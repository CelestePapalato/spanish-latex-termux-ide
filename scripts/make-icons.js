'use strict';
// Generates public/icons/icon-192.png and icon-512.png (flame #ED254E on #002A32) with no dependencies.
// The artwork is the same as public/icons/icon.svg: absolute M/C/Z paths, flattened and scanline-filled.
const zlib = require('zlib'), fs = require('fs'), path = require('path');

const BG = [0x00, 0x2a, 0x32], RED = [0xed, 0x25, 0x4e], WHITE = [255, 255, 255];
const OUTER = 'M32.5 3C33 14 41 19 46.5 27C52 35 52.5 43 48.5 50C44.5 57 38 61 31.5 61C23 61 15.5 56 12.5 48.5C9.5 41 12 33 17 28C17.5 33 20.5 36 23 36C22 28 24 20 29 13C30.5 10.5 32 7 32.5 3Z';
const INNER = 'M31.5 58C26 58 21.5 54 21.5 48.5C21.5 43 26 40 29 35C30.5 38 33 39.5 35 42C37.5 45 38 48 37 51.5C35.8 55.5 34 58 31.5 58Z';
// same transform as the SVG: translate(12.8 11) scale(.6) inside a 64x64 viewBox
const TX = 12.8, TY = 11, SC = 0.6;

function flatten(d) {
  const t = d.match(/[MCZ]|-?\d*\.?\d+/g);
  const pts = []; let i = 0, cur = null;
  while (i < t.length) {
    const c = t[i++];
    if (c === 'M') { cur = [+t[i++], +t[i++]]; pts.push(cur); }
    else if (c === 'C') {
      while (i < t.length && !/[MCZ]/.test(t[i])) {
        const p1 = [+t[i++], +t[i++]], p2 = [+t[i++], +t[i++]], p3 = [+t[i++], +t[i++]];
        for (let k = 1; k <= 24; k++) {
          const u = k / 24, v = 1 - u;
          pts.push([0, 1].map(j => v * v * v * cur[j] + 3 * v * v * u * p1[j] + 3 * v * u * u * p2[j] + u * u * u * p3[j]));
        }
        cur = p3;
      }
    }
  }
  return pts.map(([x, y]) => [TX + x * SC, TY + y * SC]);
}

// per-pixel coverage (0..1) by scanline with 4x4 supersampling, "even-odd" rule
function coverage(poly, s) {
  const SS = 4, cov = new Float32Array(s * s), k = s / 64;
  const P = poly.map(([x, y]) => [x * k, y * k]);
  for (let sy = 0; sy < s * SS; sy++) {
    const y = (sy + 0.5) / SS, xs = [];
    for (let i = 0; i < P.length; i++) {
      const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % P.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + (y - y1) / (y2 - y1) * (x2 - x1));
    }
    xs.sort((a, b) => a - b);
    for (let j = 0; j + 1 < xs.length; j += 2) {
      for (let sx = Math.ceil(xs[j] * SS - 0.5); sx < xs[j + 1] * SS - 0.5; sx++) {
        if (sx >= 0 && sx < s * SS) cov[Math.floor(sy / SS) * s + Math.floor(sx / SS)] += 1 / (SS * SS);
      }
    }
  }
  return cov;
}

const T = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = ~0; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };

function png(s) {
  const outer = coverage(flatten(OUTER), s), inner = coverage(flatten(INNER), s);
  const raw = Buffer.alloc((s * 4 + 1) * s);
  const mix = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));
  for (let y = 0; y < s; y++) {
    raw[y * (s * 4 + 1)] = 0;
    for (let x = 0; x < s; x++) {
      let c = mix(BG, RED, Math.min(1, outer[y * s + x]));
      c = mix(c, WHITE, 0.92 * Math.min(1, inner[y * s + x]));
      raw.set([...c, 255], y * (s * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(s, 0); ihdr.writeUInt32BE(s, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const dir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(dir, { recursive: true });
for (const s of [192, 512]) fs.writeFileSync(path.join(dir, `icon-${s}.png`), png(s));
console.log('Ícones gerados em', dir);
