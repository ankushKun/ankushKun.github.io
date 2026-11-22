// The menu of sections (Frame.astro): its tiles drop out of the menu button one under another and
// fold back up into it, the last first, as the opening played backwards. Driven here with the Web
// Animations API rather than CSS transitions on the popover, so the fold plays out in full in
// every browser before the popover hides. Pressing the button mid-way turns the move around from
// wherever it has got to.

type State = 'closed' | 'opening' | 'open' | 'closing';

const SPRING = 'cubic-bezier(0.3, 1.45, 0.5, 1)';
/** The spring, reversed: a small lift, then pulled up into the button. */
const SPRING_BACK = 'cubic-bezier(0.6, -0.28, 0.735, 0.045)';
const STAGGER = 32;

const menu = () => document.getElementById('tv-menu');
const button = () => document.querySelector<HTMLElement>('.tv-open');
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let state: State = 'closed';
let moves: Animation[] = [];
let done: Promise<void> = Promise.resolve();

/** Where an item sits folded: inside the button, relative to where it stands open. */
function home(item: HTMLElement, from: HTMLElement) {
  const tile = (item.querySelector('.tv-tile') ?? item).getBoundingClientRect();
  const b = from.getBoundingClientRect();
  return `${b.left + b.width / 2 - (tile.left + tile.width / 2)}px ${b.top + b.height / 2 - (tile.top + tile.height / 2)}px`;
}

function play(out: boolean) {
  const m = menu();
  const b = button();
  if (!m || !b) return [];
  const still = calm();
  const items = [...m.querySelectorAll<HTMLElement>('.tv-item')];
  const n = items.length;
  return items.map((item, i) => {
    const folded: Keyframe = still ? { opacity: 0 } : { opacity: 0, translate: home(item, b), scale: 0.4 };
    const shown: Keyframe = still ? { opacity: 1 } : { opacity: 1, translate: '0px 0px', scale: 1 };
    // Opening, an item is fully there a third of the way in; closing, it stays until half way.
    const frames = out ? [shown, { opacity: 1, offset: 0.55 }, folded] : [folded, { opacity: 1, offset: 0.35 }, shown];
    return item.animate(frames, {
      duration: still ? 150 : out ? 340 : 440,
      delay: still ? 0 : (out ? n - 1 - i : i) * STAGGER,
      easing: still ? 'ease' : out ? SPRING_BACK : SPRING,
      fill: 'both',
    });
  });
}

const settle = (all: Animation[]) => Promise.all(all.map((a) => a.finished)).then(() => undefined);

export function isMenuOpen() {
  return state === 'open' || state === 'opening';
}

export function openMenu() {
  const m = menu();
  if (!m || state === 'open' || state === 'opening') return;
  if (state === 'closing') {
    // Turned around on the way in: the fold plays back out from where it is.
    state = 'opening';
    delete m.dataset.closing;
    for (const a of moves) a.reverse();
    done = settle(moves).then(() => {
      if (state === 'opening') state = 'open';
    });
    return;
  }
  m.showPopover();
  state = 'opening';
  moves = play(false);
  done = settle(moves).then(() => {
    if (state !== 'opening') return;
    state = 'open';
    for (const a of moves) a.cancel();
    moves = [];
  });
}

/** Folds the menu away; resolves once it has gone. */
export function closeMenu(): Promise<void> {
  const m = menu();
  if (!m || state === 'closed') return Promise.resolve();
  if (state === 'closing') return done;
  m.dataset.closing = '';
  if (state === 'opening') {
    // Turned around on the way out: the drop plays back in from where it is.
    for (const a of moves) a.reverse();
  } else {
    for (const a of moves) a.cancel();
    moves = play(true);
  }
  state = 'closing';
  done = settle(moves)
    .then(() => {
      if (state !== 'closing') return;
      state = 'closed';
      delete m.dataset.closing;
      m.hidePopover();
      for (const a of moves) a.cancel();
      moves = [];
    })
    .catch(() => undefined);
  return done;
}

/** Shows the menu at once, as it was, after a page change. */
export function showMenuStill() {
  const m = menu();
  if (!m) return;
  for (const a of moves) a.cancel();
  moves = [];
  delete m.dataset.closing;
  if (!m.matches(':popover-open')) m.showPopover();
  state = 'open';
}

/** Forgets the menu's state when it has been taken away with the page (a phone, or the plaza). */
export function resetMenu() {
  for (const a of moves) a.cancel();
  moves = [];
  state = menu()?.matches(':popover-open') ? 'open' : 'closed';
}

// The button: its own popover toggling is replaced by the animated one.
document.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('.tv-open') : null;
  if (!b) return;
  e.preventDefault();
  if (isMenuOpen()) void closeMenu();
  else openMenu();
});
