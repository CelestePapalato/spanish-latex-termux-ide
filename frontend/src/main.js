import { api, Socket } from './api.js';
import { createEditor } from './editor.js';
import { LspClient } from './lsp.js';
import { PdfViewer } from './pdfview.js';
import { $, toast, pickList, showInfo } from './ui.js';
import { icon, hydrate, fileIcon } from './icons.js';

const TEXT_EXT = /\.(tex|sty|cls|bib|bst|txt|md|def|cfg|ltx|dtx|ins|csv|json|ya?ml|py|sh|clo|fd|tikz|latex)$/i;
const prefs = Object.assign({ theme: 'auto', font: 15, wrap: true, project: null, side: null, view: null, qk: false, pdfTools: false }, JSON.parse(localStorage.getItem('latexide-prefs') || '{}'));
const savePrefs = () => localStorage.setItem('latexide-prefs', JSON.stringify(prefs));

const S = {
  project: null, settings: {}, tree: [], open: [], cur: null, dirty: new Set(), expanded: new Set(), selDir: '',
  compileDiags: [], lspDiags: new Map(), filter: 'all', logTab: 'problems', health: null, saveT: 0, compiling: false,
  view: 'split', projects: [], bannerDismissed: false, tlmgr: false,
};

const sock = new Socket();
const lsp = new LspClient(sock);
const mainFile = () => S.settings.main || null;

const editor = createEditor($('#editor'), {
  lsp,
  hooks: {
    save: () => saveAll(S.settings.autoCompile), compile: () => compile(), change: onEdit,
    navigate: (p, l, c) => openAt(p, l, c), toast, list: pickList, info: showInfo, mainFile,
  },
});
const pdf = new PdfViewer({ onBackward: syncBackward });

/* ---------- panels / theme ---------- */
const overlay = () => matchMedia('(max-width:699px)').matches;
const wide = () => matchMedia('(min-width:700px)').matches;
function setSide(open, persist = true) {
  $('#layout').dataset.side = open ? 'open' : 'closed';
  $('#btn-side').classList.toggle('active', open);
  if (persist && !overlay()) { prefs.side = open; savePrefs(); }
  setTimeout(() => pdf.layout(), 60);
}
const sideOpen = () => $('#layout').dataset.side === 'open';
$('#btn-side').onclick = () => setSide(!sideOpen());
$('#f-close').onclick = () => setSide(false);
$('#side-backdrop').onclick = () => setSide(false);

