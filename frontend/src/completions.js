import { snippetCompletion } from '@codemirror/autocomplete';
import { t } from './i18n.js';

// Local suggestions: shown instantly (without waiting for TexLab) and merged with the LSP ones.
// [name, number of {} arguments]. The descriptions live in public/locales/<lang>.json → completions.commands
const CMD = [
  ['documentclass', 1], ['usepackage', 1], ['input', 1], ['include', 1],
  ['includegraphics', 1], ['part', 1], ['chapter', 1], ['section', 1], ['subsection', 1],
  ['subsubsection', 1], ['paragraph', 1], ['label', 1], ['ref', 1], ['eqref', 1],
  ['pageref', 1], ['autoref', 1], ['cref', 1], ['cite', 1], ['citep', 1],
  ['citet', 1], ['footnote', 1], ['caption', 1], ['title', 1], ['author', 1], ['date', 1],
  ['maketitle', 0], ['tableofcontents', 0], ['listoffigures', 0], ['listoftables', 0],
  ['textbf', 1], ['textit', 1], ['emph', 1], ['underline', 1], ['texttt', 1], ['textsc', 1],
  ['textrm', 1], ['textsf', 1], ['textcolor', 2], ['color', 1], ['url', 1], ['href', 2],
  ['item', 0], ['hline', 0], ['toprule', 0], ['midrule', 0],
  ['bottomrule', 0], ['cmidrule', 1], ['multicolumn', 3], ['centering', 0],
  ['newpage', 0], ['clearpage', 0], ['noindent', 0], ['vspace', 1], ['hspace', 1],
  ['bibliography', 1], ['bibliographystyle', 1], ['printbibliography', 0],
  ['newcommand', 2], ['renewcommand', 2], ['setlength', 2], ['geometry', 1], ['chemfig', 1],
  ['frac', 2], ['sqrt', 1], ['sum', 0], ['int', 0], ['prod', 0], ['lim', 0], ['infty', 0],
  ['partial', 0], ['nabla', 0], ['cdot', 0], ['times', 0], ['leq', 0], ['geq', 0],
  ['neq', 0], ['approx', 0], ['rightarrow', 0], ['Rightarrow', 0], ['leftrightarrow', 0], ['mathbb', 1],
  ['mathbf', 1], ['mathcal', 1], ['mathrm', 1], ['vec', 1], ['hat', 1], ['bar', 1],
  ['overline', 1], ['text', 1], ['left', 0], ['right', 0], ['ce', 1],
];
const GREEK = 'alpha beta gamma delta epsilon varepsilon zeta eta theta lambda mu nu xi pi rho sigma tau phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Phi Psi Omega'.split(' ');
const SPECIAL = {
  documentclass: '\\documentclass{${article}}', usepackage: '\\usepackage{${}}', includegraphics: '\\includegraphics[width=\\linewidth]{${}}',
  item: '\\item ${}', cmidrule: '\\cmidrule{${2-3}}', setlength: '\\setlength{${}}{${}}',
};

// Environments: [name, optional body]. The body uses CodeMirror's snippet syntax.
const ENV = [
  ['document'], ['itemize', '  \\item ${}'], ['enumerate', '  \\item ${}'], ['description', '  \\item[${}] '],
  ['equation'], ['equation*'], ['align'], ['align*'], ['gather'], ['multline'], ['split'], ['cases'], ['matrix'], ['pmatrix'], ['bmatrix'], ['array', null, '{${cc}}'],
  ['figure', '  \\centering\n  \\includegraphics[width=\\linewidth]{${}}\n  \\caption{${}}\n  \\label{fig:${}}', '[${htbp}]'],
  ['table', '  \\centering\n  \\caption{${}}\n  \\label{tab:${}}\n  \\begin{tabular}{${ll}}\n    \\toprule\n    ${}\n    \\bottomrule\n  \\end{tabular}', '[${htbp}]'],
  ['tabular', null, '{${ll}}'], ['center'], ['abstract'], ['quote'], ['verbatim'], ['minipage', null, '{${0.5\\linewidth}}'], ['tikzpicture'], ['frame', null, '{${' + t('completions.frameTitle') + '}}'],
  ['theorem'], ['lemma'], ['proof'], ['definition'], ['thebibliography', null, '{${99}}'],
];
const ENV_NAMES = ENV.map(e => e[0]);
const PACKAGES = 'amsmath amssymb amsthm mathtools physics graphicx tikz pgfplots chemfig mhchem booktabs geometry hyperref xcolor babel inputenc fontenc lmodern microtype enumitem float caption subcaption siunitx listings minted cleveref natbib biblatex fancyhdr setspace multicol array longtable multirow csquotes url titlesec'.split(' ');
const CLASSES = 'article report book beamer memoir letter amsart IEEEtran standalone scrartcl scrreprt scrbook'.split(' ');
const REF = new Set(['ref', 'eqref', 'pageref', 'autoref', 'cref', 'Cref', 'vref', 'nameref']);
const CITE = new Set(['cite', 'citep', 'citet', 'citealp', 'citeauthor', 'citeyear', 'parencite', 'textcite', 'autocite', 'footcite', 'nocite']);
const PKG = new Set(['usepackage', 'RequirePackage']);

