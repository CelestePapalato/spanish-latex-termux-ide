'use strict';
// TeX Live package manager (tlmgr) integration for the IDE.
// Security: only runs the fixed "search" and "install" subcommands, with arguments passed as an
// array (no shell) and names validated by regex. There is no generic command execution.
const { spawn } = require('child_process');
const { which } = require('./doctor');
const { HttpError } = require('./projects');
const { t } = require('./i18n');

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const QUERY_RE = /^[A-Za-z0-9][A-Za-z0-9._+\-\/ ]{0,99}$/;
const MAX_PACKAGES = 20;
const MAX_LOG = 60000;

function clean(text) {
  // strip ANSI sequences that tlmgr sometimes prints and normalize carriage returns
  return String(text).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r(?!\n)/g, '\n');
}

// Parses the output of `tlmgr search`, accepting both known formats:
//   "name - description"      or      "name:" followed by indented lines (description / file)
function parseSearch(out) {
  const res = new Map();
  let curr = null;
  for (const raw of clean(out).split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line || /^tlmgr:/i.test(line) || /^\(running on/i.test(line) || /^\(see /i.test(line) || /^TLPDB:/i.test(line)) { curr = null; continue; }
    let m = /^([A-Za-z0-9][A-Za-z0-9._+-]*)\s+-\s+(.*)$/.exec(line);
    if (m) { res.set(m[1], { name: m[1], desc: m[2] }); curr = null; continue; }
    m = /^([A-Za-z0-9][A-Za-z0-9._+-]*):$/.exec(line);
    if (m) { curr = res.get(m[1]) || { name: m[1], desc: '' }; res.set(m[1], curr); continue; }
    if (curr && /^\s+/.test(raw)) { const t = line.trim(); if (t && !curr.desc) curr.desc = t; }
  }
  return [...res.values()].slice(0, 100);
}

class Tlmgr {
  constructor(emit) { this.emit = emit; this.job = null; }

  path() { return which('tlmgr'); }
  available() { return !!this.path(); }

  status() {
    return { available: this.available(), busy: !!this.job, job: this.job && { packages: this.job.packages, log: this.job.log } };
  }

  // short execution, no streaming (used by search)
  exec(args, timeoutMs) {
    const bin = this.path();
    if (!bin) return Promise.reject(new HttpError(503, t('server.tlmgr.notFound')));
    return new Promise((resolve, reject) => {
      const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', timedOut = false;
      const cap = c => { if (out.length < 400000) out += c; };
      p.stdout.on('data', cap); p.stderr.on('data', cap);
      const timer = setTimeout(() => { timedOut = true; p.kill('SIGKILL'); }, timeoutMs);
      p.on('error', e => { clearTimeout(timer); reject(new HttpError(500, t('server.tlmgr.runError', { error: e.message }))); });
      p.on('close', code => { clearTimeout(timer); resolve({ code, out, timedOut }); });
    });
  }

  async search(q, byFile) {
    q = String(q || '').trim();
    if (!QUERY_RE.test(q)) throw new HttpError(400, t('server.tlmgr.invalidQuery'));
    const args = ['search', '--global'];
    if (byFile) args.push('--file');
    args.push('--', q);
    const r = await this.exec(args, 90000);
    if (r.timedOut) throw new HttpError(504, t('server.tlmgr.searchTimeout'));
    const results = parseSearch(r.out);
    if (r.code !== 0 && !results.length) throw new HttpError(502, clean(r.out).trim().split('\n').slice(-3).join('\n') || t('server.tlmgr.failed'));
    return { results };
  }

  install(packages) {
    if (this.job) throw new HttpError(409, t('server.tlmgr.busy'));
    if (!Array.isArray(packages) || !packages.length || packages.length > MAX_PACKAGES) throw new HttpError(400, t('server.tlmgr.packageCount', { max: MAX_PACKAGES }));
    for (const p of packages) if (!NAME_RE.test(String(p))) throw new HttpError(400, t('server.tlmgr.invalidPackage', { name: String(p).slice(0, 40) }));
    const bin = this.path();
    if (!bin) throw new HttpError(503, t('server.tlmgr.notFound'));
    const pkgs = packages.map(String);
    const job = this.job = { packages: pkgs, log: '', proc: null };
    const push = text => {
      text = clean(text);
      job.log = (job.log + text).slice(-MAX_LOG);
      this.emit({ type: 'tlmgr_log', text });
    };
    this.emit({ type: 'tlmgr_started', packages: pkgs });
    push(`$ tlmgr install ${pkgs.join(' ')}\n`);
    const p = job.proc = spawn(bin, ['install', '--', ...pkgs], { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { push('\n' + t('server.tlmgr.installTimeout') + '\n'); p.kill('SIGTERM'); }, 15 * 60 * 1000);
    p.stdout.on('data', c => push(c.toString()));
    p.stderr.on('data', c => push(c.toString()));
    const done = (code, err) => {
      clearTimeout(timer);
      if (this.job !== job) return;
      this.job = null;
      if (err) push(`\n${err}\n`);
      this.emit({ type: 'tlmgr_done', packages: pkgs, ok: code === 0, code });
    };
    p.on('error', e => done(-1, t('server.tlmgr.runError', { error: e.message })));
    p.on('close', code => done(code));
  }

  stop() { if (this.job && this.job.proc) { try { this.job.proc.kill('SIGTERM'); } catch {} } }
}

module.exports = { Tlmgr, parseSearch, NAME_RE, QUERY_RE };
