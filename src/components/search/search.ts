// The quick search (Search.astro): Ctrl or Cmd K on any page, and F as well on the plaza, opens it;
// typing narrows /search.json to what matches, best first; arrows move, Enter or a press goes there
// through the router, so the music plays on. Escape, a press outside it or the keys again close it.
import { navigate } from 'astro:transitions/client';
import { track } from '../../scripts/analytics';
import { play } from '../../scripts/sfx';
import type { SearchItem, SearchKind } from '../../lib/search';

interface Item extends SearchItem {
  /** Title and words, lowercased without accents, to match against. */
  t: string;
  w: string;
}

/** Among equally good matches, what people most likely came for goes first. */
const KIND_ORDER: Record<SearchKind, number> = { App: 6, Game: 5, Page: 4, Project: 3, Blog: 2, Timeline: 1 };
const LIMIT = 40;

const plain = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

let items: Item[] | null = null;
let failed = false;
let loading: Promise<void> | null = null;
let shown: Item[] = [];
let active = 0;

function load() {
  loading ??= fetch('/search.json')
    .then((r) => (r.ok ? (r.json() as Promise<SearchItem[]>) : Promise.reject(new Error(String(r.status)))))
    .then((list) => {
      items = list.map((i) => ({ ...i, t: plain(i.title), w: plain(`${i.words} ${i.kind}`) }));
      failed = false;
    })
    .catch(() => {
      failed = true;
      loading = null;
    })
    .finally(() => {
      if (dialog()?.open) render();
    });
  return loading;
}

const dialog = () => document.querySelector<HTMLDialogElement>('[data-search]');
const input = () => dialog()!.querySelector<HTMLInputElement>('[data-search-input]')!;
const list = () => dialog()!.querySelector<HTMLUListElement>('[data-search-list]')!;

/** How well one word of the query fits an item, or 0 if it doesn't. */
function fit(item: Item, word: string) {
  const { t } = item;
  if (t === word) return 120;
  if (t.startsWith(word)) return 100;
  const at = t.indexOf(word);
  if (at > 0 && !/[a-z0-9]/.test(t[at - 1])) return 80;
  if (at > 0) return 55;
  if (item.w.includes(word)) return 25;
  // Letters in order inside one word, for a slip or a shorthand ("pant" for Paint, "gstbk").
  if (word.length >= 3)
    for (const part of t.split(/[^a-z0-9]+/)) {
      if (part[0] !== word[0] || part.length > word.length * 2) continue;
      let i = 0;
      for (const c of part) if (c === word[i]) i++;
      if (i === word.length) return 10;
    }
  return 0;
}

function match(query: string): Item[] {
  if (!items) return [];
  const words = plain(query).split(/\s+/).filter(Boolean);
  if (!words.length) return items.filter((i) => i.kind === 'App' || i.kind === 'Page');
  const scored: [Item, number][] = [];
  for (const item of items) {
    let score = 0;
    for (const w of words) {
      const f = fit(item, w);
      if (!f) {
        score = 0;
        break;
      }
      score += f;
    }
    if (score) scored.push([item, score + KIND_ORDER[item.kind]]);
  }
  return scored
    .sort((a, b) => b[1] - a[1] || (b[0].date ?? 0) - (a[0].date ?? 0))
    .slice(0, LIMIT)
    .map(([i]) => i);
}

function render() {
  const query = input().value;
  shown = match(query);
  active = Math.min(active, Math.max(0, shown.length - 1));
  const ul = list();
  if (!items) {
    ul.replaceChildren(...(failed ? [note("Search didn't load. Try again in a moment.")] : []));
    return;
  }
  if (!shown.length) {
    ul.replaceChildren(note(`Nothing matches "${query.trim()}".`));
    return;
  }
  ul.replaceChildren(
    ...shown.map((item, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'presentation');
      const a = document.createElement('a');
      a.className = 'search-item';
      a.href = item.href;
      a.id = `search-opt-${i}`;
      a.tabIndex = -1;
      a.dataset.sfx = '';
      a.dataset.index = String(i);
      a.setAttribute('role', 'option');
      const tile = document.createElement('span');
      tile.className = 'tile';
      tile.append(Object.assign(new Image(80, 80), { src: item.icon, alt: '', decoding: 'async', loading: 'lazy' }));
      const name = Object.assign(document.createElement('span'), { className: 'search-name', textContent: item.title });
      const kind = Object.assign(document.createElement('span'), { className: 'search-kind', textContent: item.kind });
      a.append(tile, name, kind);
      li.append(a);
      return li;
    }),
  );
  select(active, false);
}

