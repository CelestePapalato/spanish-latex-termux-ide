'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const cfg = require('./config');
const P = require('./projects');
const doctor = require('./doctor');
const { Compiler, synctexForward, synctexBackward } = require('./compiler');
const { TexlabManager } = require('./texlab');
const { Tlmgr } = require('./tlmgr');
const { HttpError } = P;

const clients = new Set();
const emit = ev => { const s = JSON.stringify(ev); for (const c of clients) if (c.readyState === 1) c.send(s); };
const compiler = new Compiler(emit);
const texlab = new TexlabManager(emit);
const tlmgr = new Tlmgr(emit);
const recentWrites = new Map();

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.pdf': 'application/pdf' };
const TEXT = /\.(tex|sty|cls|bib|bst|txt|md|def|cfg|ltx|dtx|ins|log|aux|csv|json|ya?ml|py|sh|clo|fd|tikz|latex|out|toc)$/i;
const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:* ws://localhost:* ws://[::1]:*; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

// ---------- security ----------
function hostOk(req) {
  const h = (req.headers.host || '').toLowerCase();
  const name = h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0];
  return LOOPBACK.has(name) || cfg.ALLOWED_HOSTS.includes(name);
}
function originOk(req, required = false) {
  const o = req.headers.origin;
  if (!o) return !required;
  try { return new URL(o).host === req.headers.host; } catch { return false; }
}

