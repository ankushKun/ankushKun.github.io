(function () {
    'use strict';

    // One relay, our own. (There used to be a public fallback; it meant a
    // third party saw every visitor's IP, so it is gone. If gun.ankush.one is
    // down the realtime features wait for it, see the revive loop below.)
    const GUN_RELAY = 'https://gun.ankush.one/gun';
    const ROOT = 'ankush-one';
    const RELAYS = [GUN_RELAY];
    const REVIVE_MIN_MS = 4000;   // after Gun's own single retry has had its turn
    const REVIVE_MAX_MS = 30000;

    /**
     * Storage that never throws. Uses the shell's SiteStore when it has loaded
     * and falls back to guarded localStorage plus an in-memory map, so blocked
     * storage (private mode, strict cookie settings) cannot take realtime down.
     */
    const memStore = {};
    const store = {
        get(key) {
            try {
                const s = window.SiteStore;
                const v = s && s.get ? s.get(key) : localStorage.getItem(key);
                return v == null ? (key in memStore ? memStore[key] : null) : v;
            } catch (e) {
                return key in memStore ? memStore[key] : null;
            }
        },
        set(key, value) {
            memStore[key] = String(value);
            try {
                const s = window.SiteStore;
                if (s && s.set) s.set(key, String(value));
                else localStorage.setItem(key, String(value));
            } catch (e) { /* kept in memory only */ }
        },
        remove(key) {
            delete memStore[key];
            try {
                const s = window.SiteStore;
                if (s && s.remove) s.remove(key);
                else localStorage.removeItem(key);
            } catch (e) { /* ignore */ }
        }
    };

    /** One anonymous id per visitor, shared by cursors, paint and the guestbook. */
    function visitorId() {
        // __siteVisitorId covers apps that had to mint an id before this
        // script loaded while storage was blocked.
        let id = store.get('multiplayer-cursor-id') || window.__siteVisitorId;
        if (!id) id = Math.random().toString(36).slice(2, 11);
        if (store.get('multiplayer-cursor-id') !== id) store.set('multiplayer-cursor-id', id);
        window.__siteVisitorId = id;
        return id;
    }

    function getGun() {
        if (!window.__siteGun) {
            // Nothing here needs offline persistence, and Gun's bundled adapter
            // otherwise re-serialises the whole graph into one localStorage key
            // on the main thread after every put it sees (cursor moves included).
            window.__siteGun = Gun({ peers: RELAYS, localStorage: false });
            // Drop the graph cached by earlier versions of the site.
            try { localStorage.removeItem('gun/'); } catch (e) { /* storage blocked */ }
            // Start watching the connection (and reviving dropped relays)
            // even on pages where nothing asks for its status.
            setTimeout(getConnection, 0);
        }
        return window.__siteGun;
    }

    function gunRoot() {
        return getGun().get(ROOT);
    }

    /**
     * Cursors and presence are scoped per page. Anchor keys ("icon:terminal",
     * "win:about") only mean anything within the page that renders them, and a
     * blog reader should not paint a cursor onto the desktop.
     */
    function roomKey(pathname) {
        const path = pathname || window.location.pathname || '/';
        const key = path.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase();
        return key || 'home';
    }

    /** Live relay connectivity, so the UI can tell the truth about being offline. */
    function connection() {
        const state = { connected: false, listeners: new Set() };

        function emit() {
            state.listeners.forEach((fn) => {
                try { fn(state.connected); } catch (e) { /* ignore */ }
            });
        }

        const gun = getGun();

        // This Gun build forgets a relay as soon as its socket closes and
        // retries it exactly once, about two seconds later. A relay that is
        // away for longer than that was never reconnected - the page stayed
        // "reconnecting" until it was reloaded. So while nothing is connected,
        // keep offering Gun the relays it has dropped, backing off to 30s.
        let reviveTimer = null;
        let reviveDelay = REVIVE_MIN_MS;
        const attempts = {};         // url -> the peer object last handed to Gun

        function revive() {
            reviveTimer = null;
            if (state.connected) return;
            // Gun does not open sockets from a hidden tab either.
            if (!document.hidden) {
                try {
                    const peers = gun.back('opt.peers') || {};
                    const mesh = gun.back('opt.mesh');
                    if (mesh && mesh.hi) {
                        RELAYS.forEach((url) => {
                            if (peers[url]) return;
                            // Still dialling from the last round - leave it be.
                            const last = attempts[url];
                            if (last && last.wire && last.wire.readyState === 0) return;
                            mesh.hi(attempts[url] = { url: url, id: url });
                        });
                    }
                } catch (e) { /* try again next round */ }
                reviveDelay = Math.min(reviveDelay * 2, REVIVE_MAX_MS);
            }
            reviveTimer = setTimeout(revive, reviveDelay);
        }

        // After a reconnect Gun re-asks the relay for everything it had asked
        // for before, which is how a viewer catches up on what was written
        // while it was away. One case slips through: a key that did not exist
        // yet on a node this page already held (the first stroke on a blank
        // board, the first message in a channel). Gun answered that lookup
        // from its own copy, never put it on the re-ask list, and so never
        // learns the key was created in the meantime. Ask for those directly.
        let everConnected = false;
        let catchUpTimer = null;

        function catchUp() {
            catchUpTimer = null;
            try {
                const root = gun._;
                const mesh = gun.back('opt.mesh');
                const graph = root.graph || {};
                if (!mesh || !mesh.say) return;
                // Walk the chains the page has open (they all hang off the
                // site root) alongside the graph, and ask for each key a
                // chain is waiting on that the graph still has no value for.
                let budget = 60;
                const seen = new Set();
                (function walk(at, soul) {
                    if (!at || seen.has(at)) return;
                    seen.add(at);
                    const have = graph[soul] || {};
                    Object.keys(at.next || {}).forEach((key) => {
                        if (!key) return;
                        const value = have[key];
                        if (value === undefined) {
                            if (budget-- > 0) {
                                mesh.say({
                                    '#': Math.random().toString(36).slice(2, 11),
                                    get: { '#': soul, '.': key }
                                });
                            }
                            return;
                        }
                        const child = at.next[key];
                        if (value && typeof value === 'object' && value['#']) {
                            walk(child && (child._ || child), value['#']);
                        }
                    });
                })(root.next && root.next[ROOT], ROOT);
            } catch (e) { /* internals moved: live updates still resume */ }
        }

        gun.on('hi', () => {
            reviveDelay = REVIVE_MIN_MS;
            if (!state.connected) {
                state.connected = true;
                emit();
                // Not on first connect - nothing can have been missed yet.
                // Delayed so Gun's own re-asks go out first.
                if (everConnected && !catchUpTimer) catchUpTimer = setTimeout(catchUp, 800);
                everConnected = true;
            }
        });
        gun.on('bye', () => {
            // Only report a drop once no peer remains connected.
            const peers = gun.back('opt.peers') || {};
            const anyOpen = Object.keys(peers).some((k) => {
                const wire = peers[k] && peers[k].wire;
                return wire && wire.readyState === 1;
            });
            if (state.connected && !anyOpen) { state.connected = false; emit(); }
            if (!anyOpen && !reviveTimer) reviveTimer = setTimeout(revive, reviveDelay);
        });

        return {
            get isConnected() { return state.connected; },
            onChange(fn) {
                state.listeners.add(fn);
                fn(state.connected);
                return () => state.listeners.delete(fn);
            }
        };
    }

    let sharedConnection = null;
    function getConnection() {
        if (!sharedConnection) sharedConnection = connection();
        return sharedConnection;
    }

    const paths = {
        live: {
            cursors: (room) =>
                gunRoot().get('live').get('cursors').get(room || roomKey()),
            presence: (room) =>
                gunRoot().get('live').get('presence').get(room || roomKey()),
            reactions: (room) =>
                gunRoot().get('live').get('reactions').get(room || roomKey()),
            ircPresence: (channel = 'general') =>
                gunRoot().get('live').get('irc').get(channel).get('presence'),
            // Opt-in "listening now" records, one per visitor per UTC day
            // (`day` is YYYY-MM-DD) so the node cannot grow without bound.
            music: (day) =>
                gunRoot().get('live').get('music').get(day || new Date().toISOString().slice(0, 10)),
        },
        apps: {
            ircMessages: (channel = 'general') =>
                gunRoot().get('apps').get('irc').get(channel).get('messages'),
            // One number, overwritten: when the channel last had a message
            // (sender's clock, ms). Drives the unread dot on the IRC icon.
            ircLatest: (channel = 'general') =>
                gunRoot().get('apps').get('irc').get(channel).get('latest'),
            sticky:() => gunRoot().get('apps').get('sticky').get('shared'),
            // `gun` is only passed by the guestbook's read-back check, which
            // uses a second, empty instance to see what the relays really hold.
            guestbook: (gun) =>
                (gun || getGun()).get(ROOT).get('apps').get('guestbook').get('entries'),
            paintStrokes: (board = 'main') =>
                gunRoot().get('apps').get('paint').get(board).get('strokes'),
            paintMeta: (board = 'main') =>
                gunRoot().get('apps').get('paint').get(board).get('meta'),
            // Parent of every board ('main', 'd-YYYY-MM-DD'); its keys are
            // how the Paint gallery learns which days have a canvas.
            paintBoards: () => gunRoot().get('apps').get('paint'),
            // Reactions under a post or project: <reaction>/<visitor id> = true.
            // `key` is roomKey(the page's path), so a desktop window and the
            // article page share one node.
            postReactions: (key) =>
                gunRoot().get('apps').get('reactions').get(key || roomKey()),
            // Leaderboard for one game on one UTC day (`day` is YYYY-MM-DD):
            // <visitor id> = { name, ms, hits, ts }, one row per visitor.
            scores: (day, game = 'daily-puzzle') =>
                gunRoot().get('apps').get('scores').get(game)
                    .get(day || new Date().toISOString().slice(0, 10)),
        },
    };

    window.SiteGun = { getGun, paths, roomKey, getConnection, store, visitorId, GUN_RELAY, ROOT };
})();
