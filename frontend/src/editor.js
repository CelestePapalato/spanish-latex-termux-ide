import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, hoverTooltip } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from '@codemirror/commands';
import { StreamLanguage, indentOnInput, bracketMatching, syntaxHighlighting, defaultHighlightStyle, foldGutter, foldKeymap, indentUnit } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { searchKeymap, highlightSelectionMatches, search, openSearchPanel } from '@codemirror/search';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, startCompletion, acceptCompletion } from '@codemirror/autocomplete';
import { lintGutter, lintKeymap, setDiagnostics } from '@codemirror/lint';
import { oneDark } from '@codemirror/theme-one-dark';
import { localComplete } from './completions.js';
import { uiTheme } from './cm-theme.js';

const latex = StreamLanguage.define(stex);
const latexData = latex.data.of({ commentTokens: { line: '%' }, closeBrackets: { brackets: ['(', '[', '{', '$'] } });
const fontTheme = px => EditorView.theme({ '&': { fontSize: px + 'px', height: '100%' }, '.cm-scroller': { fontFamily: 'ui-monospace,Menlo,Consolas,monospace', overflow: 'auto' } });
const mdText = c => (!c ? '' : typeof c === 'string' ? c : Array.isArray(c) ? c.map(mdText).join('\n\n') : c.value || '');
const SEV = { 1: 'error', 2: 'warning', 3: 'info', 4: 'info' };
// LSP CompletionItemKind -> popup type (icon)
const KIND = { 1: 'text', 2: 'function', 3: 'command', 4: 'function', 5: 'cite', 6: 'variable', 7: 'class', 8: 'class', 9: 'package', 10: 'variable', 12: 'text', 13: 'environment', 14: 'keyword', 15: 'snippet', 17: 'file', 18: 'label', 19: 'folder', 20: 'environment', 21: 'label', 22: 'class' };
const sleep = (ms, v = null) => new Promise(r => setTimeout(() => r(v), ms));

