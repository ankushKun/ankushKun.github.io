// Runs the Guestbook (Guestbook.astro). The board as built is the snapshot; this adds what the relay
// holds that's newer, takes down what was taken down, and runs the sheet you sign in: the gate if
// you haven't a name yet, then your note (drawn, written or both, on a paper you pick), where you're
// from and your links. One note per person, kept under your id, so signing again changes yours.
//
// Nodes:
//   apps/guestbook/entries   <id> = a note (entry.ts), or { deleted } once its writer took it down
//   apps/guestbook/hidden    <id> = when a mod hid it, or null once shown again
import { track } from '../../scripts/analytics';
import { play } from '../../scripts/sfx';
import { mountPad, type Pad, type Tool } from '../live/pad';
import { node, parse, type Chain } from '../live/relay';
import { mountSession } from '../live/session';
import { store } from '../live/store';
import { MAX_LINKS, NOTE_H, NOTE_W, PAPERS, asHandle, handleLink, normLink, readEntry, writeEntry, type Entry } from './entry';
import { badgeEl, badgeFor } from './links';
import { dateOf, lookOf } from './look';

/** The old site's id for a visitor, which its notes are kept under. */
const LEGACY_ID = 'multiplayer-cursor-id';
const COOLDOWN = 4000;

export function mount(root: HTMLElement): () => void {
  const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const $$ = <T extends Element = HTMLElement>(sel: string) => [...root.querySelectorAll<T>(sel)];
  const wall = $<HTMLOListElement>('[data-wall]');
  const count = $('[data-count]');
  const signBtn = $<HTMLButtonElement>('[data-sign]');
  const sheet = $<HTMLDialogElement>('[data-sheet]');
  const editor = $<HTMLFormElement>('[data-editor]');
  const noteEdit = $('[data-note]');
  const textInput = $<HTMLTextAreaElement>('[data-text]');
  const fromInput = $<HTMLInputElement>('[data-from]');
  const linkList = $<HTMLUListElement>('[data-link-list]');
  const linkAdd = $('[data-link-add]');
  const linkInput = $<HTMLInputElement>('[data-link-input]');
  const handlePick = $('[data-handle]');
  const error = $('[data-error]');
  const removeBtn = $<HTMLButtonElement>('[data-remove]');
  const pinLabel = $('[data-pin-label]');

  /** Every note on the board, by id: what we know of it and its element. */
  const notes = new Map<string, { entry: Entry | null; updated: number; ts: number; el: HTMLLIElement }>();
  for (const el of $$<HTMLLIElement>('.note[data-id]')) {
    notes.set(el.dataset.id!, { entry: null, updated: Number(el.dataset.updated) || 0, ts: Number(el.dataset.ts) || 0, el });
  }
  const hidden = new Set<string>();
  const chains: Chain[] = [];
  let lastSave = 0;

  const session = mountSession(root, {
    app: 'guestbook',
    gateFirst: false,
    behind: [editor],
    onChange: () => {
      root.toggleAttribute('data-mod', session.isMod());
      $('[data-my-name]').textContent = session.me.nick;
    },
  });
  session.paintFaces(wall);

  // The board ------------------------------------------------------------------------------------

  function noteEl(e: Entry): HTMLLIElement {
    const look = lookOf(e);
    const li = document.createElement('li');
    li.className = 'note is-new';
    li.dataset.id = e.id;
    li.dataset.ts = String(e.ts);
    li.dataset.updated = String(e.updatedTs);
    li.dataset.paper = look.paper;
    li.style.setProperty('--tilt', look.tilt);
    const pin = li.appendChild(document.createElement('span'));
    pin.className = 'note-pin';
    pin.dataset.pin = look.pin;
    pin.setAttribute('aria-hidden', 'true');
    const paper = li.appendChild(document.createElement('div'));
    paper.className = 'note-paper';
    const sheetEl = paper.appendChild(document.createElement('div'));
    sheetEl.className = 'note-sheet';
    if (e.blurb || !e.doodle) {
      const p = sheetEl.appendChild(document.createElement('p'));
      p.className = e.blurb ? 'note-text' : 'note-sig';
      p.textContent = e.blurb || e.name;
    }
    if (e.doodle) {
      const img = paper.appendChild(document.createElement('img'));
      img.className = 'note-doodle';
      img.alt = `Drawing by ${e.name}`;
      img.width = NOTE_W;
      img.height = NOTE_H;
      img.src = e.doodle;
    }
    const foot = li.appendChild(document.createElement('footer'));
    foot.className = 'note-foot';
    foot.append(session.face(e.uuid || null, e.uuid || e.id));
    const who = foot.appendChild(document.createElement('div'));
    who.className = 'note-who';
    who.appendChild(document.createElement('b')).textContent = e.name;
    if (e.from) who.appendChild(document.createElement('span')).textContent = e.from;
    if (e.links.length) foot.append(linksEl(e.links, e.name));
    const time = foot.appendChild(document.createElement('time'));
    time.dateTime = new Date(e.ts || e.updatedTs).toISOString();
    time.textContent = dateOf(e.ts || e.updatedTs);
    addHide(li);
    return li;
  }

  function linksEl(links: string[], name: string) {
    const span = document.createElement('span');
    span.className = 'note-links';
    for (const href of links) {
      const b = badgeFor(href);
      const a = span.appendChild(document.createElement('a'));
      a.className = b.email ? 'note-link ph-no-capture' : 'note-link';
      a.href = b.href;
      a.rel = 'noopener nofollow ugc';
      a.target = '_blank';
      a.title = b.short;
      a.setAttribute('aria-label', `${name} on ${b.label}`);
      a.append(badgeEl(b));
    }
    return span;
  }

  /** A mod's Hide, on every note; the CSS shows it only to mods. */
  function addHide(li: HTMLLIElement) {
    const b = li.appendChild(document.createElement('button'));
    b.type = 'button';
    b.className = 'note-hide';
    b.dataset.hide = li.dataset.id!;
    b.setAttribute('aria-label', 'Hide note');
    b.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.7 5.1A10 10 0 0 1 12 5c5 0 8.5 4.5 9.5 7a13 13 0 0 1-2.2 3.3M6.6 6.6C4.5 8 3.1 10.1 2.5 12c1 2.5 4.5 7 9.5 7 1.9 0 3.6-.6 5-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18"/></svg>';
  }

  function place(id: string, el: HTMLLIElement, ts: number) {
    const after = [...wall.children].find((c) => {
      const n = notes.get((c as HTMLElement).dataset.id ?? '');
      return n && n.el !== el && (n.ts < ts || (n.ts === ts && id.localeCompare((c as HTMLElement).dataset.id!) < 0));
    });
    wall.insertBefore(el, after ?? null);
  }

  function recount() {
    const n = [...notes.keys()].filter((id) => !hidden.has(id)).length;
    count.textContent = `${n} ${n === 1 ? 'note' : 'notes'}`;
  }

  function show(e: Entry) {
    const known = notes.get(e.id);
    if (known && known.updated >= e.updatedTs) {
      known.entry ??= e;
      return;
    }
    const el = noteEl(e);
    if (known) known.el.replaceWith(el);
    notes.set(e.id, { entry: e, updated: e.updatedTs, ts: e.ts, el });
    el.hidden = hidden.has(e.id);
    place(e.id, el, e.ts);
    recount();
  }

  function takeDown(id: string) {
    const known = notes.get(id);
    if (!known) return;
    known.el.remove();
    notes.delete(id);
    recount();
  }

  function onEntry(id: string, data: unknown) {
    const raw = parse(data);
    if (!raw) return;
    // Taken down by its writer. A note that simply isn't there (a relay that lost it) stays as the
    // snapshot has it.
    if (raw.deleted && !raw.name) return takeDown(id);
    const e = readEntry(id, raw);
    if (e) show(e);
  }

  function onHidden(id: string, data: unknown) {
    const on = Number(data) > 0;
    if (on) hidden.add(id);
    else hidden.delete(id);
    const known = notes.get(id);
    if (known) known.el.hidden = on;
    recount();
  }

  wall.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-hide]');
    if (!b || !session.isMod()) return;
    node('apps/guestbook/hidden').get(b.dataset.hide!).put(Date.now());
    onHidden(b.dataset.hide!, Date.now());
    play('back');
  });

  // Your note --------------------------------------------------------------------------------------

  /** Your note is kept under your id, or under the old site's if you signed there and not here. */
  function myId() {
    const legacy = store.get(LEGACY_ID);
    if (!notes.has(session.me.uuid) && legacy && notes.has(legacy)) return legacy;
    return session.me.uuid;
  }

  /** Your note as the board knows it, read again from its element's data if it came from the snapshot. */
  const mine = () => notes.get(myId()) ?? null;

  let pad: Pad | null = null;
  let links: string[] = [];
  let pendingHandle = '';
  let paper = 0;
  let loadedDoodle = '';

  const say = (text = '') => {
    error.textContent = text;
    error.hidden = !text;
  };

  function setMode(mode: 'draw' | 'type') {
    editor.dataset.mode = mode;
    for (const b of $$('[data-mode-pick]')) b.setAttribute('aria-selected', String(b.dataset.modePick === mode));
    if (mode === 'type') textInput.focus();
  }

  function setPaper(i: number) {
    paper = i;
    noteEdit.dataset.paper = PAPERS[i];
    for (const b of $$('[data-paper-pick]')) b.setAttribute('aria-checked', String(Number(b.dataset.paperPick) === i));
  }

  function drawLinks() {
    linkList.replaceChildren(
      ...links.map((href, i) => {
        const b = badgeFor(href);
        const li = document.createElement('li');
        li.className = b.email ? 'gb-link ph-no-capture' : 'gb-link';
        li.append(badgeEl(b, 14));
        const span = li.appendChild(document.createElement('span'));
        span.className = 'gb-link-text';
        span.textContent = b.short;
        const x = li.appendChild(document.createElement('button'));
        x.type = 'button';
        x.className = 'gb-link-x';
        x.setAttribute('aria-label', `Remove ${b.short}`);
        x.dataset.unlink = String(i);
        x.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
        return li;
      }),
    );
    linkAdd.hidden = links.length >= MAX_LINKS;
    $('[data-my-links]').replaceChildren(...linksEl(links, session.me.nick).childNodes);
  }

  function addLink(href: string | null) {
    if (!href) {
      say("That doesn't look like a link.");
      play('nope');
      return;
    }
    say();
    if (!links.includes(href)) links.push(href);
    linkInput.value = '';
    pendingHandle = '';
    handlePick.hidden = true;
    drawLinks();
    play('tick');
  }

  function takeLink() {
    const v = linkInput.value.trim();
    if (!v) return;
    const href = normLink(v);
    if (href) return addLink(href);
    const handle = asHandle(v);
    if (handle) {
      pendingHandle = handle;
      handlePick.hidden = false;
      say();
      return;
    }
    addLink(null);
  }

  linkInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      takeLink();
    }
  });
  linkInput.addEventListener('blur', () => {
    // Leaving the field for the platform picker isn't leaving it.
    setTimeout(() => {
      if (!handlePick.contains(document.activeElement)) takeLink();
    }, 0);
  });
  linkInput.addEventListener('input', () => {
    handlePick.hidden = true;
    say();
  });
  handlePick.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-handle-pick]');
    if (b && pendingHandle) addLink(handleLink(b.dataset.handlePick!, pendingHandle));
  });
  linkList.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-unlink]');
    if (!b) return;
    links.splice(Number(b.dataset.unlink), 1);
    drawLinks();
    play('back');
  });

  // The note's lines are all it has: what doesn't fit isn't kept.
  let lastText = '';
  textInput.addEventListener('input', () => {
    if (textInput.scrollHeight > textInput.clientHeight + 2) {
      textInput.value = lastText;
      play('nope');
    }
    lastText = textInput.value;
  });
  fromInput.addEventListener('input', () => ($('[data-my-from]').textContent = fromInput.value.trim()));

  for (const b of $$('[data-mode-pick]')) b.addEventListener('click', () => setMode(b.dataset.modePick as 'draw' | 'type'));
  for (const b of $$('[data-paper-pick]')) b.addEventListener('click', () => setPaper(Number(b.dataset.paperPick)));
  for (const b of $$<HTMLButtonElement>('[data-tool]'))
    b.addEventListener('click', () => {
      pad?.setTool(b.dataset.tool as Tool);
      for (const t of $$('[data-tool]')) t.setAttribute('aria-pressed', String(t === b));
      setMode('draw');
    });
  for (const b of $$<HTMLButtonElement>('[data-ink]'))
    b.addEventListener('click', () => {
      pad?.setInk(b.dataset.ink!);
      for (const t of $$('[data-ink]')) t.setAttribute('aria-checked', String(t === b));
      if ($('[data-tool="eraser"]').getAttribute('aria-pressed') === 'true') $<HTMLButtonElement>('[data-tool="pen"]').click();
      setMode('draw');
    });
  $('[data-undo]').addEventListener('click', () => pad?.undo());
  $('[data-clear]').addEventListener('click', () => {
    pad?.clear();
    loadedDoodle = '';
  });
  const onUndoKey = (e: KeyboardEvent) => {
    if (!sheet.open || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z' || e.target === textInput || e.target instanceof HTMLInputElement) return;
    e.preventDefault();
    pad?.undo();
  };
  addEventListener('keydown', onUndoKey);

  /** Fills the sheet with your note as it stands, the first time it opens. */
  let filled = false;
  async function fill() {
    pad ??= mountPad($<HTMLCanvasElement>('[data-pad]'), () => {}, { width: NOTE_W, height: NOTE_H });
    pad.setInk($<HTMLElement>('[data-ink][aria-checked="true"]').dataset.ink!);
    $('[data-my-name]').textContent = session.me.nick;
    if (filled) return;
    filled = true;
    const m = mine();
    const e = m?.entry ?? (m ? await snapshotEntry(myId()) : null);
    removeBtn.hidden = !m;
    pinLabel.textContent = m ? 'Pin again' : 'Pin it';
    if (!e) return;
    textInput.value = lastText = e.blurb;
    fromInput.value = e.from;
    $('[data-my-from]').textContent = e.from;
    links = [...e.links];
    drawLinks();
    setPaper(e.paper);
    if (e.doodle) {
      loadedDoodle = e.doodle;
      await pad.load(e.doodle).catch(() => {});
    }
  }

  /** A note from the snapshot: read from the page's own copy (the snapshot is built in). */
  async function snapshotEntry(id: string): Promise<Entry | null> {
    try {
      const res = await fetch('/apps/guestbook/notes.json');
      const all = (await res.json()) as { entries: Record<string, unknown>[] };
      const raw = all.entries.find((x) => x.id === id);
      return raw ? readEntry(id, raw) : null;
    } catch {
      return null;
    }
  }

  async function open() {
    say();
    sheet.showModal();
    await session.ensure();
    if (!sheet.open) return;
    await fill();
    if (editor.dataset.mode === 'type') textInput.focus();
  }

  signBtn.addEventListener('click', () => void open());
  $('[data-close]').addEventListener('click', () => sheet.close());
  sheet.addEventListener('close', () => {
    session.closeGate();
    handlePick.hidden = true;
  });
  // A press on the dim around the sheet closes it, as a press outside a Wii U sheet did.
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) sheet.close();
  });

  editor.addEventListener('submit', (e) => {
    e.preventDefault();
    if (linkInput.value.trim()) takeLink();
    if (!error.hidden) return;
    const now = Date.now();
    if (now - lastSave < COOLDOWN) return say('Give it a moment.');
    const blurb = textInput.value.trim();
    const doodle = pad?.dirty ? pad.png() : loadedDoodle;
    if (!blurb && !doodle) {
      play('nope');
      return say('Draw or write something first.');
    }
    const id = myId();
    const before = notes.get(id)?.entry;
    const entry: Entry = {
      id,
      name: session.me.nick,
      from: fromInput.value.trim(),
      blurb,
      doodle,
      paper,
      links,
      uuid: session.me.uuid,
      ts: before?.ts || notes.get(id)?.ts || now,
      updatedTs: now,
    };
    const checked = readEntry(id, writeEntry(entry));
    if (!checked) return say("That note can't be pinned.");
    if (checked.doodle !== doodle && doodle) {
      play('nope');
      return say('That drawing is too detailed to pin. Try fewer colours or less shading.');
    }
    lastSave = now;
    track('guestbook_signed', { edit: Boolean(before), drawing: Boolean(doodle), links: links.length });
    node('apps/guestbook/entries').get(id).put(writeEntry(entry), (ack) => {
      if (ack.err) say("The guestbook didn't take it. Try again in a moment.");
    });
    show(checked);
    filled = false;
    play('select');
    sheet.close();
    notes.get(id)?.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  removeBtn.addEventListener('click', () => {
    const id = myId();
    track('guestbook_removed');
    node('apps/guestbook/entries').get(id).put({ deleted: Date.now(), name: '', blurb: '', doodle: '', links: '' });
    takeDown(id);
    filled = false;
    links = [];
    textInput.value = lastText = '';
    pad?.clear();
    loadedDoodle = '';
    drawLinks();
    play('back');
    sheet.close();
  });

  // Start ------------------------------------------------------------------------------------------

  for (const id of JSON.parse(root.dataset.hidden ?? '[]') as string[]) hidden.add(id);
  for (const n of notes.values()) addHide(n.el);
  const entries = node('apps/guestbook/entries');
  const hides = node('apps/guestbook/hidden');
  chains.push(entries, hides);
  entries.map().on((data, id) => onEntry(id, data));
  hides.map().on((data, id) => onHidden(id, data));
  signBtn.hidden = false;
  drawLinks();

  return () => {
    for (const c of chains) c.off();
    removeEventListener('keydown', onUndoKey);
    pad?.destroy();
    if (sheet.open) sheet.close();
    session.destroy();
  };
}

