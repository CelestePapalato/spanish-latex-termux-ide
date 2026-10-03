#!/usr/bin/env bash
# LaTeX IDE installer for Termux. It does NOT install TeX Live automatically
# (see scripts/install-texlive.sh for the minimal TeX Live installer).
set -u
cd "$(dirname "$0")"

ok()   { printf '  [ok]       %s\n' "$1"; }
miss() { printf '  [MISSING]  %s\n             -> %s\n' "$1" "$2"; }
opt()  { printf '  [optional] %s\n             -> %s\n' "$1" "$2"; }

echo "== Checking dependencies =="
fail=0
for c in node npm; do
  if command -v "$c" >/dev/null 2>&1; then ok "$c"; else miss "$c" "pkg install nodejs"; fail=1; fi
done
if command -v python >/dev/null 2>&1; then ok python; else opt python "pkg install python   (build tools for npm native modules; pygments for minted)"; fi
TEX="bash scripts/install-texlive.sh"
if command -v pdflatex >/dev/null 2>&1; then ok pdflatex; else miss pdflatex "$TEX  (then: source \$PREFIX/etc/profile.d/texlive.sh)"; fi
for c in bibtex makeindex synctex tlmgr; do
  if command -v "$c" >/dev/null 2>&1; then ok "$c"; else opt "$c" "$TEX"; fi
done
if command -v xelatex >/dev/null 2>&1; then ok xelatex; else opt xelatex "tlmgr install xetex"; fi
if command -v lualatex >/dev/null 2>&1; then ok lualatex; else opt lualatex "tlmgr install luatex"; fi
if command -v texlab >/dev/null 2>&1; then ok texlab; else opt texlab "pkg install texlab   (without it the editor works, but without LSP features)"; fi

if [ "$fail" -ne 0 ]; then
  echo; echo "Install what is missing (Node/npm) and run ./install.sh again."; exit 1
fi

echo; echo "== npm install =="
npm install || { echo "npm install failed."; exit 1; }

echo; echo "== Building the frontend =="
npm run build || {
  echo
  echo "The build failed. If it is esbuild on Termux, try:"
  echo "  pkg install esbuild"
  echo "  ESBUILD_BINARY_PATH=\$(command -v esbuild) npm run build"
  exit 1
}

mkdir -p "$HOME/latex-projects"
chmod +x start.sh install.sh scripts/install-texlive.sh 2>/dev/null
echo; echo "Done. Start it with:  ./start.sh"
if ! command -v pdflatex >/dev/null 2>&1; then
  echo "Warning: pdflatex was not found; install TeX Live (and run 'source \$PREFIX/etc/profile.d/texlive.sh') to be able to compile."
fi
