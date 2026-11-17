import { $, el, icon, debounce, copyText, downloadBlob, flashButton, readTextFile, toast, formatDuration } from '../core/util.js';
import { t, onLangChange } from '../core/i18n.js';
import { parseJSON, stringifyAST, jsonStats, errorContext, formatBytes } from '../core/logic.js';

const MAX_UPLOAD = 5 * 1024 * 1024;
const SAMPLE = `{"name":"Toolora","free":true,"tools":[{"id":"image-compressor","tags":["image","jpg","png"]},{"id":"json-formatter","tags":["developer"]}],"stats":{"version":1.10,"users":12345678901234567890},"notes":null}`;

const inputEl = $('#input');
const outputEl = $('#output');
const statusEl = $('#status');
const indentEl = $('#indent');
const sortEl = $('#sort');
const copyBtn = $('#btn-copy');
const downloadBtn = $('#btn-download');

let mode = 'format';
let lastOk = null; // { output, filename }
let lastError = null;
let uploadName = null;

function setStatus(node) {
  statusEl.replaceChildren(...(node ? [node] : []));
}

function typeLabel(type) {
  return t(`jf.type.${type}`, type);
}

function describeError(error) {
  // Translate when we have a translation for this error code; otherwise fall back to the English message.
  return t(`jf.err.${error.code}`, error.message, { ...error.params, line: error.line, column: error.column });
}

function render() {
  const text = inputEl.value;
  copyBtn.disabled = downloadBtn.disabled = true;
  lastOk = null;
  lastError = null;

  const parsed = parseJSON(text);
  if (parsed.empty) {
    outputEl.value = '';
    setStatus(null);
    return;
  }
  if (!parsed.ok) {
    outputEl.value = '';
    lastError = parsed.error;
    const ctx = errorContext(text, parsed.error.offset);
    const box = el('div', { class: 'json-error', role: 'alert' },
      el('strong', {}, t('jf.invalid', 'Invalid JSON'), ' — ', t('jf.at', 'line {line}, column {column}', { line: parsed.error.line, column: parsed.error.column })),
      el('div', {}, describeError(parsed.error)),
      el('pre', {}, `${ctx.line}\n${' '.repeat(ctx.col)}^`),
      el('button', { class: 'btn btn-sm', type: 'button', onclick: goToError }, icon('search'), t('jf.goto', 'Go to error')));
    setStatus(box);
    return;
  }

  const indent = mode === 'minify' ? 0 : indentEl.value === 'tab' ? 'tab' : Number(indentEl.value);
  const output = stringifyAST(parsed.ast, { indent, sortKeys: sortEl.checked });
  outputEl.value = output;
  const stats = jsonStats(parsed.ast);
  const bytes = new TextEncoder().encode(output).length;
  lastOk = { output, filename: `${uploadName || (mode === 'minify' ? 'minified' : 'formatted')}.json` };
  copyBtn.disabled = downloadBtn.disabled = false;

  const bits = [
    typeLabel(stats.type),
    stats.type === 'array' ? t('jf.items', '{n} items', { n: stats.size }) : stats.type === 'object' ? t('jf.keysTop', '{n} keys', { n: stats.size }) : null,
    t('jf.depth', 'depth {n}', { n: stats.depth }),
    formatBytes(bytes),
  ].filter(Boolean);
  setStatus(
    el('div', { class: 'json-ok' },
      el('span', { class: 'badge badge--success' }, icon('check'), t('jf.valid', 'Valid JSON')),
      el('span', { class: 'muted' }, bits.join(' · ')))
  );
}

function goToError() {
  if (!lastError) return;
  inputEl.focus();
  const at = Math.min(lastError.offset, inputEl.value.length);
  inputEl.setSelectionRange(at, Math.min(at + 1, inputEl.value.length));
  // Scroll the caret into view in browsers that don't do it on selection.
  const lineHeight = parseFloat(getComputedStyle(inputEl).lineHeight) || 20;
  inputEl.scrollTop = Math.max(0, (lastError.line - 3) * lineHeight);
}

// Large inputs are re-parsed less eagerly so typing stays smooth.
const renderFast = debounce(render, 120);
const renderSlow = debounce(render, 500);
const scheduleRender = () => {
  renderFast.cancel();
  renderSlow.cancel();
  (inputEl.value.length > 300000 ? renderSlow : renderFast)();
};

inputEl.addEventListener('input', () => {
  uploadName = null;
  scheduleRender();
});
indentEl.addEventListener('change', render);
sortEl.addEventListener('change', render);

function setMode(next) {
  mode = next;
  $('#mode-format').setAttribute('aria-pressed', String(next === 'format'));
  $('#mode-minify').setAttribute('aria-pressed', String(next === 'minify'));
  $('#indent-field').hidden = next === 'minify';
  render();
}
$('#mode-format').addEventListener('click', () => setMode('format'));
$('#mode-minify').addEventListener('click', () => setMode('minify'));

$('#btn-sample').addEventListener('click', () => {
  inputEl.value = SAMPLE;
  uploadName = null;
  render();
});

$('#btn-clear').addEventListener('click', () => {
  inputEl.value = '';
  outputEl.value = '';
  uploadName = null;
  render();
  inputEl.focus();
});

$('#btn-paste').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    inputEl.value = text;
    uploadName = null;
    render();
  } catch {
    toast(t('common.pasteBlocked', 'Your browser blocked clipboard access. Press Ctrl+V (or ⌘V) in the box instead.'), 'error');
    inputEl.focus();
  }
});

$('#file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const r = await readTextFile(file, { maxBytes: MAX_UPLOAD, extensions: ['.json', '.txt'] });
  if (!r.ok) {
    const msg = r.code === 'too-large' ? t('jf.upload.large', 'That file is larger than 5 MB.') : t('jf.upload.type', 'Please choose a .json or .txt text file.');
    toast(msg, 'error');
    return;
  }
  inputEl.value = r.text;
  uploadName = `${file.name.replace(/\.[^.]*$/, '').replace(/[\\/:*?"<>|]/g, '_') || 'data'}-${mode === 'minify' ? 'minified' : 'formatted'}`;
  render();
});

copyBtn.addEventListener('click', async () => {
  if (!lastOk) return;
  const ok = await copyText(lastOk.output);
  if (ok) flashButton(copyBtn, t('common.copied', 'Copied!'));
  else toast(t('common.copyFailed', 'Could not copy'), 'error');
});

downloadBtn.addEventListener('click', () => {
  if (!lastOk) return;
  downloadBlob(new Blob([lastOk.output], { type: 'application/json' }), lastOk.filename);
});

onLangChange(render);
render();
