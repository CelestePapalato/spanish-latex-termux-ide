'use strict';
// Bundles the frontend (CodeMirror 6 + app) and copies PDF.js to public/vendor. Runs once, at install time.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

async function main() {
  const esbuild = require('esbuild');
  await esbuild.build({
    entryPoints: [path.join(root, 'frontend/src/main.js')],
    bundle: true, minify: true, format: 'iife', target: ['chrome90'],
    outfile: path.join(root, 'public/app.js'), logLevel: 'info',
  });
  const pdf = path.join(root, 'node_modules/pdfjs-dist');
  const out = path.join(root, 'public/vendor/pdfjs');
  fs.mkdirSync(out, { recursive: true });
  for (const f of ['pdf.min.mjs', 'pdf.worker.min.mjs']) fs.copyFileSync(path.join(pdf, 'build', f), path.join(out, f));
  for (const d of ['cmaps', 'standard_fonts', 'wasm']) {
    if (fs.existsSync(path.join(pdf, d))) fs.cpSync(path.join(pdf, d), path.join(out, d), { recursive: true });
  }
  console.log('Build finished: public/app.js + public/vendor/pdfjs');
}
main().catch(e => { console.error('Build failed:', e.message); process.exit(1); });
