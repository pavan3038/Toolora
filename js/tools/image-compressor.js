import { $, el, icon, debounce, downloadBlob, toast } from '../core/util.js';
import { t } from '../core/i18n.js';
import { formatBytes, fitWithin, baseName, uniqueName, buildZip } from '../core/logic.js';
import { LIMITS, EXT, LABEL, validateImage, loadImage, encodeImage, canEncode, describeImageError } from '../core/image.js';

const dropzone = $('#dropzone');
const input = $('#file-input');
const qualityEl = $('#quality');
const qualityOut = $('#quality-out');
const formatEl = $('#format');
const maxSideEl = $('#maxside');
const messages = $('#messages');
const results = $('#results');
const list = $('#file-list');
const summary = $('#summary');
const zipBtn = $('#btn-zip');

let items = [];
let nextId = 1;
let running = false;
let rerun = false;

/* ---------- messages ---------- */
function showMessages(lines) {
  messages.replaceChildren();
  if (!lines.length) return;
  messages.append(
    el('div', { class: 'alert alert--error' }, icon('alert'),
      el('div', { class: 'alert-list' }, lines.map((l) => el('div', {}, l))))
  );
}

const rejection = (name, v) => {
  switch (v.code) {
    case 'too-large': return t('ic.err.large', '“{name}” is larger than 25 MB.', { name });
    case 'empty': return t('ic.err.empty', '“{name}” is empty.', { name });
    case 'unsupported':
      return v.detected
        ? t('ic.err.format', '“{name}” is a {type} file. Only JPG, PNG and WebP are supported.', { name, type: v.detected.replace('image/', '').toUpperCase() })
        : t('ic.err.notimage', '“{name}” is not a valid JPG, PNG or WebP image.', { name });
    default: return t('ic.err.read', '“{name}” could not be read.', { name });
  }
};

/* ---------- adding files ---------- */
async function addFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const problems = [];
  let room = LIMITS.maxFiles - items.length;
  for (const file of files) {
    if (room <= 0) {
      problems.push(t('ic.err.count', 'Only {max} images can be added at once. Skipped “{name}”.', { max: LIMITS.maxFiles, name: file.name }));
      continue;
    }
    const v = await validateImage(file);
    if (!v.ok) {
      problems.push(rejection(file.name, v));
      continue;
    }
    room--;
    const item = { id: nextId++, file, name: file.name, type: v.type, status: 'queued', result: null, error: null, thumb: null, row: null };
    items.push(item);
    list.append(buildRow(item));
  }
  showMessages(problems);
  syncVisibility();
  run();
}

/* ---------- processing ---------- */
function settings() {
  return {
    quality: Number(qualityEl.value) / 100,
    format: formatEl.value,
    maxSide: Number(maxSideEl.value),
  };
}

async function processItem(item) {
  item.status = 'working';
  item.error = null;
  renderRow(item);
  const s = settings();
  let loaded;
  try {
    loaded = await loadImage(item.file);
    let mime = s.format === 'auto' ? item.type : s.format;
    if (!(await canEncode(mime))) {
      if (s.format === 'auto') mime = 'image/jpeg';
      else throw new Error('format-unsupported');
    }
    const { width, height } = fitWithin(loaded.width, loaded.height, s.maxSide);
    const blob = await encodeImage(loaded, { width, height, mime, quality: s.quality });
    const unchanged = mime === item.type && width === loaded.width && height === loaded.height;
    let final = blob;
    let kept = false;
    // Never hand back a bigger file than the one the person started with (when nothing else changed).
    if (unchanged && blob.size >= item.file.size) {
      final = item.file;
      kept = true;
    }
    if (item.thumb) URL.revokeObjectURL(item.thumb);
    item.thumb = URL.createObjectURL(final);
    const outName = kept ? item.name : `${baseName(item.name)}-compressed.${EXT[mime]}`;
    item.result = { blob: final, width, height, mime, kept, name: outName, origWidth: loaded.width, origHeight: loaded.height };
    item.status = 'done';
  } catch (err) {
    item.status = 'error';
    const [key, fallback] = describeImageError(err.message);
    item.error = t(key, fallback);
    item.result = null;
  } finally {
    loaded?.release();
  }
  renderRow(item);
}

async function run() {
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  try {
    do {
      rerun = false;
      for (const item of [...items]) {
        if (rerun) break;
        if (!items.includes(item) || item.status === 'done') continue;
        await processItem(item);
        if (!items.includes(item) && item.thumb) URL.revokeObjectURL(item.thumb);
      }
    } while (rerun);
  } finally {
    running = false;
    renderSummary();
  }
}

const settingsChanged = debounce(() => {
  items.forEach((i) => {
    i.status = 'queued';
    renderRow(i);
  });
  run();
}, 350);

