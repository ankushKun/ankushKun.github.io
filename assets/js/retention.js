/**
 * Reasons to come back.
 *
 *  - "New since your last visit": the Recent Activity widget, the Blogs and
 *    Projects icons and their lists only call something new when it is new to
 *    THIS visitor.
 *  - Achievements and the visit streak behind the Passport app
 *    (window.Achievements). Kept in this browser only, never sent anywhere.
 *  - Finds the reaction bar under posts and projects and the guestbook's
 *    "On this day" strip, and fetches their scripts the first time one is
 *    actually on screen.
 *
 * Runs on every page from the idle-loaded bundle, so it stays small and makes
 * no request of its own.
 */
(function () {
    'use strict';

    if (window.Achievements) return;

    const IS_DESKTOP = !!document.getElementById('window-contents');
    const VISIT_KEY = 'site-visit-v1';
    const PASSPORT_KEY = 'site-passport-v1';
    const VISIT_GAP_MS = 30 * 60 * 1000;            // longer away than this = a new visit
    const FIRST_VISIT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
    const MAX_SEEN = 80;

    // ------------------------------------------------------------------
    // Storage (may be blocked: fall back to memory for this page view)
    // ------------------------------------------------------------------

    const mem = {};
    function readJSON(key) {
        let raw = null;
        try {
            raw = window.SiteStore ? window.SiteStore.get(key) : localStorage.getItem(key);
        } catch (e) { /* storage blocked */ }
        if (raw == null) raw = key in mem ? mem[key] : null;
        if (!raw) return {};
        try {
            const value = JSON.parse(raw);
            return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        } catch (e) {
            return {};
        }
    }

    function writeJSON(key, value) {
        const raw = JSON.stringify(value);
        mem[key] = raw;
        try {
            if (window.SiteStore) window.SiteStore.set(key, raw);
            else localStorage.setItem(key, raw);
        } catch (e) { /* kept in memory only */ }
    }

    const num = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : 0);

    // ------------------------------------------------------------------
    // App registry (ids, kinds, titles and sizes from data/apps.yaml)
    // ------------------------------------------------------------------

    const registry = {};
    try {
        const el = document.getElementById('app-registry');
        (el ? JSON.parse(el.textContent) : []).forEach((app) => {
            if (app && app.id) registry[app.id] = app;
        });
    } catch (e) { /* no registry: app-count achievements simply never advance */ }

    function openApp(id) {
        const app = registry[id];
        if (!app || typeof window.openWindow !== 'function') return;
        window.openWindow(id, app.title || id, { width: app.width || 1000, height: app.height || 700 });
    }

    // ------------------------------------------------------------------
    // Achievements
    // ------------------------------------------------------------------

    // `counter` + `goal`: unlocked once that many different things were opened.
    // `secret`: the Passport does not say how until it is unlocked.
    // `icon`: the pictogram on the Passport's entry stamp (assets/js/passport.js),
    // one per stamp. Ids are stored in visitors' browsers: never rename one.
    // The order is the order of the stamp slots on the Passport's visa pages.
    const DEFS = [
        { id: 'welcome-back', title: 'Welcome Back', desc: 'Visit on two different days', pts: 10, icon: 'calendar' },
        { id: 'streak-3', title: 'Regular', desc: 'Visit three days in a row', pts: 25, icon: 'flame' },
        { id: 'streak-7', title: 'Daily Driver', desc: 'Visit seven days in a row', pts: 50, icon: 'wheel' },
        { id: 'explorer', title: 'Window Shopper', desc: 'Open 5 different apps', pts: 10, icon: 'bag', counter: 'apps', goal: 5 },
        { id: 'power-user', title: 'Power User', desc: 'Open 12 different apps', pts: 25, icon: 'bolt', counter: 'apps', goal: 12 },
        { id: 'spotlight', title: 'Seek and Find', desc: 'Open something from Spotlight', pts: 10, icon: 'search' },
        { id: 'fullscreen', title: 'Big Picture', desc: 'Take a window full screen', pts: 10, icon: 'expand' },
        { id: 'terminal', title: 'Command Line', desc: 'Open the Terminal', pts: 10, icon: 'terminal' },
        { id: 'reader', title: 'Bookworm', desc: 'Read 3 different blog posts', pts: 10, icon: 'book', counter: 'posts', goal: 3 },
        { id: 'tour', title: 'Studio Tour', desc: 'Look at 5 different projects', pts: 10, icon: 'folder', counter: 'projects', goal: 5 },
        { id: 'reaction', title: 'Applause', desc: 'React to a post or project', pts: 10, icon: 'heart' },
        { id: 'share', title: 'Word of Mouth', desc: 'Share or copy a link to a page', pts: 10, icon: 'share' },
        { id: 'guestbook', title: 'Signed, Sealed', desc: 'Sign the guestbook', pts: 25, icon: 'pen' },
        { id: 'irc', title: 'First Words', desc: 'Send a message in IRC Chat', pts: 10, icon: 'chat' },
        { id: 'paint', title: 'Left a Mark', desc: 'Draw on the shared Paint canvas', pts: 10, icon: 'brush' },
        { id: 'music', title: 'Now Playing', desc: 'Play a track in Music', pts: 10, icon: 'music' },
        { id: 'arcade', title: 'Arcade Regular', desc: 'Open 3 different games', pts: 10, icon: 'joystick', counter: 'games', goal: 3 },
        { id: 'doom', title: 'Rip and Tear', desc: 'Start DOOM', pts: 10, icon: 'skull' },
        { id: 'puzzle', title: 'Clean Sweep', desc: 'Clear the Daily Puzzle in Games', pts: 25, icon: 'flag' },
        { id: 'konami', title: 'Cheat Code', desc: 'Enter the Konami code', pts: 50, icon: 'arrows', secret: true },
        { id: 'crysis', title: 'But Can It Run Crysis?', desc: 'Try to launch Crysis', pts: 25, icon: 'chip', secret: true }
    ];
    const DEF_BY_ID = {};
    DEFS.forEach((d) => { DEF_BY_ID[d.id] = d; });

    // Each stamp's look on the Passport's visa pages (8 slots a page): the
    // border shape and the ink, set by its slot so that no two stamps next
    // to or above each other share either, whether a page shows 4 across
    // (desktop) or 2 (phone). Shifted page by page so pages differ. Also
    // used by the unlock banner, so it shows the same ink as the page.
    const STAMP_SHAPES = ['circle', 'rect', 'oval', 'octagon'];
    const STAMP_INKS = ['red', 'blue', 'violet', 'green'];
    const SHAPE_SEQ = [1, 0, 2, 3, 0, 2, 1, 0];
    const INK_SEQ = [0, 1, 2, 3, 3, 0, 1, 2];
    DEFS.forEach((d, i) => {
        const page = Math.floor(i / 8);
        const slot = i % 8;
        d.shape = STAMP_SHAPES[(SHAPE_SEQ[slot] + page) % 4];
        d.ink = STAMP_INKS[(INK_SEQ[slot] + page * 3) % 4];
    });

    // Stamp pictograms: 24x24 line drawings, one per stamp (`icon` above),
    // drawn on the Passport's stamps and in the unlock banner. Authored here,
    // safe as markup.
    const PICTS = {
        calendar: '<rect x="4" y="5.5" width="16" height="14" rx="1.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4M9 14.6l2 2 4-4"/>',
        flame: '<path d="M12 3.5c.6 3.4 4.8 5.2 4.8 9.9a4.8 4.8 0 0 1-9.6 0c0-1.9.9-3.2 2-4.3.3 1.5 1 2.3 1.9 2.7-.4-3 .1-6 .9-8.3z"/>',
        wheel: '<circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="2.2"/><path d="M3.9 11h5.9M14.2 11h5.9M12 14.2v6"/>',
        bag: '<path d="M5.5 8.5h13l-1.2 11.5H6.7z"/><path d="M9 11V7.2a3 3 0 0 1 6 0V11"/>',
        bolt: '<path d="M13.2 3 5.5 13.6h5.6L10 21l7.8-10.7h-5.7z"/>',
        search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
        expand: '<path d="M14 4.5h5.5V10M10 19.5H4.5V14M19.5 4.5l-6 6M4.5 19.5l6-6"/>',
        terminal: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="m7.5 10 2.5 2.2-2.5 2.2M12.5 14.5h4"/>',
        book: '<path d="M12 6.5c-2-1.4-4.7-1.7-7.5-1.3v12.6c2.8-.4 5.5-.1 7.5 1.3 2-1.4 4.7-1.7 7.5-1.3V5.2c-2.8-.4-5.5-.1-7.5 1.3zM12 6.5v12.6"/>',
        folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M3.5 10.5h17"/>',
        heart: '<path d="M12 19.5s-7.5-4.4-7.5-9.7A4.1 4.1 0 0 1 12 7.6a4.1 4.1 0 0 1 7.5 2.2c0 5.3-7.5 9.7-7.5 9.7z"/>',
        share: '<path d="M12 14.5v-11M8.5 7 12 3.5 15.5 7M8 10.5H6.2a1.5 1.5 0 0 0-1.5 1.5v6.5A1.5 1.5 0 0 0 6.2 20h11.6a1.5 1.5 0 0 0 1.5-1.5V12a1.5 1.5 0 0 0-1.5-1.5H16"/>',
        pen: '<path d="M12 3.2 7 9.4l1.6 6.6h6.8L17 9.4z"/><path d="M12 3.2v7.2"/><circle cx="12" cy="11.6" r="1.2"/><path d="M8.6 19.8h6.8"/>',
        chat: '<path d="M4 6.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6.5L7 20v-3.5H6a2 2 0 0 1-2-2z"/>',
        brush: '<path d="M19.5 3.5 10 13l1.8 1.8 9.2-9.8zM9 14c-2.4 0-3.3 1.6-3.3 3.2 0 1.1-.7 1.9-1.7 2.3 3.7.9 7-.4 7-3.5z"/>',
        music: '<path d="M9.5 17.5V6l9-2v11.5"/><circle cx="7" cy="17.5" r="2.5"/><circle cx="16" cy="15.5" r="2.5"/>',
        joystick: '<rect x="4" y="15" width="16" height="5" rx="1.5"/><path d="M12 15V9.6"/><circle cx="12" cy="7" r="2.6"/><circle cx="16.6" cy="17.5" r=".9"/>',
        skull: '<path d="M12 3.5c-4.3 0-7.5 3-7.5 7 0 2.4 1 4 2.6 5.1V19h9.8v-3.4c1.6-1.1 2.6-2.7 2.6-5.1 0-4-3.2-7-7.5-7z"/><circle cx="9" cy="11" r="1.7"/><circle cx="15" cy="11" r="1.7"/><path d="M10.4 19v-2.2M13.6 19v-2.2M12 13.4l-.9 1.6h1.8z"/>',
        flag: '<path d="M6.5 20.5V3.8"/><path d="M6.5 4.5H17l-2.6 3.6L17 11.6H6.5"/><path d="M3.8 20.5h5.4"/>',
        arrows: '<path d="M4.5 19V5M2.6 7 4.5 5 6.4 7M9.5 19V5M7.6 7 9.5 5l1.9 2M14.5 5v14M12.6 17l1.9 2 1.9-2M19.5 5v14M17.6 17l1.9 2 1.9-2"/>',
        chip: '<rect x="7" y="7" width="10" height="10" rx="1.2"/><rect x="10" y="10" width="4" height="4"/><path d="M9.5 4v3M12 4v3M14.5 4v3M9.5 17v3M12 17v3M14.5 17v3M4 9.5h3M4 12h3M4 14.5h3M17 9.5h3M17 12h3M17 14.5h3"/>',
        secret: '<path d="M9.3 9.3a2.8 2.8 0 1 1 4.3 2.4c-.9.6-1.6 1.2-1.6 2.3v.4"/><circle cx="12" cy="17.8" r=".7"/>'
    };
    const COUNTERS = ['apps', 'games', 'posts', 'projects'];

    function readPassport() {
        const p = readJSON(PASSPORT_KEY);
        const unlocked = {};
        if (p.unlocked && typeof p.unlocked === 'object') {
            Object.keys(p.unlocked).forEach((id) => {
                if (DEF_BY_ID[id] && num(p.unlocked[id])) unlocked[id] = p.unlocked[id];
            });
        }
        const seen = {};
        COUNTERS.forEach((name) => {
            const list = p.seen && Array.isArray(p.seen[name]) ? p.seen[name] : [];
            seen[name] = list.filter((v) => typeof v === 'string' && v.length <= 120).slice(0, MAX_SEEN);
        });
        return {
            v: 1,
            first: num(p.first),
            lastDay: typeof p.lastDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.lastDay) ? p.lastDay : '',
            streak: Math.floor(num(p.streak)),
            best: Math.floor(num(p.best)),
            days: Math.floor(num(p.days)),
            // When the Passport last showed its stamps (newer ones get inked in)
            viewed: num(p.viewed),
            unlocked: unlocked,
            seen: seen
        };
    }

    const listeners = new Set();
    function changed(id) {
        listeners.forEach((fn) => {
            try { fn(id || null); } catch (e) { /* a listener must not break the rest */ }
        });
    }

    // The unlock banner's icon: the stamp itself (its own border shape, ink
    // and pictogram, as the visitor will find it on the visa page), inked on
    // a scrap of the Passport's cream page (a material: the same in light and dark)
    const INK_HEX = { red: '#b3261e', blue: '#1d4c9c', violet: '#5e3796', green: '#276a39' };
    const BANNER_EDGES = {
        circle: '<circle cx="18" cy="18" r="14" stroke-width="1.9"/>'
            + '<circle cx="18" cy="18" r="11.3" stroke-width=".7" stroke-dasharray="1.4 1.2"/>',
        rect: '<rect x="3.5" y="8" width="29" height="20" rx="1" stroke-width="1.7"/>'
            + '<rect x="6" y="10.5" width="24" height="15" stroke-width=".7" stroke-dasharray="1.4 1.2"/>',
        oval: '<ellipse cx="18" cy="18" rx="15.5" ry="11" stroke-width="1.8"/>'
            + '<ellipse cx="18" cy="18" rx="12.8" ry="8.4" stroke-width=".7" stroke-dasharray="1.4 1.2"/>',
        octagon: '<polygon points="11.8,3.5 24.2,3.5 32.5,11.8 32.5,24.2 24.2,32.5 11.8,32.5 3.5,24.2 3.5,11.8" stroke-width="1.8"/>'
            + '<polygon points="12.9,6.2 23.1,6.2 29.8,12.9 29.8,23.1 23.1,29.8 12.9,29.8 6.2,23.1 6.2,12.9" stroke-width=".7" stroke-dasharray="1.4 1.2"/>'
    };
    function stampIcon(def) {
        const ink = INK_HEX[def.ink] || INK_HEX.blue;
        const shape = BANNER_EDGES[def.shape] ? def.shape : 'circle';
        const wide = shape === 'rect' || shape === 'oval';
        // Wide stamps sit a little straighter, and their pictogram is smaller
        const tilt = (def.id.length % 2 ? -9 : 7) * (wide ? 0.6 : 1);
        const pict = wide ? 'translate(12.5 12.5) scale(.4583)' : 'translate(11 11) scale(.5833)';
        return '<span class="ach-medal ach-stamp"><svg viewBox="0 0 36 36" width="36" height="36" focusable="false" aria-hidden="true">'
            + '<rect x=".5" y=".5" width="35" height="35" rx="6" fill="#f5efdc" stroke="rgba(110,86,40,.35)"/>'
            + '<g transform="rotate(' + tilt + ' 18 18)" fill="none" stroke="' + ink + '" stroke-opacity=".9">'
            + BANNER_EDGES[shape]
            + '<g transform="' + pict + '" stroke-width="' + (wide ? 3.4 : 2.9) + '" stroke-linecap="round" stroke-linejoin="round">'
            + (PICTS[def.icon] || PICTS.secret) + '</g></g></svg></span>';
    }

    const bannerQueue = [];
    let bannerBusy = false;

    function nextBanner() {
        if (bannerBusy) return;
        const def = bannerQueue.shift();
        if (!def) return;
        if (typeof window.showNotification !== 'function') { bannerQueue.length = 0; return; }
        bannerBusy = true;
        const note = window.showNotification({
            title: def.title,
            message: def.desc,
            iconHtml: stampIcon(def),
            duration: 6500,
            onClick: () => openApp('passport')
        });
        if (note && note.classList) {
            note.classList.add('notification-achievement');
            const title = note.querySelector('.notification-title');
            if (title) {
                const kicker = document.createElement('span');
                kicker.className = 'ach-kicker';
                kicker.textContent = 'Passport stamped · ' + def.pts + ' pts';
                title.parentNode.insertBefore(kicker, title);
            }
        }
        // One at a time, so three unlocked by the same click do not pile up
        setTimeout(() => { bannerBusy = false; nextBanner(); }, 1600);
    }

    /**
     * @param {string} id
     * @param {{silent?: boolean}} [opts]  silent: no banner (something that was
     *        already true before achievements existed, e.g. an old signature)
     * @returns {boolean} true when this call unlocked it
     */
    function unlock(id, opts) {
        const def = DEF_BY_ID[id];
        if (!def) return false;
        const p = readPassport();
        if (p.unlocked[id]) return false;
        p.unlocked[id] = Date.now();
        writeJSON(PASSPORT_KEY, p);
        try {
            document.dispatchEvent(new CustomEvent('site:achievement', { detail: { id: id } }));
        } catch (e) { /* very old browser */ }
        changed(id);
        if (!(opts && opts.silent)) {
            bannerQueue.push(def);
            nextBanner();
        }
        return true;
    }

    /** Count one more distinct thing and unlock whatever that reaches. */
    function count(counter, key) {
        if (!key || typeof key !== 'string') return;
        const p = readPassport();
        const list = p.seen[counter];
        if (!list || list.indexOf(key) !== -1) return;
        if (list.length < MAX_SEEN) {
            list.push(key.slice(0, 120));
            writeJSON(PASSPORT_KEY, p);
            changed(null);
        }
        DEFS.forEach((d) => {
            if (d.counter === counter && list.length >= d.goal) unlock(d.id);
        });
    }

    function localDay(date) {
        const d = date || new Date();
        const pad = (n) => (n < 10 ? '0' : '') + n;
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    function daysBetween(a, b) {
        const at = new Date(a + 'T12:00:00').getTime();
        const bt = new Date(b + 'T12:00:00').getTime();
        return Math.round((bt - at) / 86400000);
    }

    /** One stamp per calendar day (the visitor's own), and the streak with it. */
    function stampToday() {
        const p = readPassport();
        const today = localDay();
        if (!p.first) p.first = Date.now();
        if (p.lastDay !== today) {
            const gap = p.lastDay ? daysBetween(p.lastDay, today) : 0;
            // A clock set backwards restarts the streak rather than extending it
            p.streak = gap === 1 ? p.streak + 1 : 1;
            p.best = Math.max(p.best, p.streak);
            p.days += 1;
            p.lastDay = today;
        }
        writeJSON(PASSPORT_KEY, p);
        if (p.days >= 2) unlock('welcome-back');
        if (p.streak >= 3) unlock('streak-3');
        if (p.streak >= 7) unlock('streak-7');
    }

    window.Achievements = {
        /** A stamp pictogram's SVG markup (24x24 line drawing, no <svg> wrapper). */
        pictogram(name) {
            return PICTS[name] || PICTS.secret;
        },
        /** Every achievement with this visitor's progress. */
        list() {
            const p = readPassport();
            return DEFS.map((d) => ({
                id: d.id,
                title: d.title,
                desc: d.desc,
                points: d.pts,
                icon: d.icon,
                shape: d.shape,
                ink: d.ink,
                secret: !!d.secret,
                unlockedAt: p.unlocked[d.id] || 0,
                goal: d.goal || 0,
                progress: d.counter ? Math.min(p.seen[d.counter].length, d.goal) : 0
            }));
        },
        /** Visit facts for the Passport. */
        stats() {
            const p = readPassport();
            // Shown as broken once a day has been missed, not only on the next visit
            const live = p.lastDay && daysBetween(p.lastDay, localDay()) <= 1 ? p.streak : 0;
            return { first: p.first, days: p.days, streak: live, best: p.best, viewed: p.viewed };
        },
        /** The Passport has shown every stamp up to now (no change event). */
        markViewed() {
            const p = readPassport();
            p.viewed = Date.now();
            writeJSON(PASSPORT_KEY, p);
        },
        unlock: unlock,
        isUnlocked: (id) => !!readPassport().unlocked[id],
        /** fn(id|null) after any change; returns an unsubscribe function. */
        onChange(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
        /** Forget everything (the Passport's Reset button). */
        reset() {
            const p = readPassport();
            writeJSON(PASSPORT_KEY, { v: 1, first: p.first });
            stampToday();
            changed(null);
        }
    };

    // ---- What counts ---------------------------------------------------

    function onWindowOpened(id) {
        if (!id) return;
        const app = registry[id];
        if (app) count(app.type === 'game' ? 'games' : 'apps', id);
        if (id === 'terminal') unlock('terminal');
        if (id === 'doom') unlock('doom');
    }

    function onTrack(name, props) {
        const p = props || {};
        switch (name) {
            case 'spotlight_result':
                if (p.id === 'crysis') unlock('crysis');
                unlock('spotlight');
                break;
            case 'guestbook_signed': unlock('guestbook'); break;
            case 'irc_first_message': unlock('irc'); break;
            case 'music_play': if (!p.ambient) unlock('music'); break;
            case 'post_reaction': unlock('reaction'); break;
            case 'share': unlock('share'); break;
            case 'fullscreen': unlock('fullscreen'); break;
            case 'paint_draw': unlock('paint'); break;
            case 'puzzle_solved': unlock('puzzle'); break;
            default: break;
        }
    }

    // The shell's event bus. Until it has been heard from, also catch calls
    // other scripts make through window.track (older shell builds have no bus).
    let busSeen = false;
    document.addEventListener('site:track', (e) => {
        busSeen = true;
        const d = e.detail || {};
        if (typeof d.name === 'string') onTrack(d.name, d.props);
    });
    (function wrapTrack() {
        const original = window.track;
        if (typeof original !== 'function' || original.__retention) return;
        const wrapped = function (name, props) {
            const before = busSeen;
            const result = original.apply(this, arguments);
            // No bus event came out of that call: handle it here instead
            if (!before && !busSeen && typeof name === 'string') onTrack(name, props);
            return result;
        };
        wrapped.__retention = true;
        window.track = wrapped;
    })();

    // Things the shell does not announce
    if (window.MutationObserver && document.body) {
        const konami = new MutationObserver(() => {
            if (!document.body.classList.contains('konami-active')) return;
            konami.disconnect();
            unlock('konami');
        });
        konami.observe(document.body, { attributes: true, attributeFilter: ['class'] });

        // Launching Crysis only ever produces the shell's "No. No it cannot."
        // notification (with the game's own icon), wherever it was opened from
        const watchNotes = (box) => {
            new MutationObserver((records) => {
                records.forEach((r) => r.addedNodes.forEach((n) => {
                    if (n.nodeType === 1 && n.querySelector && n.querySelector('.notification-icon img[src$="/games/crysis.png"]')) {
                        unlock('crysis');
                    }
                }));
            }).observe(box, { childList: true });
        };
        const box = document.getElementById('notification-container');
        if (box) {
            watchNotes(box);
        } else {
            const waitForBox = new MutationObserver(() => {
                const found = document.getElementById('notification-container');
                if (!found) return;
                waitForBox.disconnect();
                watchNotes(found);
            });
            waitForBox.observe(document.body, { childList: true });
        }
    }

    // ------------------------------------------------------------------
    // Lazy extras: reaction bars and the guestbook's "On this day"
    // ------------------------------------------------------------------

    const scriptLoads = {};
    function loadScript(urlKey) {
        if (scriptLoads[urlKey]) return scriptLoads[urlKey];
        const src = window[urlKey];
        if (!src) return Promise.reject(new Error('Missing URL for ' + urlKey));
        scriptLoads[urlKey] = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.async = true;
            s.onload = resolve;
            s.onerror = () => { delete scriptLoads[urlKey]; reject(new Error('Failed to load ' + src)); };
            document.head.appendChild(s);
        });
        return scriptLoads[urlKey];
    }

    /** Reaction bars inside `root` that nobody has picked up yet. */
    function scanPosts(root) {
        const bars = root.querySelectorAll ? root.querySelectorAll('.post-social[data-post-key]:not([data-ps])') : [];
        if (!bars.length) return;
        bars.forEach((bar) => {
            bar.setAttribute('data-ps', 'found');
            const key = bar.getAttribute('data-post-key') || '';
            count(bar.getAttribute('data-kind') === 'project' ? 'projects' : 'posts', key);
        });
        loadScript('POST_SOCIAL_URL').then(() => {
            if (!window.PostSocial) return;
            bars.forEach((bar) => { if (bar.isConnected) window.PostSocial.mount(bar); });
        }).catch(() => { /* the bar stays hidden */ });
    }

    function mountOnThisDay(win) {
        loadScript('ON_THIS_DAY_URL').then(() => {
            if (window.OnThisDay && win.isConnected) window.OnThisDay.mount(win);
        }).catch(() => { /* the book works without it */ });
    }

    const container = document.getElementById('windows-container');
    const contentWatchers = new Map(); // window element -> MutationObserver

    function watchWindow(win) {
        if (!win || win.nodeType !== 1 || !win.dataset || contentWatchers.has(win)) return;
        const id = win.dataset.windowId;
        if (!id) return;
        onWindowOpened(id);
        noteAppOpened(id);
        if (id === 'guestbook') mountOnThisDay(win);
        // Pages arrive after the window does, and Previous/Next swap them in
        // place - so watch content windows (never apps) for a reaction bar.
        if (registry[id] || !window.MutationObserver) return;
        let timer = null;
        const mo = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(() => scanPosts(win), 150);
        });
        mo.observe(win, { childList: true, subtree: true });
        contentWatchers.set(win, mo);
        scanPosts(win);
    }

    function unwatchWindow(win) {
        if (window.OnThisDay && win && win.nodeType === 1) window.OnThisDay.unmount(win);
        const mo = contentWatchers.get(win);
        if (mo) mo.disconnect();
        contentWatchers.delete(win);
    }

    // ------------------------------------------------------------------
    // New since your last visit
    // ------------------------------------------------------------------

    const visit = (function () {
        const v = readJSON(VISIT_KEY);
        const now = Date.now();
        const last = num(v.last);
        const state = {
            last: last,
            base: num(v.base),                // "new" means newer than this
            first: !!v.first,                 // still on the very first visit
            ackBlogs: num(v.ackBlogs),        // when each list was last opened
            ackProjects: num(v.ackProjects),
            notified: !!v.notified
        };
        if (!last || last > now + 60000) {
            // Never been here (or a clock that jumped): only the last month
            // counts as new, not the whole archive.
            state.base = now - FIRST_VISIT_WINDOW_MS;
            state.first = true;
            state.ackBlogs = state.ackProjects = 0;
            state.notified = false;
        } else if (now - last > VISIT_GAP_MS) {
            state.base = last;
            state.first = false;
            state.ackBlogs = state.ackProjects = 0;
            state.notified = false;
        }
        return state;
    })();

    function saveVisit() {
        visit.last = Date.now();
        writeJSON(VISIT_KEY, visit);
    }

    // "Unload" is not dependable on phones: note the visit shortly after
    // arriving and again whenever the page is hidden or left.
    setTimeout(saveVisit, 3000);
    document.addEventListener('visibilitychange', () => { if (document.hidden) saveVisit(); });
    window.addEventListener('pagehide', saveVisit);

    const newItems = { blogs: [], projects: [] };   // [{path, title, id, permalink, date}]

    function pathOf(href) {
        try { return new URL(href, window.location.href).pathname; } catch (e) { return ''; }
    }

    function isNew(ms) {
        return ms > visit.base && ms <= Date.now() + 86400000;
    }

    function pill() {
        const el = document.createElement('span');
        el.className = 'new-pill';
        el.textContent = 'New';
        return el;
    }

    function markRows() {
        const dates = {};
        const kinds = [
            ['blogs', 'a.blog-row[data-date]', '.blog-title'],
            ['projects', 'a.project-card[data-date]', '.project-card-title']
        ];
        kinds.forEach(([kind, selector, titleSelector]) => {
            const seen = {};
            document.querySelectorAll(selector).forEach((row) => {
                const ms = (parseInt(row.getAttribute('data-date'), 10) || 0) * 1000;
                const path = pathOf(row.getAttribute('href'));
                if (!ms || !path) return;
                dates[path] = ms;
                if (!isNew(ms)) return;
                const title = row.querySelector(titleSelector);
                if (title && !row.classList.contains('is-new')) {
                    row.classList.add('is-new');
                    title.appendChild(document.createTextNode(' '));
                    title.appendChild(pill());
                }
                if (seen[path]) return;       // Featured repeats a project card
                seen[path] = true;
                newItems[kind].push({
                    path: path,
                    date: ms,
                    id: row.getAttribute('data-window') || '',
                    title: row.getAttribute('data-title') || '',
                    permalink: row.getAttribute('data-permalink') || ''
                });
            });
        });
        return dates;
    }

    /** The Latest list of the About window (and any copy of it in an open window). */
    function markWidget(dates) {
        document.querySelectorAll('.home-latest').forEach((widget) => markLatest(widget, dates));
    }

    function markLatest(widget, dates) {
        let any = false;
        widget.querySelectorAll('.widget-blog-item').forEach((item) => {
            let ms = dates[pathOf(item.getAttribute('href'))] || 0;
            if (!ms) {
                // Timeline entries are not in a list on this page: use the day
                const time = item.querySelector('time[datetime]');
                const day = time ? time.getAttribute('datetime') : '';
                if (/^\d{4}-\d{2}-\d{2}$/.test(day)) ms = new Date(day + 'T00:00:00').getTime() || 0;
            }
            if (!ms || !isNew(ms) || item.classList.contains('is-new')) return;
            any = true;
            item.classList.add('is-new');
            const dot = document.createElement('span');
            dot.className = 'widget-new-dot';
            const label = document.createElement('span');
            label.className = 'visually-hidden';
            label.textContent = 'New: ';
            dot.appendChild(label);
            // At the row's left edge, ahead of the title and its wrapper
            item.insertBefore(dot, item.firstChild);
        });
        const badge = widget.querySelector('.blink-new');
        if (badge) badge.classList.toggle('is-live', any);
    }

    function unseenCount(kind) {
        const ack = kind === 'blogs' ? visit.ackBlogs : visit.ackProjects;
        return newItems[kind].filter((item) => item.date > ack).length;
    }

    function paintIconBadge(kind) {
        const icon = document.querySelector('.desktop-icon[data-window="' + kind + '"]');
        if (!icon) return;
        const n = unseenCount(kind);
        let badge = icon.querySelector(':scope > .icon-count-badge');
        const label = icon.getAttribute('data-label') || icon.getAttribute('aria-label') || '';
        if (!icon.hasAttribute('data-label')) icon.setAttribute('data-label', label);
        if (!n) {
            if (badge) badge.remove();
            icon.setAttribute('aria-label', label);
            return;
        }
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'icon-count-badge';
            badge.setAttribute('aria-hidden', 'true');
            icon.appendChild(badge);
        }
        badge.textContent = n > 9 ? '9+' : String(n);
        icon.setAttribute('aria-label', label + ', ' + n + ' new');
    }

    /** Opening Blogs or Projects is looking at the list: the count has done its job. */
    function noteAppOpened(id) {
        if (id !== 'blogs' && id !== 'projects') return;
        if (!unseenCount(id)) return;
        if (id === 'blogs') visit.ackBlogs = Date.now();
        else visit.ackProjects = Date.now();
        saveVisit();
        paintIconBadge(id);
    }

    function plural(n, word) {
        return n + ' new ' + word + (n === 1 ? '' : 's');
    }

    function announceNew() {
        const blogs = newItems.blogs.length;
        const projects = newItems.projects.length;
        // Returning visitors only, once per visit
        if (visit.first || visit.notified || !(blogs + projects)) return;
        if (typeof window.showNotification !== 'function') return;
        visit.notified = true;
        saveVisit();

        const only = blogs + projects === 1 ? (newItems.blogs[0] || newItems.projects[0]) : null;
        const kind = blogs ? 'blogs' : 'projects';
        const iconEl = document.querySelector('.desktop-icon[data-window="' + kind + '"] .icon-image');
        const parts = [];
        if (blogs) parts.push(plural(blogs, 'post'));
        if (projects) parts.push(plural(projects, 'project'));

        window.showNotification({
            title: 'Since your last visit',
            message: only && only.title ? only.title : parts.join(' and '),
            iconHtml: iconEl ? iconEl.innerHTML : '',
            duration: 9000,
            onClick: () => {
                if (only && only.id && only.permalink && typeof window.openContentWindow === 'function') {
                    window.openContentWindow(only.id, only.title, only.permalink);
                } else {
                    openApp(kind);
                }
            }
        });
    }

    // The /blogs/ and /projects/ pages carry the same rows as the desktop lists
    const rowDates = markRows();
    if (IS_DESKTOP) {
        markWidget(rowDates);
        paintIconBadge('blogs');
        paintIconBadge('projects');
        // Lists that were already open (a restored session) have been marked
        // above; their count is spent
        ['blogs', 'projects'].forEach((id) => {
            if (container && container.querySelector('[data-window-id="' + id + '"]')) noteAppOpened(id);
        });
        setTimeout(announceNew, 6000);
    }

    // Windows: the ones already open, and every one opened from here on
    if (container && window.MutationObserver) {
        new MutationObserver((records) => {
            records.forEach((r) => {
                r.addedNodes.forEach(watchWindow);
                r.removedNodes.forEach(unwatchWindow);
            });
        }).observe(container, { childList: true });
        Array.prototype.forEach.call(container.children, watchWindow);
    }
    // An article or project page loaded directly
    if (!IS_DESKTOP) scanPosts(document);

    // ------------------------------------------------------------------
    // Today's stamp, and anything that was already true
    // ------------------------------------------------------------------

    stampToday();
    try {
        const signed = window.SiteStore ? window.SiteStore.get('guestbook-signed') : localStorage.getItem('guestbook-signed');
        if (signed) unlock('guestbook', { silent: true });
        // The Daily Puzzle counts its own wins (assets/js/daily-puzzle.js)
        const puzzle = readJSON('daily-puzzle-v1');
        if (num(puzzle.solved)) unlock('puzzle', { silent: true });
    } catch (e) { /* storage blocked */ }
})();