// ---------- HTTP helpers ----------
function sendJson(res, status, obj) {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': b.length, 'Cache-Control': 'no-store' });
  res.end(b);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0, over = false;
    req.on('data', c => { n += c.length; if (n > limit) over = true; else chunks.push(c); });
    req.on('end', () => (over ? reject(new HttpError(413, 'Arquivo muito grande')) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const b = await readBody(req, 1 << 20);
  try { return b.length ? JSON.parse(b) : {}; } catch { throw new HttpError(400, 'JSON inválido'); }
}
function streamFile(res, full, headers) {
  const st = fs.statSync(full);
  if (!st.isFile()) throw new HttpError(404, 'Não encontrado');
  res.writeHead(200, { 'Content-Length': st.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  fs.createReadStream(full).pipe(res);
}

// ---------- API ----------
async function api(req, res, url) {
  const m = req.method;
  if (m !== 'GET' && m !== 'HEAD') {
    if (req.headers['x-latexide'] !== '1') throw new HttpError(403, 'Requisição não autorizada');
    if (!originOk(req)) throw new HttpError(403, 'Origem não permitida');
  }
  let parts;
  try { parts = url.pathname.split('/').filter(Boolean).slice(1).map(decodeURIComponent); } catch { throw new HttpError(400, 'URL inválida'); }

  if (parts[0] === 'health' && m === 'GET') return sendJson(res, 200, { ...doctor.check(), projectsDir: cfg.PROJECTS_DIR, shellEscape: cfg.SHELL_ESCAPE });
  if (parts[0] === 'tlmgr') return tlmgrApi(req, res, url, parts[1], m);
  if (parts[0] !== 'projects') throw new HttpError(404, 'Rota inexistente');

  if (parts.length === 1) {
    if (m === 'GET') { const details = await P.listProjectsDetailed(); return sendJson(res, 200, { projects: details.map(d => d.name), details }); }
    if (m === 'POST') { const b = await readJson(req); await P.createProject(b.name); return sendJson(res, 201, { ok: true, name: b.name }); }
    throw new HttpError(405, 'Método não permitido');
  }

  const project = parts[1], sub = parts[2], sub2 = parts[3];
  const q = k => url.searchParams.get(k);
  if (!sub) {
    if (m === 'DELETE') { compiler.stop(project); await P.deleteProject(project); return sendJson(res, 200, { ok: true }); }
    throw new HttpError(405, 'Método não permitido');
  }

  switch (sub) {
    case 'tree':
      return sendJson(res, 200, { tree: await P.tree(project) });

    case 'settings': {
      if (m === 'PUT') await P.saveSettings(project, await readJson(req));
      const s = await P.getSettings(project);
      return sendJson(res, 200, { ...s, main: await P.detectMain(project, s) });
    }

    case 'file': {
      const rel = q('path');
      if (!rel) throw new HttpError(400, 'Parâmetro path ausente');
      if (m === 'GET') {
        const full = P.resolveIn(project, rel);
        if (!fs.existsSync(full)) throw new HttpError(404, 'Arquivo não encontrado');
        const ct = TEXT.test(rel) ? 'text/plain; charset=utf-8' : (MIME[path.extname(rel).toLowerCase()] || 'application/octet-stream');
        return streamFile(res, full, { 'Content-Type': ct, 'Content-Security-Policy': "sandbox; default-src 'none'" });
      }
      if (m === 'PUT') {
        const body = await readBody(req, 100 << 20);
        await P.writeFile(project, rel, body);
        recentWrites.set(`${project}/${rel}`, Date.now());
        if (q('compile') === '1') compiler.schedule(project, 0);
        return sendJson(res, 200, { ok: true, size: body.length });
      }
      if (m === 'DELETE') { await P.removePath(project, rel); return sendJson(res, 200, { ok: true }); }
      throw new HttpError(405, 'Método não permitido');
    }

    case 'mkdir': { const b = await readJson(req); await P.mkdir(project, b.path); return sendJson(res, 200, { ok: true }); }
    case 'rename': { const b = await readJson(req); await P.rename(project, b.from, b.to); return sendJson(res, 200, { ok: true }); }

    case 'compile':
      if (m !== 'POST') throw new HttpError(405, 'Método não permitido');
      P.resolveIn(project, '');
      if (sub2 === 'stop') { compiler.stop(project); return sendJson(res, 200, { ok: true }); }
      compiler.compile(project).catch(() => {});
      return sendJson(res, 202, { ok: true });

    case 'clean':
      if (m !== 'POST') throw new HttpError(405, 'Método não permitido');
      await compiler.clean(project);
      return sendJson(res, 200, { ok: true });

    case 'pdf': {
      const s = await P.getSettings(project);
      const main = await P.detectMain(project, s);
      const full = main && path.join(P.projectDir(project), P.jobname(main) + '.pdf');
      if (!full || !fs.existsSync(full)) throw new HttpError(404, 'PDF ainda não gerado');
      const h = { 'Content-Type': 'application/pdf' };
      if (q('download') === '1') {
        const base = P.jobname(main) || 'documento';
        const ascii = base.replace(/[^A-Za-z0-9._-]+/g, '_') || 'documento';
        h['Content-Disposition'] = `attachment; filename="${ascii}.pdf"; filename*=UTF-8''${encodeURIComponent(base)}.pdf`;
      }
      return streamFile(res, full, h);
    }

    case 'synctex':
      if (sub2 === 'forward') return sendJson(res, 200, await synctexForward(project, q('file'), q('line'), q('col')));
      if (sub2 === 'backward') return sendJson(res, 200, await synctexBackward(project, q('page'), q('x'), q('y')));
      throw new HttpError(404, 'Rota inexistente');

    default:
      throw new HttpError(404, 'Rota inexistente');
  }
}

// ---------- TeX Live packages (tlmgr) ----------
async function tlmgrApi(req, res, url, sub, m) {
  // also required on GET: these routes hit the network and can install software
  if (req.headers['x-latexide'] !== '1') throw new HttpError(403, 'Requisição não autorizada');
  const q = k => url.searchParams.get(k);
  if (sub === 'status' && m === 'GET') return sendJson(res, 200, tlmgr.status());
  if (sub === 'search' && m === 'GET') return sendJson(res, 200, await tlmgr.search(q('q'), q('file') === '1'));
  if (sub === 'install' && m === 'POST') { const b = await readJson(req); tlmgr.install(b.packages); return sendJson(res, 202, { ok: true }); }
  if (sub === 'stop' && m === 'POST') { tlmgr.stop(); return sendJson(res, 200, { ok: true }); }
  throw new HttpError(404, 'Rota inexistente');
}

// ---------- static files ----------
async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Método não permitido');
  let p;
  try { p = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'URL inválida'); }
  if (p.endsWith('/')) p += 'index.html';
  const full = path.normalize(path.join(cfg.PUBLIC_DIR, p));
  if (!full.startsWith(cfg.PUBLIC_DIR + path.sep)) throw new HttpError(403, 'Proibido');
  if (!fs.existsSync(full)) throw new HttpError(404, 'Não encontrado');
  const ext = path.extname(full).toLowerCase();
  const h = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' };
  if (ext === '.html') h['Content-Security-Policy'] = CSP;
  if (req.method === 'HEAD') { res.writeHead(200, h); return res.end(); }
  streamFile(res, full, h);
}

const server = http.createServer(async (req, res) => {
  try {
    if (!hostOk(req)) throw new HttpError(403, 'Host não permitido');
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else await serveStatic(req, res, url);
  } catch (e) {
    const status = e.status || (e.code === 'ENOENT' ? 404 : 500);
    if (status === 500) console.error(e);
    if (!res.headersSent) sendJson(res, status, { error: e.message });
    else res.end();
  }
});

// ---------- external change watcher (e.g. a file edited in vim) ----------
const watcher = {
  w: null, project: null, timers: new Map(),
  watch(project) {
    if (this.project === project && this.w) return;
    this.close();
    this.project = project;
    try {
      this.w = fs.watch(P.projectDir(project), { recursive: true }, (_ev, name) => this.onChange(project, name));
      this.w.on('error', () => this.close());
    } catch (e) { console.warn('fs.watch is not available on this system:', e.message); }
  },
  close() { if (this.w) { try { this.w.close(); } catch {} } this.w = null; this.project = null; },
  onChange(project, name) {
    if (!name) return;
    const rel = String(name).split(path.sep).join('/');
    if (rel.split('/').some(s => s.startsWith('.') || s.startsWith('_minted')) || P.isGenerated(rel) || (/\.pdf$/i.test(rel) && !rel.includes('/'))) return;
    if (compiler.busy(project)) return;
    if (Date.now() - (recentWrites.get(`${project}/${rel}`) || 0) < 1500) return;
    clearTimeout(this.timers.get(rel));
    this.timers.set(rel, setTimeout(async () => {
      this.timers.delete(rel);
      emit({ type: 'file_changed', project, path: rel });
      try { const s = await P.getSettings(project); if (s.autoCompile) compiler.schedule(project, s.debounceMs); } catch {}
    }, 300));
  },
};

// ---------- WebSocket ----------
const wss = new WebSocketServer({ noServer: true, maxPayload: 8 << 20 });
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/ws') || !hostOk(req) || !originOk(req, true)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return socket.destroy(); }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
  ws.on('message', async raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    try {
      if (msg.type === 'open_project') {
        await P.getSettings(msg.project);
        watcher.watch(msg.project);
        texlab.ensure(msg.project, ws);
      } else if (msg.type === 'lsp_request') {
        try { ws.send(JSON.stringify({ type: 'lsp_response', id: msg.id, result: await texlab.request(msg.method, msg.params) })); }
        catch (e) { ws.send(JSON.stringify({ type: 'lsp_response', id: msg.id, error: e.message })); }
      } else if (msg.type === 'lsp_notify') {
        texlab.notify(msg.method, msg.params);
      }
    } catch (e) { ws.send(JSON.stringify({ type: 'error', message: e.message })); }
  });
});
setInterval(() => { for (const ws of clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); } }, 30000).unref();

