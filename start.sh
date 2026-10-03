#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
export PORT="${PORT:-3000}"
# Make sure TeX Live is in PATH even if this shell did not load it yet.
if ! command -v pdflatex >/dev/null 2>&1 && [ -n "${PREFIX:-}" ] && [ -f "$PREFIX/etc/profile.d/texlive.sh" ]; then
  # shellcheck disable=SC1091
  . "$PREFIX/etc/profile.d/texlive.sh"
fi
if [ ! -f public/app.js ]; then
  echo "Frontend not built. Run ./install.sh (or npm run build) first."; exit 1
fi
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock
exec node backend/server.js
