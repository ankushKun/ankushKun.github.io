#!/usr/bin/env node
// The Guestbook's daily snapshot: reads every note from the relay into src/data/guestbook.json,
// which the board is built from (so it reads without JavaScript, and survives the relay losing it).
// .github/workflows/guestbook.yml runs it every day and commits what changed.
//
//   node scripts/guestbook.mjs
//
// It only ever reads from the relay: it speaks GUN's wire protocol directly (a `get` per node)
// rather than running a peer, so it can't write to the book even by accident. Notes are read by the
// page's own rules (src/components/guestbook/entry.ts), notes on the hide list
// (src/data/guestbook-hidden.json) are left out, and emails never go in: this file lives in a public
// git history, where a signer could never take one back. A run that would add or change more than a
// handful of notes at once stops for a human instead (GUESTBOOK_ALLOW_BULK=1 lets it through).
//
// GUESTBOOK_RELAY points it at another relay (default: the site's).
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEntry, writeEntry } from '../src/components/guestbook/entry.ts';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = path.join(REPO, 'src/data/guestbook.json');
const HIDDEN = path.join(REPO, 'src/data/guestbook-hidden.json');
const RELAY = process.env.GUESTBOOK_RELAY || 'https://gun.ankush.one/gun';
const ENTRIES = 'ankush-one/apps/guestbook/entries';
const MAX_ENTRIES = 3000;
const MAX_NEW = 200;
const MAX_CHANGED = 20;
const QUIET = 3000;
const TIMEOUT = 90000;

/** Every note node under the entries node, as { id: fields }. */
function readRelay(url) {
  return new Promise((resolve, reject) => {
    const graph = {};
    const asked = new Set();
    let answered = false;
    let done = false;
    let quiet = 0;
    const ws = new WebSocket(url.replace(/^http/, 'ws'));
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(quiet);
      clearTimeout(total);
      try {
        ws.close();
      } catch {
        // Closed already.
      }
      if (err) reject(err);
      else if (!answered) reject(new Error('the relay never answered for the book'));
      else resolve(graph);
    };
    const total = setTimeout(() => finish(), TIMEOUT);
    const bump = () => {
      clearTimeout(quiet);
      quiet = setTimeout(() => finish(), QUIET);
    };
    const ask = (soul) => {
      if (asked.has(soul) || asked.size > MAX_ENTRIES * 2) return;
      asked.add(soul);
      ws.send(JSON.stringify({ '#': Math.random().toString(36).slice(2), get: { '#': soul } }));
    };
    const merge = (put) => {
      for (const [soul, node] of Object.entries(put)) {
        if (!node || typeof node !== 'object' || (soul !== ENTRIES && !soul.startsWith(`${ENTRIES}/`))) continue;
        if (soul === ENTRIES) answered = true;
        const states = node._?.['>'] ?? {};
        const mine = (graph[soul] ??= {});
        for (const [key, value] of Object.entries(node)) {
          if (key === '_') continue;
          const state = Number(states[key]) || 0;
          if (mine[key] && mine[key].state > state) continue;
          mine[key] = { value, state };
          const link = value && typeof value === 'object' && value['#'];
          if (soul === ENTRIES && typeof link === 'string' && link.startsWith(`${ENTRIES}/`)) ask(link);
        }
      }
    };
    const hear = (raw) => {
      let msg = raw;
      if (typeof msg === 'string') {
        try {
          msg = JSON.parse(msg);
        } catch {
          return;
        }
      }
      if (Array.isArray(msg)) return msg.forEach(hear);
      if (msg?.put && typeof msg.put === 'object') merge(msg.put);
    };
    ws.addEventListener('open', () => {
      ask(ENTRIES);
      bump();
    });
    ws.addEventListener('message', (e) => {
      hear(typeof e.data === 'string' ? e.data : '');
      bump();
    });
    ws.addEventListener('error', () => finish(new Error('connection failed')));
    ws.addEventListener('close', () => finish(done ? undefined : new Error('connection closed early')));
  });
}

const readJson = async (file, fallback) => {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
};

/** A note as the snapshot keeps it: no email links. */
const keep = (e) => ({ id: e.id, ...writeEntry({ ...e, links: e.links.filter((l) => !l.startsWith('mailto:')) }) });

console.log(`Reading the guestbook from ${RELAY}`);
let graph;
try {
  graph = await readRelay(RELAY);
} catch (err) {
  // Losing the relay is exactly what the snapshot is for: keep it as it is.
  console.warn(`${err.message}. The snapshot was left alone.`);
  process.exit(0);
}

const now = Date.now();
const live = new Map();
const takenDown = new Set();
for (const [id, cell] of Object.entries(graph[ENTRIES] ?? {})) {
  const soul = cell.value && typeof cell.value === 'object' && cell.value['#'];
  const node = soul && graph[soul];
  if (!node) continue;
  const data = Object.fromEntries(Object.entries(node).map(([k, c]) => [k, c.value]));
  if (data.deleted && !data.name) takenDown.add(id);
  const e = readEntry(id, data, now);
  if (e) live.set(id, e);
}

const hidden = new Set((await readJson(HIDDEN, { ids: [] })).ids);
const before = (await readJson(SNAPSHOT, { entries: [] })).entries;
const byId = new Map(before.map((e) => [e.id, e]));
const known = new Set(byId.keys());
const changed = new Set();

for (const [id, e] of live) {
  const old = byId.get(id);
  if (old && (old.updatedTs || 0) >= e.updatedTs) continue;
  const next = keep(e);
  if (old) changed.add(id);
  byId.set(id, next);
}
// A note its writer took down goes; a note that has simply gone missing from the relay stays.
for (const id of takenDown) if (byId.delete(id) && known.has(id)) changed.add(id);
for (const id of hidden) byId.delete(id);

const fresh = [...byId.keys()].filter((id) => !known.has(id));
if (process.env.GUESTBOOK_ALLOW_BULK !== '1' && (fresh.length + changed.size > MAX_NEW || changed.size > MAX_CHANGED)) {
  console.error(
    `${fresh.length} new and ${changed.size} changed notes in one run (limits ${MAX_NEW} in all, ${MAX_CHANGED} changed). Nothing was written. ` +
      'Look over the book, put junk ids in src/data/guestbook-hidden.json, then run again with GUESTBOOK_ALLOW_BULK=1.',
  );
  process.exit(1);
}

const entries = [...byId.values()].sort((a, b) => (a.ts || 0) - (b.ts || 0) || (a.id < b.id ? -1 : 1)).slice(-MAX_ENTRIES);
const same = JSON.stringify(entries) === JSON.stringify(before);
if (same) {
  console.log(`No change: ${entries.length} notes.`);
  process.exit(0);
}
await writeFile(SNAPSHOT, `${JSON.stringify({ updated: new Date(now).toISOString(), count: entries.length, entries }, null, 1)}\n`);
console.log(`Wrote ${entries.length} notes (${fresh.length} new, ${changed.size} changed).`);
