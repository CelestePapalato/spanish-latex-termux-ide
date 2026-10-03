// Applies the theme before the first paint (avoids a flash of the wrong theme). Loaded synchronously in <head>.
(function () {
  var t = 'auto';
  try { t = (JSON.parse(localStorage.getItem('latexide-prefs') || '{}')).theme || 'auto'; } catch (e) {}
  var dark = t === 'dark' || (t !== 'light' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
