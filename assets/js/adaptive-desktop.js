/**
 * Adaptive desktop: the icons on the desktop are the apps this visitor is
 * most likely to open next, learned from what they open and from what
 * everybody opens.
 *
 * Two scores per app, each a count that halves every two weeks ("frecency":
 * often and lately both count):
 *
 *   mine     every app this visitor opens adds 1 (this browser only,
 *            localStorage app-usage-v1)
 *   everyone each visitor adds 1 per app per UTC day to one shared node on
 *            the relay (SiteGun.paths.apps.usage), so it counts the people
 *            who used an app each day, not how hard one of them clicked
 *
 * blended by how much this visitor has to go on:
 *
 *   score = w * mine/sum(mine) + (1 - w) * everyone/sum(everyone),
 *   w = sum(mine) / (sum(mine) + PRIOR)
 *
 * so a first visit gets what is popular and a regular gets their own habits.
 * The top SLOTS apps that are not in the Dock (data/apps.yaml, minus
 * `autoDesktop: false`) become the icons, most likely first; the curated
 * `desktop: true` apps fill any gap. An icon already there keeps its place
 * unless another app beats it by a clear margin, so they do not shuffle.
 *
 * The set is chosen once, when the page loads, from the last numbers this
 * browser saw (app-usage-global-v1); the fresh ones are saved for next time.
 * Only a first visit, which has nothing saved, takes them as they arrive.
 * Icons are built from the #app-registry block (baseof.html), like the Dock.
 * Loaded before desktop-personal.js, which lays out whatever icons it finds.
 */
