// The Guestbook's notes as the site was built with them, for the page to read a note back into the
// sheet and for anything else that wants the book without running the relay.
import type { APIRoute } from 'astro';
import { writeEntry } from '../../../components/guestbook/entry';
import { guestbookEntries } from '../../../lib/guestbook';

export const GET: APIRoute = () =>
  new Response(JSON.stringify({ entries: guestbookEntries().map((e) => ({ id: e.id, ...writeEntry(e) })) }), {
    headers: { 'Content-Type': 'application/json' },
  });
