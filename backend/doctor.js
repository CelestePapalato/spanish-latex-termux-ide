'use strict';
const fs = require('fs');
const path = require('path');

// Looks a command up in PATH (no shell involved).
function which(cmd) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, cmd);
    try { fs.accessSync(p, fs.constants.X_OK); if (fs.statSync(p).isFile()) return p; } catch {}
  }
  return null;
}

// Each tool has two hints:
//   hint   - Brazilian Portuguese, shown inside the IDE (the IDE interface is pt-BR)
//   hintEn - English, printed in the terminal by `npm run doctor` and at server startup
const TEX = 'bash scripts/install-texlive.sh   (instala o TeX Live mínimo; depois: source $PREFIX/etc/profile.d/texlive.sh)';
const TEX_EN = 'bash scripts/install-texlive.sh   (installs minimal TeX Live; then: source $PREFIX/etc/profile.d/texlive.sh)';
const TOOLS = [
  { name: 'pdflatex', level: 'required', hint: TEX, hintEn: TEX_EN },
  { name: 'xelatex', level: 'optional', hint: 'tlmgr install xetex', hintEn: 'tlmgr install xetex' },
  { name: 'lualatex', level: 'optional', hint: 'tlmgr install luatex lualatex-math', hintEn: 'tlmgr install luatex lualatex-math' },
  { name: 'bibtex', level: 'optional', hint: TEX, hintEn: TEX_EN },
  { name: 'biber', level: 'optional', hint: 'pode não existir para Android; use bibtex/natbib', hintEn: 'may not exist for Android; use bibtex/natbib' },
  { name: 'makeindex', level: 'optional', hint: TEX, hintEn: TEX_EN },
  { name: 'makeglossaries', level: 'optional', hint: 'tlmgr install glossaries   (requer: pkg install perl)', hintEn: 'tlmgr install glossaries   (requires: pkg install perl)' },
  { name: 'synctex', level: 'optional', hint: TEX, hintEn: TEX_EN },
  { name: 'texlab', level: 'recommended', hint: 'pkg install texlab', hintEn: 'pkg install texlab' },
  { name: 'tlmgr', level: 'optional', hint: TEX + ' — o tlmgr acompanha o TeX Live e permite instalar pacotes pela IDE', hintEn: TEX_EN + ' — tlmgr ships with TeX Live and lets the IDE install packages' },
];

function check() {
  const tools = {};
  for (const t of TOOLS) {
    const p = which(t.name);
    tools[t.name] = { found: !!p, path: p, level: t.level, hint: t.hint, hintEn: t.hintEn };
  }
  return { node: process.version, tools };
}

// Terminal report (English).
function report(res = check()) {
  const out = [`Node ${res.node}`];
  for (const [name, t] of Object.entries(res.tools)) {
    if (t.found) out.push(`  [ok]       ${name}  (${t.path})`);
    else out.push(`  [${t.level === 'optional' ? 'optional' : t.level === 'recommended' ? 'recommended' : 'MISSING'}] ${name}\n            -> ${t.hintEn}`);
  }
  return out.join('\n');
}

module.exports = { which, check, report };
if (require.main === module) console.log(report());
