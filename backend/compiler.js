'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const cfg = require('./config');
const P = require('./projects');
const { which, check } = require('./doctor');

const MAX_PASSES = 4;
const TOOL_TIMEOUT = 180000;
const RERUN = /Rerun to get|Label\(s\) may have changed|Please \(re\)run|Rerun LaTeX/i;
const AUX_EXT = ['aux', 'log', 'out', 'toc', 'lof', 'lot', 'fls', 'fdb_latexmk', 'bbl', 'blg', 'bcf', 'run.xml', 'idx', 'ilg', 'ind', 'glo', 'gls', 'glg', 'ist', 'acn', 'acr', 'alg', 'nav', 'snm', 'vrb', 'synctex.gz'];

function kill(child) {
  try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
}

function runProc(bin, args, cwd, onData, track) {
  return new Promise(resolve => {
    let child;
    try { child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: process.env }); }
    catch (e) { onData(`Erro ao iniciar ${bin}: ${e.message}\n`); return resolve({ code: -1 }); }
    track(child);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    const t = setTimeout(() => { onData(`\n[tempo esgotado: encerrando ${path.basename(bin)}]\n`); kill(child); }, TOOL_TIMEOUT);
    child.on('error', e => { clearTimeout(t); onData(`Erro: ${e.message}\n`); resolve({ code: -1 }); });
    child.on('close', code => { clearTimeout(t); resolve({ code: code == null ? -1 : code }); });
  });
}

function execCollect(bin, args, cwd, ms = 10000) {
  return new Promise(resolve => {
    const c = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.setEncoding('utf8');
    c.stdout.on('data', d => { out += d; });
    c.stderr.on('data', () => {});
    const t = setTimeout(() => c.kill('SIGKILL'), ms);
    c.on('error', () => { clearTimeout(t); resolve({ code: -1, out }); });
    c.on('close', code => { clearTimeout(t); resolve({ code, out }); });
  });
}

