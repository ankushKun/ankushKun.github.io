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
 */
(function () {
    'use strict';

    if (!window.SiteGun) return;

    const ROOM = window.SiteGun.roomKey();
    const MOVE_THROTTLE_MS = 70;      // ~14 updates/sec
    const PRESENCE_BEAT_MS = 5000;
    const CURSOR_TTL_MS = 6000;       // hide a cursor we stopped hearing from
    const PRESENCE_TTL_MS = 15000;    // count someone as online this long after a beat
    const GRAPH_PRUNE_MS = 60000;     // delete truly abandoned nodes from the graph

    // Cursors are a pointing device; a touch screen has nothing to broadcast.
    // Presence still runs so the online count stays honest on mobile.
    const publishesCursor = !window.matchMedia('(max-width: 768px)').matches;

    const cursorsRef = window.SiteGun.paths.live.cursors(ROOM);
    const presenceRef = window.SiteGun.paths.live.presence(ROOM);
    const reactionsRef = window.SiteGun.paths.live.reactions(ROOM);

    let myId = localStorage.getItem('multiplayer-cursor-id');
    if (!myId) {
        myId = Math.random().toString(36).slice(2, 11);
        localStorage.setItem('multiplayer-cursor-id', myId);
    }

    // ------------------------------------------------------------------
    // Render layer
    // ------------------------------------------------------------------
    // Anchor rects come from getBoundingClientRect(), which is viewport
    // relative - so the layer must be fixed, not absolutely positioned in body.
    const layer = document.createElement('div');
    layer.id = 'cursor-layer';
    document.body.appendChild(layer);

    const onlineCountEl = document.createElement('div');
    onlineCountEl.id = 'online-count';
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

    let lastSent = 0;
    let lastPayload = '';

    function publishPosition(e) {
        const now = Date.now();
        if (now - lastSent < MOVE_THROTTLE_MS) return;

        const anchor = anchorFor(e.target);
        if (!anchor) return;

        // Real pixels inside the anchor - not normalized. Identical CSS box
        // sizes make this exact for icons, the widget and the sticky note.
        const payload = {
            a: anchor.key,
            ox: Math.round(e.clientX - anchor.rect.left),
            oy: Math.round(e.clientY - anchor.rect.top),
            ts: now
        };

        // Skip redundant writes when the pointer is parked.
        const signature = payload.a + ':' + payload.ox + ':' + payload.oy;
        if (signature === lastPayload) return;

        lastSent = now;
        lastPayload = signature;
        lastAnchor = anchor;
        lastClient = { x: e.clientX, y: e.clientY };
        cursorsRef.get(myId).put(payload);
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
    const REACTION_COOLDOWN_MS = 350;
    const REACTION_LIFETIME_MS = 2200;

    let lastReactionAt = 0;
    let lastAnchor = null;
    let lastClient = null;
    const seenReactions = new Set();

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
            ts: now,
            // Distinguishes rapid repeats of the same emoji at the same spot
            id: myId + '-' + now
        };

        reactionsRef.get(payload.id).put(payload);
        spawnReaction(payload); // instant local feedback, no relay round-trip
        seenReactions.add(payload.id);
    }

    function spawnReaction(data) {
        const rect = resolveAnchor(data.a);
        if (!rect) return;

        const el = document.createElement('div');
        el.className = 'cursor-reaction';
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
            if (!data || !data.e || !data.a) return;
            if (seenReactions.has(id)) return;
            seenReactions.add(id);

            const age = Date.now() - (data.ts || 0);
            if (age > REACTION_LIFETIME_MS) {
                // Reactions are momentary; do not let them accumulate in the graph
                if (age > GRAPH_PRUNE_MS) reactionsRef.get(id).put(null);
                return;
            }

            spawnReaction(data);
        });

        // Bound the local dedupe set
        setInterval(() => {
            if (seenReactions.size > 300) seenReactions.clear();
        }, 30000);
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

        peers.forEach((peer, id) => {
            if (now - peer.lastSeen > CURSOR_TTL_MS) {
                removePeer(id);
                return;
            }

            const rect = rectFor(peer.a);

            if (!rect) {
                // The peer is pointing at something this viewer does not have
                // open. Park it rather than teleporting it somewhere wrong -
                // and stay hidden if it has never had a valid position, so it
                // does not appear stuck in the top-left corner.
                peer.el.classList.add('is-orphaned');
                peer.el.hidden = !peer.positioned;
                return;
            }
            peer.el.classList.remove('is-orphaned');
            peer.el.hidden = false;
            peer.positioned = true;

            let x = rect.left + peer.ox;
            let y = rect.top + peer.oy;

            // Clamp inside sized anchors; the desktop fallback is free to roam
            // (a peer can be over the menubar, which sits above the desktop).
            if (peer.a !== 'desktop') {
                x = Math.min(rect.right, Math.max(rect.left, x));
                y = Math.min(rect.bottom, Math.max(rect.top, y));
            }

            peer.el.style.transform =
                'translate3d(' + Math.round(Math.min(vw - 4, Math.max(0, x))) + 'px,' +
                Math.round(Math.min(vh - 4, Math.max(0, y))) + 'px,0)';
        });
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

    cursorsRef.map().on((data, id) => {
        if (id === myId) return;

        if (!data || typeof data.a !== 'string') {
            removePeer(id);
            return;
        }

        const age = Date.now() - (data.ts || 0);

        if (age > CURSOR_TTL_MS) {
            // Prune nodes nobody has touched in a long time so the graph does
            // not grow without bound.
            if (age > GRAPH_PRUNE_MS) cursorsRef.get(id).put(null);
            removePeer(id);
            return;
        }

        let peer = peers.get(id);
        if (!peer) {
            peer = { el: createPeerElement() };
            peers.set(id, peer);
        }

        peer.a = data.a;
        peer.ox = typeof data.ox === 'number' ? data.ox : 0;
        peer.oy = typeof data.oy === 'number' ? data.oy : 0;
        peer.lastSeen = Date.now();

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

    function refreshViewerBadges() {
        const counts = viewerCounts();

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
            if (key.startsWith('win:')) {
                return el.querySelector('.window-titlebar') || el;
            }
            return el;
        }
        return null;
    }

    // ------------------------------------------------------------------
    // Presence - the online count must not depend on people wiggling a mouse
    // ------------------------------------------------------------------

    const presentPeers = new Map(); // id -> lastBeat

    function announcePresence() {
        presenceRef.get(myId).put({ ts: Date.now() });
    }

    function updateOnlineCount() {
        const now = Date.now();
        let count = 1; // this viewer
        presentPeers.forEach((ts, id) => {
            if (now - ts > PRESENCE_TTL_MS) {
                presentPeers.delete(id);
                return;
            }
            if (id !== myId) count++;
        });
        onlineCountEl.textContent = count + ' Online';
    }

    presenceRef.map().on((data, id) => {
        if (!data || !data.ts) {
            presentPeers.delete(id);
            updateOnlineCount();
            return;
        }
        if (Date.now() - data.ts > PRESENCE_TTL_MS) {
            if (Date.now() - data.ts > GRAPH_PRUNE_MS) presenceRef.get(id).put(null);
            presentPeers.delete(id);
            updateOnlineCount();
            return;
        }
        presentPeers.set(id, data.ts);
        updateOnlineCount();
    });

    announcePresence();
    setInterval(announcePresence, PRESENCE_BEAT_MS);
    setInterval(updateOnlineCount, 2000);
    updateOnlineCount();

    // ------------------------------------------------------------------
    // Local layout changes move anchors while peers stand still
    // ------------------------------------------------------------------

    window.addEventListener('resize', () => scheduleRender(true));
    // Capture phase so inner scrollers (window content, finder lists) are caught.
    window.addEventListener('scroll', () => scheduleRender(true), true);

    // Window drags, resizes, maximize and minimize all mutate inline styles.
    // rAF coalescing keeps this to one reposition per frame during a drag.
    const windowsContainer = document.getElementById('windows-container');
    if (windowsContainer && 'MutationObserver' in window) {
        new MutationObserver(() => scheduleRender(true)).observe(windowsContainer, {
            attributes: true,
            attributeFilter: ['style', 'class'],
            subtree: true,
            childList: true
        });
    }

    // Prune expired cursors even when no updates are arriving.
    setInterval(() => scheduleRender(false), 2000);

    // Viewer badges change slowly; a 1s cadence is plenty and keeps the
    // DOM work off the cursor render path.
    setInterval(refreshViewerBadges, 1000);

    // Reactions work on every device, including ones with no cursor to publish
    setupReactions();

    if (publishesCursor) {
        window.addEventListener('mousemove', publishPosition, { passive: true });

        // Best effort removal. Fires synchronously; anything queued behind a
        // timer here would never run, which is why the old version's delayed
        // cleanup was dead code. Staleness is the real guarantee.
        window.addEventListener('pagehide', () => {
            cursorsRef.get(myId).put(null);
            presenceRef.get(myId).put(null);
        });
    }
})();
