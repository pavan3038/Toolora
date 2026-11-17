import { $, $$, el, icon, debounce, copyText, downloadBlob, flashButton, readTextFile, toast, formatDuration } from '../core/util.js';
import { t, onLangChange } from '../core/i18n.js';
import { analyzeText, countCharacters } from '../core/logic.js';

const MAX_UPLOAD = 2 * 1024 * 1024;
const textEl = $('#text');
const ignoreEl = $('#ignore-common');
const copyBtn = $('#btn-copy');
const downloadBtn = $('#btn-download');
const nf = new Intl.NumberFormat();

function render() {
  const text = textEl.value;
  const a = analyzeText(text, { ignoreStopWords: ignoreEl.checked });
  $('#s-words').textContent = nf.format(a.words);
  $('#s-chars').textContent = nf.format(a.characters);
  $('#s-nospace').textContent = nf.format(a.charactersNoSpaces);
  $('#s-sentences').textContent = nf.format(a.sentences);
  $('#s-paragraphs').textContent = nf.format(a.paragraphs);
  $('#s-reading').textContent = formatDuration(a.readingSeconds, t);
  $('#s-speaking').textContent = formatDuration(a.speakingSeconds, t);
  copyBtn.disabled = downloadBtn.disabled = text.length === 0;

  $$('.meter').forEach((m) => {
    const limit = Number(m.dataset.limit);
    $('[data-role="count"]', m).textContent = `${nf.format(a.characters)} / ${limit}`;
    const fill = $('[data-role="fill"]', m);
    fill.style.width = `${Math.min(100, (a.characters / limit) * 100)}%`;
    m.classList.toggle('is-over', a.characters > limit);
  });

  const host = $('#keywords');
  host.replaceChildren();
  if (!a.keywords.length) {
    host.append(el('p', { class: 'kw-empty' }, a.words ? t('wc.kw.none', 'No repeated words yet.') : t('wc.kw.start', 'Start typing to see your most used words.')));
  } else {
    host.append(
      el('table', { class: 'kw-table' },
        el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, t('wc.kw.word', 'Word')), el('th', { scope: 'col' }, t('wc.kw.count', 'Count')), el('th', { scope: 'col' }, '%'))),
        el('tbody', {}, a.keywords.map((k) => el('tr', {}, el('td', {}, k.word), el('td', {}, nf.format(k.count)), el('td', {}, `${k.percent}%`))))));
  }
}

// Longer texts update a little less often so typing never lags.
const fast = debounce(render, 60);
const slow = debounce(render, 350);
textEl.addEventListener('input', () => (textEl.value.length > 200000 ? slow() : fast()));
ignoreEl.addEventListener('change', render);

$('#btn-clear').addEventListener('click', () => {
  textEl.value = '';
  render();
  textEl.focus();
});

$('#btn-paste').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    textEl.value = text;
    render();
  } catch {
    toast(t('common.pasteBlocked', 'Your browser blocked clipboard access. Press Ctrl+V (or ⌘V) in the box instead.'), 'error');
    textEl.focus();
  }
});

copyBtn.addEventListener('click', async () => {
  const ok = await copyText(textEl.value);
  if (ok) flashButton(copyBtn, t('common.copied', 'Copied!'));
  else toast(t('common.copyFailed', 'Could not copy'), 'error');
});

downloadBtn.addEventListener('click', () => {
  downloadBlob(new Blob([textEl.value], { type: 'text/plain;charset=utf-8' }), 'text.txt');
});

$('#file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const r = await readTextFile(file, { maxBytes: MAX_UPLOAD, extensions: ['.txt', '.md', '.csv'] });
  if (!r.ok) {
    toast(r.code === 'too-large' ? t('wc.upload.large', 'That file is larger than 2 MB.') : t('wc.upload.type', 'Please choose a plain text file (.txt, .md or .csv).'), 'error');
    return;
  }
  textEl.value = r.text;
  render();
});

onLangChange(render);
render();
