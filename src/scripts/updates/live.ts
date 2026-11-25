// The live apps' news, read from the relay for the badges (store.ts): the chat's messages, but only
// once its newest is newer than the visitor's last look, the days drawn on in Paint (just the list
// of days, never the strokes), and when the Guestbook's newest note was pinned. Loaded only on pages
// that show these badges, so the relay's library never comes along to a blog post.
import { paths as chat, readMessage } from '../../components/chat/net';
import { node } from '../../components/live/relay';
import { dayOf, paths as paint } from '../../components/paint/board';
import { changed, live, seenAt } from './store';

let started = false;

export function start() {
  if (started) return;
  started = true;

  const messages = new Map<string, { time: number; uuid: string | null }>();
  let reading = false;
  let timer = 0;
  // A burst of messages is counted once it pauses.
  const soon = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      live.chat = [...messages.values()];
      changed();
    }, 300);
  };
  chat.latest().on((at) => {
    if (reading || !(Number(at) > seenAt('chat'))) return;
    reading = true;
    chat.messages().map().on((data, key) => {
      const m = data ? readMessage(key, data) : null;
      if (!m || m.deleted || m.kind === 'system') messages.delete(key);
      else messages.set(key, { time: m.time, uuid: m.uuid });
      soon();
    });
  });

  const days = new Set<string>();
  paint.boards().map().on((data, key) => {
    const day = dayOf(key);
    if (!day || !data || days.has(day)) return;
    days.add(day);
    live.paintDays = [...days];
    changed();
  });

  node('apps/guestbook').get('latest').on((at) => {
    const time = Number(at) || 0;
    if (time <= live.guestbook) return;
    live.guestbook = time;
    changed();
  });
}
