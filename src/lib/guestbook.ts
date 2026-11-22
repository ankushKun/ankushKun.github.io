// The Guestbook as the site is built with it: the daily snapshot of the relay
// (src/data/guestbook.json, written by scripts/guestbook.mjs), less the notes a mod has hidden for
// good (src/data/guestbook-hidden.json), each read as the page reads the relay, newest first.
import snapshot from '../data/guestbook.json';
import hiddenList from '../data/guestbook-hidden.json';
import { byNewest, readEntry, type Entry } from '../components/guestbook/entry';

export const HIDDEN: string[] = hiddenList.ids;

export function guestbookEntries(): Entry[] {
  const hidden = new Set(HIDDEN);
  return (snapshot.entries as Record<string, unknown>[])
    .map((raw) => (typeof raw.id === 'string' && !hidden.has(raw.id) ? readEntry(raw.id, raw) : null))
    .filter((e): e is Entry => !!e)
    .sort(byNewest);
}