export function createEditor(parent, { lsp, hooks }) {
  const themeC = new Compartment(), fontC = new Compartment(), wrapC = new Compartment();
  let dark = true, font = 15, wrap = true, cur = null, syncTimer = null, silent = false;
  const states = new Map();
  const lspDiags = new Map();
  let compileDiags = [];

  const toLsp = (state, p) => { const l = state.doc.lineAt(p); return { line: l.number - 1, character: p - l.from }; };
  const fromLsp = (state, p) => { const l = state.doc.line(Math.min(Math.max(p.line + 1, 1), state.doc.lines)); return Math.min(l.from + p.character, l.to); };
  const flush = () => { if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; if (cur) lsp.didChange(cur, view.state.doc.toString()); } };
  const pos = () => toLsp(view.state, view.state.selection.main.head);

  async function complete(ctx) {
    if (!cur) return null;
    const line = ctx.state.doc.lineAt(ctx.pos), before = line.text.slice(0, ctx.pos - line.from);
    if (/(^|[^\\])%/.test(before)) return null; // inside a comment
    const local = localComplete(ctx.state, ctx.pos, before, ctx.explicit);
    if (!local) return null;
    let min = local.from;
    const options = [...local.options], seen = new Set(options.map(o => o.label));
    if (lsp.ready) {
      flush();
      // wait for TexLab for up to 0.9 s; if it takes longer, show only the local (instant) suggestions
      const r = await Promise.race([lsp.request('textDocument/completion', { textDocument: lsp.td(cur), position: toLsp(ctx.state, ctx.pos), context: { triggerKind: ctx.explicit ? 1 : 2 } }), sleep(900)]);
      if (ctx.aborted) return null;
      const items = r ? (Array.isArray(r) ? r : r.items || []).slice(0, 200) : [];
      for (const it of items) {
        const label = it.filterText || it.label;
        if (seen.has(label)) continue;
        seen.add(label);
        const te = it.textEdit, range = te && (te.range || te.replace);
        const start = range ? fromLsp(ctx.state, range.start) : local.from;
        const end = range ? fromLsp(ctx.state, range.end) : ctx.pos;
        const insert = (te && te.newText) ?? it.insertText ?? it.label;
        if (range) min = Math.min(min, start);
        const doc = it.documentation && (typeof it.documentation === 'string' ? it.documentation : it.documentation.value);
        options.push({
          label, displayLabel: it.label, detail: it.detail, info: doc || undefined, type: KIND[it.kind] || (label.startsWith('\\') ? 'command' : 'text'),
          apply: (v, _c, _f, t) => v.dispatch({ changes: { from: start, to: Math.max(end, t), insert }, selection: { anchor: start + insert.length }, userEvent: 'input.complete' }),
        });
      }
    }
    if (!options.length) return null;
    return { from: min, options, validFor: /^[\\\w@:.\-*\/]*$/ };
  }

  const hover = hoverTooltip(async (v, p) => {
    if (!cur || !lsp.ready) return null;
    flush();
    const r = await lsp.request('textDocument/hover', { textDocument: lsp.td(cur), position: toLsp(v.state, p) });
    const text = r && mdText(r.contents).trim();
    if (!text) return null;
    return { pos: p, above: true, create: () => { const d = document.createElement('div'); d.className = 'lsp-hover'; d.textContent = text; return { dom: d }; } };
  }, { hoverTime: 400 });

  const extensions = [
    lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), history(), foldGutter(), drawSelection(), dropCursor(),
    EditorState.allowMultipleSelections.of(true), indentOnInput(), syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(), closeBrackets(), autocompletion({ override: [complete], activateOnTyping: true, activateOnTypingDelay: 40, maxRenderedOptions: 100, icons: true, closeOnBlur: true }), rectangularSelection(), crosshairCursor(),
    highlightActiveLine(), highlightSelectionMatches(), lintGutter(), search({ top: true }), latex, latexData,
    EditorState.tabSize.of(2), indentUnit.of('  '),
    EditorView.contentAttributes.of({ autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' }),
    EditorView.clickAddsSelectionRange.of(e => e.altKey || e.ctrlKey), hover,
    keymap.of([
      { key: 'Mod-s', preventDefault: true, run: () => { hooks.save(); return true; } },
      { key: 'Mod-Enter', preventDefault: true, run: () => { hooks.compile(); return true; } },
      { key: 'F12', preventDefault: true, run: () => { definition(); return true; } },
      { key: 'Tab', run: acceptCompletion },
      ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, ...lintKeymap, indentWithTab,
    ]),
    EditorView.updateListener.of(u => {
      if (!u.docChanged || !cur || silent) return;
      hooks.change(cur);
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => { syncTimer = null; lsp.didChange(cur, u.state.doc.toString()); }, 200);
    }),
    themeC.of([]), fontC.of(fontTheme(font)), wrapC.of(EditorView.lineWrapping), uiTheme,
  ];

  const view = new EditorView({ parent, state: EditorState.create({ doc: '', extensions }) });
  const reconf = () => view.dispatch({ effects: [themeC.reconfigure(dark ? oneDark : []), fontC.reconfigure(fontTheme(font)), wrapC.reconfigure(wrap ? EditorView.lineWrapping : [])] });

  function refreshDiags() {
    if (!cur) return;
    const st = view.state, n = st.doc.length, list = [];
    for (const d of lspDiags.get(cur) || []) {
      const from = fromLsp(st, d.range.start);
      let to = fromLsp(st, d.range.end);
      if (to <= from) to = Math.min(from + 1, n);
      list.push({ from, to, severity: SEV[d.severity] || 'error', message: d.message, source: d.source || 'texlab' });
    }
    for (const d of compileDiags) {
      if (d.line == null || d.severity === 'info' || (d.file || hooks.mainFile()) !== cur) continue;
      const l = st.doc.line(Math.min(Math.max(d.line, 1), st.doc.lines));
      list.push({ from: l.from, to: Math.max(l.to, Math.min(l.from + 1, n)), severity: d.severity, message: d.message, source: 'tex' });
    }
    view.dispatch(setDiagnostics(st, list.filter(d => d.from <= n && d.to <= n)));
  }

  const normLocs = r => (r ? (Array.isArray(r) ? r : [r]) : [])
    .map(l => ({ uri: l.uri || l.targetUri, range: l.range || l.targetSelectionRange }))
    .filter(l => l.uri && l.range && lsp.path(l.uri) != null);
  const go = l => hooks.navigate(lsp.path(l.uri), l.range.start.line + 1, l.range.start.character);
  const locItem = l => ({ label: `${lsp.path(l.uri)}:${l.range.start.line + 1}`, onPick: () => go(l) });

  async function definition() {
    if (!cur) return;
    flush();
    const locs = normLocs(await lsp.request('textDocument/definition', { textDocument: lsp.td(cur), position: pos() }));
    if (!locs.length) return hooks.toast('Definição não encontrada');
    locs.length === 1 ? go(locs[0]) : hooks.list('Definições', locs.map(locItem));
  }
  async function references() {
    if (!cur) return;
    flush();
    const locs = normLocs(await lsp.request('textDocument/references', { textDocument: lsp.td(cur), position: pos(), context: { includeDeclaration: true } }));
    hooks.list('Referências', locs.map(locItem));
  }
  async function outline() {
    if (!cur) return;
    flush();
    const r = await lsp.request('textDocument/documentSymbol', { textDocument: lsp.td(cur) }) || [];
    const items = [], path = cur;
    const walk = (syms, d) => { for (const s of syms) {
      const rg = s.selectionRange || (s.location && s.location.range) || s.range;
      if (rg) items.push({ label: '\u00a0\u00a0'.repeat(d) + s.name, onPick: () => hooks.navigate(path, rg.start.line + 1, rg.start.character) });
      if (s.children) walk(s.children, d + 1);
    } };
    walk(r, 0);
    hooks.list('Estrutura do documento', items);
  }
  async function hoverNow() {
    if (!cur) return;
    flush();
    const r = await lsp.request('textDocument/hover', { textDocument: lsp.td(cur), position: pos() });
    const t = r && mdText(r.contents).trim();
    t ? hooks.info('Informação', t) : hooks.toast('Sem informação neste ponto');
  }

  return {
    view,
    has: p => states.has(p) || p === cur,
    path: () => cur,
    textOf: p => (p === cur ? view.state.doc.toString() : states.has(p) ? states.get(p).doc.toString() : null),
    open(p, text) {
      if (cur && cur !== p) { flush(); states.set(cur, view.state); lsp.didClose(cur); }
      let st = states.get(p);
      if (!st) st = EditorState.create({ doc: text ?? '', extensions });
      states.delete(p);
      cur = p;
      view.setState(st); reconf();
      lsp.didOpen(p, view.state.doc.toString());
      refreshDiags();
    },
    close(p) {
      states.delete(p);
      if (cur === p) { lsp.didClose(p); cur = null; view.setState(EditorState.create({ doc: '', extensions })); reconf(); }
    },
    reload(p, text) {
      if (p === cur) { silent = true; view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }); silent = false; lsp.didChange(p, text); }
      else states.delete(p);
    },
    reset() { states.clear(); lspDiags.clear(); compileDiags = []; cur = null; view.setState(EditorState.create({ doc: '', extensions })); reconf(); },
    resync() { if (cur && lsp.ready) lsp.didOpen(cur, view.state.doc.toString()); },
    setLspDiags(p, arr) { lspDiags.set(p, arr); if (p === cur) refreshDiags(); },
    setCompileDiags(arr) { compileDiags = arr; refreshDiags(); },
    goto(line, col = 0) {
      const l = view.state.doc.line(Math.min(Math.max(line, 1), view.state.doc.lines));
      const p = Math.min(l.from + col, l.to);
      view.dispatch({ selection: { anchor: p }, effects: EditorView.scrollIntoView(p, { y: 'center' }) });
      view.focus();
    },
    cursorLine: () => view.state.doc.lineAt(view.state.selection.main.head).number,
    cursorCol: () => { const h = view.state.selection.main.head; return h - view.state.doc.lineAt(h).from; },
    setTheme(d) { dark = d; reconf(); },
    setFont(px) { font = px; reconf(); },
    setWrap(w) { wrap = w; reconf(); },
    insert(t, back = 0) {
      view.dispatch(view.state.replaceSelection(t));
      if (back) view.dispatch({ selection: { anchor: view.state.selection.main.head - back } });
      view.focus();
    },
    move(d) { const h = Math.min(Math.max(view.state.selection.main.head + d, 0), view.state.doc.length); view.dispatch({ selection: { anchor: h } }); view.focus(); },
    cmd: {
      undo: () => { undo(view); view.focus(); }, redo: () => { redo(view); view.focus(); },
      complete: () => { view.focus(); startCompletion(view); }, search: () => openSearchPanel(view),
      hover: hoverNow, def: definition, refs: references, outline,
    },
  };
}
