import { $, el, icon, downloadBlob, toast } from '../core/util.js';
import { t } from '../core/i18n.js';
import { formatBytes, baseName, fitWithin, parseJpegInfo, jpegCanEmbedDirectly, layoutPage, buildPdfParts } from '../core/logic.js';
import { validateImage, loadImage, encodeImage, describeImageError, LABEL } from '../core/image.js';

const MAX_FILES = 40;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 150 * 1024 * 1024;
const MAX_REENCODE_SIDE = 4096; // PNG/WebP are re-encoded at most this large (≈ 350 dpi on A4)

const dropzone = $('#dropzone');
const input = $('#file-input');
const messages = $('#messages');
const results = $('#results');
const list = $('#file-list');
const summary = $('#summary');
const convertBtn = $('#btn-convert');
const sizeEl = $('#page-size');
const orientEl = $('#orientation');
const marginEl = $('#margin');
const srStatus = $('#sr-status');
const dialog = $('#preview-dialog');

let items = [];
let nextId = 1;
let converting = false;
let adding = Promise.resolve();
let previewUrl = null;

/* ---------- messages ---------- */
function showMessages(lines) {
  messages.replaceChildren();
  if (!lines.length) return;
  messages.append(el('div', { class: 'alert alert--error' }, icon('alert'), el('div', { class: 'alert-list' }, lines.map((l) => el('div', {}, l)))));
}

const rejection = (name, v) => {
  switch (v.code) {
    case 'too-large': return t('ic.err.large', '“{name}” is larger than 25 MB.', { name });
    case 'empty': return t('ic.err.empty', '“{name}” is empty.', { name });
    case 'unsupported':
      return v.detected
        ? t('jp.err.format', '“{name}” is a {type} file. Only JPG, PNG and WebP images can be added.', { name, type: v.detected.replace('image/', '').toUpperCase() })
        : t('ic.err.notimage', '“{name}” is not a valid JPG, PNG or WebP image.', { name });
    default: return t('ic.err.read', '“{name}” could not be read.', { name });
  }
};

/* ---------- adding files ---------- */
async function makeThumb(loaded) {
  const { width, height } = fitWithin(loaded.width, loaded.height, 160);
  return URL.createObjectURL(await encodeImage(loaded, { width, height, mime: 'image/jpeg', quality: 0.7 }));
}

async function addFilesNow(files) {
  if (!files.length) return;
  const problems = [];
  let total = items.reduce((n, i) => n + i.file.size, 0);
  for (const file of files) {
    if (items.length >= MAX_FILES) {
      problems.push(t('jp.err.count', 'Only {max} images can be added at once. Skipped “{name}”.', { max: MAX_FILES, name: file.name }));
      continue;
    }
    if (total + file.size > MAX_TOTAL_BYTES) {
      problems.push(t('jp.err.total', 'Adding “{name}” would go over the 150 MB total limit.', { name: file.name }));
      continue;
    }
    const v = await validateImage(file);
    if (!v.ok) {
      problems.push(rejection(file.name, v));
      continue;
    }
    let loaded;
    try {
      loaded = await loadImage(file);
      const item = { id: nextId++, file, name: file.name, type: v.type, width: loaded.width, height: loaded.height, thumb: await makeThumb(loaded), row: null };
      total += file.size;
      items.push(item);
      list.append(buildRow(item));
      syncAll();
    } catch (err) {
      const [key, fallback] = describeImageError(err.message);
      problems.push(`${file.name}: ${t(key, fallback)}`);
    } finally {
      loaded?.release();
    }
  }
  showMessages(problems);
  syncAll();
}
// Serialise additions so two quick drops cannot interleave. The FileList is copied immediately:
// it is "live", and the file input is cleared right after this call.
const addFiles = (fileList) => {
  const files = Array.from(fileList || []);
  adding = adding.then(() => addFilesNow(files)).catch((err) => {
    showMessages([t('img.err.generic', 'Something went wrong while processing this image.')]);
    console.error(err);
  });
  return adding;
};

/* ---------- rows ---------- */
function actionButton(iconName, label, onclick) {
  return el('button', { class: 'btn btn-sm btn-ghost', type: 'button', 'aria-label': label, title: label, onclick }, icon(iconName));
}

function buildRow(item) {
  const r = (item.row = {});
  r.name = el('div', { class: 'file-name', title: item.name }, item.name);
  r.meta = el('div', { class: 'file-meta' }, `${formatBytes(item.file.size)} · ${item.width}×${item.height} · ${LABEL[item.type]}`);
  r.badge = el('span', { class: 'badge badge--primary' });
  r.preview = actionButton('eye', '', () => openPreview(item));
  r.up = actionButton('arrow-up', '', () => move(item, -1, r.up));
  r.down = actionButton('arrow-down', '', () => move(item, 1, r.down));
  r.remove = actionButton('x', '', () => removeItem(item));
  r.li = el('li', { class: 'file-row' },
    el('img', { class: 'file-thumb thumb-sq', src: item.thumb, alt: '', width: 56, height: 56 }),
    el('div', { class: 'file-info' }, r.name, r.meta),
    el('span', { class: 'badge-wrap' }, r.badge),
    el('div', { class: 'file-actions' }, r.preview, r.up, r.down, r.remove));
  return r.li;
}

