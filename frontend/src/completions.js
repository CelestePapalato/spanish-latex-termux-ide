import { snippetCompletion } from '@codemirror/autocomplete';

// Local suggestions: shown instantly (without waiting for TexLab) and merged with the LSP ones.
// [name, number of {} arguments, description]
const CMD = [
  ['documentclass', 1, 'classe do documento'], ['usepackage', 1, 'carrega um pacote'], ['input', 1, 'inclui um arquivo'], ['include', 1, 'inclui um capítulo'],
  ['includegraphics', 1, 'insere imagem'], ['part', 1, 'parte'], ['chapter', 1, 'capítulo'], ['section', 1, 'seção'], ['subsection', 1, 'subseção'],
  ['subsubsection', 1, 'subsubseção'], ['paragraph', 1, 'parágrafo'], ['label', 1, 'rótulo'], ['ref', 1, 'referência'], ['eqref', 1, 'referência de equação'],
  ['pageref', 1, 'número da página'], ['autoref', 1, 'referência automática'], ['cref', 1, 'referência (cleveref)'], ['cite', 1, 'citação'], ['citep', 1, 'citação (entre parênteses)'],
  ['citet', 1, 'citação (textual)'], ['footnote', 1, 'nota de rodapé'], ['caption', 1, 'legenda'], ['title', 1, 'título'], ['author', 1, 'autor'], ['date', 1, 'data'],
  ['maketitle', 0, 'gera o título'], ['tableofcontents', 0, 'sumário'], ['listoffigures', 0, 'lista de figuras'], ['listoftables', 0, 'lista de tabelas'],
  ['textbf', 1, 'negrito'], ['textit', 1, 'itálico'], ['emph', 1, 'ênfase'], ['underline', 1, 'sublinhado'], ['texttt', 1, 'monoespaçado'], ['textsc', 1, 'versalete'],
  ['textrm', 1, 'romano'], ['textsf', 1, 'sem serifa'], ['textcolor', 2, 'texto colorido'], ['color', 1, 'cor'], ['url', 1, 'endereço'], ['href', 2, 'hiperlink'],
  ['item', 0, 'item de lista'], ['hline', 0, 'linha horizontal'], ['toprule', 0, 'booktabs: linha superior'], ['midrule', 0, 'booktabs: linha do meio'],
  ['bottomrule', 0, 'booktabs: linha inferior'], ['cmidrule', 1, 'booktabs: linha parcial'], ['multicolumn', 3, 'células mescladas'], ['centering', 0, 'centraliza'],
  ['newpage', 0, 'nova página'], ['clearpage', 0, 'limpa página'], ['noindent', 0, 'sem recuo'], ['vspace', 1, 'espaço vertical'], ['hspace', 1, 'espaço horizontal'],
  ['bibliography', 1, 'arquivo .bib'], ['bibliographystyle', 1, 'estilo da bibliografia'], ['printbibliography', 0, 'imprime bibliografia (biblatex)'],
  ['newcommand', 2, 'novo comando'], ['renewcommand', 2, 'redefine comando'], ['setlength', 2, 'define comprimento'], ['geometry', 1, 'margens'], ['chemfig', 1, 'estrutura química'],
  ['frac', 2, 'fração'], ['sqrt', 1, 'raiz'], ['sum', 0, 'somatório'], ['int', 0, 'integral'], ['prod', 0, 'produtório'], ['lim', 0, 'limite'], ['infty', 0, 'infinito'],
  ['partial', 0, 'derivada parcial'], ['nabla', 0, 'nabla'], ['cdot', 0, 'ponto'], ['times', 0, 'vezes'], ['leq', 0, 'menor ou igual'], ['geq', 0, 'maior ou igual'],
  ['neq', 0, 'diferente'], ['approx', 0, 'aproximado'], ['rightarrow', 0, 'seta →'], ['Rightarrow', 0, 'seta ⇒'], ['leftrightarrow', 0, 'seta ↔'], ['mathbb', 1, 'quadro negro'],
  ['mathbf', 1, 'negrito matemático'], ['mathcal', 1, 'caligráfico'], ['mathrm', 1, 'romano matemático'], ['vec', 1, 'vetor'], ['hat', 1, 'chapéu'], ['bar', 1, 'barra'],
  ['overline', 1, 'linha acima'], ['text', 1, 'texto em modo matemático'], ['left', 0, 'delimitador esquerdo'], ['right', 0, 'delimitador direito'], ['ce', 1, 'mhchem: fórmula química'],
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
  ['tabular', null, '{${ll}}'], ['center'], ['abstract'], ['quote'], ['verbatim'], ['minipage', null, '{${0.5\\linewidth}}'], ['tikzpicture'], ['frame', null, '{${Título}}'],
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
  for (const [n, argc, detail] of CMD) {
    const label = '\\' + n, type = argc === 0 && /^(sum|int|prod|lim|infty|partial|nabla|cdot|times|leq|geq|neq|approx|rightarrow|Rightarrow|leftrightarrow)$/.test(n) ? 'keyword' : 'command';
    const tpl = SPECIAL[n] || (argc ? label + '{${}}'.repeat(argc) : null);
    out.push(tpl ? snip(tpl, start, { label, detail, type }) : plain(label, start, { detail, type }));
  }
  for (const g of GREEK) out.push(plain('\\' + g, start, { detail: 'letra grega', type: 'variable' }));
  for (const [n, body, args] of ENV) {
    const b = body === undefined ? '  ${}' : body === null ? '  ${}' : body;
    out.push(snip(`\\begin{${n}}${args || ''}\n${b}\n\\end{${n}}`, start, { label: `\\begin{${n}}`, detail: 'ambiente', type: 'environment', boost: -1 }));
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
