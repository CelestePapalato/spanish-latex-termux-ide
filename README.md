# LaTeX IDE for Termux

A local, Overleaf-style LaTeX IDE for **Android / Termux**. It works offline and opens at `http://127.0.0.1:3000`.

> [!IMPORTANT]
> **Interface language:** the IDE itself (menus, buttons, messages, dialogs) is in **Brazilian Portuguese (pt-BR)**.
> All documentation, code comments and terminal output (installer, server, `doctor`) are in English.

## Features

- CodeMirror 6 editor and a real file tree stored in `~/latex-projects/`
- Compilation with native TeX Live (`pdflatex`, `xelatex`, `lualatex`), multiple passes (bibtex/biber, index, glossaries)
- Built-in PDF.js viewer, SyncTeX, clickable logs, WebSocket live updates
- TexLab via LSP (autocomplete, hover, go to definition, references, outline, diagnostics)
- Responsive layout (file tree + editor + PDF; Editor / Split / PDF switch), icons, optional PWA
- Brand colors `#ED254E` and `#002A32`; light, dark and automatic (follows the system) themes
- Projects screen (flame logo, top left): create new projects or open/delete existing ones
- Download the finished PDF and install TeX Live packages from inside the IDE (`tlmgr`)

## Requirements

| Tool | Required | Why | Installed with |
|------|----------|-----|----------------|
| Node.js (>= 18) + npm | Yes | Runs the server and builds the frontend | `pkg install nodejs` |
| TeX Live (`scheme-basic`) | Yes | `pdflatex`, `bibtex`, `makeindex`, `tlmgr` | `scripts/install-texlive.sh` |
| TexLab | Recommended | Autocomplete, hover and diagnostics (LSP). The editor works without it | `pkg install texlab` |
| Python | Recommended | Build tools for npm native modules (`node-gyp`) and Pygments for `minted` | `pkg install python` |
| Perl | Yes (for TeX Live) | `tlmgr` and several TeX Live scripts are written in Perl | `pkg install perl` |
| Git | Optional | Clone this repository | `pkg install git` |

> [!NOTE]
> The IDE code does not call Python directly. It is listed because Termux often needs it to build native npm modules, and because `minted` (with `LATEXIDE_SHELL_ESCAPE=1`) needs Pygments.

## Installation

Run everything below inside **Termux**. Every block can be copied with the copy button in the top right corner of the block.

### 1. Update Termux and install the base packages

```bash
pkg update && pkg upgrade -y
pkg install -y nodejs python perl git texlab
```

### 2. Get the project

Clone the repository (replace the URL with your own):

```bash
git clone https://github.com/jkestavivo/latex-termux-ide.git
cd latex-termux-ide
```

Or, if you downloaded the `.tar.gz` release:

```bash
tar -xzf latex-termux-ide.tar.gz
cd latex-termux-ide
```

### 3. Install the minimal TeX Live

The helper script installs the **smallest TeX Live scheme that can compile LaTeX documents** (`scheme-basic`) instead of the multi-gigabyte `scheme-full`:

```bash
bash scripts/install-texlive.sh
```

Why `scheme-basic`?

| Scheme | Contains | Enough for this IDE? |
|--------|----------|----------------------|
| `scheme-minimal` | Plain TeX only, no LaTeX format | No (no `pdflatex`) |
| `scheme-basic` | Plain TeX + LaTeX core (`pdflatex`, `bibtex`, `makeindex`, `amsmath`, `hyperref`) | **Yes, the minimum** |
| `scheme-small` / `scheme-medium` / `scheme-full` | More packages, languages and fonts | Not needed, just bigger |

The download needs an internet connection and may take several minutes.

### 4. Make `pdflatex` work: load TeX Live into your PATH (`source`)

TeX Live is installed outside the default Termux `bin` folder, so the shell does not know where `pdflatex` is until you load the TeX Live environment file. This is what `source` does: it runs the file **inside your current shell** so the `PATH` change takes effect immediately.

Load it in the current session:

```bash
source "$PREFIX/etc/profile.d/texlive.sh"
```

Make it permanent for every new Termux session (safe to run more than once):

```bash
grep -qxF 'source "$PREFIX/etc/profile.d/texlive.sh"' ~/.bashrc || echo 'source "$PREFIX/etc/profile.d/texlive.sh"' >> ~/.bashrc
```

Check that it worked (each command should print a version):

```bash
pdflatex --version
tlmgr --version
```

> [!TIP]
> If you see `pdflatex: command not found`, you opened a new session before the `source` line was saved, or it was skipped. Run the `source` command above again, or fully close and reopen Termux. `./start.sh` also tries to load the file automatically.

### 5. Install the IDE

```bash
./install.sh
```

This checks the dependencies, runs `npm install` and builds the frontend (`npm run build`).

### 6. Start it

```bash
./start.sh
```

To use another port:

```bash
PORT=3001 ./start.sh
```

Open `http://127.0.0.1:3000` in your phone's browser.

To see which tools were found:

```bash
npm run doctor
```

### Optional extras

LaTeX engines and tools that are **not** in `scheme-basic` can be added at any time (from the terminal, or from the IDE: menu `⋯` → "Pacotes TeX Live"):

