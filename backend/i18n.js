'use strict';
// Server-side translations (error messages and hints shown in the IDE).
// They share the file public/locales/<lang>.json with the interface (section "server").
// Language: LATEXIDE_LANG environment variable (default "es"); missing keys fall back to "es".
// Terminal output (startup, doctor, compile log banners) stays in English and does not use this.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'public', 'locales');
const DEFAULT_LANG = 'es';

function load(lang) {
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(lang)) return null;
  try { return JSON.parse(fs.readFileSync(path.join(DIR, lang + '.json'), 'utf8')); } catch { return null; }
}

const wanted = process.env.LATEXIDE_LANG || DEFAULT_LANG;
const fallback = load(DEFAULT_LANG) || {};
const dict = (wanted !== DEFAULT_LANG && load(wanted)) || fallback;
const LANG = dict === fallback ? DEFAULT_LANG : wanted;

const lookup = (d, key) => key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), d);

function t(key, params) {
  let s = lookup(dict, key);
  if (typeof s !== 'string') s = lookup(fallback, key);
  if (typeof s !== 'string') return key;
  return params ? s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m)) : s;
}

module.exports = { t, LANG };
