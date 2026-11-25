// Who you are in the live apps (the chat, and Paint and the Guestbook once they're built), kept in
// this browser and shared by all of them: one name, one Mii and one agreement get you into each.
// The nick and uuid keys are the old site's, so a name chosen there still works. `seen` is when the
// newest chat message the visitor has seen was sent, written by the chat and the plaza, which puts
// anything newer first (plaza/chatter.ts).
export const STORE = {
  nick: 'irc_nick',
  uuid: 'irc_uuid',
  mii: 'chat_mii',
  agreed: 'live_agreed',
  seen: 'chat_seen',
};

/** Bump to ask everyone to agree again, after the agreement's words change (Gate.astro). */
const AGREEMENT = '1';

export const MAX_NICK = 16;

export const store = {
  get(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      // Private windows may refuse; it lasts for this visit.
    }
  },
};

/** A name as the live apps take it: no spaces at the ends, underscores between words, 16 at most. */
export const cleanNick = (s: string) => s.trim().replace(/\s+/g, '_').slice(0, MAX_NICK);

/** Whether this browser has agreed to the current agreement. */
export const agreed = () => store.get(STORE.agreed) === AGREEMENT;

export const agree = () => store.set(STORE.agreed, AGREEMENT);

/** Notes that the visitor has seen a chat message sent at `time`, if it is newer than any before. */
export function saw(time: number) {
  if (time <= (Number(store.get(STORE.seen)) || 0)) return;
  store.set(STORE.seen, String(time));
  // The unread count on the Chat block and channel goes down with it (scripts/updates/).
  window.dispatchEvent(new Event('chat-seen'));
}
