import { $, el, icon, debounce, downloadBlob } from '../core/util.js';
import { t } from '../core/i18n.js';
import { formatBytes, baseName, heightForWidth, widthForHeight, scaleByPercent } from '../core/logic.js';
import { LIMITS, EXT, LABEL, validateImage, loadImage, encodeImage, canEncode, describeImageError } from '../core/image.js';

const $id = (id) => document.getElementById(id);
const dropzone = $id('dropzone');
const input = $id('file-input');
const messages = $id('messages');
const workspace = $id('workspace');
const widthEl = $id('width');
const heightEl = $id('height');
const lockEl = $id('lock');
const percentEl = $id('percent');
const formatEl = $id('format');
const qualityEl = $id('quality');
const downloadBtn = $id('btn-download');

const state = {
  file: null,
  type: null,
  loaded: null,
  mode: 'pixels',
  out: null, // { blob, url, name, width, height, mime }
  seq: 0,
};

/* ---------- helpers ---------- */
const showError = (container, text) => {
  container.replaceChildren();
  if (text) container.append(el('div', { class: 'alert alert--error' }, icon('alert'), el('div', {}, text)));
};
const showWarn = (container, text) => {
  container.replaceChildren();
  if (text) container.append(el('div', { class: 'alert alert--warn' }, icon('alert'), el('div', {}, text)));
};

function targetMime() {
  return formatEl.value === 'auto' ? state.type : formatEl.value;
}

function syncQualityState() {
  const mime = targetMime();
  const lossless = mime === 'image/png';
  qualityEl.disabled = lossless;
  $id('quality-hint').textContent = lossless ? t('ir.quality.png', 'PNG is lossless, so there is no quality setting.') : '';
}

/** Returns {width,height} or null if the inputs are not valid yet. Sets error text. */
function currentDimensions() {
  const alertBox = $id('dim-alert');
  if (state.mode === 'percent') {
    const d = scaleByPercent(state.loaded.width, state.loaded.height, Number(percentEl.value));
    $id('percent-out').textContent = `${percentEl.value}%`;
    $id('percent-result').textContent = `→ ${d.width} × ${d.height} px`;
    return validate(d, alertBox);
  }
  const w = parseInt(widthEl.value, 10);
  const h = parseInt(heightEl.value, 10);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) {
    showError(alertBox, t('ir.err.invalid', 'Enter a width and height of at least 1 pixel.'));
    return null;
  }
  return validate({ width: w, height: h }, alertBox);
}

function validate(d, alertBox) {
  if (d.width > LIMITS.maxOutputSide || d.height > LIMITS.maxOutputSide) {
    showError(alertBox, t('ir.err.side', 'The largest supported size is {max} pixels on either side.', { max: LIMITS.maxOutputSide }));
    return null;
  }
  if (d.width * d.height > LIMITS.maxOutputPixels) {
    showError(alertBox, t('ir.err.area', 'That size has too many pixels for a browser to handle. Try something smaller.'));
    return null;
  }
  if (d.width > state.loaded.width || d.height > state.loaded.height) {
    showWarn(alertBox, t('ir.warn.enlarge', 'Enlarging an image can make it look soft or blurry.'));
  } else {
    showError(alertBox, '');
  }
  return d;
}

/* ---------- loading ---------- */
async function loadFile(file) {
  showError(messages, '');
  const v = await validateImage(file);
  if (!v.ok) {
    const name = file.name;
    const text =
      v.code === 'too-large' ? t('ic.err.large', '“{name}” is larger than 25 MB.', { name })
      : v.code === 'empty' ? t('ic.err.empty', '“{name}” is empty.', { name })
      : v.code === 'unsupported' ? t('ic.err.notimage', '“{name}” is not a valid JPG, PNG or WebP image.', { name })
      : t('ic.err.read', '“{name}” could not be read.', { name });
    showError(messages, text);
    return;
  }
  let loaded;
  try {
    loaded = await loadImage(file);
  } catch (err) {
    const [key, fallback] = describeImageError(err.message);
    showError(messages, t(key, fallback));
    return;
  }
  reset({ keepMessages: true });
  state.file = file;
  state.type = v.type;
  state.loaded = loaded;
  const origImg = $id('orig-img');
  origImg.src = loaded.img.src;
  $id('orig-name').textContent = file.name;
  $id('orig-dims').textContent = `${loaded.width} × ${loaded.height} px`;
  $id('orig-size').textContent = `${formatBytes(file.size)} · ${LABEL[v.type]}`;
  widthEl.value = loaded.width;
  heightEl.value = loaded.height;
  percentEl.value = 50;
  workspace.hidden = false;
  dropzone.classList.add('dropzone--compact');
  syncQualityState();
  update();
}

