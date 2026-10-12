#!/usr/bin/env node
/**
 * Guestbook maintenance. No dependencies - needs Node 22+ (global WebSocket).
 *
 *   node scripts/guestbook.mjs backup   Snapshot the live book into data/guestbook.json
 *   node scripts/guestbook.mjs keygen   Make the key pair for the "keep my email private" option
 *   node scripts/guestbook.mjs emails   List the privately shared emails (needs the private key)
 *
 * `backup` is what .github/workflows/guestbook-backup.yml runs every day. It
 * only ever READS from the relays: it speaks Gun's wire protocol directly
 * (a `get` per node) instead of running a Gun peer, so it cannot write to the
 * book even by accident.
 *
 * Environment:
 *   GUESTBOOK_RELAYS        comma-separated relay URLs (default: the site's two relays)
 *   GUESTBOOK_PRIVATE_KEY   the private key JSON printed by `keygen`, or
 *   GUESTBOOK_PRIVATE_KEY_FILE  a path to a file holding it
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = path.join(REPO, 'data', 'guestbook.json');
const HIDDEN = path.join(REPO, 'data', 'guestbook-hidden.yaml');

// Keep in step with assets/js/gun-config.js
const RELAYS = (process.env.GUESTBOOK_RELAYS || 'https://gun.ankush.one/gun')
    .split(',').map((s) => s.trim()).filter(Boolean);
const ENTRIES_SOUL = 'ankush-one/apps/guestbook/entries';

// Keep in step with assets/js/guestbook.js
const MAX_NAME = 24;
const MAX_FROM = 24;
const MAX_BLURB = 100;
const MAX_ENTRIES = 3000;
// More new signatures than this in one run is far likelier a junk flood than
// a busy day, so the run stops for a human instead of committing them.
// GUESTBOOK_ALLOW_BULK=1 accepts the run as it is.
const MAX_NEW_PER_RUN = 200;
// Signers do edit their entries, but rarely many at once. Rewrites of
// existing entries are just as unreviewed, so they stop the run too.
const MAX_CHANGED_PER_RUN = 20;
const MAX_ID_LEN = 64;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const VARIANTS = 12;
const X_RE = /^[A-Za-z0-9_]+$/;
const IG_RE = /^[A-Za-z0-9._]+$/;
const ENC_RE = /^v1\.[A-Za-z0-9_-]{87}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,160}$/;
const ENC_INFO = 'ankush.one guestbook email v1';

const CONNECT_TIMEOUT_MS = 15000;
const QUIET_MS = 3000;          // a relay streams a big node in several replies
const TOTAL_TIMEOUT_MS = 90000;

// ---- Field normalisation (same rules the page applies) ------------------

function text(value, max) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function normHandle(v, max, allowed) {
    let s = text(v, 120);
    s = s.replace(/^https?:\/\/(www\.)?(twitter\.com|x\.com|instagram\.com)\//i, '');
    s = s.replace(/[/?#].*$/, '');
    s = s.replace(/^@+/, '');
    if (!s) return '';
    return allowed.test(s) && s.length <= max ? s : '';
}

function readEntry(data, now) {
    if (!data || typeof data.name !== 'string') return null;
    const name = text(data.name, MAX_NAME);
    if (!name) return null;
    const stamp = (v) => {
        const n = Number(v) || 0;
        return n > 0 && n <= now + MAX_CLOCK_SKEW_MS ? n : 0;
    };
    const variant = Math.floor(Number(data.variant)) || 0;
    return {
        name,
        from: text(data.from, MAX_FROM),
        blurb: text(data.blurb, MAX_BLURB),
        x: normHandle(data.x, 15, X_RE),
        ig: normHandle(data.ig, 30, IG_RE),
        variant: variant >= 0 && variant < VARIANTS ? variant : 0,
        ts: stamp(data.ts),
        updatedTs: stamp(data.updatedTs),
        // Never written to the snapshot - see backup().
        emailEnc: typeof data.emailEnc === 'string' && ENC_RE.test(data.emailEnc) ? data.emailEnc : ''
    };
}

// ---- Reading a relay ------------------------------------------------------

function msgId() {
    return Math.random().toString(36).slice(2, 11);
}

/**
 * Fetch the entries node and every entry it links to from one relay.
 * Resolves to { soul: { key: { value, state } } }; rejects if the relay could
 * not be reached or never answered for the entries node.
 */
