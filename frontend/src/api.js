const enc = encodeURIComponent;
const base = p => `/api/projects/${enc(p)}`;

async function req(method, url, { json, body, raw } = {}) {
  const opt = { method, headers: { 'X-LatexIDE': '1' } };
  if (json !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(json); }
  else if (body !== undefined) opt.body = body;
  const r = await fetch(url, opt);
  if (!r.ok) {
    let m = r.statusText;
    try { m = (await r.json()).error || m; } catch {}
    throw new Error(m);
  }
  if (raw) return r;
  return (r.headers.get('content-type') || '').includes('json') ? r.json() : r.text();
}

export const api = {
  health: () => req('GET', '/api/health'),
  projects: () => req('GET', '/api/projects').then(r => r.projects),
  projectsDetailed: () => req('GET', '/api/projects'),
  createProject: name => req('POST', '/api/projects', { json: { name } }),
  deleteProject: p => req('DELETE', base(p)),
  tree: p => req('GET', `${base(p)}/tree`).then(r => r.tree),
  settings: p => req('GET', `${base(p)}/settings`),
  saveSettings: (p, s) => req('PUT', `${base(p)}/settings`, { json: s }),
  readText: async (p, f) => (await req('GET', `${base(p)}/file?path=${enc(f)}`, { raw: true })).text(),
  write: (p, f, body, compile) => req('PUT', `${base(p)}/file?path=${enc(f)}${compile ? '&compile=1' : ''}`, { body }),
  remove: (p, f) => req('DELETE', `${base(p)}/file?path=${enc(f)}`),
  mkdir: (p, f) => req('POST', `${base(p)}/mkdir`, { json: { path: f } }),
  rename: (p, from, to) => req('POST', `${base(p)}/rename`, { json: { from, to } }),
  compile: p => req('POST', `${base(p)}/compile`),
  stop: p => req('POST', `${base(p)}/compile/stop`),
  clean: p => req('POST', `${base(p)}/clean`),
  syncForward: (p, file, line, col) => req('GET', `${base(p)}/synctex/forward?file=${enc(file)}&line=${line}&col=${col}`),
  syncBackward: (p, page, x, y) => req('GET', `${base(p)}/synctex/backward?page=${page}&x=${x}&y=${y}`),
  pdfUrl: p => `${base(p)}/pdf`,
  tlmgrStatus: () => req('GET', '/api/tlmgr/status'),
  tlmgrSearch: (q, file) => req('GET', `/api/tlmgr/search?q=${enc(q)}${file ? '&file=1' : ''}`),
  tlmgrInstall: packages => req('POST', '/api/tlmgr/install', { json: { packages } }),
  tlmgrStop: () => req('POST', '/api/tlmgr/stop'),
};

export class Socket {
  constructor() { this.h = {}; this.q = []; this.tries = 0; this.connect(); }
  on(t, f) { (this.h[t] ||= []).push(f); }
  emit(t, m) { (this.h[t] || []).forEach(f => { try { f(m); } catch (e) { console.error(e); } }); }
  send(o) {
    const s = JSON.stringify(o);
    if (this.ws && this.ws.readyState === 1) this.ws.send(s);
    else if (this.q.length < 100) this.q.push(s);
  }
  connect() {
    const ws = this.ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => { this.tries = 0; this.q.splice(0).forEach(s => ws.send(s)); this.emit('open', {}); };
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } this.emit(m.type, m); };
    ws.onclose = () => { this.emit('close', {}); setTimeout(() => this.connect(), Math.min(5000, 400 * 2 ** this.tries++)); };
  }
}
