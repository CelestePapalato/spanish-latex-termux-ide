'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const cfg = require('./config');
const { t } = require('./i18n');

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/;
const GENERATED = /\.(aux|log|out|toc|lof|lot|fls|fdb_latexmk|bbl|blg|bcf|run\.xml|idx|ilg|ind|glo|gls|glg|ist|acn|acr|alg|nav|snm|vrb|synctex\.gz|synctex|xdv|nlo|nls)$/i;
const COMPILERS = ['pdflatex', 'xelatex', 'lualatex'];
const DEFAULTS = { mainFile: null, compiler: 'pdflatex', autoCompile: true, debounceMs: 1000 };

// main.tex of a new project; the title and greeting come from the locale file (server.template).
const template = () => String.raw`\documentclass[12pt]{article}
\usepackage{amsmath}

\title{${t('server.template.title')}}
\author{}
\date{\today}

\begin{document}
\maketitle

${t('server.template.greeting')}

\begin{equation}
  e^{i\pi} + 1 = 0
\end{equation}

\end{document}
`;

function projectDir(name) {
  if (typeof name !== 'string' || !NAME_RE.test(name) || name.includes('..')) throw new HttpError(400, t('server.projects.invalidName'));
  return path.join(cfg.PROJECTS_DIR, name);
}

// Resolves a relative path inside the project, blocking "..", absolute paths and symlinks pointing outside.
function resolveIn(project, rel = '') {
  const root = projectDir(project);
  if (typeof rel !== 'string' || rel.includes('\0')) throw new HttpError(400, t('server.projects.invalidPath'));
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) throw new HttpError(400, t('server.projects.invalidPath'));
  let realRoot;
  try { realRoot = fs.realpathSync(root); } catch { throw new HttpError(404, t('server.projects.notFound')); }
  let probe = full;
  while (!fs.existsSync(probe) && probe !== root) probe = path.dirname(probe);
  const realProbe = fs.realpathSync(probe);
  if (realProbe !== realRoot && !realProbe.startsWith(realRoot + path.sep)) throw new HttpError(400, t('server.projects.symlink'));
  return full;
}

const jobname = main => path.basename(main).replace(/\.tex$/i, '');
const isGenerated = rel => GENERATED.test(rel) || rel.includes('.tmp-');

async function listProjects() {
  await fsp.mkdir(cfg.PROJECTS_DIR, { recursive: true });
  const ents = await fsp.readdir(cfg.PROJECTS_DIR, { withFileTypes: true });
  return ents.filter(e => e.isDirectory() && NAME_RE.test(e.name)).map(e => e.name).sort((a, b) => a.localeCompare(b));
}

// Name + modification time (the newest of the folder and the main file), for the projects screen.
async function listProjectsDetailed() {
  const out = [];
  for (const name of await listProjects()) {
    let mtime = 0, main = null;
    try { mtime = (await fsp.stat(projectDir(name))).mtimeMs; } catch {}
    try {
      main = (await getSettings(name)).mainFile || 'main.tex';
      mtime = Math.max(mtime, (await fsp.stat(path.join(projectDir(name), main))).mtimeMs);
    } catch {}
    out.push({ name, mtime, main });
  }
  return out;
}

async function createProject(name) {
  const dir = projectDir(name);
  await fsp.mkdir(cfg.PROJECTS_DIR, { recursive: true });
  try { await fsp.mkdir(dir); } catch (e) { throw new HttpError(409, e.code === 'EEXIST' ? t('server.projects.exists') : e.message); }
  await fsp.writeFile(path.join(dir, 'main.tex'), template());
  await saveSettings(name, { mainFile: 'main.tex' });
}

async function deleteProject(name) {
  const dir = projectDir(name);
  resolveIn(name, '');
  await fsp.rm(dir, { recursive: true, force: true });
}

async function tree(project, rel = '', depth = 0) {
  const dir = resolveIn(project, rel);
  const out = [];
  if (depth > 8) return out;
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push({ name: e.name, path: p, type: 'dir', children: await tree(project, p, depth + 1) });
    else if (e.isFile() && !GENERATED.test(e.name)) out.push({ name: e.name, path: p, type: 'file' });
  }
  return out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
}

function sanitize(r) {
  const o = {};
  if (COMPILERS.includes(r.compiler)) o.compiler = r.compiler;
  if (typeof r.autoCompile === 'boolean') o.autoCompile = r.autoCompile;
  if (Number.isFinite(r.debounceMs)) o.debounceMs = Math.min(10000, Math.max(200, Math.round(r.debounceMs)));
  if (r.mainFile === null || r.mainFile === '') o.mainFile = null;
  else if (typeof r.mainFile === 'string' && /\.tex$/i.test(r.mainFile) && !path.isAbsolute(r.mainFile) && !r.mainFile.split('/').includes('..') && !r.mainFile.includes('\0')) o.mainFile = r.mainFile;
  return o;
}

async function getSettings(project) {
  const dir = resolveIn(project, '');
  let raw = {};
  try { raw = JSON.parse(await fsp.readFile(path.join(dir, '.latexide.json'), 'utf8')); } catch {}
  return { ...DEFAULTS, ...sanitize(raw) };
}

async function saveSettings(project, patch) {
  const next = { ...(await getSettings(project)), ...sanitize(patch || {}) };
  await fsp.writeFile(path.join(projectDir(project), '.latexide.json'), JSON.stringify(next, null, 2));
  return next;
}

async function detectMain(project, s) {
  const dir = projectDir(project);
  const isFile = async f => { try { return (await fsp.stat(path.join(dir, f))).isFile(); } catch { return false; } };
  if (s.mainFile && await isFile(s.mainFile)) return s.mainFile;
  if (await isFile('main.tex')) return 'main.tex';
  for (const e of await fsp.readdir(dir)) {
    if (/\.tex$/i.test(e) && await isFile(e)) {
      const t = await fsp.readFile(path.join(dir, e), 'utf8').catch(() => '');
      if (/\\documentclass/.test(t)) return e;
    }
  }
  return null;
}

async function writeFile(project, rel, buf) {
  if (!rel) throw new HttpError(400, t('server.projects.emptyPath'));
  const full = resolveIn(project, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  resolveIn(project, rel);
  const tmp = `${full}.tmp-${process.pid}`;
  await fsp.writeFile(tmp, buf);
  await fsp.rename(tmp, full);
}

async function removePath(project, rel) {
  if (!rel) throw new HttpError(400, t('server.projects.emptyPath'));
  await fsp.rm(resolveIn(project, rel), { recursive: true, force: true });
}

async function mkdir(project, rel) {
  if (!rel) throw new HttpError(400, t('server.projects.emptyPath'));
  await fsp.mkdir(resolveIn(project, rel), { recursive: true });
}

async function rename(project, from, to) {
  if (!from || !to) throw new HttpError(400, t('server.projects.emptyPath'));
  const a = resolveIn(project, from), b = resolveIn(project, to);
  if (fs.existsSync(b)) throw new HttpError(409, t('server.projects.destExists'));
  await fsp.mkdir(path.dirname(b), { recursive: true });
  await fsp.rename(a, b);
}

module.exports = { HttpError, projectDir, resolveIn, jobname, isGenerated, listProjects, listProjectsDetailed, createProject, deleteProject, tree, getSettings, saveSettings, detectMain, writeFile, removePath, mkdir, rename, COMPILERS };