// View: 'editor' | 'split' (wide screens only) | 'pdf'. The user's choice is stored in prefs.view.
function setView(v, byUser = false) {
  if (byUser) { prefs.view = v; savePrefs(); }
  if (v === 'split' && !wide()) v = 'editor';
  S.view = v;
  $('#layout').dataset.view = v;
  document.querySelectorAll('#viewseg button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  if (v !== 'editor') setTimeout(() => pdf.layout(), 60);
}
// Used by code (not by the user): makes sure the requested panel is visible without hiding the other one when there is room.
function setPane(name) {
  if (name === 'pdf' && S.view === 'editor') setView(wide() ? 'split' : 'pdf');
  else if (name === 'editor' && S.view === 'pdf') setView(wide() ? 'split' : 'editor');
}
document.querySelectorAll('#viewseg button').forEach(b => { b.onclick = () => setView(b.dataset.view, true); });
matchMedia('(min-width:700px)').addEventListener('change', () => setView(prefs.view || (wide() ? 'split' : 'editor')));

// Logs: bottom drawer, hidden by default.
function setLogs(open) {
  $('#logs').hidden = !open;
  $('#btn-logs').classList.toggle('active', open);
  $('#btn-logs').setAttribute('aria-expanded', String(open));
  if (open) { renderProblems(); const o = $('#output'); o.scrollTop = o.scrollHeight; }
  setTimeout(() => pdf.layout(), 60);
}
$('#btn-logs').onclick = () => setLogs($('#logs').hidden);
$('#logs-close').onclick = () => setLogs(false);

// "More options" menu
function setMenu(open) {
  $('#menu').hidden = !open;
  $('#btn-menu').classList.toggle('active', open);
  $('#btn-menu').setAttribute('aria-expanded', String(open));
}
$('#btn-menu').onclick = e => { e.stopPropagation(); setMenu($('#menu').hidden); };
document.addEventListener('click', e => { if (!$('#menu').hidden && !e.target.closest('#menu')) setMenu(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#menu').hidden) setMenu(false); });

// PDF toolbar (zoom, navigation, search) and quick keys: collapsed by default.
function setPdfTools(open, persist = true) {
  $('#pdf-toolbar').hidden = !open;
  $('#pdf-tools-toggle').setAttribute('aria-expanded', String(open));
  if (persist) { prefs.pdfTools = open; savePrefs(); }
  setTimeout(() => pdf.layout(), 30);
}
$('#pdf-tools-toggle').onclick = () => setPdfTools($('#pdf-toolbar').hidden);
function setQk(open, persist = true) {
  $('#qk').dataset.open = String(open);
  $('#qk-toggle').setAttribute('aria-expanded', String(open));
  if (persist) { prefs.qk = open; savePrefs(); }
}
$('#qk-toggle').addEventListener('mousedown', e => e.preventDefault());
$('#qk-toggle').onclick = () => setQk($('#qk').dataset.open !== 'true');

// Theme: 'auto' follows the system; 'dark'/'light' are explicit.
const mqDark = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => prefs.theme === 'dark' || (prefs.theme !== 'light' && mqDark.matches);
function applyPrefs() {
  const dark = isDark();
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  editor.setTheme(dark); editor.setFont(prefs.font); editor.setWrap(prefs.wrap);
  $('#m-theme-ico').innerHTML = icon(dark ? 'sun' : 'moon', 18);
  $('#m-theme-lbl').textContent = dark ? 'Mudar para tema claro' : 'Mudar para tema escuro';
}
mqDark.addEventListener('change', () => { if (prefs.theme === 'auto') applyPrefs(); });
$('#m-theme').onclick = () => { prefs.theme = isDark() ? 'light' : 'dark'; savePrefs(); applyPrefs(); setMenu(false); };

function setStatus(t, cls = '') { const s = $('#status'); s.textContent = t; s.className = 'status ' + cls; }

/* ---------- files ---------- */
const flat = (nodes, out = []) => { for (const n of nodes) { if (n.type === 'dir') flat(n.children, out); else out.push(n.path); } return out; };

async function refreshTree() {
  try { S.tree = await api.tree(S.project); } catch (e) { toast(e.message); return; }
  renderTree();
}

function renderTree() {
  const ul = $('#tree');
  ul.textContent = '';
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      const isDir = n.type === 'dir', open = S.expanded.has(n.path);
      const li = document.createElement('li');
      li.className = 'row' + (n.path === S.cur ? ' sel' : '');
      li.style.paddingLeft = 4 + depth * 14 + 'px';
      li.title = n.path;
      const chev = document.createElement('span');
      chev.className = 'chev ico';
      chev.innerHTML = isDir ? icon(open ? 'chevron-down' : 'chevron-right', 14) : '';
      const [ic, color] = isDir ? [open ? 'folder-open' : 'folder', '#fbbf24'] : fileIcon(n.name);
      const fi = document.createElement('span');
      fi.className = 'fi ico'; fi.style.color = color; fi.innerHTML = icon(ic, 16);
      const nm = document.createElement('span');
      nm.className = 'nm'; nm.textContent = n.name;
      li.onclick = () => {
        if (isDir) { open ? S.expanded.delete(n.path) : S.expanded.add(n.path); S.selDir = n.path; renderTree(); }
        else { S.selDir = n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : ''; openAt(n.path); }
      };
      li.append(chev, fi, nm);
      if (n.path === mainFile()) { const st = document.createElement('span'); st.className = 'main-star ico'; st.title = 'Arquivo principal'; st.innerHTML = icon('star', 13); li.append(st); }
      const mb = document.createElement('button');
      mb.className = 'mini'; mb.innerHTML = icon('more', 16); mb.title = 'Ações'; mb.setAttribute('aria-label', 'Ações');
      mb.onclick = ev => { ev.stopPropagation(); fileMenu(n); };
      li.append(mb);
      ul.append(li);
      if (isDir && open) walk(n.children, depth + 1);
    }
  };
  walk(S.tree, 0);
  if (!S.tree.length) ul.innerHTML = '<li class="empty">Projeto vazio. Use os botões acima para criar ou importar arquivos.</li>';
}

function fileMenu(n) {
  const items = [];
  if (n.type === 'dir') {
    items.push({ label: 'Novo arquivo aqui', onPick: () => newFile(n.path) }, { label: 'Nova subpasta aqui', onPick: () => newFolder(n.path) });
  } else {
    items.push({ label: 'Abrir', onPick: () => openAt(n.path) });
    if (/\.tex$/i.test(n.path)) items.push({ label: 'Definir como arquivo principal', onPick: () => setMain(n.path) });
  }
  items.push({ label: 'Renomear / mover', onPick: () => renamePath(n) }, { label: 'Excluir', onPick: () => deletePath(n) });
  pickList(n.path, items);
}

async function newFile(dir = S.selDir) {
  const p = prompt('Caminho do novo arquivo', (dir ? dir + '/' : '') + 'novo.tex');
  if (!p) return;
  try { await api.write(S.project, p.trim(), ''); await refreshTree(); await openAt(p.trim()); } catch (e) { toast(e.message); }
}
async function newFolder(dir = S.selDir) {
  const p = prompt('Caminho da nova pasta', (dir ? dir + '/' : '') + 'figuras');
  if (!p) return;
  try { await api.mkdir(S.project, p.trim()); S.expanded.add(p.trim()); await refreshTree(); } catch (e) { toast(e.message); }
}
async function renamePath(n) {
  const to = prompt('Novo caminho', n.path);
  if (!to || to === n.path) return;
  try {
    await saveAll(false);
    await api.rename(S.project, n.path, to.trim());
    for (const f of [...S.open]) if (f === n.path || f.startsWith(n.path + '/')) closeTab(f, true);
    if (mainFile() === n.path) await api.saveSettings(S.project, { mainFile: to.trim() });
    await loadSettings(); await refreshTree();
  } catch (e) { toast(e.message); }
}
async function deletePath(n) {
  if (!confirm(`Excluir “${n.path}”? Isso não pode ser desfeito.`)) return;
  try {
    for (const f of [...S.open]) if (f === n.path || f.startsWith(n.path + '/')) closeTab(f, true);
    await api.remove(S.project, n.path); await refreshTree();
  } catch (e) { toast(e.message); }
}
async function setMain(p) { await api.saveSettings(S.project, { mainFile: p }); await loadSettings(); renderTree(); toast(`Principal: ${p}`); }

$('#f-new').onclick = () => newFile();
$('#f-dir').onclick = () => newFolder();
$('#f-refresh').onclick = refreshTree;
$('#f-up').onclick = () => $('#f-input').click();
$('#f-input').onchange = async e => {
  const files = [...e.target.files];
  e.target.value = '';
  try {
    for (const f of files) await api.write(S.project, (S.selDir ? S.selDir + '/' : '') + f.name, f);
    toast(`${files.length} arquivo(s) importado(s)`);
    await refreshTree();
  } catch (err) { toast(err.message); }
};

/* ---------- file tabs and editor ---------- */
function renderTabs() {
  const box = $('#file-tabs');
  box.textContent = '';
  for (const p of S.open) {
    const b = document.createElement('button');
    b.className = 'ftab' + (p === S.cur ? ' active' : '');
    const name = p.split('/').pop(), [ic, color] = fileIcon(name);
    const fi = document.createElement('span');
    fi.className = 'ico'; fi.style.color = color; fi.innerHTML = icon(ic, 15);
    b.append(fi, document.createTextNode(name));
    if (S.dirty.has(p)) { const d = document.createElement('span'); d.className = 'dot'; d.title = 'Não salvo'; b.append(d); }
    const x = document.createElement('span');
    x.className = 'x ico'; x.innerHTML = icon('x', 14);
    x.onclick = ev => { ev.stopPropagation(); closeTab(p); };
    b.title = p; b.append(x);
    b.onclick = () => openAt(p);
    box.append(b);
  }
}

async function openFile(path) {
  if (!TEXT_EXT.test(path)) { toast('Arquivo não editável (binário)'); return false; }
  if (S.cur === path && editor.has(path)) return true;
  try {
    let text;
    if (!S.open.includes(path) || !editor.has(path)) text = await api.readText(S.project, path);
    if (!S.open.includes(path)) S.open.push(path);
    editor.open(path, text);
    S.cur = path;
    renderTabs(); renderTree();
    return true;
  } catch (e) { toast(e.message); return false; }
}

async function openAt(path, line, col) {
  if (!(await openFile(path))) return;
  if (line) editor.goto(line, col || 0);
  if (overlay() && sideOpen()) setSide(false);
  setPane('editor');
}

function closeTab(path, force) {
  if (!force && S.dirty.has(path)) saveAll(false);
  S.open = S.open.filter(p => p !== path);
  S.dirty.delete(path);
  const wasCur = S.cur === path;
  editor.close(path);
  if (wasCur) { S.cur = null; if (S.open.length) openFile(S.open[S.open.length - 1]); }
  renderTabs(); renderTree();
}

function onEdit(path) {
  S.dirty.add(path);
  renderTabs();
  clearTimeout(S.saveT);
  S.saveT = setTimeout(() => saveAll(S.settings.autoCompile), S.settings.debounceMs || 1000);
}

async function saveAll(withCompile) {
  clearTimeout(S.saveT);
  const paths = [...S.dirty];
  if (!paths.length) return false;
  try {
    for (let i = 0; i < paths.length; i++) {
      const text = editor.textOf(paths[i]);
      if (text != null) await api.write(S.project, paths[i], text, withCompile && i === paths.length - 1);
      S.dirty.delete(paths[i]);
      if (paths[i] === S.cur) lsp.didSave(paths[i]);
    }
  } catch (e) { toast('Erro ao salvar: ' + e.message); }
  renderTabs();
  return true;
}

/* ---------- compilation ---------- */
async function compile() {
  await saveAll(false);
  try { await api.compile(S.project); } catch (e) { toast(e.message); }
}
$('#btn-compile').onclick = compile;
$('#btn-stop').onclick = () => api.stop(S.project).catch(() => {});
$('#auto-compile').onchange = e => { S.settings.autoCompile = e.target.checked; api.saveSettings(S.project, { autoCompile: e.target.checked }); };
$('#compiler-select').onchange = e => { S.settings.compiler = e.target.value; api.saveSettings(S.project, { compiler: e.target.value }); };

const ours = m => m.project === S.project;
sock.on('compilation_started', m => {
  if (!ours(m)) return;
  S.compiling = true;
  $('#btn-compile').disabled = true; $('#btn-compile').classList.add('busy'); $('#btn-compile .lbl').textContent = 'Compilando…';
  setStatus(`${m.compiler}…`, 'busy');
  $('#output').textContent = '';
});
sock.on('log', m => {
  if (!ours(m)) return;
  const o = $('#output');
  o.textContent += m.text;
  if (o.textContent.length > 300000) o.textContent = o.textContent.slice(-200000);
  o.scrollTop = o.scrollHeight;
});
function endCompile(m, ok) {
  S.compiling = false;
  $('#btn-compile').disabled = false; $('#btn-compile').classList.remove('busy'); $('#btn-compile .lbl').textContent = 'Compilar';
  S.compileDiags = m.diagnostics || [];
  if (m.error) { S.compileDiags = [{ severity: 'error', file: null, line: null, message: m.error }]; $('#output').textContent += `\n${m.error}\n`; }
  const errs = S.compileDiags.filter(d => d.severity === 'error').length;
  setStatus(ok ? `✓ ok${m.ms ? ` (${(m.ms / 1000).toFixed(1)}s)` : ''}` : `✗ ${errs} erro(s)`, ok ? 'ok' : 'err');
  editor.setCompileDiags(S.compileDiags);
  renderProblems();
}
sock.on('compilation_finished', m => { if (ours(m)) endCompile(m, true); });
sock.on('compilation_failed', m => { if (ours(m)) endCompile(m, false); });
sock.on('pdf_updated', m => { if (ours(m)) pdf.load(); });
sock.on('diagnostics_updated', m => {
  if (!ours(m)) return;
  S.lspDiags.set(m.path, m.diagnostics);
  editor.setLspDiags(m.path, m.diagnostics);
  renderProblems();
});
sock.on('file_changed', async m => {
  if (!ours(m)) return;
  if (S.open.includes(m.path) && !S.dirty.has(m.path)) {
    try { editor.reload(m.path, await api.readText(S.project, m.path)); } catch {}
  }
  clearTimeout(S.treeT); S.treeT = setTimeout(refreshTree, 400);
});
sock.on('error', m => toast(m.message));
sock.on('open', () => { if (S.project) sock.send({ type: 'open_project', project: S.project }); });

lsp.onReady = () => editor.resync();
lsp.onStatus = (st, hint) => {
  const el = $('#lsp-status');
  el.textContent = { ready: 'TexLab: ✓', starting: 'TexLab: …', stopped: 'TexLab: parado', unavailable: 'TexLab: ausente' }[st] || 'TexLab';
  el.className = 'pill ' + (st === 'ready' ? 'ok' : st === 'unavailable' ? 'err' : '');
  el.title = st === 'unavailable' ? `Instale com: ${hint}` : 'TexLab (LSP)';
};

/* ---------- logs / problems ---------- */
function allProblems() {
  const sevOf = { 1: 'error', 2: 'warning', 3: 'info', 4: 'info' };
  const out = S.compileDiags.map(d => ({ ...d, src: 'TeX' }));
  for (const [file, arr] of S.lspDiags) for (const d of arr) out.push({ severity: sevOf[d.severity] || 'error', file, line: d.range.start.line + 1, col: d.range.start.character, message: d.message, src: 'TexLab' });
  return out;
}
function renderProblems() {
  const all = allProblems();
  const errs = all.filter(d => d.severity === 'error').length, warns = all.filter(d => d.severity === 'warning').length;
  const bd = $('#logs-badge'), n = errs || warns;
  bd.hidden = !n; bd.textContent = n > 99 ? '99+' : String(n); bd.classList.toggle('warn', !errs);
  $('#btn-logs').title = errs ? `Logs: ${errs} erro(s)` : warns ? `Logs: ${warns} aviso(s)` : 'Logs e problemas';
  const box = $('#problems');
  box.textContent = '';
  const list = all.filter(d => S.filter === 'all' || d.severity === S.filter);
  if (!list.length) { box.innerHTML = `<div class="empty">${icon('check-circle', 18)}Nenhum problema.</div>`; return; }
  for (const d of list) {
    const wrap = document.createElement('div');
    wrap.className = 'prob-wrap';
    const b = document.createElement('button');
    b.className = `prob ${d.severity}`;
    const ic = d.severity === 'error' ? 'circle-x' : d.severity === 'warning' ? 'alert' : 'info';
    const where = `${d.file || mainFile() || ''}${d.line ? ':' + d.line : ''}`;
    b.innerHTML = `<span class="pi ico">${icon(ic, 17)}</span><span class="pt"><span></span><small></small></span>`;
    b.querySelector('.pt > span').textContent = d.message;
    b.querySelector('small').textContent = `${where}  ·  ${d.src}${d.hint ? '\n' + d.hint : ''}`;
    b.onclick = () => { const f = d.file || mainFile(); if (f) { openAt(f, d.line || 1, d.col || 0); if (overlay()) setLogs(false); } };
    wrap.append(b);
    const miss = /File `([^']+)' not found|I can't find file `([^']+)'/.exec(d.message);
    if (miss && S.tlmgr) {
      const file = miss[1] || miss[2];
      const a = document.createElement('button');
      a.className = 'prob-act';
      a.innerHTML = `${icon('package', 15)}Buscar pacote para ${file.replace(/[<>&]/g, '')}`;
      a.onclick = () => openPkgs({ q: file, byFile: true, recompile: true });
      wrap.append(a);
    }
    box.append(wrap);
  }
}
function switchLog(t) {
  S.logTab = t;
  document.querySelectorAll('[data-lt]').forEach(b => b.classList.toggle('active', b.dataset.lt === t));
  $('#problems').hidden = t !== 'problems'; $('#output').hidden = t !== 'output';
}
document.querySelectorAll('[data-lt]').forEach(b => { b.onclick = () => switchLog(b.dataset.lt); });
document.querySelectorAll('[data-filter]').forEach(b => {
  b.onclick = () => { S.filter = b.dataset.filter; document.querySelectorAll('[data-filter]').forEach(x => x.classList.toggle('active', x === b)); renderProblems(); };
});

/* ---------- SyncTeX ---------- */
async function syncForward() {
  if (!S.cur) return;
  try {
    await saveAll(false);
    const r = await api.syncForward(S.project, S.cur, editor.cursorLine(), editor.cursorCol());
    setPane('pdf');
    setTimeout(() => pdf.goTo(r.page, r.y), 80);
  } catch (e) { toast(e.message); }
}
async function syncBackward(page, x, y) {
  try { const r = await api.syncBackward(S.project, page, x.toFixed(2), y.toFixed(2)); openAt(r.file, r.line, 0); } catch (e) { toast(e.message); }
}

/* ---------- quick keys (touch) ---------- */
$('#quickkeys').addEventListener('mousedown', e => e.preventDefault());
$('#quickkeys').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.ins != null) editor.insert(b.dataset.ins, ['{}', '[]', '$$'].includes(b.dataset.ins) ? 1 : 0);
  else if (b.dataset.cmd === 'left') editor.move(-1);
  else if (b.dataset.cmd === 'right') editor.move(1);
  else if (b.dataset.cmd === 'sync') syncForward();
  else editor.cmd[b.dataset.cmd] && editor.cmd[b.dataset.cmd]();
});

/* ---------- projects and settings ---------- */
async function loadSettings() {
  S.settings = await api.settings(S.project);
  $('#auto-compile').checked = !!S.settings.autoCompile;
  $('#compiler-select').value = S.settings.compiler;
}

async function selectProject(name) {
  await saveAll(false);
  S.project = name; prefs.project = name; savePrefs();
  S.open = []; S.cur = null; S.dirty.clear(); S.compileDiags = []; S.lspDiags.clear(); S.expanded.clear(); S.selDir = '';
  $('#side-title').textContent = name; $('#proj-name').textContent = name; document.title = `${name} · LaTeX IDE`;
  editor.reset(); renderTabs(); renderProblems();
  $('#output').textContent = ''; setStatus('');
  lsp.setProject(name);
  try {
    await loadSettings(); await refreshTree();
    sock.send({ type: 'open_project', project: name });
    if (S.settings.main) await openFile(S.settings.main);
    pdf.url = api.pdfUrl(name); pdf.doc = null; pdf.box.textContent = ''; pdf.load();
  } catch (e) { toast(e.message); }
}

async function loadProjects(select) {
  const r = await api.projectsDetailed();
  S.projects = r.details || r.projects.map(name => ({ name, mtime: 0 }));
  const names = S.projects.map(p => p.name);
  const pick = select || (names.includes(prefs.project) ? prefs.project : names[0]);
  if (pick) await selectProject(pick);
  else { S.project = null; $('#proj-name').textContent = '—'; openHome(); }
}

/* ---------- projects screen (logo) ---------- */
const NAME_OK = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/;
function ago(ms) {
  if (!ms) return '';
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return 'agora há pouco';
  if (d < 3600) return `há ${Math.floor(d / 60)} min`;
  if (d < 86400) return `há ${Math.floor(d / 3600)} h`;
  if (d < 86400 * 7) return `há ${Math.floor(d / 86400)} dia(s)`;
  return new Date(ms).toLocaleDateString('pt-BR');
}
function renderHome() {
  const list = $('#home-list'), f = $('#home-filter').value.trim().toLowerCase();
  const all = [...S.projects].sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name));
  $('#home-count').textContent = all.length ? `(${all.length})` : '';
  $('#home-filter').hidden = all.length < 7;
  list.textContent = '';
  const shown = all.filter(p => !f || p.name.toLowerCase().includes(f));
  if (!shown.length) { list.innerHTML = `<li class="empty">${all.length ? 'Nenhum projeto com esse nome.' : 'Você ainda não tem projetos. Crie o primeiro acima.'}</li>`; return; }
  for (const p of shown) {
    const li = document.createElement('li');
    li.className = 'pcard' + (p.name === S.project ? ' cur' : '');
    const open = document.createElement('button');
    open.className = 'open';
    open.innerHTML = `<span class="pi ico">${icon(p.name === S.project ? 'folder-open' : 'folder', 22)}</span><span class="tx"><span class="nm"></span><small></small></span>`;
    open.querySelector('.nm').textContent = p.name;
    if (p.name === S.project) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'aberto'; open.querySelector('.nm').append(t); }
    open.querySelector('small').textContent = p.mtime ? `Modificado ${ago(p.mtime)}` : '';
    open.onclick = async () => { $('#home').close(); if (p.name !== S.project) await selectProject(p.name); };
    const del = document.createElement('button');
    del.className = 'del ib sm'; del.title = `Excluir ${p.name}`; del.setAttribute('aria-label', `Excluir ${p.name}`);
    del.innerHTML = icon('trash', 17);
    del.onclick = async () => {
      if (!confirm(`Excluir o projeto “${p.name}” e todos os seus arquivos? Isso não pode ser desfeito.`)) return;
      try {
        await api.deleteProject(p.name);
        if (p.name === S.project) { S.dirty.clear(); S.project = null; $('#home').close(); await loadProjects(); }
        else { S.projects = S.projects.filter(x => x.name !== p.name); renderHome(); }
      } catch (e) { toast(e.message); }
    };
    li.append(open, del);
    list.append(li);
  }
}
async function openHome() {
  setMenu(false);
  try { S.projects = (await api.projectsDetailed()).details || S.projects; } catch (e) { toast(e.message); }
  $('#home-filter').value = '';
  renderHome();
  $('#home-close').hidden = !S.project;
  if (!$('#home').open) $('#home').showModal();
  $('#new-box').open = true;
  if (!matchMedia('(pointer:coarse)').matches) $('#new-name').focus();
}
$('#btn-home').onclick = openHome;
$('#btn-project').onclick = openHome;
$('#home-close').onclick = () => $('#home').close();
$('#home-filter').oninput = renderHome;
$('#new-form').onsubmit = async e => {
  e.preventDefault();
  const name = $('#new-name').value.trim();
  if (!NAME_OK.test(name)) { toast('Nome inválido: use letras, números, espaço, ponto, hífen ou sublinhado (até 64).'); return; }
  try {
    await api.createProject(name);
    $('#new-name').value = ''; $('#home').close();
    await loadProjects(name);
    toast(`Projeto “${name}” criado`);
  } catch (err) { toast(err.message); }
};
// clicking outside the dialog closes it
for (const id of ['#home', '#pkgs']) {
  const dlg = $(id);
  dlg.addEventListener('mousedown', e => {
    const r = dlg.getBoundingClientRect();
    if (e.target === dlg && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) dlg.close();
  });
}