```bash
tlmgr install xetex
tlmgr install luatex
tlmgr install glossaries
```

For `minted` (needs Pygments and shell escape, trusted documents only):

```bash
pip install pygments
LATEXIDE_SHELL_ESCAPE=1 ./start.sh
```

## Using the IDE

The interface is in **Brazilian Portuguese**. The labels below are the Portuguese names you will see on screen.

- **Logo (flame):** opens the projects screen ("Novo projeto" and the list of existing projects, newest first).
- **More room for code:** the logs live in a bottom drawer that is **hidden by default** (`>_` button, with an error counter). The PDF controls (zoom, navigation, search) sit behind the settings button in the PDF header, and the touch quick keys sit behind "Teclas rápidas". All three choices are remembered. The Editor / Split / PDF buttons at the top choose what fills the screen.
- **Download PDF:** download icon in the PDF header, or menu `⋯` → "Baixar PDF".
- **TeX Live packages:** menu `⋯` → "Pacotes TeX Live" (needs internet and `tlmgr`). Search by package name or, with the option checked, by file name (`.sty`, `.cls`). When a build fails because of a missing file, the problems panel shows "Buscar pacote para …"; after installing, the IDE recompiles.
- **Theme:** menu `⋯` toggles light/dark; "Configurações" also has "Automático", which follows the system.
- **Files:** the first button in the top bar shows/hides the file tree. On tablets/desktops it sits next to the editor and the PDF; on phones it opens as a drawer over the editor.
- **Autocomplete:** appears when typing `\`, inside `\begin{`, `\end{`, `\ref{`, `\cite{`, `\usepackage{`, etc. Local suggestions (commands, environments, labels, bibliography keys) appear instantly and are merged with TexLab's. `Tab`/`Enter` accept, `Ctrl+Space` forces the list.
- Create/open projects from the sidebar and choose the main file.
- **Compile** manually (`Ctrl+Enter`) or turn on auto-compile (the debounce is configurable in settings).
- Tap an error in the problems panel to jump to its line.
- Double-tap the PDF for reverse SyncTeX (PDF → source).
- Changes made outside the IDE (another editor, git) are detected and reloaded.

## Project structure

```text
backend/   HTTP + WebSocket server, compiler, LSP (texlab), projects, tlmgr
frontend/  app source code (CodeMirror, PDF.js)
public/    served files (app.js is generated by the build; theme-init.js applies the theme before the first paint)
scripts/   build, icons (make-icons.js draws the PNGs from the flame artwork) and install-texlive.sh
```

## Security

- Listens on `127.0.0.1` only (the `HOST` variable changes this, not recommended).
- Validates the `Host` and `Origin` headers, requires `X-LatexIDE` on requests that change data, and sets a CSP.
- Protects against path traversal and symlinks; there is no generic command-execution endpoint.
- Only allow-listed LSP methods are forwarded to TexLab.
- The package manager only runs `tlmgr search` and `tlmgr install`, without a shell, with names validated by regex (letters, digits, `. _ + -`), requiring the `X-LatexIDE` header; one installation at a time.
- Compiles with `-no-shell-escape`. To enable it (minted, etc.): `LATEXIDE_SHELL_ESCAPE=1 ./start.sh`, only with trusted documents.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `pdflatex: command not found` | Run `source "$PREFIX/etc/profile.d/texlive.sh"` (see [step 4](#4-make-pdflatex-work-load-tex-live-into-your-path-source)) or reopen Termux |
| `esbuild` fails on Termux | `pkg install esbuild`, then `ESBUILD_BINARY_PATH=$(command -v esbuild) npm run build` |
| Port already in use | `PORT=3001 ./start.sh` |
| External changes not detected | `fs.watch` may be limited on some storage locations; save from the IDE or recompile manually |
| Missing LaTeX package (e.g. `chemfig`) | Menu `⋯` → "Pacotes TeX Live", or `tlmgr install chemfig` in the terminal. The problems panel offers a shortcut |
| "Pacotes TeX Live" says `tlmgr` does not exist | `tlmgr` ships with TeX Live; reinstall with `bash scripts/install-texlive.sh` and load the PATH (step 4) |
| `biber` unavailable | It may not exist for Android; use bibtex/natbib |
| Process killed in the background | `start.sh` uses `termux-wake-lock`; disable battery optimization for Termux |
| TexLab missing | The editor works without LSP; install it with `pkg install texlab` |

## Known limitations

- PDF search finds the page but does not highlight the match.
- SyncTeX (forward and reverse) has not been tested against the real `synctex` binary.
- The complete flow with real TeX Live and TexLab has not been validated on Android.
- `scripts/install-texlive.sh` follows the same mechanism as the Termux `texlive-installer` package (`termux-install-tl`) with `scheme-basic`, but has not been verified on a physical device.
- Package search and installation were tested with a simulated `tlmgr`; the real `tlmgr search` output is parsed in two known formats but was not confirmed on Termux.

## Updating an existing installation

Extract the new `.tar.gz` over the old folder (your projects in `~/latex-projects` are not touched) and rebuild:

```bash
npm install
npm run build
```

If the browser still shows the old version, reload without cache (the service worker is network-first).
