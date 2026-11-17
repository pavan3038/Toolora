/*
 * Shared page behaviour: theme, mobile nav, language, instant search, favourites,
 * recently used tools, category filter and the feedback dialog.
 * Loaded on every page as an ES module.
 */
import { $, $$, storage, el, icon, copyText, toast } from './core/util.js';
import { t, initI18n, applyTranslations, onLangChange, getLang } from './core/i18n.js';
import { TOOLS, CATEGORIES } from './core/registry.js';

const toolBySlug = new Map(TOOLS.map((tool) => [tool.slug, tool]));
const catById = new Map(CATEGORIES.map((c) => [c.id, c]));

/* ---------------------------------------------------------------- theme */
function initTheme() {
  const btn = $('#theme-toggle');
  if (!btn) return;
  const sync = () => btn.setAttribute('aria-pressed', String(document.documentElement.dataset.theme === 'dark'));
  sync();
  btn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    storage.set('theme', next);
    sync();
  });
  // Follow the system setting until the person makes their own choice.
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', (e) => {
    if (storage.get('theme') === null) {
      document.documentElement.dataset.theme = e.matches ? 'dark' : 'light';
      sync();
    }
  });
}

/* ------------------------------------------------------------ mobile nav */
function initNav() {
  const header = $('.site-header');
  const toggle = $('#nav-toggle');
  if (!header || !toggle) return;
  const set = (open) => {
    header.classList.toggle('nav-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => set(!header.classList.contains('nav-open')));
  $$('#site-nav a').forEach((a) => a.addEventListener('click', () => set(false)));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && header.classList.contains('nav-open')) {
      set(false);
      toggle.focus();
    }
  });
  window.matchMedia('(min-width: 861px)').addEventListener('change', (e) => e.matches && set(false));
}

/* ----------------------------------------------------- favourites & recents */
const getFavs = () => (storage.get('favs', []) || []).filter((s) => toolBySlug.has(s));
const getRecents = () => (storage.get('recent', []) || []).filter((s) => toolBySlug.has(s));
const toolName = (slug) => t(`tool.${slug}.name`, toolBySlug.get(slug)?.name || slug);

function refreshFavButtons() {
  const favs = new Set(getFavs());
  $$('[data-fav]').forEach((btn) => {
    const slug = btn.dataset.fav;
    const on = favs.has(slug);
    btn.setAttribute('aria-pressed', String(on));
    const name = toolName(slug);
    if (btn.classList.contains('fav-inline')) {
      const label = $('[data-fav-label]', btn);
      if (label) label.textContent = on ? t('fav.saved', 'Saved') : t('fav.save', 'Save to favorites');
    } else {
      btn.setAttribute('aria-label', on ? t('fav.remove', 'Remove {name} from favorites', { name }) : t('fav.add', 'Add {name} to favorites', { name }));
      btn.title = on ? t('fav.removeShort', 'Remove from favorites') : t('fav.addShort', 'Add to favorites');
    }
  });
}

function toggleFav(slug) {
  const favs = getFavs();
  const i = favs.indexOf(slug);
  if (i >= 0) favs.splice(i, 1);
  else favs.unshift(slug);
  storage.set('favs', favs);
  refreshFavButtons();
  renderPersonalSections();
}

function initFavorites() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-fav]');
    if (btn) {
      e.preventDefault();
      toggleFav(btn.dataset.fav);
    }
  });
  refreshFavButtons();
}

function recordVisit() {
  const slug = document.body.dataset.tool;
  if (!slug || !toolBySlug.has(slug)) return;
  const list = getRecents().filter((s) => s !== slug);
  list.unshift(slug);
  storage.set('recent', list.slice(0, 8));
}

/** Home page: show "Your favorites" and "Recently used" by cloning the already-rendered cards. */
function renderPersonalSections() {
  const fill = (sectionId, gridId, slugs) => {
    const section = $(sectionId);
    const grid = $(gridId);
    if (!section || !grid) return;
    grid.replaceChildren();
    const master = new Map($$('#categories [data-card]').map((c) => [c.dataset.card, c]));
    slugs.forEach((slug) => {
      const src = master.get(slug);
      if (src) grid.append(src.cloneNode(true));
    });
    section.hidden = grid.children.length === 0;
    applyTranslations(grid);
  };
  fill('#sec-favs', '#fav-grid', getFavs());
  fill('#sec-recent', '#recent-grid', getRecents().slice(0, 4));
  refreshFavButtons();
}

function initPersonalSections() {
  if (!$('#sec-favs')) return;
  renderPersonalSections();
  $('#clear-recent')?.addEventListener('click', () => {
    storage.remove('recent');
    renderPersonalSections();
  });
}

/* ---------------------------------------------------------- category filter */
function initCategoryFilter() {
  const chips = $$('[data-filter]');
  if (!chips.length) return;
  chips.forEach((chip) =>
    chip.addEventListener('click', () => {
      const f = chip.dataset.filter;
      chips.forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
      $$('.cat-group').forEach((g) => (g.hidden = f !== 'all' && g.dataset.cat !== f));
    })
  );
}

