import { EditorView } from '@codemirror/view';
import { P } from './icons.js';

// Color and glyph for each completion type ("type" comes from completions.js and from the LSP mapping).
const KINDS = {
  command: ['#a78bfa', '<path d="m7 4 10 16"/>'],
  function: ['#a78bfa', '<path d="m7 4 10 16"/>'],
  environment: ['#fb923c', '<path d="M8 4H5v16h3M16 4h3v16h-3"/>'],
  package: ['#34d399', '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>'],
  label: ['#60a5fa', '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>'],
  cite: ['#f472b6', P.book],
  snippet: ['#fbbf24', '<path d="M4 7h16M4 12h10M4 17h6"/>'],
  keyword: ['#38bdf8', '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3"/>'],
  variable: ['#2dd4bf', '<path d="M8 4c-3 3-3 13 0 16M16 4c3 3 3 13 0 16"/>'],
  class: ['#fbbf24', '<circle cx="12" cy="12" r="7"/>'],
  file: ['#94a3b8', P.file],
  folder: ['#94a3b8', P.folder],
  text: ['#94a3b8', '<path d="M5 6h14M12 6v14"/>'],
  namespace: ['#34d399', '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/>'],
  property: ['#2dd4bf', '<path d="M8 4c-3 3-3 13 0 16M16 4c3 3 3 13 0 16"/>'],
  constant: ['#60a5fa', '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>'],
};

const glyph = (color, path) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  return { content: '""', display: 'block', width: '20px', height: '20px', borderRadius: '6px', backgroundColor: color, backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'center', backgroundSize: '13px' };
};

const spec = {
  '.cm-tooltip.cm-tooltip-autocomplete': { border: '1px solid var(--border) !important', borderRadius: '12px', backgroundColor: 'var(--panel2) !important', boxShadow: 'var(--shadow)', overflow: 'hidden', padding: '4px' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif', fontSize: '13.5px', maxHeight: '15.5em', minWidth: '240px' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px', minHeight: '32px', borderRadius: '8px', color: 'var(--fg)' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent-soft) !important', color: 'var(--fg) !important', outline: '1px solid var(--accent)' },
  '.cm-completionIcon': { width: '20px', padding: '0', opacity: '1', fontSize: 'inherit', display: 'flex', flex: 'none' },
  '.cm-completionLabel': { fontFamily: 'ui-monospace,Menlo,Consolas,monospace', fontSize: '13px' },
  '.cm-completionMatchedText': { textDecoration: 'none', color: 'var(--accent)', fontWeight: '700' },
  '.cm-completionDetail': { marginLeft: 'auto', paddingLeft: '14px', opacity: '.6', fontStyle: 'normal', fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '16em' },
  '.cm-tooltip .cm-completionInfo': { backgroundColor: 'var(--panel) !important', border: '1px solid var(--border)', borderRadius: '10px', padding: '8px 10px', fontSize: '12px', whiteSpace: 'pre-wrap', maxWidth: '320px', color: 'var(--fg)', boxShadow: 'var(--shadow)' },
  '.cm-tooltip': { border: '1px solid var(--border)', borderRadius: '10px', backgroundColor: 'var(--panel2)', color: 'var(--fg)' },
  '.cm-panels': { backgroundColor: 'var(--panel)', color: 'var(--fg)', borderColor: 'var(--border)' },
};
for (const [k, [c, p]] of Object.entries(KINDS)) spec[`.cm-completionIcon-${k}::after`] = glyph(c, p);
// CodeMirror's default icon is text-based; clear whatever is left over for unknown types
spec['.cm-completionIcon::after'] = { content: '""', display: 'block', width: '20px', height: '20px', borderRadius: '6px', backgroundColor: '#94a3b8' };
for (const [k, [c, p]] of Object.entries(KINDS)) spec[`.cm-completionIcon-${k}::after`] = glyph(c, p);

export const uiTheme = EditorView.theme(spec);