/** Refresh numbering, button states and labels after any change to the list. */
function syncAll() {
  const n = items.length;
  items.forEach((item, i) => {
    const r = item.row;
    r.badge.textContent = t('jp.page', 'Page {n}', { n: i + 1 });
    r.up.disabled = i === 0;
    r.down.disabled = i === n - 1;
    const label = (key, fb) => t(key, fb, { name: item.name });
    r.preview.setAttribute('aria-label', label('jp.act.preview', 'Preview {name}'));
    r.up.setAttribute('aria-label', label('jp.act.up', 'Move {name} up'));
    r.down.setAttribute('aria-label', label('jp.act.down', 'Move {name} down'));
    r.remove.setAttribute('aria-label', label('jp.act.remove', 'Remove {name}'));
    r.preview.title = t('jp.preview', 'Preview');
    r.up.title = t('jp.up', 'Move up');
    r.down.title = t('jp.down', 'Move down');
    r.remove.title = t('common.remove', 'Remove');
  });
  results.hidden = n === 0;
  convertBtn.disabled = n === 0 || converting;
  const total = items.reduce((s, i) => s + i.file.size, 0);
  summary.textContent = n ? `${t(n === 1 ? 'jp.summary.one' : 'jp.summary.many', n === 1 ? '1 image → 1-page PDF' : '{n} images → {n}-page PDF', { n })} · ${formatBytes(total)}` : '';
  const fit = sizeEl.value === 'fit';
  orientEl.disabled = fit;
  $('#orient-hint').textContent = fit ? t('jp.orient.fit', 'Pages match each image, so orientation is automatic.') : '';
}

function move(item, delta, button) {
  const from = items.indexOf(item);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= items.length) return;
  items.splice(from, 1);
  items.splice(to, 0, item);
  items.forEach((i) => list.append(i.row.li)); // re-append in the new order
  syncAll();
  // Keep keyboard focus on the same control; if it just became disabled, use its sibling.
  (button.disabled ? (delta < 0 ? item.row.down : item.row.up) : button).focus();
  srStatus.textContent = t('jp.moved', 'Moved “{name}” to page {n} of {total}.', { name: item.name, n: to + 1, total: items.length });
}

function removeItem(item) {
  const i = items.indexOf(item);
  items = items.filter((x) => x !== item);
  URL.revokeObjectURL(item.thumb);
  item.row.li.remove();
  showMessages([]);
  syncAll();
  items[Math.min(i, items.length - 1)]?.row.remove.focus();
  if (!items.length) input.focus();
}

function clearAll() {
  items.forEach((i) => URL.revokeObjectURL(i.thumb));
  items = [];
  list.replaceChildren();
  showMessages([]);
  syncAll();
  input.value = '';
}

/* ---------- preview ---------- */
function openPreview(item) {
  if (typeof dialog.showModal !== 'function') return;
  previewUrl = URL.createObjectURL(item.file);
  $('#preview-img').src = previewUrl;
  $('#preview-caption').textContent = `${item.name} · ${item.width}×${item.height} · ${formatBytes(item.file.size)}`;
  dialog.showModal();
}
function closePreview() {
  if (dialog.open) dialog.close();
}
dialog.addEventListener('close', () => {
  $('#preview-img').removeAttribute('src');
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
});
$('#preview-close').addEventListener('click', closePreview);
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) closePreview();
});

/* ---------- conversion ---------- */
const tick = () => new Promise((r) => setTimeout(r, 0)); // let the browser paint progress between pages

async function toPdfImage(item) {
  if (item.type === 'image/jpeg') {
    const data = new Uint8Array(await item.file.arrayBuffer());
    const info = parseJpegInfo(data);
    if (jpegCanEmbedDirectly(info)) return { data, width: info.width, height: info.height, components: info.components };
  }
  // PNG, WebP, and JPEGs a PDF cannot hold as-is (CMYK, EXIF-rotated, 12-bit…): re-encode as upright RGB JPEG.
  const loaded = await loadImage(item.file);
  try {
    const { width, height } = fitWithin(loaded.width, loaded.height, MAX_REENCODE_SIDE);
    const blob = await encodeImage(loaded, { width, height, mime: 'image/jpeg', quality: 0.92 });
    return { data: new Uint8Array(await blob.arrayBuffer()), width, height, components: 3 };
  } finally {
    loaded.release();
  }
}

async function convert() {
  if (converting || !items.length) return;
  converting = true;
  const label = convertBtn.querySelector('[data-label]');
  const original = label.textContent;
  convertBtn.disabled = true;
  showMessages([]);
  try {
    const opts = { size: sizeEl.value, orientation: orientEl.value, margin: Number(marginEl.value) };
    const pages = [];
    for (const [i, item] of items.entries()) {
      label.textContent = t('jp.working', 'Creating PDF… {done}/{total}', { done: i + 1, total: items.length });
      await tick();
      const image = await toPdfImage(item);
      pages.push({ ...layoutPage(image.width, image.height, opts), image });
    }
    const { parts } = buildPdfParts(pages);
    const blob = new Blob(parts, { type: 'application/pdf' });
    const name = items.length === 1 ? `${baseName(items[0].name)}.pdf` : 'toolora-images.pdf';
    downloadBlob(blob, name);
    toast(t('jp.done', 'PDF created: {size}', { size: formatBytes(blob.size) }));
  } catch (err) {
    const [key, fallback] = describeImageError(err.message);
    showMessages([t('jp.err.convert', 'The PDF could not be created. {reason}', { reason: t(key, fallback) })]);
  } finally {
    label.textContent = original;
    converting = false;
    syncAll();
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
sizeEl.addEventListener('change', syncAll);
$('#btn-clear').addEventListener('click', clearAll);
convertBtn.addEventListener('click', convert);
window.addEventListener('pagehide', () => items.forEach((i) => URL.revokeObjectURL(i.thumb)));
syncAll();
