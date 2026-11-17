import { $, $$, copyText, flashButton, toast } from '../core/util.js';
import { t, onLangChange } from '../core/i18n.js';
import { parseNumber, percentOf, whatPercent, percentChange, increaseBy, decreaseBy, findWhole } from '../core/logic.js';

const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 8 });
const fmt = (n) => nf.format(n);

/**
 * Each calculator: compute(a, b) → result | error, plus how to display it.
 *  big()      the headline answer
 *  working()  the formula with the person's numbers substituted
 */
const CALCS = {
  'percent-of': {
    compute: (a, b) => percentOf(a, b),
    big: (r) => fmt(r.value),
    working: (a, b, r) => `${fmt(b)} × ${fmt(a)} ÷ 100 = ${fmt(r.value)}`,
    example: ['50', '200'],
  },
  'what-percent': {
    compute: (a, b) => whatPercent(a, b),
    big: (r) => `${fmt(r.value)}%`,
    working: (a, b, r) => `${fmt(a)} ÷ ${fmt(b)} × 100 = ${fmt(r.value)}%`,
    example: ['30', '150'],
  },
  change: {
    compute: (a, b) => percentChange(a, b),
    big: (r) => `${r.value > 0 ? '+' : ''}${fmt(r.value)}%`,
    note: (r) => (r.direction === 'increase' ? t('pc.increase', 'Increase') : r.direction === 'decrease' ? t('pc.decrease', 'Decrease') : t('pc.nochange', 'No change')),
    working: (a, b, r) => `(${fmt(b)} − ${fmt(a)}) ÷ |${fmt(a)}| × 100 = ${fmt(r.value)}%`,
    example: ['80', '100'],
  },
  increase: {
    compute: (a, b) => increaseBy(a, b),
    big: (r) => fmt(r.value),
    working: (a, b, r) => `${fmt(a)} + (${fmt(a)} × ${fmt(b)} ÷ 100) = ${fmt(r.value)}`,
    example: ['200', '15'],
  },
  decrease: {
    compute: (a, b) => decreaseBy(a, b),
    big: (r) => fmt(r.value),
    working: (a, b, r) => `${fmt(a)} − (${fmt(a)} × ${fmt(b)} ÷ 100) = ${fmt(r.value)}`,
    example: ['1500', '20'],
  },
  whole: {
    compute: (a, b) => findWhole(a, b),
    big: (r) => fmt(r.value),
    working: (a, b, r) => `${fmt(b)} ÷ (${fmt(a)} ÷ 100) = ${fmt(r.value)}`,
    example: ['20', '30'],
  },
};

const ERRORS = {
  'total-zero': ['pc.err.total0', 'The total (Y) cannot be zero.'],
  'from-zero': ['pc.err.from0', 'A change from zero cannot be shown as a percentage.'],
  'percent-zero': ['pc.err.percent0', 'The percentage (X) cannot be zero.'],
};

const raw = {}; // last plain-number result per calculator, used by Copy

function update(id) {
  const card = $(`[data-calc-card="${id}"]`);
  const aEl = $(`#${id}-a`);
  const bEl = $(`#${id}-b`);
  const big = $('[data-role="big"]', card);
  const working = $('[data-role="working"]', card);
  const copyBtn = $(`[data-copy="${id}"]`);
  const setState = (cls, key, fallback) => {
    big.className = `big ${cls}`;
    big.textContent = t(key, fallback);
    big.removeAttribute('data-i18n');
    working.textContent = '';
    copyBtn.disabled = true;
    raw[id] = null;
  };

  const sa = aEl.value.trim();
  const sb = bEl.value.trim();
  const a = parseNumber(sa);
  const b = parseNumber(sb);
  const aBad = sa !== '' && Number.isNaN(a);
  const bBad = sb !== '' && Number.isNaN(b);
  aEl.setAttribute('aria-invalid', String(aBad));
  bEl.setAttribute('aria-invalid', String(bBad));

  if (aBad || bBad) return setState('is-error', 'pc.err.invalid', 'Enter a valid number (use a dot for decimals).');
  if (sa === '' || sb === '') return setState('is-empty', 'pc.empty', 'Enter two numbers to see the result.');

  const r = CALCS[id].compute(a, b);
  if (!r.ok) return setState('is-error', ...ERRORS[r.error]);

  big.className = 'big';
  const note = CALCS[id].note?.(r);
  big.textContent = CALCS[id].big(r) + (note ? ` · ${note}` : '');
  working.textContent = CALCS[id].working(a, b, r);
  copyBtn.disabled = false;
  raw[id] = String(r.value);
}

$$('[data-calc]').forEach((input) => input.addEventListener('input', () => update(input.dataset.calc)));

$$('[data-copy]').forEach((btn) =>
  btn.addEventListener('click', async () => {
    const value = raw[btn.dataset.copy];
    if (value == null) return;
    const ok = await copyText(value);
    if (ok) flashButton(btn, t('common.copied', 'Copied!'));
    else toast(t('common.copyFailed', 'Could not copy'), 'error');
  })
);

$$('[data-example]').forEach((btn) =>
  btn.addEventListener('click', () => {
    const id = btn.dataset.example;
    const [a, b] = CALCS[id].example;
    $(`#${id}-a`).value = a;
    $(`#${id}-b`).value = b;
    update(id);
  })
);

$('#btn-reset').addEventListener('click', () => {
  $$('[data-calc]').forEach((i) => (i.value = ''));
  Object.keys(CALCS).forEach(update);
  $('#percent-of-a').focus();
});

// Re-render messages (they are built from translated strings) when the language changes.
onLangChange(() => Object.keys(CALCS).forEach(update));