function readRelay(url) {
    return new Promise((resolve, reject) => {
        const graph = {};
        const asked = new Set();
        let ws;
        let quiet = null;
        let answered = false;
        let done = false;

        const finish = (err) => {
            if (done) return;
            done = true;
            clearTimeout(quiet);
            clearTimeout(connectTimer);
            clearTimeout(totalTimer);
            try { ws.close(); } catch (e) { /* ignore */ }
            if (err) reject(err);
            else if (!answered) reject(new Error('no answer for the entries node'));
            else resolve(graph);
        };
        const connectTimer = setTimeout(() => finish(new Error('connect timed out')), CONNECT_TIMEOUT_MS);
        const totalTimer = setTimeout(() => finish(), TOTAL_TIMEOUT_MS);
        const bump = () => {
            clearTimeout(quiet);
            quiet = setTimeout(() => finish(), QUIET_MS);
        };

        const ask = (soul) => {
            if (asked.has(soul)) return;
            asked.add(soul);
            ws.send(JSON.stringify({ '#': msgId(), get: { '#': soul } }));
        };

        function merge(put) {
            Object.keys(put).forEach((soul) => {
                const node = put[soul];
                if (!node || typeof node !== 'object') return;
                if (soul !== ENTRIES_SOUL && !soul.startsWith(ENTRIES_SOUL + '/')) return;
                if (soul === ENTRIES_SOUL) answered = true;
                const states = (node._ && node._['>']) || {};
                const mine = graph[soul] || (graph[soul] = {});
                Object.keys(node).forEach((key) => {
                    if (key === '_') return;
                    const state = Number(states[key]) || 0;
                    if (mine[key] && mine[key].state > state) return;
                    mine[key] = { value: node[key], state };
                    // Each entry is its own node, linked from the entries node.
                    const link = node[key] && typeof node[key] === 'object' && node[key]['#'];
                    if (soul === ENTRIES_SOUL && typeof link === 'string' &&
                        link.startsWith(ENTRIES_SOUL + '/') && asked.size <= MAX_ENTRIES * 2) {
                        ask(link);
                    }
                });
            });
        }

        function hear(raw) {
            let msg = raw;
            if (typeof msg === 'string') {
                try { msg = JSON.parse(msg); } catch (e) { return; }
            }
            // Relays batch several messages into one frame.
            if (Array.isArray(msg)) return msg.forEach(hear);
            if (!msg || typeof msg !== 'object') return;
            if (msg.put && typeof msg.put === 'object') {
                // An empty answer still counts as an answer for an empty book.
                merge(msg.put);
            }
        }

        try {
            ws = new WebSocket(url.replace(/^http/, 'ws'));
        } catch (e) {
            return finish(e);
        }
        ws.addEventListener('open', () => {
            clearTimeout(connectTimer);
            ask(ENTRIES_SOUL);
            bump();
        });
        ws.addEventListener('message', (ev) => {
            hear(typeof ev.data === 'string' ? ev.data : '');
            bump();
        });
        ws.addEventListener('error', () => finish(new Error('connection failed')));
        ws.addEventListener('close', () => finish(done ? undefined : new Error('connection closed early')));
    });
}

