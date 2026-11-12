// Entry point: loads the translations first, translates index.html and only then starts the app,
// so every module can call t() while it initializes.
import { loadLocale, applyI18n } from './i18n.js';

loadLocale().then(() => {
  applyI18n();
  return import('./main.js');
}).catch(e => console.error('Startup failed:', e));