/* ------------------------------------------------------------------ search */
function scoreTool(tool, tokens) {
  const name = `${toolName(tool.slug)} ${tool.name}`.toLowerCase();
  const catName = `${t(`cat.${tool.cat}.name`, catById.get(tool.cat)?.name || '')} ${catById.get(tool.cat)?.name || ''}`.toLowerCase();
  const keywords = tool.keywords.join(' ').toLowerCase();
  const desc = `${t(`tool.${tool.slug}.desc`, tool.desc)} ${tool.desc}`.toLowerCase();
  let total = 0;
  for (const tok of tokens) {
    let s = 0;
    if (name.startsWith(tok)) s += 8;
    else if (name.split(/\s+/).some((w) => w.startsWith(tok))) s += 6;
    else if (name.includes(tok)) s += 4;
    if (tool.keywords.some((k) => k.toLowerCase() === tok)) s += 4;
    else if (keywords.includes(tok)) s += 2;
    if (catName.includes(tok)) s += 1;
    if (desc.includes(tok)) s += 1;
    if (s === 0) return 0; // every word typed must match something
    total += s;
  }
  return total;
}

export function searchTools(query) {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  return TOOLS.map((tool) => ({ tool, score: scoreTool(tool, tokens) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || (a.tool.popular || 99) - (b.tool.popular || 99))
    .map((r) => r.tool);
}

function initSearch(input) {
  const list = input.closest('.search')?.querySelector('.search-results');
  if (!list) return;
  let items = [];
  let active = -1;
  const idBase = list.id || 'sr';

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };

  const setActive = (i) => {
    $$('a', list).forEach((a, idx) => a.setAttribute('aria-selected', String(idx === i)));
    active = i;
    const a = $$('a', list)[i];
    if (a) {
      input.setAttribute('aria-activedescendant', a.id);
      a.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  };

  const render = () => {
    const q = input.value.trim();
    list.replaceChildren();
    if (q) items = searchTools(q);
    else items = TOOLS.slice().sort((a, b) => (a.popular || 99) - (b.popular || 99)).slice(0, 5);
    if (!q) list.append(el('li', { class: 'sr-label', role: 'presentation' }, t('search.popular', 'Popular tools')));
    if (!items.length) {
      list.append(el('li', { class: 'sr-empty', role: 'presentation' }, t('search.none', 'No tools match “{q}”. Try “image”, “json” or “percentage”.', { q })));
    }
    items.forEach((tool, i) => {
      const cat = catById.get(tool.cat);
      list.append(
        el('li', { role: 'presentation' },
          el('a', { href: tool.url, role: 'option', id: `${idBase}-${i}`, 'aria-selected': 'false' },
            el('span', { class: `card-icon cat-${tool.cat}`, style: undefined }, icon(tool.icon)),
            el('span', {}, el('span', { class: 'sr-name' }, toolName(tool.slug)), el('span', { class: 'sr-cat' }, t(`cat.${tool.cat}.name`, cat?.name || ''))))));
    });
    // Shrink the gradient icon inside results (CSS handles size via .search-results .card-icon)
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    active = -1;
  };

  input.addEventListener('input', render);
  input.addEventListener('focus', render);
  input.addEventListener('keydown', (e) => {
    const links = $$('a', list);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (list.hidden) render();
      setActive(Math.min(links.length - 1, active + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(0, active - 1));
    } else if (e.key === 'Enter') {
      const target = links[active] || links[0];
      if (target) {
        e.preventDefault();
        location.href = target.href;
      }
    } else if (e.key === 'Escape') {
      close();
      input.blur();
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search')) close();
  });
  list.hidden = true;
}

function initSearchShortcut() {
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) return;
    const input = $$('.search-input').find((i) => i.offsetParent !== null);
    if (input) {
      e.preventDefault();
      input.focus();
    }
  });
}

/* ---------------------------------------------------------------- feedback */
function initFeedback() {
  const dialog = $('#feedback-dialog');
  if (!dialog || typeof dialog.showModal !== 'function') {
    // Very old browser: fall back to a plain mailto link.
    $$('[data-open-feedback]').forEach((b) => b.addEventListener('click', () => (location.href = `mailto:${b.dataset.email || ''}`)));
    return;
  }
  const form = $('form', dialog);
  const message = $('#fb-message');
  const type = $('#fb-type');
  const email = form.dataset.email;
  const fallback = $('#fb-fallback');

  const compose = () => {
    const subject = `[Toolora] ${type.options[type.selectedIndex].textContent}`;
    const body = `${message.value.trim()}\n\n—\nPage: ${location.pathname}`;
    return { subject, body };
  };

  $$('[data-open-feedback]').forEach((btn) =>
    btn.addEventListener('click', () => {
      fallback.hidden = true;
      dialog.showModal();
      message.focus();
    })
  );
  $('#fb-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!message.value.trim()) {
      message.focus();
      return;
    }
    const { subject, body } = compose();
    fallback.hidden = false;
    location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.slice(0, 1800))}`;
  });
  $('#fb-copy').addEventListener('click', async () => {
    const { subject, body } = compose();
    const ok = await copyText(`To: ${email}\nSubject: ${subject}\n\n${body}`);
    toast(ok ? t('common.copied', 'Copied!') : t('common.copyFailed', 'Could not copy'), ok ? 'info' : 'error');
  });
}

/* -------------------------------------------------------------------- init */
async function init() {
  initTheme();
  initNav();
  await initI18n();
  initFavorites();
  initPersonalSections();
  initCategoryFilter();
  $$('.search-input').forEach(initSearch);
  initSearchShortcut();
  initFeedback();
  recordVisit();
  onLangChange(() => refreshFavButtons());
  document.documentElement.classList.add('js-ready');
}

init();