// ---------- startup ----------
async function main() {
  const res = doctor.check();
  console.log('=== LaTeX IDE for Termux ===\n' + doctor.report(res));
  if (!res.tools.pdflatex.found) console.log('\n[!] pdflatex not found: you can edit, but not compile. Install it with:\n    ' + res.tools.pdflatex.hintEn);
  if (!res.tools.texlab.found) console.log('\n[!] TexLab not found: no LSP autocomplete/diagnostics. Install it with:\n    ' + res.tools.texlab.hintEn);
  if (!fs.existsSync(path.join(cfg.PUBLIC_DIR, 'app.js'))) console.log('\n[!] Frontend not built yet. Run: npm run build');
  await fs.promises.mkdir(cfg.PROJECTS_DIR, { recursive: true });
  if (!(await P.listProjects()).length) { await P.createProject('exemplo'); console.log('\nExample project created at ' + path.join(cfg.PROJECTS_DIR, 'exemplo')); }
  server.on('error', e => {
    console.error(e.code === 'EADDRINUSE' ? `\nPort ${cfg.PORT} is already in use. Pick another one: PORT=3001 ./start.sh` : e);
    process.exit(1);
  });
  server.listen(cfg.PORT, cfg.HOST, () => {
    console.log(`\nProjects directory: ${cfg.PROJECTS_DIR}`);
    console.log(`\nOpen in your browser:  http://${cfg.HOST === '0.0.0.0' ? '127.0.0.1' : cfg.HOST}:${cfg.PORT}\n(Ctrl+C to stop)`);
    if (cfg.HOST !== '127.0.0.1' && cfg.HOST !== 'localhost') console.log('\n[!] Server is listening outside loopback. Anyone on the network will be able to edit your files.');
  });
}
process.on('SIGINT', () => { texlab.stop(); tlmgr.stop(); process.exit(0); });
process.on('SIGTERM', () => { texlab.stop(); tlmgr.stop(); process.exit(0); });
main();
