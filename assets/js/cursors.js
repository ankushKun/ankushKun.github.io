/**
 * Multiplayer cursors - anchor based.
 *
 * A screen coordinate is meaningless across viewers: the desktop icon grid is
 * right-anchored and wraps by viewport height (see .desktop-icons in
 * mavericks.css), windows sit wherever each viewer dragged them, and the sticky
 * note is placed from a normalized position. The same pixel is a different
 * thing on every screen.
 *
 * So a cursor is published as "what it is pointing at" plus a real pixel offset
 * inside that thing:
 *
 *     { a: "icon:terminal", ox: 31, oy: 44 }
 *
 * Cursors are anonymous - no nickname is rendered or published.
 *
 * The receiver finds its own copy of that element and places the cursor at
 * rect.left + ox, rect.top + oy. Because anchored elements are a fixed CSS size
 * (an icon is always 80px wide), the offset lands pixel-exact for everyone -
 * hover the Terminal icon's label and every viewer sees it on their Terminal
 * icon's label, wherever the grid happened to put it.
 *
 * There is one room for the whole site, so a visitor on an article and one on
 * the desktop see each other. Every update also carries the spot in the
 * viewport (nx, ny in 0..1000): a viewer without that anchor on screen (another
 * page, a window they do not have open) draws the cursor there, dimmed.
 *
 * Cost: on the Workers free plan every frame sent to the relay counts against
 * a daily request limit, so the stream only runs while someone else is here,
 * and it goes out every 200ms carrying the 60ms samples in between ("tr"),
 * which receivers replay so the motion stays smooth.
 */
