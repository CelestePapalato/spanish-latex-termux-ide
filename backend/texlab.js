'use strict';
const { spawn } = require('child_process');
const path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');
const { which } = require('./doctor');
const P = require('./projects');

const REQ_OK = new Set(['textDocument/completion', 'textDocument/hover', 'textDocument/definition', 'textDocument/references', 'textDocument/documentSymbol', 'textDocument/documentLink', 'textDocument/foldingRange', 'textDocument/documentHighlight', 'textDocument/codeAction', 'textDocument/formatting']);
const NOTIFY_OK = new Set(['textDocument/didOpen', 'textDocument/didChange', 'textDocument/didClose', 'textDocument/didSave']);

class TexlabSession {
  constructor(project, emit) {
    this.project = project; this.emit = emit;
    this.root = P.projectDir(project);
    this.rootUri = pathToFileURL(this.root).href;
    this.nextId = 1; this.pending = new Map(); this.buf = Buffer.alloc(0);
    this.ready = false; this.proc = null; this.stopping = false;
  }

  start() {
    const bin = which('texlab');
    if (!bin) { this.emit({ type: 'texlab_unavailable', project: this.project, hint: 'pkg install texlab' }); return false; }
    const proc = this.proc = spawn(bin, [], { cwd: this.root, stdio: ['pipe', 'pipe', 'pipe'] });
    proc.stdin.on('error', () => {});
    proc.stderr.on('data', () => {});
    proc.stdout.on('data', d => this._onData(d));
    proc.on('error', e => { this.ready = false; this.emit({ type: 'texlab_unavailable', project: this.project, hint: e.message }); });
    proc.on('exit', () => {
      this.ready = false; this.proc = null;
      for (const p of this.pending.values()) { clearTimeout(p.t); p.reject(new Error('TexLab encerrou')); }
      this.pending.clear();
      if (!this.stopping) this.emit({ type: 'texlab_stopped', project: this.project });
    });
    this._init().catch(e => this.emit({ type: 'texlab_unavailable', project: this.project, hint: `Falha ao iniciar o TexLab: ${e.message}` }));
    return true;
  }

  async _init() {
    await this.request('initialize', {
      processId: process.pid,
      rootUri: this.rootUri,
      workspaceFolders: [{ uri: this.rootUri, name: this.project }],
      capabilities: {
        general: { positionEncodings: ['utf-16'] },
        textDocument: {
          synchronization: { didSave: true },
          completion: { completionItem: { snippetSupport: false, documentationFormat: ['markdown', 'plaintext'] } },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          publishDiagnostics: { relatedInformation: true },
          definition: {}, references: {},
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
        },
        workspace: { configuration: true, workspaceFolders: true },
      },
    }, 30000);
    this.notify('initialized', {});
    this.ready = true;
    this.emit({ type: 'texlab_ready', project: this.project, rootUri: this.rootUri });
  }

  _send(obj) {
    if (!this.proc || !this.proc.stdin.writable) return;
    const body = Buffer.from(JSON.stringify(obj));
    this.proc.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.proc.stdin.write(body);
  }

  request(method, params, ms = 10000) {
    return new Promise((resolve, reject) => {
      if (!this.proc) return reject(new Error('TexLab não está em execução'));
      const id = this.nextId++;
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error('tempo esgotado')); }, ms);
      this.pending.set(id, { resolve, reject, t });
      this._send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method, params) { this._send({ jsonrpc: '2.0', method, params }); }

  _onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      const he = this.buf.indexOf('\r\n\r\n');
      if (he < 0) return;
      const m = /Content-Length:\s*(\d+)/i.exec(this.buf.slice(0, he).toString('ascii'));
      if (!m) { this.buf = this.buf.slice(he + 4); continue; }
      const len = +m[1];
      if (this.buf.length < he + 4 + len) return;
      const body = this.buf.slice(he + 4, he + 4 + len).toString('utf8');
      this.buf = this.buf.slice(he + 4 + len);
      try { this._handle(JSON.parse(body)); } catch {}
    }
  }

  _handle(msg) {
    if (msg.id != null && msg.method === undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id); clearTimeout(p.t);
      msg.error ? p.reject(new Error(msg.error.message || 'erro LSP')) : p.resolve(msg.result);
    } else if (msg.id != null) { // server-to-client request
      let result = null;
      if (msg.method === 'workspace/configuration') result = (msg.params.items || []).map(() => ({}));
      this._send({ jsonrpc: '2.0', id: msg.id, result });
    } else if (msg.method === 'textDocument/publishDiagnostics') {
      try {
        const rel = path.relative(this.root, fileURLToPath(msg.params.uri));
        if (rel.startsWith('..')) return;
        this.emit({ type: 'diagnostics_updated', project: this.project, path: rel.split(path.sep).join('/'), diagnostics: msg.params.diagnostics || [] });
      } catch {}
    }
  }

  stop() {
    this.stopping = true;
    if (this.proc) { try { this.notify('shutdown'); this.proc.kill(); } catch {} }
  }
}

class TexlabManager {
  constructor(emit) { this.emit = emit; this.session = null; }

  ensure(project, ws) {
    const s = this.session;
    if (s && s.project === project && (s.proc || !s.ready)) {
      if (s.ready && ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'texlab_ready', project, rootUri: s.rootUri }));
      return;
    }
    this.stop();
    this.session = new TexlabSession(project, this.emit);
    this.session.start();
  }

  stop() { if (this.session) this.session.stop(); this.session = null; }

  async request(method, params) {
    if (!REQ_OK.has(method)) throw new Error('Método LSP não permitido');
    if (!this.session || !this.session.ready) return null;
    return this.session.request(method, params);
  }

  notify(method, params) {
    if (!NOTIFY_OK.has(method) || !this.session || !this.session.ready) return;
    this.session.notify(method, params);
  }
}

module.exports = { TexlabSession, TexlabManager };