/* ---------- download PDF ---------- */
async function downloadPdf() {
  setMenu(false);
  if (!S.project) return;
  try {
    const r = await fetch(api.pdfUrl(S.project) + '?download=1', { cache: 'no-store' });
    if (!r.ok) { toast(r.status === 404 ? 'Ainda não há PDF. Compile primeiro.' : 'Não foi possível baixar o PDF'); return; }
    const blob = await r.blob();
    const name = ((S.settings.main || 'documento').split('/').pop().replace(/\.tex$/i, '') || 'documento') + '.pdf';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 15000);
    toast(`PDF baixado: ${name}`);
  } catch (e) { toast(e.message); }
}
$('#pdf-download').onclick = downloadPdf;
$('#m-download').onclick = downloadPdf;

/* ---------- TeX Live packages (tlmgr) ---------- */
const pkg = { avail: false, busy: false, recompile: false };
function setPkgBusy(b) {
  pkg.busy = b;
  $('#pkg-stop').hidden = !b;
  document.querySelectorAll('#pkg-results button').forEach(x => { x.disabled = b; });
  $('#pkg-form button').disabled = b || !pkg.avail;
}
function pkgMsg(t) { const d = document.createElement('div'); d.className = 'empty'; d.textContent = t; return d; }
function renderPkgResults(q, results) {
  const box = $('#pkg-results');
  box.textContent = '';
  const rows = [...results];
  if (!$('#pkg-file').checked && /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(q) && !rows.some(r => r.name === q)) rows.unshift({ name: q, desc: 'Instalar com este nome exato', direct: true });
  if (!rows.length) { box.append(pkgMsg('Nenhum pacote encontrado.')); return; }
  for (const r of rows) {
    const d = document.createElement('div');
    d.className = 'pkg';
    d.innerHTML = '<span class="tx"><span class="nm"></span><small></small></span>';
    d.querySelector('.nm').textContent = r.name;
    d.querySelector('small').textContent = r.desc || '';
    d.querySelector('small').title = r.desc || '';
    const b = document.createElement('button');
    b.innerHTML = `${icon('download', 15)}Instalar`;
    b.disabled = pkg.busy;
    b.onclick = () => installPkg(r.name);
    d.append(b);
    box.append(d);
  }
}
async function searchPkgs() {
  const q = $('#pkg-q').value.trim();
  if (!q) return;
  const box = $('#pkg-results');
  box.textContent = ''; box.append(pkgMsg('Buscando… (precisa de internet)'));
  try { renderPkgResults(q, (await api.tlmgrSearch(q, $('#pkg-file').checked)).results); }
  catch (e) { box.textContent = ''; box.append(pkgMsg(e.message)); }
}
async function installPkg(name) {
  try { await api.tlmgrInstall([name]); } catch (e) { toast(e.message); }
}
async function openPkgs(opts = {}) {
  setMenu(false);
  if (!$('#pkgs').open) $('#pkgs').showModal();
  let st = { available: false };
  try { st = await api.tlmgrStatus(); } catch (e) { toast(e.message); }
  pkg.avail = !!st.available;
  const un = $('#pkg-unavail');
  un.hidden = pkg.avail;
  un.textContent = 'tlmgr não encontrado. Instale o TeX Live no Termux: bash scripts/install-texlive.sh';
  setPkgBusy(!!st.busy);
  if (st.busy && st.job) { $('#pkg-log').textContent = st.job.log; $('#pkg-logbox').open = true; }
  if (opts.q != null) {
    $('#pkg-q').value = opts.q; $('#pkg-file').checked = !!opts.byFile; pkg.recompile = !!opts.recompile;
    if (pkg.avail) searchPkgs();
  } else if (!matchMedia('(pointer:coarse)').matches) $('#pkg-q').focus();
}
$('#m-packages').onclick = () => openPkgs();
$('#pkg-form').onsubmit = e => { e.preventDefault(); if (pkg.avail) searchPkgs(); };
$('#pkg-close').onclick = () => $('#pkgs').close();
$('#pkg-stop').onclick = () => api.tlmgrStop().catch(() => {});
sock.on('tlmgr_started', () => { setPkgBusy(true); $('#pkg-log').textContent = ''; $('#pkg-logbox').open = true; });
sock.on('tlmgr_log', m => { const l = $('#pkg-log'); l.textContent += m.text; l.scrollTop = l.scrollHeight; });
sock.on('tlmgr_done', m => {
  setPkgBusy(false);
  toast(m.ok ? `Instalado: ${m.packages.join(', ')}` : 'A instalação falhou. Veja a saída no diálogo de pacotes.', m.ok ? 2600 : 5000);
  if (m.ok && pkg.recompile) { pkg.recompile = false; compile(); }
});