function note(text: string) {
  return Object.assign(document.createElement('li'), { className: 'search-none', textContent: text });
}

function select(i: number, scroll = true) {
  if (!shown.length) return;
  active = (i + shown.length) % shown.length;
  const ul = list();
  for (const a of ul.querySelectorAll('[aria-selected]')) a.removeAttribute('aria-selected');
  const a = ul.querySelector<HTMLElement>(`#search-opt-${active}`);
  if (!a) return;
  a.setAttribute('aria-selected', 'true');
  input().setAttribute('aria-activedescendant', a.id);
  if (scroll) a.scrollIntoView({ block: 'nearest' });
}

function open(key: 'k' | 'f') {
  const d = dialog();
  if (!d) return;
  if (d.open && !d.hasAttribute('data-closing')) {
    input().select();
    return;
  }
  d.removeAttribute('data-closing');
  clearTimeout(closing);
  if (!d.open) d.showModal();
  play('flip');
  track('search_opened', { key });
  input().value = '';
  active = 0;
  render();
  input().focus();
  void load();
}

let closing = 0;
function close(sound = true) {
  const d = dialog();
  if (!d?.open || d.hasAttribute('data-closing')) return;
  if (sound) play('back');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return d.close();
  d.setAttribute('data-closing', '');
  closing = window.setTimeout(() => {
    d.close();
    d.removeAttribute('data-closing');
  }, 200);
}

function go(i: number) {
  const item = shown[i];
  if (!item) return;
  track('search_picked', { href: item.href, kind: item.kind, query: input().value.trim().slice(0, 60) });
  dialog()?.close();
  const to = new URL(item.href, location.href);
  if (to.pathname === location.pathname && to.hash === location.hash) return;
  void navigate(to.pathname + to.search + to.hash);
}

// Ctrl or Cmd K anywhere; F as well on the plaza, where there is no page text for the browser to
// find. In the Terminal a bare Ctrl K is the shell's (cut to the end of the line), so only Cmd K
// opens it there.
addEventListener(
  'keydown',
  (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.repeat) return;
    const k = e.key.toLowerCase();
    const html = document.documentElement;
    if (html.hasAttribute('data-embed')) return;
    if (k !== 'k' && !(k === 'f' && html.hasAttribute('data-home'))) return;
    if (e.ctrlKey && !e.metaKey && location.pathname.startsWith('/apps/terminal')) return;
    if (!dialog()) return;
    e.preventDefault();
    e.stopPropagation();
    if (dialog()!.open && input() !== document.activeElement) input().focus();
    open(k as 'k' | 'f');
  },
  true,
);

document.addEventListener('input', (e) => {
  if (!(e.target instanceof HTMLElement) || !e.target.matches('[data-search-input]')) return;
  active = 0;
  render();
});

document.addEventListener('keydown', (e) => {
  const d = dialog();
  if (!d?.open || !(e.target instanceof Node) || !d.contains(e.target)) return;
  // Keys typed here are the search's alone: not the plaza's, the app's, M to mute or B to go back.
  e.stopPropagation();
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (shown.length > 1) play('tick');
    select(active + (e.key === 'ArrowDown' ? 1 : -1));
  } else if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    if (!shown.length) return play('nope');
    play('select');
    go(active);
  }
});

document.addEventListener(
  'cancel',
  (e) => {
    if (e.target !== dialog()) return;
    e.preventDefault();
    close();
  },
  true,
);

document.addEventListener('click', (e) => {
  const d = dialog();
  if (!d?.open || !(e.target instanceof Element)) return;
  // A press on the dim around the sheet lands on the dialog itself, outside its box.
  if (e.target === d) {
    const r = d.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
    return;
  }
  const a = e.target.closest<HTMLElement>('.search-item');
  if (!a || !d.contains(a) || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  go(Number(a.dataset.index));
});

document.addEventListener(
  'pointermove',
  (e) => {
    if (e.pointerType !== 'mouse' || !dialog()?.open || !(e.target instanceof Element)) return;
    const a = e.target.closest<HTMLElement>('.search-item');
    if (a && Number(a.dataset.index) !== active) select(Number(a.dataset.index), false);
  },
  { passive: true },
);

// Going elsewhere by any other way puts it away.
document.addEventListener('astro:before-preparation', () => {
  if (dialog()?.open) dialog()!.close();
});