/** Entries from every reachable relay, newest write per field winning. */
async function readBook() {
    const merged = {};
    let reached = 0;
    for (const url of RELAYS) {
        try {
            const graph = await readRelay(url);
            reached++;
            Object.keys(graph).forEach((soul) => {
                const into = merged[soul] || (merged[soul] = {});
                Object.keys(graph[soul]).forEach((key) => {
                    const cell = graph[soul][key];
                    if (!into[key] || cell.state > into[key].state) into[key] = cell;
                });
            });
            console.log(`  ${url}: ${Math.max(0, Object.keys(graph).length - 1)} entry nodes`);
        } catch (e) {
            console.warn(`  ${url}: ${e.message}`);
        }
    }
    if (!reached) return null;

    const now = Date.now();
    const parent = merged[ENTRIES_SOUL] || {};
    const live = new Map();     // id -> entry
    Object.keys(parent).forEach((id) => {
        if (!id || id.length > MAX_ID_LEN) return;
        // A nulled link is not a delete: the page never writes one, so it can
        // only be someone blanking entries from the console. Skipped like any
        // other missing entry, which leaves the snapshot's copy in place.
        const link = parent[id].value;
        const soul = link && typeof link === 'object' && link['#'];
        const node = soul && merged[soul];
        if (!node) return;
        const data = {};
        Object.keys(node).forEach((k) => { data[k] = node[k].value; });
        const entry = readEntry(data, now);
        if (entry) live.set(id, entry);
    });
    return { live };
}

