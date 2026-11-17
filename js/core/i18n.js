/*
 * Tiny i18n layer.
 *  - English is the default and lives in the HTML itself (best for SEO and speed).
 *  - Other languages are small dictionaries in /js/i18n/<code>.js, loaded only when chosen.
 *  - Elements opt in with data-i18n="key" (text) and data-i18n-attr="attr:key;attr2:key2".
 *  - Dynamic strings in JS use t('key', 'English fallback {name}', { name }).
 */
import { storage } from './util.js';

let dict = {};
let lang = 'en';
const listeners = new Set();

export const getLang = () => lang;
export const onLangChange = (fn) => listeners.add(fn);

function interpolate(str, vars) {
  return vars ? str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : str;
}

export function t(key, fallback, vars) {
  const value = dict[key] ?? fallback ?? key;
  return interpolate(value, vars);
}

/** Apply translations under `root`. The first pass also records the English baseline for each element. */
export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((node) => {
    if (node.dataset.en === undefined) node.dataset.en = node.textContent;
    const next = dict[node.dataset.i18n];
    node.textContent = next !== undefined ? next : node.dataset.en;
  });
  root.querySelectorAll('[data-i18n-attr]').forEach((node) => {
    node.dataset.i18nAttr.split(';').forEach((pair) => {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (!attr || !key) return;
      const baseKey = `data-en-${attr}`;
      if (node.getAttribute(baseKey) === null) node.setAttribute(baseKey, node.getAttribute(attr) || '');
      node.setAttribute(attr, dict[key] !== undefined ? dict[key] : node.getAttribute(baseKey));
    });
  });
}

export async function setLang(code, { persist = true } = {}) {
  let next = {};
  if (code !== 'en') {
    try {
      const mod = await import(`/js/i18n/${code}.js`);
      next = mod.default || {};
    } catch {
      code = 'en';
    }
  }
  dict = next;
  lang = code;
  document.documentElement.lang = code;
  applyTranslations();
  if (persist) storage.set('lang', code);
  const select = document.getElementById('lang-select');
  if (select) select.value = code;
  listeners.forEach((fn) => fn(code));
}

export async function initI18n() {
  const saved = storage.get('lang', 'en');
  const select = document.getElementById('lang-select');
  const allowed = select ? Array.from(select.options).map((o) => o.value) : ['en'];
  await setLang(allowed.includes(saved) ? saved : 'en', { persist: false });
  select?.addEventListener('change', () => setLang(select.value));
}