$('#btn-settings').onclick = () => {
  setMenu(false);
  const sel = $('#set-main');
  sel.textContent = '';
  sel.append(new Option('(detectar automaticamente)', ''));
  for (const f of flat(S.tree).filter(f => /\.tex$/i.test(f))) sel.append(new Option(f, f));
  sel.value = S.settings.mainFile || '';
  $('#set-debounce').value = S.settings.debounceMs;
  $('#set-theme').value = prefs.theme; $('#set-font').value = prefs.font; $('#set-wrap').checked = prefs.wrap;
  $('#settings').showModal();
};
$('#set-cancel').onclick = () => $('#settings').close();
$('#set-save').onclick = async () => {
  prefs.theme = $('#set-theme').value;
  prefs.font = Math.min(28, Math.max(10, parseInt($('#set-font').value, 10) || 15));
  prefs.wrap = $('#set-wrap').checked;
  savePrefs(); applyPrefs();
  try {
    await api.saveSettings(S.project, { mainFile: $('#set-main').value || null, debounceMs: parseInt($('#set-debounce').value, 10) || 1000 });
    await loadSettings(); renderTree();
  } catch (e) { toast(e.message); }
  $('#settings').close();
};
$('#set-clean').onclick = async () => { try { await api.clean(S.project); toast('Arquivos auxiliares removidos'); } catch (e) { toast(e.message); } };
$('#set-delete').onclick = async () => {
  if (!confirm(`Excluir o projeto “${S.project}” e todos os seus arquivos? Isso não pode ser desfeito.`)) return;
  try { await api.deleteProject(S.project); $('#settings').close(); S.dirty.clear(); S.project = null; await loadProjects(); } catch (e) { toast(e.message); }
};
$('#picker-close').onclick = () => $('#picker').close();