/* ---------- rendering ---------- */
function buildRow(item) {
  item.row = {
    thumb: el('div', { class: 'thumb-ph' }, icon('image')),
    name: el('div', { class: 'file-name', title: item.name }, item.name),
    meta: el('div', { class: 'file-meta' }),
    badge: el('span', { class: 'badge-wrap' }),
    download: el('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => item.result && downloadBlob(item.result.blob, item.result.name) }, icon('download'), el('span', { 'data-label': '' }, t('common.download', 'Download'))),
    remove: el('button', { class: 'btn btn-sm btn-ghost', type: 'button', 'aria-label': t('common.remove', 'Remove'), onclick: () => removeItem(item) }, icon('x')),
  };
  const info = el('div', { class: 'file-info' }, item.row.name, item.row.meta);
  const actions = el('div', { class: 'file-actions' }, item.row.download, item.row.remove);
  item.row.li = el('li', { class: 'file-row' }, item.row.thumb, info, item.row.badge, actions);
  renderRow(item);
  return item.row.li;
}

function renderRow(item) {
  const r = item.row;
  if (!r) return;
  r.download.disabled = item.status !== 'done';
  r.badge.replaceChildren();
  if (item.status === 'queued' || item.status === 'working') {
    r.meta.textContent = `${formatBytes(item.file.size)} · ${item.status === 'working' ? t('ic.working', 'Compressing…') : t('ic.waiting', 'Waiting…')}`;
    r.badge.append(el('span', { class: 'spinner', role: 'status', 'aria-label': t('ic.working', 'Compressing…') }));
    return;
  }
  if (item.status === 'error') {
    r.meta.textContent = item.error;
    r.badge.append(el('span', { class: 'badge badge--danger' }, t('ic.failed', 'Failed')));
    return;
  }
  const res = item.result;
  if (r.thumb.tagName !== 'IMG') {
    const img = el('img', { class: 'file-thumb', alt: '', width: 56, height: 56 });
    r.thumb.replaceWith(img);
    r.thumb = img;
  }
  r.thumb.src = item.thumb;
  const dims = `${res.width}×${res.height}`;
  r.meta.textContent = `${formatBytes(item.file.size)} → ${formatBytes(res.blob.size)} · ${dims} · ${LABEL[res.mime]}`;
  const delta = Math.round((1 - res.blob.size / item.file.size) * 100);
  if (res.kept) r.badge.append(el('span', { class: 'badge', title: t('ic.kept.title', 'Compressing would have made this file larger, so your original is kept.') }, t('ic.kept', 'Already optimized')));
  else if (delta > 0) r.badge.append(el('span', { class: 'badge badge--success' }, `−${delta}%`));
  else r.badge.append(el('span', { class: 'badge badge--warn' }, `+${Math.abs(delta)}%`));
}

function renderSummary() {
  const done = items.filter((i) => i.status === 'done');
  zipBtn.disabled = done.length < 1;
  zipBtn.hidden = items.length < 2;
  if (!done.length) {
    summary.textContent = '';
    return;
  }
  const before = done.reduce((n, i) => n + i.file.size, 0);
  const after = done.reduce((n, i) => n + i.result.blob.size, 0);
  const saved = before - after;
  summary.replaceChildren(
    saved > 0
      ? el('span', {}, t('ic.saved', 'Saved '), el('strong', {}, `${formatBytes(saved)} (${Math.round((saved / before) * 100)}%)`), ` · ${formatBytes(before)} → ${formatBytes(after)}`)
      : el('span', {}, `${formatBytes(before)} → ${formatBytes(after)}`)
  );
}

function syncVisibility() {
  results.hidden = items.length === 0;
  renderSummary();
}

function removeItem(item) {
  items = items.filter((i) => i !== item);
  if (item.thumb) URL.revokeObjectURL(item.thumb);
  item.row?.li.remove();
  showMessages([]);
  syncVisibility();
}

function clearAll() {
  items.forEach((i) => i.thumb && URL.revokeObjectURL(i.thumb));
  items = [];
  list.replaceChildren();
  showMessages([]);
  syncVisibility();
  input.value = '';
}

async function downloadZip() {
  const done = items.filter((i) => i.status === 'done');
  if (!done.length) return;
  const label = zipBtn.querySelector('[data-label]');
  const original = label.textContent;
  zipBtn.disabled = true;
  label.textContent = t('ic.zipping', 'Preparing ZIP…');
  try {
    const used = new Set();
    const files = [];
    for (const i of done) files.push({ name: uniqueName(i.result.name, used), data: new Uint8Array(await i.result.blob.arrayBuffer()) });
    const zip = buildZip(files);
    downloadBlob(new Blob([zip], { type: 'application/zip' }), 'toolora-compressed-images.zip');
  } catch {
    toast(t('ic.err.zip', 'Could not create the ZIP file. Try downloading images one by one.'), 'error');
  } finally {
    label.textContent = original;
    zipBtn.disabled = false;
  }
}

/* ---------- events ---------- */
input.addEventListener('change', () => {
  addFiles(input.files);
  input.value = '';
});

const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
['dragenter', 'dragover'].forEach((type) =>
  window.addEventListener(type, (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dropzone.classList.add('is-over');
  })
);
window.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) dropzone.classList.remove('is-over');
});
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dropzone.classList.remove('is-over');
  addFiles(e.dataTransfer.files);
});
document.addEventListener('paste', (e) => {
  const files = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith('image/'));
  if (files.length) {
    e.preventDefault();
    addFiles(files);
  }
});

qualityEl.addEventListener('input', () => {
  qualityOut.textContent = qualityEl.value;
  settingsChanged();
});
formatEl.addEventListener('change', settingsChanged);
maxSideEl.addEventListener('change', settingsChanged);
$('#btn-clear').addEventListener('click', clearAll);
zipBtn.addEventListener('click', downloadZip);

// Disable WebP if this browser cannot create WebP files (e.g. Safari).
canEncode('image/webp').then((ok) => {
  if (!ok) {
    const opt = $('#opt-webp');
    opt.disabled = true;
    opt.textContent = `WebP (${t('ic.webp.unsupported', 'not supported by this browser')})`;
  }
});

window.addEventListener('pagehide', () => items.forEach((i) => i.thumb && URL.revokeObjectURL(i.thumb)));
