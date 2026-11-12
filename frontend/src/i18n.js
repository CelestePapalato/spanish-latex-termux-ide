// Interface translations.
// Texts live in public/locales/<lang>.json (one file per language) and are loaded at
// startup, so a fix in that file only needs a page reload, not a rebuild.
//
//   t('files.newFile')                 -> "Nuevo archivo"
//   t('home.created', { name: 'tesis' }) -> "Proyecto “tesis” creado"   ({name} is replaced)
//
// In index.html, elements are translated with attributes:
//   data-i18n="key"            textContent
//   data-i18n-html="key"       innerHTML (only for texts that contain markup, e.g. <code>)
//   data-i18n-title="key"      title attribute
//   data-i18n-aria-label="key" aria-label attribute
//   data-i18n-placeholder="key" placeholder attribute

export const DEFAULT_LANG = 'es';
let dict = {}, fallback = {}, lang = DEFAULT_LANG;

const lookup = (d, key) => key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), d);

async function fetchLocale(l) {
  try {
    const r = await fetch(`/locales/${encodeURIComponent(l)}.json`, { cache: 'no-cache' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

// Language: prefs.lang (localStorage) > <html lang> > DEFAULT_LANG. Missing keys fall back to DEFAULT_LANG.
export async function loadLocale(wanted) {
  if (!wanted) {
    try { wanted = JSON.parse(localStorage.getItem('latexide-prefs') || '{}').lang; } catch {}
  }
  wanted = wanted || document.documentElement.lang || DEFAULT_LANG;
  const d = await fetchLocale(wanted);
  fallback = wanted === DEFAULT_LANG ? (d || {}) : ((await fetchLocale(DEFAULT_LANG)) || {});
  dict = d || fallback;
  lang = d ? wanted : DEFAULT_LANG;
  document.documentElement.lang = lang;
  return lang;
}

export const getLang = () => lang;

export function t(key, params) {
  let s = lookup(dict, key);
  if (typeof s !== 'string') s = lookup(fallback, key);
  if (typeof s !== 'string') { console.warn('[i18n] missing key:', key); return key; }
  return params ? s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m)) : s;
}

const ATTRS = [['i18nTitle', 'title'], ['i18nAriaLabel', 'aria-label'], ['i18nPlaceholder', 'placeholder']];

export function applyI18n(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const [ds, attr] of ATTRS) {
    for (const el of root.querySelectorAll(`[data-i18n-${attr}]`)) el.setAttribute(attr, t(el.dataset[ds]));
  }
}