function reset({ keepMessages = false } = {}) {
  state.seq++;
  if (state.out) URL.revokeObjectURL(state.out.url);
  state.out = null;
  state.loaded?.release();
  state.loaded = null;
  state.file = null;
  $id('orig-img').removeAttribute('src');
  $id('out-img').removeAttribute('src');
  workspace.hidden = true;
  dropzone.classList.remove('dropzone--compact');
  downloadBtn.disabled = true;
  if (!keepMessages) showError(messages, '');
  showError($id('dim-alert'), '');
  input.value = '';
}

/* ---------- re-render result ---------- */
async function render() {
  if (!state.loaded) return;
  const dims = currentDimensions();
  const busy = $id('busy');
  if (!dims) {
    downloadBtn.disabled = true;
    $id('out-dims').textContent = '—';
    $id('out-size').textContent = '—';
    $id('out-change').textContent = '—';
    return;
  }
  const seq = ++state.seq;
  busy.replaceChildren(el('span', { class: 'spinner', role: 'status' }), ` ${t('ir.working', 'Resizing…')}`);
  let mime = targetMime();
  try {
    if (!(await canEncode(mime))) {
      if (formatEl.value === 'auto') mime = 'image/jpeg';
      else throw new Error('format-unsupported');
    }
    const blob = await encodeImage(state.loaded, { width: dims.width, height: dims.height, mime, quality: Number(qualityEl.value) / 100 });
    if (seq !== state.seq) return; // a newer render started
    if (state.out) URL.revokeObjectURL(state.out.url);
    const url = URL.createObjectURL(blob);
    state.out = { blob, url, mime, width: dims.width, height: dims.height, name: `${baseName(state.file.name)}-${dims.width}x${dims.height}.${EXT[mime]}` };
    $id('out-img').src = url;
    $id('out-dims').textContent = `${dims.width} × ${dims.height} px`;
    $id('out-size').textContent = `${formatBytes(blob.size)} · ${LABEL[mime]}`;
    const delta = Math.round((1 - blob.size / state.file.size) * 100);
    $id('out-change').textContent = delta > 0 ? `−${delta}%` : delta < 0 ? `+${Math.abs(delta)}%` : '0%';
    downloadBtn.disabled = false;
    busy.replaceChildren();
  } catch (err) {
    if (seq !== state.seq) return;
    const [key, fallback] = describeImageError(err.message);
    busy.replaceChildren();
    showError($id('dim-alert'), t(key, fallback));
    downloadBtn.disabled = true;
  }
}
const update = debounce(render, 180);

/* ---------- events ---------- */
input.addEventListener('change', () => {
  if (input.files[0]) loadFile(input.files[0]);
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
  if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
});
document.addEventListener('paste', (e) => {
  const f = Array.from(e.clipboardData?.files || []).find((x) => x.type.startsWith('image/'));
  if (f) {
    e.preventDefault();
    loadFile(f);
  }
});

widthEl.addEventListener('input', () => {
  const w = parseInt(widthEl.value, 10);
  if (lockEl.checked && state.loaded && Number.isInteger(w) && w > 0) heightEl.value = heightForWidth(state.loaded.width, state.loaded.height, w);
  update();
});
heightEl.addEventListener('input', () => {
  const h = parseInt(heightEl.value, 10);
  if (lockEl.checked && state.loaded && Number.isInteger(h) && h > 0) widthEl.value = widthForHeight(state.loaded.width, state.loaded.height, h);
  update();
});
lockEl.addEventListener('change', () => {
  if (lockEl.checked && state.loaded) {
    const w = parseInt(widthEl.value, 10);
    if (Number.isInteger(w) && w > 0) heightEl.value = heightForWidth(state.loaded.width, state.loaded.height, w);
    update();
  }
});
$id('quick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-w]');
  if (!b || !state.loaded) return;
  const w = Number(b.dataset.w);
  widthEl.value = w;
  heightEl.value = heightForWidth(state.loaded.width, state.loaded.height, w);
  update();
});

function setMode(mode) {
  state.mode = mode;
  $id('mode-pixels').setAttribute('aria-pressed', String(mode === 'pixels'));
  $id('mode-percent').setAttribute('aria-pressed', String(mode === 'percent'));
  $id('pixels-panel').hidden = mode !== 'pixels';
  $id('percent-panel').hidden = mode !== 'percent';
  update();
}
$id('mode-pixels').addEventListener('click', () => setMode('pixels'));
$id('mode-percent').addEventListener('click', () => setMode('percent'));
percentEl.addEventListener('input', update);
formatEl.addEventListener('change', () => {
  syncQualityState();
  update();
});
qualityEl.addEventListener('input', () => {
  $id('quality-out').textContent = qualityEl.value;
  update();
});
downloadBtn.addEventListener('click', () => state.out && downloadBlob(state.out.blob, state.out.name));
$id('btn-reset').addEventListener('click', () => reset());

canEncode('image/webp').then((ok) => {
  if (!ok) {
    const opt = $id('opt-webp');
    opt.disabled = true;
    opt.textContent = `WebP (${t('ic.webp.unsupported', 'not supported by this browser')})`;
  }
});
window.addEventListener('pagehide', () => state.out && URL.revokeObjectURL(state.out.url));