(function () {
    'use strict';

    if (!window.SiteGun) return;

    const SAMPLE_MS = 60;             // pointer position sampled this often while moving
    const SEND_MS = 200;              // ...and sent this often, with the samples in between
    const MAX_TRAIL = 8;
    const PRESENCE_BEAT_MS = 20000;
    const SLOW_BEAT_MS = 60000;       // while the relay says its daily budget is running low
    const CURSOR_TTL_MS = 6000;       // hide a cursor we stopped hearing from
    const PRESENCE_TTL_MS = 50000;    // count someone as online this long after a beat
    const MAX_PEERS = 40;             // cursors drawn at once; ids are self-declared
    const MAX_TRACKED_IDS = 2000;     // ids remembered per stream for liveness
    const MAX_ANCHOR_LEN = 80;
    const MAX_OFFSET = 10000;         // px; nothing anchored is anywhere near this big
    const HIDE_CURSORS_KEY = 'cursors-hidden';

    // Cursors are a pointing device; a touch screen has nothing to broadcast,
    // but a narrow desktop window still does - so this asks about the pointer,
    // not the viewport. Presence runs either way so the online count stays
    // honest on mobile.
    const hasFinePointer = window.matchMedia('(pointer: fine)').matches;

    const cursorsRef = window.SiteGun.paths.live.cursors();
    const presenceRef = window.SiteGun.paths.live.presence();
    const reactionsRef = window.SiteGun.paths.live.reactions();
    const load = window.SiteGun.load || { slow: false, onChange() {} };
    /** The page this visitor is on: on the desktop, the focused window's page. */
    const currentPage = () => {
        const shell = window.SiteShell;
        const path = shell && shell.isDesktop && shell.currentPath ? shell.currentPath() : null;
        return window.SiteGun.roomKey(path || window.location.pathname);
    };

    // Storage may be blocked; SiteGun.store never throws.
    const store = window.SiteGun.store;
    const myId = window.SiteGun.visitorId();

    let cursorsHidden = store.get(HIDE_CURSORS_KEY) === '1';
    const publishesCursor = () => hasFinePointer && !cursorsHidden;

    /**
     * Liveness without trusting anyone's clock.
     *
     * Comparing a sender's `ts` with our own Date.now() made every visitor
     * whose clock ran a few seconds behind invisible, and let a forged `ts`
     * look alive forever. What actually proves a peer is here is that its `ts`
     * CHANGED while we were listening, so that is what is tracked, against
     * local receipt time. The sender's clock is only consulted once, for the
     * very first value seen (which may be a stale node replayed on load).
     */
    function livenessTracker(firstSeenTtl) {
        const seen = new Map(); // id -> { ts, at }
        return {
            /** @returns {boolean} true when this update is evidence of life */
            touch(id, ts) {
                const now = Date.now();
                const prev = seen.get(id);
                if (!prev) {
                    // Bounded: drop the longest-remembered id to make room.
                    if (seen.size >= MAX_TRACKED_IDS) seen.delete(seen.keys().next().value);
                    seen.set(id, { ts: ts, at: now });
                    return Math.abs(now - ts) <= firstSeenTtl;
                }
                if (prev.ts === ts) return false;
                prev.ts = ts;
                prev.at = now;
                return true;
            }
        };
    }

    // Abandoned records are not deleted from here any more: every viewer used
    // to put a null for every stale id it had seen, and the relay forgets live
    // records on its own two minutes after their last update.

    const finite = (v) => typeof v === 'number' && Number.isFinite(v);
    const clampOffset = (v) => Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, Math.round(v)));
    const validAnchor = (a) => typeof a === 'string' && a.length > 0 && a.length < MAX_ANCHOR_LEN;

    // ------------------------------------------------------------------
    // Render layer
    // ------------------------------------------------------------------
    // Anchor rects come from getBoundingClientRect(), which is viewport
    // relative - so the layer must be fixed, not absolutely positioned in body.
    const layer = document.createElement('div');
    layer.id = 'cursor-layer';
    layer.classList.toggle('cursors-hidden', cursorsHidden);
    document.body.appendChild(layer);

    // The online pill doubles as the way into reactions and cursor settings:
    // it is the one piece of multiplayer UI that is always on screen.
    const onlineCountEl = document.createElement('button');
    onlineCountEl.type = 'button';
    onlineCountEl.id = 'online-count';
    onlineCountEl.setAttribute('aria-haspopup', 'dialog');
    onlineCountEl.setAttribute('aria-expanded', 'false');
    document.body.appendChild(onlineCountEl);

    // peerId -> { a, ox, oy, lastSeen, el, positioned }
    const peers = new Map();

    // ------------------------------------------------------------------
    // Anchor resolution
    // ------------------------------------------------------------------

    function anchorSelector(key) {
        // Attribute values are quoted, so only quotes and backslashes need escaping.
        return '[data-cursor-anchor="' + String(key).replace(/[\\"]/g, '\\$&') + '"]';
    }

    /**
     * Find the local element for an anchor key.
     *
     * The hidden #window-contents template holds a clone of every app's markup,
     * so a naive querySelector can match an invisible copy. Anything with a
     * zero-sized rect is skipped, which excludes display:none subtrees.
     */
    function resolveAnchor(key) {
        if (!key) return null;
        const matches = document.querySelectorAll(anchorSelector(key));
        for (let i = 0; i < matches.length; i++) {
            const rect = matches[i].getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) return rect;
        }
        return null;
    }

    /** Nearest anchored ancestor of the element under the pointer. */
    function anchorFor(target) {
        const el = target && target.closest ? target.closest('[data-cursor-anchor]') : null;
        if (el) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                return { key: el.dataset.cursorAnchor, rect: rect };
            }
        }
        const desktop = document.getElementById('desktop');
        if (!desktop) return null;
        return { key: 'desktop', rect: desktop.getBoundingClientRect() };
    }

    // ------------------------------------------------------------------
    // Publishing
    // ------------------------------------------------------------------

    let lastPayload = '';
    let pointer = null;      // newest position, waiting for the next sample
    let lastPointer = null;  // last position sampled, re-sent when someone arrives
    let samples = [];        // sampled since the last send
    let sampleTimer = null;
    let sendTimer = null;
    let lastSendAt = 0;

    /** Our own multiplayer chrome is not something to point at. */
    function isOwnChrome(target) {
        return !!(target && target.closest && target.closest('#online-count, #reactions-popover'));
    }

    /** Anyone to show the cursor to? Most visits are alone; then nothing is sent. */
    function othersHere() {
        const now = Date.now();
        for (const [id, at] of presentPeers) {
            if (id !== myId && now - at <= PRESENCE_TTL_MS) return true;
        }
        return false;
    }

    const streaming = () => publishesCursor() && !load.slow && othersHere();

    const viewportPos = (v, size) => Math.max(0, Math.min(1000, Math.round(v / Math.max(1, size) * 1000)));

    function onPointerMove(e) {
        if (isOwnChrome(e.target)) return;
        pointer = { target: e.target, x: e.clientX, y: e.clientY };
        if (!sampleTimer) takeSample();
    }

    // Runs every SAMPLE_MS while the pointer moves and stops once it rests,
    // after taking the resting position: the last sample is always the
    // newest move, so a parked cursor ends exactly where it stopped.
    function takeSample() {
        sampleTimer = null;
        const p = pointer;
        if (!p) return;
        pointer = null;
        sampleTimer = setTimeout(takeSample, SAMPLE_MS);

        const anchor = anchorFor(p.target);
        if (!anchor) return;
        // Tracked even when not shared, so a reaction lands where the pointer is.
        lastAnchor = anchor;
        lastClient = { x: p.x, y: p.y };
        lastPointer = p;
        if (!streaming()) {
            samples = [];
            return;
        }
        samples.push({
            a: anchor.key,
            // Real pixels inside the anchor - not normalized. Identical CSS box
            // sizes make this exact for icons, the widget and the sticky note.
            ox: Math.round(p.x - anchor.rect.left),
            oy: Math.round(p.y - anchor.rect.top),
            nx: viewportPos(p.x, window.innerWidth),
            ny: viewportPos(p.y, window.innerHeight),
            t: Date.now()
        });
        if (!sendTimer) sendTimer = setTimeout(send, Math.max(0, lastSendAt + SEND_MS - Date.now()));
    }

    function send() {
        sendTimer = null;
        if (!samples.length || !streaming()) {
            samples = [];
            return;
        }
        const last = samples[samples.length - 1];
        // The way here, as "ox,oy,ms before the final point" on the same anchor.
        const trail = samples.slice(0, -1)
            .filter((s) => s.a === last.a)
            .slice(-MAX_TRAIL)
            .map((s) => s.ox + ',' + s.oy + ',' + (last.t - s.t))
            .join(';');
        samples = [];

        // Skip redundant writes when the pointer is parked.
        const signature = last.a + ':' + last.ox + ':' + last.oy;
        if (signature === lastPayload && !trail) return;
        lastPayload = signature;
        lastSendAt = Date.now();
        // `tr` is always written, or the previous trail would replay again.
        cursorsRef.get(myId).put({ a: last.a, ox: last.ox, oy: last.oy, nx: last.nx, ny: last.ny, tr: trail, ts: lastSendAt });
    }

    /** Someone just arrived: show them where this cursor is without waiting for a move. */
    function resendPosition() {
        if (!lastPointer || !lastPointer.target.isConnected) return;
        lastPayload = '';
        pointer = lastPointer;
        if (!sampleTimer) takeSample();
    }

    // ------------------------------------------------------------------
    // Reactions
    // Press a key, burst an emoji at your cursor for everybody in the room.
    // Rides the same anchor scheme as cursors, so a reaction dropped on a
    // project card lands on that card for every viewer.
    // ------------------------------------------------------------------

    const REACTION_KEYS = {
        '1': '❤️', '2': '🔥', '3': '😂', '4': '🎉', '5': '👀',
        '6': '🤯', '7': '👍', '8': '💀'
    };
    const REACTION_NAMES = {
        '1': 'Heart', '2': 'Fire', '3': 'Laughing', '4': 'Party', '5': 'Eyes',
        '6': 'Mind blown', '7': 'Thumbs up', '8': 'Skull'
    };
    // What a peer sends is rendered as text, so only these are ever drawn.
    const ALLOWED_REACTIONS = new Set(Object.values(REACTION_KEYS));
    const REACTION_COOLDOWN_MS = 350;
    const REACTION_LIFETIME_MS = 2200;
    // Receive-side limits. Sender ids are self-declared, so the per-sender
    // limit alone could be dodged with fresh ids - hence the global one.
    const REACTION_WINDOW_MS = 2000;
    const REACTIONS_PER_SENDER = 5;
    const REACTIONS_PER_WINDOW = 14;

    let lastReactionAt = 0;
    let lastAnchor = null;
    let lastClient = null;

    const reactionLive = livenessTracker(REACTION_LIFETIME_MS);
    const reactionTimes = new Map(); // senderId -> recent receipt times
    let reactionTimesAll = [];

    function reactionAllowed(id) {
        const now = Date.now();
        reactionTimesAll = reactionTimesAll.filter((t) => now - t < REACTION_WINDOW_MS);
        if (reactionTimesAll.length >= REACTIONS_PER_WINDOW) return false;

        const mine = (reactionTimes.get(id) || []).filter((t) => now - t < REACTION_WINDOW_MS);
        if (mine.length >= REACTIONS_PER_SENDER) return false;

        mine.push(now);
        if (reactionTimes.size > 200) reactionTimes.clear();
        reactionTimes.set(id, mine);
        reactionTimesAll.push(now);
        return true;
    }

    function sendReaction(emoji) {
        const now = Date.now();
        if (now - lastReactionAt < REACTION_COOLDOWN_MS) return;
        lastReactionAt = now;

        // Fall back to the desktop centre if the pointer has not moved yet
        let anchor = lastAnchor;
        let client = lastClient;
        if (!anchor) {
            const desktop = document.getElementById('desktop');
            if (!desktop) return;
            const rect = desktop.getBoundingClientRect();
            anchor = { key: 'desktop', rect: rect };
            client = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }

        const payload = {
            e: emoji,
            a: anchor.key,
            ox: Math.round(client.x - anchor.rect.left),
            oy: Math.round(client.y - anchor.rect.top),
            ts: now
        };

        // One node per visitor, overwritten on each press. A fresh key per
        // press left a tombstone behind every time, and every new visitor had
        // to be sent all of them.
        reactionsRef.get(myId).put(payload);
        spawnReaction(payload); // instant local feedback, no relay round-trip
    }

    function spawnReaction(data) {
        const rect = resolveAnchor(data.a);
        if (!rect) return;

        const el = document.createElement('div');
        el.className = 'cursor-reaction';
        el.setAttribute('aria-hidden', 'true');
        el.textContent = data.e;
        // Randomised drift so simultaneous reactions do not perfectly overlap
        el.style.setProperty('--drift', (Math.random() * 44 - 22).toFixed(1) + 'px');
        el.style.setProperty('--spin', (Math.random() * 28 - 14).toFixed(1) + 'deg');
        el.style.left = Math.round(rect.left + data.ox) + 'px';
        el.style.top = Math.round(rect.top + data.oy) + 'px';

        layer.appendChild(el);
        setTimeout(() => el.remove(), REACTION_LIFETIME_MS);
    }

    function setupReactions() {
        window.addEventListener('keydown', (e) => {
            if (e.metaKey || e.ctrlKey || e.altKey) return;

            // Never steal a keystroke from something the user is typing into
            const t = e.target;
            if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;

            const emoji = REACTION_KEYS[e.key];
            if (!emoji) return;
            sendReaction(emoji);
        });

        reactionsRef.map().on((data, id) => {
            if (id === myId || !data) return; // own presses are shown locally

            // Anything that is not one of our eight emoji at a sane anchor is
            // dropped: this text is drawn over other people's screens.
            if (!ALLOWED_REACTIONS.has(data.e) || !validAnchor(data.a)) return;
            if (!finite(data.ox) || !finite(data.oy)) return;

            // `ts` is unique per press (see the cooldown) and is the last
            // field Gun applies, so by the time it changes the rest of the
            // node belongs to the same press.
            if (!reactionLive.touch(id, Number(data.ts) || 0)) return;
            if (!reactionAllowed(id)) return;

            spawnReaction({
                e: data.e,
                a: data.a,
                ox: clampOffset(data.ox),
                oy: clampOffset(data.oy)
            });
        });
    }

    // ------------------------------------------------------------------
    // Positioning
    // ------------------------------------------------------------------

    let renderQueued = false;
    let renderInstant = false;

    /**
     * @param {boolean} instant - true when a LOCAL layout change moved the
     *   anchor (window drag, resize, scroll). The peer did not move, so the
     *   cursor must snap with the layout instead of sliding after it.
     */
    function scheduleRender(instant) {
        // Nothing to place. This runs on every scroll, resize and window
        // mutation, and most visits never have a second person on the site.
        if (!peers.size) return;
        if (instant) renderInstant = true;
        if (renderQueued) return;
        renderQueued = true;
        requestAnimationFrame(() => {
            renderQueued = false;
            const wasInstant = renderInstant;
            renderInstant = false;
            positionAll(wasInstant);
        });
    }

    function positionAll(instant) {
        layer.classList.toggle('is-instant', !!instant);

        const now = Date.now();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        // getBoundingClientRect forces layout, and peers frequently share an
        // anchor - resolve each key at most once per frame.
        const rectCache = new Map();
        const rectFor = (key) => {
            if (rectCache.has(key)) return rectCache.get(key);
            const rect = resolveAnchor(key);
            rectCache.set(key, rect);
            return rect;
        };

        let replaying = false;
        peers.forEach((peer, id) => {
            if (now - peer.lastSeen > CURSOR_TTL_MS) {
                removePeer(id);
                return;
            }

            // Step through the replayed trail: each point is due at its time.
            while (peer.queue.length && peer.queue[0].at <= now) Object.assign(peer, peer.queue.shift());
            if (peer.queue.length) replaying = true;

            let x;
            let y;
            const rect = peer.a !== 'desktop' ? rectFor(peer.a) : null;
            if (rect) {
                // Clamp inside sized anchors.
                x = Math.min(rect.right, Math.max(rect.left, rect.left + peer.ox));
                y = Math.min(rect.bottom, Math.max(rect.top, rect.top + peer.oy));
                peer.el.classList.remove('is-orphaned');
            } else if (peer.nx != null) {
                // The wallpaper, or something this viewer does not have open
                // (another page, a closed window): the same spot on screen,
                // dimmed when it is not just the desktop.
                x = peer.nx / 1000 * vw;
                y = peer.ny / 1000 * vh;
                peer.el.classList.toggle('is-orphaned', peer.a !== 'desktop');
            } else {
                // An older client without a viewport position.
                const desk = rectFor('desktop');
                if (peer.a !== 'desktop' || !desk) {
                    peer.el.classList.add('is-orphaned');
                    peer.el.hidden = !peer.positioned;
                    return;
                }
                x = desk.left + peer.ox;
                y = desk.top + peer.oy;
                peer.el.classList.remove('is-orphaned');
            }
            peer.el.hidden = false;
            peer.positioned = true;

            peer.el.style.transform =
                'translate3d(' + Math.round(Math.min(vw - 4, Math.max(0, x))) + 'px,' +
                Math.round(Math.min(vh - 4, Math.max(0, y))) + 'px,0)';
        });
        if (replaying) scheduleRender(false);
    }

    function createPeerElement() {
        const el = document.createElement('div');
        el.className = 'remote-cursor';
        el.innerHTML =
            '<img class="remote-cursor-icon" src="/icons/cursor.svg" width="24" height="24" alt="">';
        layer.appendChild(el);
        return el;
    }

    function removePeer(id) {
        const peer = peers.get(id);
        if (!peer) return;
        peer.el.remove();
        peers.delete(id);
    }

    // ------------------------------------------------------------------
    // Subscriptions
    // ------------------------------------------------------------------

    const cursorLive = livenessTracker(CURSOR_TTL_MS);

    /** "ox,oy,dt;..." from a peer, oldest first, bounded and sanity checked. */
    function parseTrail(tr) {
        if (typeof tr !== 'string' || !tr || tr.length > 400) return [];
        const out = [];
        tr.split(';').slice(0, MAX_TRAIL).forEach((part) => {
            const [ox, oy, dt] = part.split(',').map(Number);
            if (![ox, oy, dt].every(Number.isFinite) || dt < 0 || dt > 1000) return;
            out.push({ ox: clampOffset(ox), oy: clampOffset(oy), dt: dt });
        });
        return out.sort((p, q) => q.dt - p.dt);
    }

    cursorsRef.map().on((data, id) => {
        if (id === myId) return;

        if (!data || !validAnchor(data.a)) {
            removePeer(id);
            return;
        }

        // Only a changed `ts` counts as the peer moving. A replayed or
        // re-delivered node leaves the cursor to expire by receipt time
        // (positionAll removes it after CURSOR_TTL_MS).
        if (!cursorLive.touch(id, Number(data.ts) || 0)) return;

        let peer = peers.get(id);
        if (!peer) {
            // Ids are self-declared, so without a ceiling one script could
            // fill the layer with thousands of elements.
            if (peers.size >= MAX_PEERS) return;
            peer = { el: createPeerElement(), queue: [] };
            peers.set(id, peer);
        }

        const now = Date.now();
        const final = {
            a: data.a,
            ox: finite(data.ox) ? clampOffset(data.ox) : 0,
            oy: finite(data.oy) ? clampOffset(data.oy) : 0,
            nx: finite(data.nx) ? Math.max(0, Math.min(1000, Math.round(data.nx))) : null,
            ny: finite(data.ny) ? Math.max(0, Math.min(1000, Math.round(data.ny))) : null
        };
        if (final.ny == null) final.nx = null;
        // Replay the way here at the speed it was drawn, so the cursor lands
        // on `final` one trail-length after this update arrived.
        const trail = parseTrail(data.tr);
        const span = trail.length ? trail[0].dt : 0;
        peer.queue = trail.map((p) => ({
            a: final.a, ox: p.ox, oy: p.oy, nx: final.nx, ny: final.ny, at: now + span - p.dt
        }));
        peer.queue.push(Object.assign({ at: now + span }, final));
        if (!peer.positioned) Object.assign(peer, peer.queue.shift());
        peer.lastSeen = now;

        scheduleRender(false);
    });

    // ------------------------------------------------------------------
    // "N people looking at this"
    //
    // Peers already broadcast which anchor they are pointing at, so viewer
    // counts need no extra traffic - this is purely a read of the cursor
    // stream we are already receiving.
    // ------------------------------------------------------------------

    const VIEWER_BADGE_CLASS = 'viewer-badge';

    /** Count peers per anchor key, including the anchor's parent window. */
    function viewerCounts() {
        const counts = new Map();
        const now = Date.now();

        peers.forEach((peer) => {
            if (!peer.a || now - peer.lastSeen > CURSOR_TTL_MS) return;
            counts.set(peer.a, (counts.get(peer.a) || 0) + 1);
        });

        return counts;
    }

    let badgesShown = false;

    function refreshViewerBadges() {
        // No peers and nothing left over to clear: skip the DOM queries.
        if (!peers.size && !badgesShown) return;
        const counts = viewerCounts();
        badgesShown = counts.size > 0;

        // Clear badges whose anchor no longer has viewers
        document.querySelectorAll('.' + VIEWER_BADGE_CLASS).forEach((badge) => {
            const key = badge.dataset.forAnchor;
            if (!counts.has(key)) badge.remove();
        });

        counts.forEach((count, key) => {
            // Only content-ish anchors get a badge; a cursor sitting on the
            // wallpaper is not "looking at" anything.
            if (key === 'desktop') return;

            const host = findBadgeHost(key);
            if (!host) return;

            let badge = host.querySelector(':scope > .' + VIEWER_BADGE_CLASS);
            if (!badge) {
                badge = document.createElement('span');
                badge.className = VIEWER_BADGE_CLASS;
                badge.dataset.forAnchor = key;
                host.appendChild(badge);
            }
            badge.textContent = count === 1 ? '1 viewing' : count + ' viewing';
            badge.dataset.forAnchor = key;
        });
    }

    /** The element a badge should be attached to for a given anchor key. */
    function findBadgeHost(key) {
        const matches = document.querySelectorAll(anchorSelector(key));
        for (let i = 0; i < matches.length; i++) {
            const el = matches[i];
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;

            // For windows, hang the badge off the titlebar so it does not sit
            // on top of content.
            if (key.startsWith('win:') || key.startsWith('page:')) {
                return el.querySelector('.window-titlebar') || el;
            }
            return el;
        }
        return null;
    }

    // ------------------------------------------------------------------
    // Presence - the online count must not depend on people wiggling a mouse
    // ------------------------------------------------------------------

    const presentPeers = new Map(); // id -> local time its last beat arrived
    const peerNicks = new Map();    // id -> the name they joined IRC Chat with ('' for a guest)
    const presenceLive = livenessTracker(PRESENCE_TTL_MS);
    const MAX_NICK = 10;            // same cap as the IRC app
    let lastCount = 0;
    // The pill's popover and its people list (built on first open, see buildPopover)
    let popover = null;
    let peopleList = null;

    /** The name this visitor joined IRC Chat with (assets/js/irc-chat.js keeps it), or ''. */
    function myNick() {
        let nick = '';
        try { nick = localStorage.getItem('irc_nick') || ''; } catch (e) { /* storage blocked */ }
        return cleanNick(nick);
    }

    function cleanNick(nick) {
        return typeof nick === 'string' ? nick.trim().slice(0, MAX_NICK) : '';
    }

    let announcedPage = null;

    /** The beat carries the name, so the online list can show who is who
        (always sent, so a name that was cleared clears for everyone too),
        and the page, so a post can say how many are reading it. */
    function announcePresence() {
        announcedPage = currentPage();
        presenceRef.get(myId).put({ ts: Date.now(), nick: myNick(), p: announcedPage });
    }

    /** Moving to another page (or focusing another window) says so at once. */
    function announceIfMoved() {
        if (announcedPage !== null && currentPage() !== announcedPage) announcePresence();
    }

    function updateOnlineCount() {
        const now = Date.now();
        let count = 1; // this viewer
        presentPeers.forEach((at, id) => {
            if (now - at > PRESENCE_TTL_MS) {
                presentPeers.delete(id);
                return;
            }
            if (id !== myId) count++;
        });
        if (count === lastCount) return;
        // The first other person arrived: show them where this cursor is.
        if (count > 1 && lastCount <= 1) resendPosition();
        lastCount = count;
        onlineCountEl.textContent = count + ' Online';
        onlineCountEl.setAttribute('aria-label',
            count + ' online. Who is here, reactions and cursor settings');
        refreshPeople();
    }

    presenceRef.map().on((data, id) => {
        if (id === myId) return;
        if (!data || !data.ts) {
            presentPeers.delete(id);
            peerNicks.delete(id);
            updateOnlineCount();
            refreshPeople();
            return;
        }
        // A beat only counts when it is new to us - see livenessTracker.
        if (!presenceLive.touch(id, Number(data.ts) || 0)) return;
        if (presentPeers.size >= MAX_TRACKED_IDS && !presentPeers.has(id)) return;
        presentPeers.set(id, Date.now());
        const nick = cleanNick(data.nick);
        if (peerNicks.get(id) !== nick) {
            peerNicks.set(id, nick);
            refreshPeople();
        }
        updateOnlineCount();
    });

    updateOnlineCount();

    // ------------------------------------------------------------------
    // Local layout changes move anchors while peers stand still
    // ------------------------------------------------------------------

    window.addEventListener('resize', () => scheduleRender(true));
    // Capture phase so inner scrollers (window content, finder lists) are caught.
    window.addEventListener('scroll', () => scheduleRender(true), true);

    // Window drags, resizes, maximize and minimize all mutate inline styles.
    // rAF coalescing keeps this to one reposition per frame during a drag.
    //
    // Only the window elements themselves are watched (plus windows being
    // added or removed). Watching the whole subtree fired for every DOM change
    // inside every app - a chat message, a terminal line - none of which move
    // an anchor's box in a way the scroll/resize listeners do not already see.
    const windowsContainer = document.getElementById('windows-container');
    if (windowsContainer && 'MutationObserver' in window) {
        const windowObserver = new MutationObserver(() => scheduleRender(true));
        const watchWindow = (el) => {
            if (el.nodeType !== 1) return;
            windowObserver.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
        };
        Array.prototype.forEach.call(windowsContainer.children, watchWindow);

        new MutationObserver((records) => {
            records.forEach((r) => r.addedNodes.forEach(watchWindow));
            scheduleRender(true);
        }).observe(windowsContainer, { childList: true });
    }

    // ------------------------------------------------------------------
    // Reactions and settings popover, opened from the online pill
    //
    // Keys 1-8 were the only way to react, which nobody could discover and a
    // touch screen could not do at all.
    // ------------------------------------------------------------------

    /**
     * Who is online: everyone who joined IRC Chat by name, this visitor
     * marked "(you)", and the rest folded into one "guests" row. A guest
     * gets a nudge to pick a name, which opens IRC Chat.
     */
    function refreshPeople() {
        if (!peopleList || !popover || popover.hidden) return;
        const now = Date.now();
        const named = [];
        let guests = 0;
        presentPeers.forEach((at, id) => {
            if (id === myId || now - at > PRESENCE_TTL_MS) return;
            const nick = peerNicks.get(id) || '';
            if (nick) named.push(nick);
            else guests++;
        });
        named.sort((a, b) => a.localeCompare(b));

        peopleList.textContent = '';
        const row = (text, cls) => {
            const li = document.createElement('li');
            li.className = 'people-row' + (cls ? ' ' + cls : '');
            li.textContent = text;
            peopleList.appendChild(li);
            return li;
        };

        const mine = myNick();
        if (mine) {
            row(mine + ' (you)', 'is-you');
        } else {
            const li = row('', 'is-you is-guest');
            li.appendChild(document.createTextNode('You, as a guest '));
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'people-name-btn';
            btn.textContent = 'Pick a name';
            btn.title = 'Join IRC Chat with a name and it shows here';
            btn.addEventListener('click', () => {
                closePopover();
                const shell = window.SiteShell;
                if (shell && shell.isDesktop && shell.openApp('irc-chat', onlineCountEl, 'presence')) return;
                window.location.href = '/?open=irc-chat';
            });
            li.appendChild(btn);
        }
        named.forEach((nick) => row(nick));
        if (guests) row(guests === 1 ? '1 guest' : guests + ' guests', 'is-guests');
    }

    function setCursorsHidden(hidden) {
        cursorsHidden = hidden;
        if (hidden) store.set(HIDE_CURSORS_KEY, '1');
        else store.remove(HIDE_CURSORS_KEY);
        layer.classList.toggle('cursors-hidden', hidden);
        lastPayload = '';
        // Hiding is mutual: stop sharing ours as well.
        if (hidden) cursorsRef.get(myId).put(null);
    }

    function buildPopover() {
        const el = document.createElement('div');
        el.id = 'reactions-popover';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-label', 'Reactions');
        el.hidden = true;

        const people = document.createElement('div');
        people.className = 'people';
        const title = document.createElement('div');
        title.className = 'people-title';
        title.textContent = 'Online';
        people.appendChild(title);
        peopleList = document.createElement('ul');
        peopleList.className = 'people-list';
        people.appendChild(peopleList);
        el.appendChild(people);

        const row = document.createElement('div');
        row.className = 'reactions-row';
        Object.keys(REACTION_KEYS).forEach((key) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'reaction-btn';
            btn.textContent = REACTION_KEYS[key];
            btn.setAttribute('aria-label', REACTION_NAMES[key] + ' reaction');
            btn.addEventListener('click', () => sendReaction(REACTION_KEYS[key]));
            row.appendChild(btn);
        });
        el.appendChild(row);

        const hint = document.createElement('p');
        hint.className = 'reactions-hint';
        hint.textContent = 'Everyone online sees it.';
        const keys = document.createElement('span');
        keys.className = 'reactions-keys';
        keys.textContent = ' Or press 1-8 anywhere.';
        hint.appendChild(keys);
        el.appendChild(hint);

        const label = document.createElement('label');
        label.className = 'reactions-toggle';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = cursorsHidden;
        box.addEventListener('change', () => setCursorsHidden(box.checked));
        label.appendChild(box);
        label.appendChild(document.createTextNode(' Hide cursors'));
        el.appendChild(label);

        // Keep the shell's shortcuts and window focus handling out of it
        el.addEventListener('mousedown', (e) => e.stopPropagation());
        document.body.appendChild(el);
        return el;
    }

    function closePopover() {
        if (!popover || popover.hidden) return;
        popover.hidden = true;
        onlineCountEl.setAttribute('aria-expanded', 'false');
    }

    function openPopover() {
        if (!popover) popover = buildPopover();
        // Anchored to wherever the stylesheet has put the pill.
        const rect = onlineCountEl.getBoundingClientRect();
        popover.style.left = Math.max(4, Math.round(rect.left)) + 'px';
        popover.style.bottom = Math.round(window.innerHeight - rect.top + 6) + 'px';
        popover.hidden = false;
        onlineCountEl.setAttribute('aria-expanded', 'true');
        refreshPeople();
    }

    onlineCountEl.addEventListener('click', () => {
        if (popover && !popover.hidden) closePopover();
        else openPopover();
    });
    onlineCountEl.addEventListener('mousedown', (e) => e.stopPropagation());

    document.addEventListener('pointerdown', (e) => {
        if (isOwnChrome(e.target)) return;
        closePopover();
        // Remember where a tap landed so a reaction sent from the popover
        // goes there, on devices that never publish a cursor position.
        const anchor = anchorFor(e.target);
        if (anchor) {
            lastAnchor = anchor;
            lastClient = { x: e.clientX, y: e.clientY };
        }
    }, true);

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !popover || popover.hidden) return;
        closePopover();
        onlineCountEl.focus();
    });

    // Reactions work on every device, including ones with no cursor to publish
    setupReactions();

    if (hasFinePointer) {
        window.addEventListener('mousemove', onPointerMove, { passive: true });
    }

    // ------------------------------------------------------------------
    // Timers only run while the tab is visible
    //
    // A background tab has nobody looking at it: it should not keep writing a
    // presence beat every few seconds, and it should not be counted as online.
    // ------------------------------------------------------------------

    let timers = [];

    let beatTimer = null;

    function leave() {
        // Best effort removal. Staleness is the real guarantee.
        cursorsRef.get(myId).put(null);
        presenceRef.get(myId).put(null);
        announcedPage = null;
        lastPayload = '';
        samples = [];
    }

    function beat() {
        announcePresence();
        beatTimer = setTimeout(beat, load.slow ? SLOW_BEAT_MS : PRESENCE_BEAT_MS);
    }

    function startTimers() {
        if (timers.length) return;
        beat();
        updateOnlineCount();
        timers = [
            setInterval(() => {
                updateOnlineCount();
                // Drop expired cursors even when no updates are arriving.
                scheduleRender(false);
            }, 2000),
            // Viewer badges change slowly; a 1s cadence is plenty and keeps
            // the DOM work off the cursor render path.
            setInterval(() => {
                refreshViewerBadges();
                announceIfMoved();
            }, 1000)
        ];
    }

    function stopTimers() {
        timers.forEach(clearInterval);
        timers = [];
        clearTimeout(beatTimer);
        beatTimer = null;
    }

    // A slow day stretches the beat from the next one on; the cursor stream
    // checks load.slow before every send.
    load.onChange(() => {
        if (!beatTimer) return;
        clearTimeout(beatTimer);
        beatTimer = setTimeout(beat, load.slow ? SLOW_BEAT_MS : PRESENCE_BEAT_MS);
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopTimers();
            leave();
        } else {
            startTimers();
        }
    });

    // Fires synchronously; anything queued behind a timer here would never
    // run, which is why the old version's delayed cleanup was dead code.
    window.addEventListener('pagehide', leave);

    if (!document.hidden) startTimers();
})();