/* ---------- missing-dependency warnings ---------- */
function renderBanner(h) {
  const miss = Object.entries(h.tools).filter(([, t]) => !t.found && t.level !== 'optional');
  for (const o of $('#compiler-select').options) { const t = h.tools[o.value]; o.disabled = !(t && t.found); }
  S.tlmgr = !!(h.tools.tlmgr && h.tools.tlmgr.found);
  const b = $('#banner');
  if (!miss.length || S.bannerDismissed) { b.hidden = true; return; }
  b.hidden = false;
  $('#banner-txt').textContent = `Falta instalar: ${miss.map(([n]) => n).join(', ')} — toque para ver como`;
  $('#banner-detail').textContent = miss.map(([n, t]) => `${n} não encontrado. No Termux, execute:\n  ${t.hint}`).join('\n\n');
}
$('#banner-sum').onclick = () => {
  const d = $('#banner-detail');
  d.hidden = !d.hidden;
  $('#banner-sum').setAttribute('aria-expanded', String(!d.hidden));
};
$('#banner-x').onclick = () => { S.bannerDismissed = true; $('#banner').hidden = true; };

document.addEventListener('visibilitychange', () => { if (document.hidden) saveAll(false); });
window.addEventListener('pagehide', () => saveAll(false));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

(async function init() {
  hydrate(); applyPrefs(); switchLog('problems');
  setView(prefs.view || (wide() ? 'split' : 'editor'));
  setQk(!!prefs.qk, false); setPdfTools(!!prefs.pdfTools, false);
  setSide(prefs.side == null ? matchMedia('(min-width:900px)').matches : (!overlay() && prefs.side), false);
  try {
    S.health = await api.health();
    renderBanner(S.health);
    await loadProjects();
  } catch (e) { toast('Falha ao conectar ao servidor: ' + e.message, 6000); }
})();