async function readHidden() {
    // The file is a flat list under `ids:` - not worth a YAML parser.
    let raw = '';
    try { raw = await readFile(HIDDEN, 'utf8'); } catch (e) { return new Set(); }
    const ids = new Set();
    let inIds = false;
    raw.split('\n').forEach((line) => {
        const bare = line.replace(/\s+#.*$/, '').replace(/^#.*$/, '');
        if (/^ids\s*:/.test(bare)) {
            inIds = true;
            const inline = bare.match(/\[(.*)\]/);
            if (inline) inline[1].split(',').forEach((s) => { const v = s.trim().replace(/^["']|["']$/g, ''); if (v) ids.add(v); });
            return;
        }
        if (/^\S/.test(bare)) { inIds = false; return; }
        const item = inIds && bare.match(/^\s*-\s*(.+?)\s*$/);
        if (item) ids.add(item[1].replace(/^["']|["']$/g, ''));
    });
    return ids;
}

async function readSnapshot() {
    try {
        const data = JSON.parse(await readFile(SNAPSHOT, 'utf8'));
        return Array.isArray(data.entries) ? data.entries : [];
    } catch (e) {
        return [];
    }
}

// ---- backup ---------------------------------------------------------------

async function backup() {
    console.log('Reading the guestbook…');
    const book = await readBook();
    if (!book) {
        // Losing the relays is exactly what the snapshot is for: keep it.
        console.warn('No relay could be reached. The existing snapshot was left alone.');
        return;
    }

    const hidden = await readHidden();
    const previous = await readSnapshot();
    const byId = new Map();

    // The snapshot only grows by itself. An entry that has gone missing from
    // the relays (data loss, or someone blanking it from the console) stays;
    // nothing a relay says removes one. Only the hide list does.
    previous.forEach((e) => {
        if (e && typeof e.id === 'string') byId.set(e.id, e);
    });
    const known = new Set(byId.keys());
    const changedIds = new Set();
    const SHOWN = ['name', 'from', 'blurb', 'x', 'ig'];
    book.live.forEach((entry, id) => {
        const old = byId.get(id);
        if (old && (old.updatedTs || 0) > (entry.updatedTs || 0)) return;
        if (old && SHOWN.some((k) => (old[k] || '') !== (entry[k] || ''))) changedIds.add(id);
        byId.set(id, {
            id,
            name: entry.name,
            from: entry.from,
            blurb: entry.blurb,
            // No email, public or private: this file lives in a public git
            // history, where a signer could never take it back.
            x: entry.x,
            ig: entry.ig,
            variant: entry.variant,
            ts: entry.ts,
            updatedTs: entry.updatedTs
        });
    });
    hidden.forEach((id) => byId.delete(id));

    const byAge = (a, b) => (a.ts || 0) - (b.ts || 0) || (a.id < b.id ? -1 : 1);
    const kept = [...byId.values()].filter((e) => known.has(e.id)).sort(byAge).slice(-MAX_ENTRIES);
    let fresh = [...byId.values()].filter((e) => !known.has(e.id)).sort(byAge);

    // Everything here was written by strangers and is about to be committed
    // and published unattended. A flood is left for the owner to look at,
    // whether it is new entries or existing ones rewritten (Gun nodes are
    // world-writable, so defacing every signature adds no new ids at all).
    // This applies to the first run as well: an empty snapshot is no reason
    // to import a relay's worth of unreviewed entries.
    const changed = [...changedIds].filter((id) => byId.has(id));
    if (process.env.GUESTBOOK_ALLOW_BULK !== '1' &&
        (fresh.length + changed.length > MAX_NEW_PER_RUN || changed.length > MAX_CHANGED_PER_RUN)) {
        throw new Error(`${fresh.length} new and ${changed.length} rewritten entries in one run ` +
            `(limits ${MAX_NEW_PER_RUN} in all, ${MAX_CHANGED_PER_RUN} rewritten). ` +
            'Nothing was written. Check the book, add junk ids to data/guestbook-hidden.yaml, ' +
            'then run again with GUESTBOOK_ALLOW_BULK=1 to accept the rest.');
    }

    // Entries already in the snapshot are never pushed out by newer ones:
    // `ts` is whatever the writer says it is, so sorting everything by it and
    // cutting at the cap let a batch of junk evict every real signature.
    const room = MAX_ENTRIES - kept.length;
    if (fresh.length > room) {
        console.warn(`The snapshot is full: ${fresh.length - room} new entries were left out.`);
        fresh = fresh.slice(0, room);
    }
    const entries = kept.concat(fresh).sort(byAge);

    if (JSON.stringify(entries) === JSON.stringify(previous)) {
        console.log(`Unchanged (${entries.length} entries).`);
        return;
    }
    const out = { updated: new Date().toISOString(), count: entries.length, entries };
    await writeFile(SNAPSHOT, JSON.stringify(out, null, 1) + '\n');
    console.log(`Wrote ${entries.length} entries to data/guestbook.json (was ${previous.length}).`);
}

// ---- Private emails ---------------------------------------------------------

const b64u = {
    enc: (buf) => Buffer.from(buf).toString('base64url'),
    dec: (str) => new Uint8Array(Buffer.from(str, 'base64url'))
};

async function keygen() {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const pub = b64u.enc(await crypto.subtle.exportKey('raw', pair.publicKey));
    const priv = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
    console.log('Public key - put this in data/guestbook-settings.yaml as privateEmailKey:\n');
    console.log('  ' + pub + '\n');
    console.log('Private key - keep it OUT of the repo (password manager). Anyone holding it');
    console.log('can read every privately shared email; losing it makes them unreadable:\n');
    console.log('  ' + priv + '\n');
}

async function decryptEmail(enc, privateJwk) {
    const [, epk, iv, ct] = enc.split('.');
    const priv = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    const pub = await crypto.subtle.importKey('raw', b64u.dec(epk), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256);
    const hk = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: b64u.dec(epk), info: new TextEncoder().encode(ENC_INFO) },
        hk, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64u.dec(iv) }, key, b64u.dec(ct));
    return new TextDecoder().decode(plain).trim();
}

async function emails() {
    let raw = process.env.GUESTBOOK_PRIVATE_KEY || '';
    if (!raw && process.env.GUESTBOOK_PRIVATE_KEY_FILE) {
        raw = await readFile(process.env.GUESTBOOK_PRIVATE_KEY_FILE, 'utf8');
    }
    if (!raw) throw new Error('Set GUESTBOOK_PRIVATE_KEY or GUESTBOOK_PRIVATE_KEY_FILE to the key from `keygen`.');
    const jwk = JSON.parse(raw);

    const book = await readBook();
    if (!book) throw new Error('No relay could be reached.');
    let found = 0;
    for (const [id, entry] of book.live) {
        if (!entry.emailEnc) continue;
        found++;
        try {
            console.log(`${entry.name}\t${await decryptEmail(entry.emailEnc, jwk)}\t${id}`);
        } catch (e) {
            // Written for a different key, or tampered with.
            console.log(`${entry.name}\t(could not be decrypted)\t${id}`);
        }
    }
    if (!found) console.log('No privately shared emails in the book.');
}

const commands = { backup, keygen, emails };
const command = commands[process.argv[2]];
if (!command) {
    console.error('Usage: node scripts/guestbook.mjs <backup|keygen|emails>');
    process.exit(2);
}
command().then(() => process.exit(0), (e) => {
    console.error(e.message || e);
    process.exit(1);
});