function missingHint(msg) {
  const m = /File `([^']+)' not found|I can't find file `([^']+)'/.exec(msg);
  if (!m) return null;
  const f = m[1] || m[2];
  return `Arquivo ausente: ${f}. Procure o pacote do TeX Live com: tlmgr search --global --file /${f}   e instale com: tlmgr install <pacote>`;
}

function parseLog(text) {
  const lines = text.split(/\r?\n/);
  const out = [], seen = new Set();
  const add = (severity, file, line, message, hint) => {
    const k = `${severity}|${file}|${line}|${message}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ severity, file, line, message, ...(hint ? { hint } : {}) });
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m;
    if ((m = /^(?:\.\/)?([^\s:][^:]*\.(?:tex|sty|cls|bib|def|cfg|ltx|clo|fd)):(\d+): (.*)$/.exec(l))) {
      add('error', m[1], +m[2], m[3], missingHint(m[3]));
    } else if ((m = /^! (.*)$/.exec(l))) {
      add('error', null, null, m[1], missingHint(m[1]));
    } else if ((m = /^((?:LaTeX|Package \S+|Class \S+|LaTeX Font) Warning): (.*)$/.exec(l))) {
      let msg = m[2], ln = null;
      for (let j = i; j < Math.min(i + 6, lines.length); j++) {
        const lm = /on input line (\d+)/.exec(lines[j]);
        if (lm) { ln = +lm[1]; break; }
        if (j > i && lines[j].trim() === '') break;
        if (j > i) msg += ' ' + lines[j].replace(/^\(\S+\)\s*/, '').trim();
      }
      add('warning', null, ln, `${m[1]}: ${msg}`.slice(0, 300));
    } else if ((m = /^(Overfull|Underfull) \\[hv]box .*?(?:at lines?|detected at line) (\d+)/.exec(l))) {
      add('info', null, +m[2], l.slice(0, 200));
    }
  }
  return out;
}

class Compiler {
  constructor(emit) { this.emit = emit; this.jobs = new Map(); this.timers = new Map(); this.lastEnd = new Map(); }

  schedule(project, delay) {
    clearTimeout(this.timers.get(project));
    this.timers.set(project, setTimeout(() => { this.timers.delete(project); this.compile(project).catch(() => {}); }, delay));
  }

  busy(project) { return this.jobs.has(project) || Date.now() - (this.lastEnd.get(project) || 0) < 2000; }

  stop(project) {
    const j = this.jobs.get(project);
    if (j) { j.cancelled = true; j.pending = false; if (j.child) kill(j.child); }
  }

  async compile(project) {
    const running = this.jobs.get(project);
    if (running) { running.pending = true; return { queued: true }; }
    const job = { pending: false, cancelled: false, child: null, out: '' };
    this.jobs.set(project, job);
    try { await this._run(project, job); }
    catch (e) { this.emit({ type: 'compilation_failed', project, error: e.message, diagnostics: [], pdf: false }); }
    finally {
      this.jobs.delete(project);
      this.lastEnd.set(project, Date.now());
      if (job.pending) this.schedule(project, 0);
    }
    return { started: true };
  }

  async _run(project, job) {
    const cwd = P.projectDir(project);
    const s = await P.getSettings(project);
    const main = await P.detectMain(project, s);
    const log = t => this.emit({ type: 'log', project, text: t });
    const fail = (error, extra = {}) => this.emit({ type: 'compilation_failed', project, error, diagnostics: [], pdf: false, ...extra });
    if (!main) return fail('Nenhum arquivo principal .tex encontrado. Defina um em Configurações.');
    const engine = s.compiler;
    if (!which(engine)) return fail(`${engine} não encontrado. ${check().tools[engine]?.hint || ''}`);

    const jobname = P.jobname(main);
    const pdfPath = path.join(cwd, jobname + '.pdf');
    const exists = f => fs.existsSync(path.join(cwd, f));
    const started = Date.now();
    this.emit({ type: 'compilation_started', project, compiler: engine, main });
    log('=== Compilation started ===\n');

    const run = (cmd, args) => {
      log(`\nRunning:\n${cmd} ${args.join(' ')}\n\n`);
      job.out = '';
      return runProc(which(cmd), args, cwd, t => { job.out += t; log(t); }, c => { job.child = c; });
    };
    const texArgs = ['-interaction=nonstopmode', '-file-line-error', '-synctex=1', cfg.SHELL_ESCAPE ? '-shell-escape' : '-no-shell-escape', main];

    let passes = 0, code = 0, logText = '';
    const done = { bib: false, idx: false, gls: false };
    while (passes < MAX_PASSES && !job.cancelled) {
      passes++;
      code = (await run(engine, texArgs)).code;
      logText = await fsp.readFile(path.join(cwd, jobname + '.log'), 'utf8').catch(() => job.out);
      if (code !== 0 || job.cancelled) break;
      let need = false;
      const aux = await fsp.readFile(path.join(cwd, jobname + '.aux'), 'utf8').catch(() => '');
      if (!done.bib) {
        if (exists(jobname + '.bcf') && which('biber')) { await run('biber', [jobname]); need = done.bib = true; }
        else if (/\\bibdata\{/.test(aux) && which('bibtex')) { await run('bibtex', [jobname]); need = done.bib = true; }
      }
      if (!done.idx && exists(jobname + '.idx') && which('makeindex')) { await run('makeindex', [jobname + '.idx']); need = done.idx = true; }
      if (!done.gls && (exists(jobname + '.glo') || exists(jobname + '.acn')) && which('makeglossaries')) { await run('makeglossaries', [jobname]); need = done.gls = true; }
      if (!need && (RERUN.test(logText) || (passes === 1 && /There were undefined/.test(logText)))) need = true;
      if (!need) break;
    }
    if (job.cancelled) { log('\n=== Compilation cancelled ===\n'); return fail('Compilação cancelada'); }

    const diagnostics = parseLog(logText);
    if (code !== 0 && !diagnostics.some(d => d.severity === 'error')) diagnostics.unshift({ severity: 'error', file: null, line: null, message: `O compilador terminou com código ${code}` });
    let fresh = false;
    try { const st = await fsp.stat(pdfPath); fresh = st.mtimeMs >= started - 1000; if (fresh) this.emit({ type: 'pdf_updated', project, version: st.mtimeMs }); } catch {}
    const ms = Date.now() - started;
    if (code === 0) {
      log(`\n=== Compilation successful (${(ms / 1000).toFixed(1)}s, ${passes} passada${passes > 1 ? 's' : ''}) ===\n`);
      this.emit({ type: 'compilation_finished', project, ms, passes, diagnostics });
    } else {
      log('\n=== Compilation failed ===\n');
      this.emit({ type: 'compilation_failed', project, ms, passes, diagnostics, pdf: fresh });
    }
  }

  async clean(project) {
    const s = await P.getSettings(project);
    const main = await P.detectMain(project, s);
    if (!main) return;
    const j = P.jobname(main), cwd = P.projectDir(project);
    await Promise.all(AUX_EXT.map(e => fsp.rm(path.join(cwd, `${j}.${e}`), { force: true })));
  }
}

async function synctexCtx(project) {
  const bin = which('synctex');
  if (!bin) throw new P.HttpError(501, 'synctex não encontrado. Ele vem com o TeX Live (veja o README).');
  const s = await P.getSettings(project);
  const main = await P.detectMain(project, s);
  if (!main) throw new P.HttpError(404, 'Arquivo principal não encontrado');
  return { bin, cwd: P.projectDir(project), pdf: P.jobname(main) + '.pdf' };
}

async function synctexForward(project, file, line, col) {
  const { bin, cwd, pdf } = await synctexCtx(project);
  const rel = path.relative(cwd, P.resolveIn(project, file));
  const l = parseInt(line, 10), c = parseInt(col || '0', 10) || 0;
  if (!(l > 0)) throw new P.HttpError(400, 'Linha inválida');
  const r = await execCollect(bin, ['view', '-i', `${l}:${c}:${rel}`, '-o', pdf], cwd);
  const g = k => { const m = new RegExp('^' + k + ':(-?[\\d.]+)', 'm').exec(r.out); return m ? parseFloat(m[1]) : null; };
  const page = g('Page');
  if (page == null) throw new P.HttpError(404, 'Posição não encontrada no PDF');
  return { page, x: g('x'), y: g('y') };
}

async function synctexBackward(project, page, x, y) {
  const { bin, cwd, pdf } = await synctexCtx(project);
  const [p, px, py] = [parseInt(page, 10), parseFloat(x), parseFloat(y)];
  if (!(p > 0) || !Number.isFinite(px) || !Number.isFinite(py)) throw new P.HttpError(400, 'Coordenadas inválidas');
  const r = await execCollect(bin, ['edit', '-o', `${p}:${px}:${py}:${pdf}`], cwd);
  const inp = /^Input:(.+)$/m.exec(r.out), ln = /^Line:(\d+)/m.exec(r.out);
  if (!inp || !ln) throw new P.HttpError(404, 'Posição não encontrada no código');
  const rel = path.relative(cwd, path.resolve(cwd, inp[1].trim()));
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new P.HttpError(404, 'Arquivo fora do projeto');
  return { file: rel.split(path.sep).join('/'), line: +ln[1] };
}

module.exports = { Compiler, parseLog, synctexForward, synctexBackward };
