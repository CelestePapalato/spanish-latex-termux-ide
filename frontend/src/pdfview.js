import { $ } from './ui.js';

let pdfjs = null;
async function lib() {
  if (pdfjs) return pdfjs;
  const url = '/vendor/pdfjs/pdf.min.mjs'; // loaded at runtime (copied by the build step), no CDN
  pdfjs = await import(url);
  pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
  return pdfjs;
}

export class PdfViewer {
  constructor({ onBackward }) {
    this.scroll = $('#pdf-scroll'); this.box = $('#pdf-pages'); this.msgEl = $('#pdf-msg');
    this.pageIn = $('#pdf-page'); this.totalEl = $('#pdf-total'); this.zoomSel = $('#pdf-zoom'); this.info = $('#pdf-info');
    this.url = null; this.doc = null; this.sizes = []; this.pages = []; this.mode = 'width'; this.scale = 1;
    this.tasks = new Set(); this.texts = new Map(); this.onBackward = onBackward; this.last = { q: '', page: 0 };
    this.obs = new IntersectionObserver(es => {
      for (const e of es) { const n = +e.target.dataset.n; e.isIntersecting ? this.render(n) : this.unrender(n); }
    }, { root: this.scroll, rootMargin: '900px 0px' });

    $('#pdf-prev').onclick = () => this.goTo(this.cur() - 1);
    $('#pdf-next').onclick = () => this.goTo(this.cur() + 1);
    this.pageIn.onchange = () => this.goTo(parseInt(this.pageIn.value, 10) || 1);
    $('#pdf-in').onclick = () => this.setZoom(this.scale * 1.25);
    $('#pdf-out').onclick = () => this.setZoom(this.scale / 1.25);
    this.zoomSel.onchange = () => { const v = this.zoomSel.value; this.setZoom(v === 'width' || v === 'page' ? v : parseFloat(v)); };
    $('#pdf-find-btn').onclick = () => this.find($('#pdf-find').value);
    $('#pdf-find').onkeydown = e => { if (e.key === 'Enter') this.find(e.target.value); };

    let raf = 0;
    this.scroll.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => this.updatePage()); }, { passive: true });
    this.scroll.addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); this.setZoom(this.scale * (e.deltaY < 0 ? 1.1 : 0.9)); } }, { passive: false });
    this.box.addEventListener('dblclick', e => {
      const el = e.target.closest('.pdf-page');
      if (!el) return;
      const r = el.getBoundingClientRect(), p = this.pages[+el.dataset.n - 1];
      this.onBackward(+el.dataset.n, (e.clientX - r.left) / p.sc, (e.clientY - r.top) / p.sc);
    });
    // pinch zoom
    let d0 = 0, base = 1;
    const dist = e => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    this.scroll.addEventListener('touchstart', e => { if (e.touches.length === 2) { d0 = dist(e); base = this.scale; } }, { passive: true });
    this.scroll.addEventListener('touchmove', e => {
      if (e.touches.length === 2 && d0) { this.k = dist(e) / d0; this.box.style.transform = `scale(${this.k})`; this.box.style.transformOrigin = '0 0'; e.preventDefault(); }
    }, { passive: false });
    this.scroll.addEventListener('touchend', () => {
      if (d0 && this.k) { this.box.style.transform = ''; const k = this.k; this.k = 0; d0 = 0; this.setZoom(base * k); }
      else d0 = 0;
    });
    let w = this.scroll.clientWidth;
    new ResizeObserver(() => { if (Math.abs(this.scroll.clientWidth - w) > 2) { w = this.scroll.clientWidth; clearTimeout(this.rt); this.rt = setTimeout(() => this.layout(), 150); } }).observe(this.scroll);
  }

  msg(t) { this.msgEl.textContent = t; }
  cur() { return Number(this.pageIn.value) || 1; }

  async load(url) {
    if (url) this.url = url;
    if (!this.url) return;
    try {
      const L = await lib();
      const r = await fetch(`${this.url}?t=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) { if (!this.doc) this.msg(r.status === 404 ? 'Nenhum PDF ainda. Toque em Compilar.' : 'Não foi possível carregar o PDF.'); return; }
      const data = new Uint8Array(await r.arrayBuffer());
      const doc = await L.getDocument({ data, cMapUrl: '/vendor/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/vendor/pdfjs/standard_fonts/', wasmUrl: '/vendor/pdfjs/wasm/' }).promise;
      const sizes = [];
      for (let i = 1; i <= doc.numPages; i++) { const v = (await doc.getPage(i)).getViewport({ scale: 1 }); sizes.push({ w: v.width, h: v.height }); }
      const old = this.doc;
      this.doc = doc; this.sizes = sizes; this.texts.clear();
      this.totalEl.textContent = `/ ${doc.numPages}`; this.pageIn.max = doc.numPages;
      this.msg('');
      await this.layout();
      if (old) old.destroy();
    } catch (e) { this.msg('Erro no PDF: ' + e.message); }
  }

  async layout() {
    if (!this.doc) return;
    const ratio = this.scroll.scrollTop / (this.scroll.scrollHeight || 1);
    const cw = Math.max(100, this.scroll.clientWidth - 24), ch = Math.max(100, this.scroll.clientHeight - 24);
    this.obs.disconnect();
    this.tasks.forEach(t => { try { t.cancel(); } catch {} }); this.tasks.clear();
    const frag = document.createDocumentFragment();
    this.pages = this.sizes.map((s, i) => {
      let sc = this.mode === 'width' ? cw / s.w : this.mode === 'page' ? Math.min(cw / s.w, ch / s.h) : this.mode;
      sc = Math.min(Math.max(sc, 0.1), 6);
      const el = document.createElement('div');
      el.className = 'pdf-page'; el.dataset.n = i + 1;
      el.style.width = s.w * sc + 'px'; el.style.height = s.h * sc + 'px';
      frag.append(el);
      return { el, sc, rendered: false };
    });
    this.box.replaceChildren(frag);
    this.pages.forEach(p => this.obs.observe(p.el));
    this.scale = this.pages[0] ? this.pages[0].sc : 1;
    this.scroll.scrollTop = ratio * this.scroll.scrollHeight;
    this.updatePage();
  }

  async render(n) {
    const p = this.pages[n - 1];
    if (!p || p.rendered) return;
    p.rendered = true;
    const doc = this.doc;
    try {
      const page = await doc.getPage(n);
      if (doc !== this.doc) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      let vp = page.getViewport({ scale: p.sc * dpr });
      const f = Math.min(1, Math.sqrt(16e6 / (vp.width * vp.height)));
      if (f < 1) vp = page.getViewport({ scale: p.sc * dpr * f });
      const c = document.createElement('canvas');
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      c.style.cssText = 'width:100%;height:100%;display:block';
      const task = page.render({ canvasContext: c.getContext('2d'), viewport: vp });
      this.tasks.add(task);
      try { await task.promise; } finally { this.tasks.delete(task); }
      if (p.rendered && p.el.isConnected) p.el.replaceChildren(c);
    } catch { p.rendered = false; }
  }

  unrender(n) { const p = this.pages[n - 1]; if (p && p.rendered) { p.el.replaceChildren(); p.rendered = false; } }

  updatePage() {
    const y = this.scroll.scrollTop + this.scroll.clientHeight / 3;
    let n = 1;
    for (let i = 0; i < this.pages.length; i++) { if (this.pages[i].el.offsetTop <= y) n = i + 1; else break; }
    if (document.activeElement !== this.pageIn) this.pageIn.value = n;
  }

  goTo(n, y) {
    if (!this.pages.length) return;
    n = Math.min(Math.max(n, 1), this.pages.length);
    const p = this.pages[n - 1];
    this.scroll.scrollTo({ top: p.el.offsetTop - (y != null ? Math.max(8, y * p.sc - 80) : 8), behavior: 'auto' });
    this.pageIn.value = n;
  }

  setZoom(v) {
    if (typeof v === 'number') { v = Math.min(Math.max(v, 0.2), 6); this.mode = v; } else this.mode = v;
    const opt = [...this.zoomSel.options].find(o => o.value === String(v));
    if (opt) this.zoomSel.value = opt.value;
    else { const c = this.zoomSel.querySelector('[value=custom]'); c.hidden = false; c.textContent = `${Math.round(v * 100)}%`; this.zoomSel.value = 'custom'; }
    this.layout();
  }

  async pageText(n) {
    if (this.texts.has(n)) return this.texts.get(n);
    const tc = await (await this.doc.getPage(n)).getTextContent();
    const t = tc.items.map(i => i.str).join(' ').toLowerCase();
    this.texts.set(n, t);
    return t;
  }

  async find(q) {
    q = q.trim().toLowerCase();
    if (!q || !this.doc) return;
    const N = this.doc.numPages;
    const start = q === this.last.q ? this.last.page + 1 : this.cur();
    for (let i = 0; i < N; i++) {
      const n = ((start - 1 + i) % N) + 1;
      if ((await this.pageText(n)).includes(q)) { this.goTo(n); this.last = { q, page: n }; this.info.textContent = `p. ${n}`; return; }
    }
    this.last = { q, page: 0 };
    this.info.textContent = 'Não encontrado';
  }
}