const uniq = (re, text, max = 300) => { const out = new Set(); let m; while ((m = re.exec(text)) && out.size < max) out.add(m[1].trim()); return [...out]; };

function unclosedEnv(state, pos) {
  const text = state.doc.sliceString(0, pos), stack = [], re = /\\(begin|end)\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(text))) { if (m[1] === 'begin') stack.push(m[2]); else { const i = stack.lastIndexOf(m[2]); if (i >= 0) stack.length = i; } }
  return stack.length ? stack[stack.length - 1] : null;
}

const plain = (label, start, extra) => ({
  label, ...extra,
  apply: (v, _c, _f, to) => v.dispatch({ changes: { from: start, to: Math.max(to, start), insert: label }, selection: { anchor: start + label.length }, userEvent: 'input.complete' }),
});
function snip(template, start, extra) {
  const o = snippetCompletion(template, extra), base = o.apply;
  o.apply = (v, c, _f, to) => base(v, c, start, to);
  return o;
}

function commandOptions(start) {
  const out = [];
  for (const [n, argc] of CMD) {
    const detail = t('completions.commands.' + n);
    const label = '\\' + n, type = argc === 0 && /^(sum|int|prod|lim|infty|partial|nabla|cdot|times|leq|geq|neq|approx|rightarrow|Rightarrow|leftrightarrow)$/.test(n) ? 'keyword' : 'command';
    const tpl = SPECIAL[n] || (argc ? label + '{${}}'.repeat(argc) : null);
    out.push(tpl ? snip(tpl, start, { label, detail, type }) : plain(label, start, { detail, type }));
  }
  for (const g of GREEK) out.push(plain('\\' + g, start, { detail: t('completions.greekLetter'), type: 'variable' }));
  for (const [n, body, args] of ENV) {
    const b = body === undefined ? '  ${}' : body === null ? '  ${}' : body;
    out.push(snip(`\\begin{${n}}${args || ''}\n${b}\n\\end{${n}}`, start, { label: `\\begin{${n}}`, detail: t('completions.environment'), type: 'environment', boost: -1 }));
  }
  return out;
}

// Returns { from, options } when the cursor is in a LaTeX context, or null.
export function localComplete(state, pos, before, explicit) {
  const arg = /\\([a-zA-Z@]+)\*?(?:\[[^\]]*\])*\{([^{}]*)$/.exec(before);
  if (arg) {
    const cmd = arg[1], inside = arg[2];
    const multi = CITE.has(cmd) || PKG.has(cmd);
    const partial = multi ? inside.slice(inside.lastIndexOf(',') + 1).replace(/^\s+/, '') : inside;
    const from = pos - partial.length, doc = state.doc.toString();
    let names = [], type = 'text', first = null;
    if (cmd === 'begin') { names = ENV_NAMES; type = 'environment'; }
    else if (cmd === 'end') { first = unclosedEnv(state, pos); names = first ? [first, ...ENV_NAMES.filter(n => n !== first)] : ENV_NAMES; type = 'environment'; }
    else if (REF.has(cmd)) { names = uniq(/\\label\{([^}]+)\}/g, doc); type = 'label'; }
    else if (CITE.has(cmd)) { names = [...uniq(/\\bibitem(?:\[[^\]]*\])?\{([^}]+)\}/g, doc), ...uniq(/@\w+\{([^,\s]+),/g, doc)]; type = 'cite'; }
    else if (PKG.has(cmd)) { names = PACKAGES; type = 'package'; }
    else if (cmd === 'documentclass') { names = CLASSES; type = 'package'; }
    return { from, options: names.map(label => ({ label, type, boost: label === first ? 99 : 0 })) };
  }
  const m = /\\[a-zA-Z@]*\*?$/.exec(before);
  if (m) {
    const idx = before.length - m[0].length;
    if (before[idx - 1] === '\\') return null; // "\\" (line break) must not open the list
    const from = pos - m[0].length;
    return { from, options: commandOptions(from) };
  }
  if (explicit) { const w = /[\w@]*$/.exec(before)[0]; return { from: pos - w.length, options: [] }; }
  return null;
}