(function () {
    'use strict';

    const shell = window.SiteShell;
    const iconsEl = document.querySelector('#desktop .desktop-icons');
    const registryEl = document.getElementById('app-registry');
    if (!shell || !shell.isDesktop || !iconsEl || !registryEl || window.AdaptiveDesktop) return;

    const SLOTS = 4;
    const HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;
    const PRIOR = 4;                 // opens before this visitor's habits outweigh everyone's
    const KEEP_MARGIN = 1.2;         // a newcomer must beat a shown icon by this much
    const MAX_SCORE = 100000;        // anyone can write the shared node; nothing is that popular
    const GUN_WAIT_MS = 15000;
    const SETTLE_MS = 3000;          // an empty shared node never calls back

    const MINE_KEY = 'app-usage-v1';           // { v: 1, apps: { id: [score, ms] } }
    const SENT_KEY = 'app-usage-sent-v1';      // { day, ids: [...] } counted for everyone today
    const GLOBAL_KEY = 'app-usage-global-v1';  // { at, apps: { id: score at `at` } }
    const SHOWN_KEY = 'app-usage-shown-v1';    // [id, ...] on the desktop last time

    const store = {
        read(key) {
            try {
                const raw = localStorage.getItem(key);
                return raw ? JSON.parse(raw) : null;
            } catch (e) { return null; }
        },
        write(key, value) {
            try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* this visit only */ }
        }
    };

    let registry = [];
    try { registry = JSON.parse(registryEl.textContent); } catch (e) { return; }
    if (!Array.isArray(registry)) return;
    const byId = new Map(registry.filter((a) => a && a.id).map((a) => [a.id, a]));
    const eligible = registry.filter((a) => a && a.id && !a.dock && a.id !== 'launchpad' && a.autoDesktop !== false);
    const eligibleIds = new Set(eligible.map((a) => a.id));
    const defaults = registry.filter((a) => a && a.desktop && eligibleIds.has(a.id)).map((a) => a.id);

    const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
    const decay = (score, at, now) => score * Math.pow(0.5, Math.max(0, now - at) / HALF_LIFE_MS);
    const finite = (n) => typeof n === 'number' && Number.isFinite(n);

    // ---- This visitor ------------------------------------------------------

    function loadMine() {
        const saved = store.read(MINE_KEY);
        const apps = {};
        if (saved && saved.v === 1 && saved.apps && typeof saved.apps === 'object') {
            Object.keys(saved.apps).forEach((id) => {
                const entry = saved.apps[id];
                if (byId.has(id) && Array.isArray(entry) && finite(entry[0]) && finite(entry[1])) {
                    apps[id] = [Math.min(MAX_SCORE, Math.max(0, entry[0])), entry[1]];
                }
            });
        }
        return apps;
    }

    let mine = loadMine();

    function mineNow(now) {
        const out = {};
        Object.keys(mine).forEach((id) => { out[id] = decay(mine[id][0], mine[id][1], now); });
        return out;
    }

    // ---- Everyone ----------------------------------------------------------

    /** "<score>,<ms>" from the shared node, decayed to `now`; 0 for anything malformed. */
    function parseShared(value, now) {
        if (typeof value !== 'string' || value.length > 40) return 0;
        const [s, t] = value.split(',').map(Number);
        if (!finite(s) || !finite(t) || s <= 0) return 0;
        // A time in the future would never decay
        return decay(Math.min(MAX_SCORE, s), Math.min(t, now), now);
    }

    const cached = store.read(GLOBAL_KEY);
    let everyone = {};               // id -> score as of everyoneAt
    let everyoneAt = 0;
    if (cached && finite(cached.at) && cached.apps && typeof cached.apps === 'object') {
        everyoneAt = cached.at;
        Object.keys(cached.apps).forEach((id) => {
            const s = cached.apps[id];
            if (byId.has(id) && finite(s) && s > 0) everyone[id] = Math.min(MAX_SCORE, s);
        });
    }
    const hadCache = everyoneAt > 0;

    function everyoneNow(now) {
        const out = {};
        Object.keys(everyone).forEach((id) => { out[id] = decay(everyone[id], everyoneAt, now); });
        return out;
    }

    // ---- Choosing ----------------------------------------------------------

    function scores(now) {
        const m = mineNow(now);
        const g = everyoneNow(now);
        let sumM = 0;
        let sumG = 0;
        eligible.forEach((a) => { sumM += m[a.id] || 0; sumG += g[a.id] || 0; });
        const w = sumM / (sumM + PRIOR);
        const out = new Map();
        eligible.forEach((a) => {
            const pm = sumM ? (m[a.id] || 0) / sumM : 0;
            const pg = sumG ? (g[a.id] || 0) / sumG : 0;
            out.set(a.id, w * pm + (sumG ? 1 - w : 0) * pg);
        });
        return out;
    }

    /** Ties go to the curated defaults, in their order. */
    const defaultRank = (id) => (defaults.includes(id) ? defaults.indexOf(id) : defaults.length);

    /** The icons to show, most likely first. */
    function choose(now) {
        const score = scores(now);
        const byScore = (a, b) => (score.get(b) || 0) - (score.get(a) || 0) || defaultRank(a) - defaultRank(b);
        const ranked = eligible.map((a) => a.id)
            .filter((id) => score.get(id) > 0)
            .sort(byScore);
        const picked = ranked.slice(0, SLOTS);

        // An icon that was there keeps its slot against a close challenger
        const before = (store.read(SHOWN_KEY) || []).filter((id) => eligibleIds.has(id));
        before.forEach((id) => {
            if (picked.includes(id) || !(score.get(id) > 0)) return;
            const newcomers = picked.filter((p) => !before.includes(p));
            const weakest = newcomers.sort((a, b) => score.get(a) - score.get(b))[0];
            if (weakest && score.get(id) * KEEP_MARGIN >= score.get(weakest)) {
                picked[picked.indexOf(weakest)] = id;
            }
        });

        // Not enough to go on yet: the curated defaults fill in
        defaults.forEach((id) => {
            if (picked.length < Math.max(SLOTS, defaults.length) && !picked.includes(id)) picked.push(id);
        });
        return picked.slice(0, SLOTS).sort(byScore);
    }

    // ---- Icons -------------------------------------------------------------

    let svgSerial = 0;
    /** Fresh ids for the copy's gradients, so no two icons on the page share one. */
    function uniqueSvgIds(html) {
        const ids = new Set();
        html.replace(/\sid="([^"]+)"/g, (m, id) => { ids.add(id); return m; });
        if (!ids.size) return html;
        const sfx = '-ad' + (++svgSerial);
        return html
            .replace(/(\sid=")([^"]+)(")/g, (m, a, id, b) => (ids.has(id) ? a + id + sfx + b : m))
            .replace(/(url\(\s*['"]?#)([^'")\s]+)/g, (m, a, id) => (ids.has(id) ? a + id + sfx : m))
            .replace(/((?:xlink:)?href="#)([^"]+)/g, (m, a, id) => (ids.has(id) ? a + id + sfx : m));
    }

    /** The same markup as layouts/partials/os/desktop/icon.html. */
    function buildIcon(app) {
        const icon = document.createElement(app.contentPermalink ? 'a' : 'button');
        icon.className = 'desktop-icon';
        if (app.contentPermalink) {
            icon.href = app.contentPermalink;
            icon.draggable = false;
            icon.dataset.permalink = app.contentPermalink;
        } else {
            icon.type = 'button';
            icon.tabIndex = 0;
        }
        icon.dataset.cursorAnchor = 'icon:' + app.id;
        icon.dataset.window = app.id;
        icon.dataset.title = app.title || app.label || app.id;
        if (app.width) icon.dataset.width = String(app.width);
        if (app.height) icon.dataset.height = String(app.height);
        const label = app.label || app.title || app.id;
        icon.setAttribute('aria-label', label);

        const image = document.createElement('div');
        image.className = 'icon-image';
        image.innerHTML = uniqueSvgIds(String(app.iconHtml || '').replace('app-icon-spotlight', 'app-icon-desktop'));
        // In a hidden template the icon was lazy; here it is on screen
        image.querySelectorAll('img[loading="lazy"]').forEach((img) => { img.loading = 'eager'; });
        const text = document.createElement('span');
        text.className = 'icon-label';
        text.textContent = label;
        icon.append(image, text);

        if (shell.hasBadge && shell.hasBadge(app.id)) {
            icon.classList.add('has-badge');
            icon.setAttribute('aria-label', label + ', new activity');
        }
        return icon;
    }

    function current() {
        return [...iconsEl.children]
            .filter((el) => el.classList.contains('desktop-icon'))
            .map((el) => el.dataset.window);
    }

    /** Put exactly these icons on the desktop, in this order, keeping the ones already there. */
    function render(ids) {
        const existing = new Map([...iconsEl.querySelectorAll(':scope > .desktop-icon')]
            .map((el) => [el.dataset.window, el]));
        if (ids.length === existing.size && ids.every((id, i) => current()[i] === id)) return false;
        existing.forEach((el, id) => { if (!ids.includes(id)) el.remove(); });
        ids.forEach((id) => {
            const app = byId.get(id);
            if (!app) return;
            iconsEl.appendChild(existing.get(id) || buildIcon(app));
        });
        store.write(SHOWN_KEY, ids);
        return true;
    }

    // ---- Learning ----------------------------------------------------------

    let sharedRef = null;
    let sharedRaw = null;            // the node as the relay last sent it, once it has
    const sendQueue = [];

    function countForEveryone(id) {
        const today = utcDay(Date.now());
        const sent = store.read(SENT_KEY);
        const ids = sent && sent.day === today && Array.isArray(sent.ids) ? sent.ids : [];
        if (ids.includes(id)) return;
        store.write(SENT_KEY, { day: today, ids: ids.concat(id).slice(-60) });
        sendQueue.push(id);
        flushShared();
    }

    /** Add 1 to each queued app's shared count (read, decay, add, write back). */
    function flushShared() {
        // Writing before the node has arrived would overwrite its count with 1
        if (!sharedRef || !sharedRaw) return;
        const now = Date.now();
        const patch = {};
        sendQueue.splice(0).forEach((id) => {
            const next = parseShared(sharedRaw[id], now) + 1;
            const value = next.toFixed(3) + ',' + now;
            patch[id] = value;
            sharedRaw[id] = value;
        });
        if (Object.keys(patch).length) sharedRef.put(patch);
    }

    function record(id) {
        if (!byId.has(id)) return;
        const now = Date.now();
        const entry = mine[id];
        mine[id] = [Math.min(MAX_SCORE, (entry ? decay(entry[0], entry[1], now) : 0) + 1), now];
        store.write(MINE_KEY, { v: 1, apps: mine });
        if (eligibleIds.has(id)) countForEveryone(id);
    }

    window.addEventListener('site:app-open', (e) => {
        if (e.detail && typeof e.detail.id === 'string') record(e.detail.id);
    });

    // ---- The shared node ---------------------------------------------------

    function onShared(data) {
        const now = Date.now();
        sharedRaw = {};
        const apps = {};
        Object.keys(data || {}).forEach((id) => {
            if (id === '_' || !byId.has(id)) return;
            sharedRaw[id] = data[id];
            const s = parseShared(data[id], now);
            if (s > 0) apps[id] = s;
        });
        everyone = apps;
        everyoneAt = now;
        store.write(GLOBAL_KEY, { at: now, apps: apps });
        flushShared();
        // A first visit had nothing saved to choose from: use the fresh numbers
        // as they first arrive (later updates, its own clicks included, wait
        // for the next visit like everyone else's)
        if (!hadCache && !touched && !tookFresh) {
            tookFresh = true;
            apply();
        }
    }

    let tookFresh = false;
    let touched = false;             // the visitor has used the desktop since the page loaded
    iconsEl.addEventListener('pointerdown', () => { touched = true; }, { once: true });

    function connect() {
        const gun = window.SiteGun;
        if (!gun || !gun.paths || !gun.paths.apps || !gun.paths.apps.usage) return;
        sharedRef = gun.paths.apps.usage();
        sharedRef.on((data) => onShared(data));
        // Nobody has counted anything yet: Gun stays quiet about an empty node
        setTimeout(() => {
            if (sharedRaw) return;
            sharedRaw = {};
            tookFresh = true;
            flushShared();
        }, SETTLE_MS);
    }

    (function waitForGun(started) {
        if (window.SiteGun) return connect();
        if (Date.now() - started > GUN_WAIT_MS) return;
        setTimeout(() => waitForGun(started), 250);
    })(Date.now());

    // ---- Go ----------------------------------------------------------------

    function apply() {
        if (render(choose(Date.now())) && window.DesktopPersonal && window.DesktopPersonal.relayout) {
            window.DesktopPersonal.relayout();
        }
    }

    // Before desktop-personal.js runs, so it lays out the chosen icons
    apply();

    window.AdaptiveDesktop = {
        /** Scores as they stand, for the curious (console) */
        scores: () => Object.fromEntries(scores(Date.now())),
        choose: () => choose(Date.now())
    };
})();
