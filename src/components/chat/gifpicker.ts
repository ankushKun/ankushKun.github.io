// The GIF sheet over the composer: trending GIFs at first, a search as you type, more as you
// scroll, and a tap posts one. Its markup is in Chat.astro (data-gifs).
import { findGifs, type Gif } from './gifs';
import { placeAbove } from './sheets';

export function mountGifPicker(sheet: HTMLElement, anchor: HTMLElement, onPick: (gif: Gif) => void): () => void {
  const q = sheet.querySelector<HTMLInputElement>('[data-gif-q]')!;
  const scroll = sheet.querySelector<HTMLElement>('[data-gif-scroll]')!;
  const grid = sheet.querySelector<HTMLElement>('[data-gif-results]')!;
  const end = sheet.querySelector<HTMLElement>('[data-gif-end]')!;
  const state = sheet.querySelector<HTMLElement>('[data-gif-state]')!;
  let query = '';
  let next: string | undefined;
  let loading: AbortController | null = null;
  let typing = 0;

  const say = (text: string) => {
    state.textContent = text;
    state.hidden = !text;
  };

  function tile(gif: Gif) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gif-tile';
    b.title = gif.title;
    b.style.aspectRatio = `${gif.w} / ${gif.h}`;
    const img = b.appendChild(document.createElement('img'));
    img.src = gif.preview;
    img.alt = gif.title;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('load', () => img.classList.add('is-in'), { once: true });
    b.addEventListener('click', () => {
      onPick(gif);
      sheet.hidePopover();
    });
    return b;
  }

  async function load(fresh: boolean) {
    if (!fresh && (!next || loading)) return;
    loading?.abort();
    const ctrl = (loading = new AbortController());
    if (fresh) {
      next = undefined;
      grid.replaceChildren();
      scroll.scrollTop = 0;
    }
    sheet.toggleAttribute('data-busy', true);
    say('');
    try {
      const page = await findGifs(query, fresh ? undefined : next, ctrl.signal);
      if (ctrl.signal.aborted) return;
      next = page.next;
      grid.append(...page.gifs.map(tile));
      if (!grid.children.length) say(query ? `No GIFs for “${query}”.` : 'No GIFs right now.');
    } catch (err) {
      if (!ctrl.signal.aborted) {
        console.warn(err);
        say("GIFs aren't loading right now.");
      }
    } finally {
      if (loading === ctrl) {
        loading = null;
        sheet.toggleAttribute('data-busy', false);
      }
    }
  }

  // More as you near the end of the results.
  const more = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) void load(false);
  }, { root: scroll, rootMargin: '300px' });
  more.observe(end);

  const search = () => {
    clearTimeout(typing);
    const value = q.value.trim();
    if (value === query) return;
    query = value;
    void load(true);
  };
  q.addEventListener('input', () => {
    clearTimeout(typing);
    typing = window.setTimeout(search, 350);
  });
  q.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    search();
  });

  const onToggle = (e: Event) => {
    if ((e as ToggleEvent).newState !== 'open') return;
    placeAbove(sheet, anchor, 640, anchor.querySelector('.composer-gif') ?? anchor);
    if (!grid.children.length && !loading) void load(true);
    requestAnimationFrame(() => q.focus());
  };
  sheet.addEventListener('beforetoggle', onToggle);

  return () => {
    clearTimeout(typing);
    loading?.abort();
    more.disconnect();
    sheet.removeEventListener('beforetoggle', onToggle);
  };
}
