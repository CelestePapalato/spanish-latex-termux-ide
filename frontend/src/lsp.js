// Thin LSP client: messages travel over the WebSocket to the backend, which talks to the real TexLab over stdio.
const langId = p => (/\.bib$/i.test(p) ? 'bibtex' : 'latex');

export class LspClient {
  constructor(sock) {
    this.sock = sock; this.project = null; this.rootUri = null; this.ready = false;
    this.pending = new Map(); this.nid = 1; this.versions = new Map();
    this.onReady = () => {}; this.onStatus = () => {};
    sock.on('texlab_ready', m => {
      if (m.project !== this.project) return;
      this.rootUri = m.rootUri; this.ready = true; this.versions.clear();
      this.onStatus('ready'); this.onReady();
    });
    sock.on('texlab_unavailable', m => { this.ready = false; this.onStatus('unavailable', m.hint); });
    sock.on('texlab_stopped', () => { this.ready = false; this.onStatus('stopped'); });
    sock.on('close', () => { this.ready = false; this.onStatus('stopped'); });
    sock.on('lsp_response', m => {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id); clearTimeout(p.t);
      p.res(m.error ? null : m.result);
    });
  }
  setProject(p) { this.project = p; this.ready = false; this.versions.clear(); this.onStatus('starting'); }
  uri(path) { return `${this.rootUri}/${path.split('/').map(encodeURIComponent).join('/')}`; }
  path(uri) { return uri.startsWith(this.rootUri + '/') ? decodeURIComponent(uri.slice(this.rootUri.length + 1)) : null; }
  td(path) { return { uri: this.uri(path) }; }
  request(method, params, ms = 8000) {
    if (!this.ready) return Promise.resolve(null);
    return new Promise(res => {
      const id = this.nid++;
      const t = setTimeout(() => { this.pending.delete(id); res(null); }, ms);
      this.pending.set(id, { res, t });
      this.sock.send({ type: 'lsp_request', id, method, params });
    });
  }
  notify(method, params) { if (this.ready) this.sock.send({ type: 'lsp_notify', method, params }); }
  didOpen(path, text) {
    this.versions.set(path, 1);
    this.notify('textDocument/didOpen', { textDocument: { uri: this.uri(path), languageId: langId(path), version: 1, text } });
  }
  didChange(path, text) {
    const v = (this.versions.get(path) || 1) + 1;
    this.versions.set(path, v);
    this.notify('textDocument/didChange', { textDocument: { uri: this.uri(path), version: v }, contentChanges: [{ text }] });
  }
  didSave(path) { this.notify('textDocument/didSave', { textDocument: { uri: this.uri(path) } }); }
  didClose(path) { this.versions.delete(path); this.notify('textDocument/didClose', { textDocument: { uri: this.uri(path) } }); }
}
