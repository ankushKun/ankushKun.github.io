(function () {
    'use strict';

    // Primary relay plus a public fallback, so one relay going down does not
    // take every realtime feature offline with it.
    const GUN_RELAY = 'https://gun.ankush.one/gun';
    const GUN_FALLBACK_RELAYS = ['https://relay.peer.ooo/gun'];
    const ROOT = 'ankush-one';

    function getGun() {
        if (!window.__siteGun) {
            window.__siteGun = Gun({ peers: [GUN_RELAY].concat(GUN_FALLBACK_RELAYS) });
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
        gun.on('hi', () => {
            if (!state.connected) { state.connected = true; emit(); }
        });
        gun.on('bye', () => {
            // Only report a drop once no peer remains connected.
            const peers = gun.back('opt.peers') || {};
            const anyOpen = Object.keys(peers).some((k) => {
                const wire = peers[k] && peers[k].wire;
                return wire && wire.readyState === 1;
            });
            if (state.connected && !anyOpen) { state.connected = false; emit(); }
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
        },
        apps: {
            ircMessages: (channel = 'general') =>
                gunRoot().get('apps').get('irc').get(channel).get('messages'),
            sticky: () => gunRoot().get('apps').get('sticky').get('shared'),
            guestbook: () => gunRoot().get('apps').get('guestbook').get('entries'),
            paintStrokes: (board = 'main') =>
                gunRoot().get('apps').get('paint').get(board).get('strokes'),
            paintMeta: (board = 'main') =>
                gunRoot().get('apps').get('paint').get(board).get('meta'),
        },
    };

    window.SiteGun = { getGun, paths, roomKey, getConnection, GUN_RELAY, ROOT };
})();
