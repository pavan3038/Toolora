/* Small DOM + browser helpers shared by every page and tool. */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/** localStorage that never throws (private mode, blocked storage, quota). */
export const storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(`toolora:${key}`);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`toolora:${key}`, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(`toolora:${key}`);
    } catch {
      /* ignore */
    }
  },
};

export function debounce(fn, ms) {
  let timer;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

/** Create an element: el('button', { class: 'btn', onclick }, 'Text', childNode). Text is always escaped. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** <svg><use></svg> icon from /img/icons.svg */
export function icon(name, className = 'icon') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', `/img/icons.svg#i-${name}`);
  svg.append(use);
  return svg;
}

export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = el('textarea', { 'aria-hidden': 'true', readonly: '' });
    // CSSOM (not a style attribute) so this works under a strict Content-Security-Policy.
    Object.assign(ta.style, { position: 'fixed', top: '0', left: '-9999px', opacity: '0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const done = document.execCommand('copy');
    ta.remove();
    return done;
  } catch {
    return false;
  }
}

/** Trigger a browser download for a Blob. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename, rel: 'noopener' });
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function toast(message, kind = 'info') {
  const region = $('#toast-region');
  if (!region) return;
  const node = el('div', { class: `toast${kind === 'error' ? ' toast--error' : ''}` }, message);
  region.append(node);
  setTimeout(() => node.remove(), kind === 'error' ? 4200 : 2200);
}

/** Make a button briefly show feedback text (e.g. "Copied!") and restore it afterwards. */
export function flashButton(button, text, ms = 1400) {
  const label = button.querySelector('[data-label]') || button;
  if (button.dataset.flashing) return;
  const original = label.textContent;
  button.dataset.flashing = '1';
  label.textContent = text;
  setTimeout(() => {
    label.textContent = original;
    delete button.dataset.flashing;
  }, ms);
}

/** Read a text file the user picked, with size and type checks. */
export async function readTextFile(file, { maxBytes, extensions }) {
  if (file.size > maxBytes) return { ok: false, code: 'too-large' };
  const name = file.name.toLowerCase();
  const typeOk = file.type.startsWith('text/') || file.type === 'application/json' || file.type === '';
  const extOk = extensions.some((ext) => name.endsWith(ext));
  if (!extOk || !typeOk) return { ok: false, code: 'bad-type' };
  try {
    const text = await file.text();
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000e-\u001f]/.test(text.slice(0, 4096))) return { ok: false, code: 'bad-type' };
    return { ok: true, text };
  } catch {
    return { ok: false, code: 'read-failed' };
  }
}

export function formatDuration(seconds, t) {
  if (seconds < 1) return `0 ${t('unit.sec', 'sec')}`;
  if (seconds < 60) return `${seconds} ${t('unit.sec', 'sec')}`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m} ${t('unit.min', 'min')} ${s} ${t('unit.sec', 'sec')}` : `${m} ${t('unit.min', 'min')}`;
}
