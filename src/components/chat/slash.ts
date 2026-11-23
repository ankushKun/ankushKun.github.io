// The / list in the composer: typing a / at the start of the box lists every command, filtered as
// you type its name, with what it posts beside it. ↑ ↓ move, Tab or Enter fills it in, Enter on a
// name already typed in full sends it, Escape closes, and a click fills it in without leaving the box.

import { COMMANDS, type Group, type Spec } from './commands';

interface Options {
  input: HTMLTextAreaElement;
  list: HTMLElement;
  /** After a pick changes the text. */
  changed: () => void;
}

/** A command name being typed, alone in the box. */
const TYPING = /^\/([a-z0-9]*)$/i;
const ORDER: Group[] = ['chat', 'face', 'art', 'text', 'chance', 'act'];
const SORTED = [...COMMANDS].sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group));

export function mountSlash(o: Options) {
  const { input, list } = o;
  let shown: Spec[] = [];
  let active = 0;
  let typed = '';

  function close() {
    if (!list.matches(':popover-open')) return;
    list.hidePopover();
    shown = [];
    input.removeAttribute('aria-activedescendant');
  }

  function mark() {
    list.querySelectorAll('[role="option"]').forEach((el, i) => {
      el.setAttribute('aria-selected', String(i === active));
      if (i === active) el.scrollIntoView({ block: 'nearest' });
    });
    input.setAttribute('aria-activedescendant', `chat-command-${active}`);
  }

  function row(c: Spec, i: number) {
    const el = document.createElement('div');
    el.id = `chat-command-${i}`;
    el.setAttribute('role', 'option');
    el.className = 'command-option';
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pick(i);
    });
    const name = document.createElement('span');
    name.className = 'command-name';
    name.textContent = `/${c.name}`;
    el.append(name);
    if (c.arg) el.append(Object.assign(document.createElement('span'), { className: 'command-arg', textContent: c.arg }));
    if (c.peek) el.append(Object.assign(document.createElement('span'), { className: 'command-peek', textContent: c.peek }));
    return el;
  }

  /** Opens, filters or closes the list for what is in the box. */
  function update() {
    const caret = input.selectionStart ?? 0;
    const m = input.selectionEnd === caret && caret === input.value.length ? TYPING.exec(input.value) : null;
    if (!m) return close();
    const q = m[1].toLowerCase();
    const before = shown.map((c) => c.name).join();
    shown = [...SORTED.filter((c) => c.name.startsWith(q)), ...SORTED.filter((c) => !c.name.startsWith(q) && c.name.includes(q))];
    if (!shown.length) return close();
    if (q !== typed || shown.map((c) => c.name).join() !== before) active = 0;
    typed = q;
    list.replaceChildren(...shown.map(row));
    // Over the box, from its left edge.
    const box = input.getBoundingClientRect();
    const width = Math.min(340, innerWidth - 16);
    const left = Math.max(8, Math.min(box.left - 6, innerWidth - width - 8));
    Object.assign(list.style, {
      left: `${left}px`,
      width: `${width}px`,
      bottom: `${innerHeight - box.top + 10}px`,
      transformOrigin: `${box.left - left + 8}px calc(100% + 10px)`,
    });
    if (!list.matches(':popover-open')) list.showPopover();
    mark();
  }

  function pick(i: number) {
    const c = shown[i];
    if (!c) return;
    input.value = `/${c.name} `;
    input.setSelectionRange(input.value.length, input.value.length);
    close();
    o.changed();
  }

  /** Handles a key while the list is open. True when it was the list's. */
  function key(e: KeyboardEvent) {
    if (!list.matches(':popover-open') || e.isComposing) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
      mark();
    } else if (e.key === 'Tab') pick(active);
    else if (e.key === 'Enter' && !e.shiftKey) {
      // A name typed in full goes as it is, so /shrug Enter sends.
      if (shown[active]?.name === typed) {
        close();
        return false;
      }
      pick(active);
    } else if (e.key === 'Escape') close();
    else return false;
    e.preventDefault();
    e.stopPropagation();
    return true;
  }

  const onBlur = () => close();
  input.addEventListener('blur', onBlur);

  return {
    update,
    key,
    close,
    destroy() {
      close();
      input.removeEventListener('blur', onBlur);
    },
  };
}
