// @mentions in the composer. A textarea can't colour part of its text, so a mirror sits behind it:
// the same text, wrapped the same way, with each @name that belongs to someone in their colour. The
// textarea's own text is transparent over it, keeping its caret, selection, spellcheck, undo, paste
// and IME. The mirror also says where the caret is, which is where the @ list opens: typing @ (at
// the start or after a space) lists people, those here first, filtered as you type; ↑ ↓ move, Enter
// or Tab picks, Escape closes, and a click picks without leaving the box.

export interface Person {
  uuid: string;
  nick: string;
  /** In the room now. */
  here: boolean;
}

interface Options {
  input: HTMLTextAreaElement;
  mirror: HTMLElement;
  list: HTMLElement;
  /** Everyone who could be meant, you aside. */
  people: () => Person[];
  /** Whose an @name is, from its lowercase name, if anyone's. */
  whose: (lower: string) => string | null;
  /** Colours an element as the person with this id. */
  paint: (el: HTMLElement, id: string) => void;
  /** A small Mii face for this person. */
  face: (uuid: string) => HTMLElement;
  /** After a pick changes the text. */
  changed: () => void;
}

const MENTION = /(?<![\w@])@([\w.-]{1,16})/g;
/** An @ being typed right before the caret, and what has been typed after it. */
const TYPING = /(?:^|\s)@([\w.-]{0,16})$/;
const MAX = 6;

export function mountMentions(o: Options) {
  const { input, mirror, list } = o;
  let shown: Person[] = [];
  let active = 0;
  let start = -1;

  /** Draws the mirror: the text, with known @names in their owner's colour. */
  function render() {
    const text = input.value;
    const out: Node[] = [];
    let at = 0;
    for (const m of text.matchAll(MENTION)) {
      const uuid = o.whose(m[1].toLowerCase());
      if (!uuid) continue;
      if (m.index > at) out.push(document.createTextNode(text.slice(at, m.index)));
      const span = document.createElement('span');
      span.textContent = m[0];
      o.paint(span, uuid);
      out.push(span);
      at = m.index + m[0].length;
    }
    // A trailing newline needs something after it, or the mirror ends a line short.
    out.push(document.createTextNode(text.slice(at) + (text.endsWith('\n') ? ' ' : '')));
    mirror.replaceChildren(...out);
    mirror.scrollTop = input.scrollTop;
  }

  /** Where in the window a character offset of the text is drawn, from the mirror. */
  function caretAt(offset: number) {
    const walker = document.createTreeWalker(mirror, NodeFilter.SHOW_TEXT);
    let left = offset;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const len = node.textContent?.length ?? 0;
      if (left <= len) {
        const range = document.createRange();
        range.setStart(node, left);
        range.collapse(true);
        const r = range.getClientRects()[0] ?? range.getBoundingClientRect();
        if (r && (r.x || r.y)) return r;
        break;
      }
      left -= len;
    }
    return input.getBoundingClientRect();
  }

  function close() {
    if (!list.matches(':popover-open')) return;
    list.hidePopover();
    shown = [];
    input.removeAttribute('aria-activedescendant');
  }

  function mark() {
    list.querySelectorAll('[role="option"]').forEach((el, i) => el.setAttribute('aria-selected', String(i === active)));
    input.setAttribute('aria-activedescendant', `chat-mention-${active}`);
  }

  /** Opens, filters or closes the list for what is typed before the caret. */
  function update() {
    render();
    const caret = input.selectionStart ?? 0;
    const m = input.selectionEnd === caret ? TYPING.exec(input.value.slice(0, caret)) : null;
    if (!m) return close();
    const q = m[1].toLowerCase();
    start = caret - m[1].length - 1;
    const all = o.people();
    const rank = (p: Person) => (p.nick.toLowerCase().startsWith(q) ? 0 : 1);
    shown = all
      .filter((p) => p.nick.toLowerCase().includes(q))
      .sort((a, b) => rank(a) - rank(b) || Number(b.here) - Number(a.here) || a.nick.localeCompare(b.nick))
      .slice(0, MAX);
    if (!shown.length) return close();
    active = Math.min(active, shown.length - 1);
    list.replaceChildren(
      ...shown.map((p, i) => {
        const row = document.createElement('div');
        row.id = `chat-mention-${i}`;
        row.setAttribute('role', 'option');
        row.className = 'mention-option';
        // A press picks without taking focus out of the box.
        row.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          pick(i);
        });
        const name = document.createElement('span');
        name.className = 'mention-name';
        name.textContent = p.nick;
        o.paint(name, p.uuid);
        row.append(o.face(p.uuid), name);
        if (p.here) row.append(Object.assign(document.createElement('span'), { className: 'mention-here' }));
        return row;
      }),
    );
    mark();
    // Just above the @ being typed, growing out of it.
    const at = caretAt(start);
    const box = input.getBoundingClientRect();
    const width = 260;
    const left = Math.max(8, Math.min(at.left - 14, innerWidth - width - 8));
    Object.assign(list.style, {
      left: `${left}px`,
      bottom: `${innerHeight - Math.min(at.top, box.top) + 10}px`,
      transformOrigin: `${at.left - left}px calc(100% + 10px)`,
    });
    if (!list.matches(':popover-open')) {
      active = 0;
      mark();
      list.showPopover();
    }
  }

  function pick(i: number) {
    const p = shown[i];
    if (!p) return;
    const caret = input.selectionStart ?? 0;
    const before = input.value.slice(0, start);
    const after = input.value.slice(caret).replace(/^[\w.-]*/, '');
    const insert = `@${p.nick} `;
    input.value = before + insert + after.replace(/^ /, '');
    const at = before.length + insert.length;
    input.setSelectionRange(at, at);
    close();
    render();
    o.changed();
  }

  /** Handles a key while the list is open. True when it was the list's. */
  function key(e: KeyboardEvent) {
    if (!list.matches(':popover-open') || e.isComposing) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
      mark();
    } else if (e.key === 'Enter' || e.key === 'Tab') pick(active);
    else if (e.key === 'Escape') close();
    else return false;
    e.preventDefault();
    e.stopPropagation();
    return true;
  }

  const onScroll = () => {
    mirror.scrollTop = input.scrollTop;
  };
  const onCaret = () => update();
  const onBlur = () => close();
  input.addEventListener('scroll', onScroll);
  input.addEventListener('click', onCaret);
  input.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') onCaret();
  });
  input.addEventListener('blur', onBlur);
  render();

  return {
    update,
    render,
    key,
    close,
    destroy() {
      close();
      input.removeEventListener('scroll', onScroll);
      input.removeEventListener('click', onCaret);
      input.removeEventListener('blur', onBlur);
    },
  };
}
