#!/usr/bin/env bash
# Installs a MINIMAL TeX Live on Termux, unattended.
#
# Why scheme-basic?
#   - scheme-minimal only ships plain TeX (no LaTeX format, so no pdflatex).
#   - scheme-basic = plain TeX + LaTeX core (pdflatex, bibtex, makeindex, amsmath, hyperref, ...).
#     It is the smallest TeX Live scheme that is enough to compile the IDE's default template.
#   - Everything else (xetex, luatex, extra .sty files, fonts) can be added later with tlmgr,
#     either from a terminal or from the IDE itself (menu "..." -> "Pacotes TeX Live").
#
# Based on the approach used by the Termux "texlive-installer" package (termux-install-tl),
# but selecting scheme-basic instead of scheme-full. NOT validated on every Android device.
set -e

echo "== 1/5  Installing Termux packages (texlive-bin, texlive-installer, perl) =="
pkg install -y texlive-bin texlive-installer perl

echo "== 2/5  Loading the TeX Live PATH for this shell =="
# This is the "source" step: it exports the TeX Live bin directory into PATH
# so that pdflatex, tlmgr, synctex... are found in the CURRENT shell.
# shellcheck disable=SC1091
source "$PREFIX/etc/profile.d/texlive.sh"

echo "== 3/5  Creating a scheme-basic profile and running the TeX Live installer =="
sed 's/scheme-full/scheme-basic/' "$PREFIX/opt/texlive/termux.profile" > "$PREFIX/opt/texlive/termux-install-basic.profile"
"$PREFIX/opt/texlive/install-tl/install-tl" \
  --custom-bin "$PREFIX/bin/texlive" \
  --profile "$PREFIX/opt/texlive/termux-install-basic.profile"

echo "== 4/5  Applying Termux patches and generating formats =="
if command -v termux-patch-texlive >/dev/null 2>&1; then termux-patch-texlive; fi
tlmgr install latex-bin texlive-scripts-extra || true   # normally already part of scheme-basic; harmless if so
fmtutil-sys --byfmt pdflatex || true
updmap-sys || true
texlinks || true

echo "== 5/5  Making the PATH permanent (new Termux sessions) =="
LINE='source "$PREFIX/etc/profile.d/texlive.sh"'
touch "$HOME/.bashrc"
grep -qxF "$LINE" "$HOME/.bashrc" || echo "$LINE" >> "$HOME/.bashrc"

echo
echo "Done. Run this in your CURRENT session (or just restart Termux):"
echo "  source \"\$PREFIX/etc/profile.d/texlive.sh\""
echo "Then check:  pdflatex --version"
