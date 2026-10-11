/**
 * "On This Day" in the guestbook.
 *
 * A toolbar button that opens a popover with the signatures written today and
 * on this date in earlier years. Fetched by retention.js when the Guestbook
 * window opens, and kept out of guestbook.js: it reads the same two sources
 * the book does (the published daily snapshot and the relay node) and runs
 * every entry through the same checks before anything is shown.
 *
 * Read-only. It never writes to the relay or to storage.
 */
(function () {
    'use strict';

    if (window.OnThisDay) return;

    const MAX_NAME = 24;
    const MAX_FROM = 24;
    const MAX_ID_LEN = 64;
    const MAX_ENTRIES = 3000;
    const VARIANTS = 12;
    const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
    const GUN_WAIT_MS = 12000;
    const EMPTY_BOOK_GRACE_MS = 4000;
    const MAX_ROWS = 40;              // per group; a busy day says "and N more"

    const CALENDAR_SVG = '<svg class="otd-btn-icon" viewBox="0 0 16 16" width="14" height="14" fill="none"'
        + ' stroke="currentColor" stroke-width="1.3" stroke-linecap="round" focusable="false" aria-hidden="true">'
        + '<rect x="2" y="3" width="12" height="11" rx="1.8"/><path d="M2 6.4h12M5.2 1.6v2.6M10.8 1.6v2.6"/>'
        + '<rect x="4.6" y="8.4" width="2.4" height="2.2" rx=".4" fill="currentColor" stroke="none"/></svg>';

    const mounted = new Map();        // window element -> controller

    function text(value, max) {
        return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
    }

    /** The guestbook's own normalisation, reduced to what this view shows. */
    function readEntry(data) {
        if (!data || typeof data.name !== 'string') return null;
        const name = text(data.name, MAX_NAME);
        if (!name) return null;
        const ts = Number(data.ts) || 0;
        if (!(ts > 0 && ts <= Date.now() + MAX_CLOCK_SKEW_MS)) return null;
        const variant = Math.floor(Number(data.variant)) || 0;
        return {
            name: name,
            from: text(data.from, MAX_FROM),
            variant: variant >= 0 && variant < VARIANTS ? variant : 0,
            ts: ts
        };
    }

    function el(tag, className, content) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (content != null) node.textContent = content;
        return node;
    }

    function isLeap(y) {
        return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    }

    function relativeTime(ts) {
        const mins = Math.floor(Math.max(0, Date.now() - ts) / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return mins + 'm ago';
        return Math.floor(mins / 60) + 'h ago';
    }

    function yearsAgo(n) {
        return n === 1 ? '1 year ago' : n + ' years ago';
    }

    /**
     * Today's signatures, then each earlier year's for this month and day
     * (in the visitor's own calendar). A 29 February is remembered on the
     * 28th in years that do not have one.
     */
    function group(entries) {
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth();
        const d = now.getDate();
        const leapDayToo = m === 1 && d === 28 && !isLeap(y);
        const today = [];
        const years = {};
        entries.forEach((entry, id) => {
            const t = new Date(entry.ts);
            if (t.getMonth() !== m) return;
            const day = t.getDate();
            if (!(day === d || (leapDayToo && day === 29))) return;
            const row = { id: id, entry: entry };
            if (t.getFullYear() === y) {
                if (day === d) today.push(row);
            } else if (t.getFullYear() < y) {
                (years[t.getFullYear()] = years[t.getFullYear()] || []).push(row);
            }
        });
        const byTs = (a, b) => a.entry.ts - b.entry.ts;
        today.sort(byTs);
        const past = Object.keys(years).map(Number).sort((a, b) => b - a)
            .map((year) => ({ year: year, rows: years[year].sort(byTs) }));
        return { today: today, past: past, date: now };
    }

    function whenGun() {
        return new Promise((resolve, reject) => {
            const started = Date.now();
            (function poll() {
                const g = window.SiteGun;
                if (g && g.paths && g.paths.apps && g.paths.apps.guestbook) return resolve(g);
                if (Date.now() - started > GUN_WAIT_MS) return reject(new Error('realtime unavailable'));
                setTimeout(poll, 250);
            })();
        });
    }

    function mount(win, attempt) {
        if (!win || !win.isConnected || mounted.has(win)) return;
        const desk = win.querySelector('.gb-desk');
        const toolbar = desk && desk.querySelector('.gb-toolbar');
        const signBtn = toolbar && toolbar.querySelector('.gb-sign-btn');
        if (!signBtn) {
            // The window frame can arrive a moment before its content
            if ((attempt || 0) < 20) setTimeout(() => mount(win, (attempt || 0) + 1), 250);
            return;
        }
        mounted.set(win, controller(win, desk, toolbar, signBtn));
    }

    function unmount(win) {
        const c = mounted.get(win);
        if (!c) return;
        mounted.delete(win);
        c.destroy();
    }

    function controller(win, desk, toolbar, signBtn) {
        const entries = new Map();    // id -> entry, the same view of the book
        const snapshot = new Map();   // fallback copies, as in guestbook.js
        const hidden = new Set();
        const subscriptions = [];
        const timers = new Set();
        let known = false;            // something has answered: the list is not a guess
        let destroyed = false;
        let offConnection = null;
        let myId = '';

        try {
            JSON.parse(desk.dataset.hidden || '[]').forEach((id) => hidden.add(String(id)));
        } catch (e) { /* malformed list: hide nothing */ }

        // ---- Toolbar button ----------------------------------------------

        desk.classList.add('has-otd');
        const btn = el('button', 'mac-btn otd-btn');
        btn.type = 'button';
        btn.hidden = true;
        btn.setAttribute('aria-haspopup', 'dialog');
        btn.setAttribute('aria-expanded', 'false');
        btn.innerHTML = CALENDAR_SVG;
        btn.appendChild(el('span', 'otd-btn-label', 'On This Day'));
        const badge = el('span', 'otd-badge');
        badge.setAttribute('aria-hidden', 'true');
        btn.appendChild(badge);
        signBtn.parentNode.insertBefore(btn, signBtn);

        // ---- Popover ------------------------------------------------------

        const pop = el('div', 'otd-pop');
        pop.hidden = true;
        pop.id = 'otd-pop-' + Math.random().toString(36).slice(2, 8);
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', 'On This Day');
        pop.tabIndex = -1;
        btn.setAttribute('aria-controls', pop.id);
        const arrow = el('span', 'otd-arrow');
        arrow.setAttribute('aria-hidden', 'true');
        pop.appendChild(arrow);
        const head = el('div', 'otd-head');
        head.appendChild(el('h2', 'otd-title', 'On This Day'));
        const dateLine = el('p', 'otd-date');
        head.appendChild(dateLine);
        pop.appendChild(head);
        const body = el('div', 'otd-body');
        pop.appendChild(body);
        desk.appendChild(pop);

        function signRow(row, past) {
            const li = el('li', 'otd-entry' + (row.id === myId ? ' is-me' : ''));
            const sig = el('div', 'otd-sig');
            sig.setAttribute('aria-hidden', 'true');
            const svg = window.Signature && window.Signature.toSVG
                ? window.Signature.toSVG(row.entry.name, row.id + '#' + row.entry.variant, { colour: 'currentColor' })
                : '';
            if (svg) sig.innerHTML = svg;     // generated paths, no visitor text inside
            else sig.classList.add('is-empty');
            li.appendChild(sig);

            const meta = el('div', 'otd-meta');
            const who = el('span', 'otd-name', row.entry.name);
            meta.appendChild(who);
            if (row.entry.from) meta.appendChild(el('span', 'otd-from', 'from ' + row.entry.from));
            li.appendChild(meta);

            const when = el('time', 'otd-when');
            when.dateTime = new Date(row.entry.ts).toISOString();
            when.textContent = past
                ? new Date(row.entry.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
                : relativeTime(row.entry.ts);
            li.appendChild(when);
            return li;
        }

        function section(title, sub, rows, past) {
            const sec = el('section', 'otd-group');
            const h = el('h3', 'otd-group-title', title);
            if (sub) h.appendChild(el('span', 'otd-group-sub', sub));
            sec.appendChild(h);
            const list = el('ul', 'otd-list');
            rows.slice(0, MAX_ROWS).forEach((row) => list.appendChild(signRow(row, past)));
            sec.appendChild(list);
            if (rows.length > MAX_ROWS) {
                sec.appendChild(el('p', 'otd-more', 'and ' + (rows.length - MAX_ROWS) + ' more'));
            }
            return sec;
        }

        function inviteToSign(message) {
            const box = el('div', 'otd-empty');
            box.appendChild(el('p', 'otd-empty-text', message));
            if (!entries.has(myId) && !signBtn.disabled) {
                const go = el('button', 'mac-btn primary small otd-sign', 'Sign the Book');
                go.type = 'button';
                go.addEventListener('click', () => {
                    close(false);
                    signBtn.click();
                });
                box.appendChild(go);
            }
            return box;
        }

        function renderPopover(g) {
            dateLine.textContent = g.date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
            body.textContent = '';
            if (g.today.length) {
                body.appendChild(section('Today', null, g.today, false));
            } else {
                body.appendChild(inviteToSign(g.past.length
                    ? 'Nobody has signed today yet.'
                    : 'Nobody has signed the book on this day yet.'));
            }
            g.past.forEach((p) => {
                const dayName = new Date(p.rows[0].entry.ts)
                    .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
                body.appendChild(section(yearsAgo(g.date.getFullYear() - p.year), dayName, p.rows, true));
            });
        }

        function render() {
            if (destroyed) return;
            const g = group(entries);
            const n = g.today.length + g.past.reduce((sum, p) => sum + p.rows.length, 0);
            btn.hidden = !known;
            badge.textContent = n ? String(n > 99 ? '99+' : n) : '';
            btn.classList.toggle('has-count', n > 0);
            btn.setAttribute('aria-label', 'On This Day' + (n
                ? ', ' + (n === 1 ? '1 signature' : n + ' signatures')
                : ''));
            if (!pop.hidden) {
                renderPopover(g);
                place();
            }
        }

        let renderTimer = null;
        function scheduleRender() {
            clearTimeout(renderTimer);
            timers.delete(renderTimer);
            renderTimer = setTimeout(() => {
                timers.delete(renderTimer);
                render();
            }, 120);
            timers.add(renderTimer);
        }

        function markKnown() {
            if (known) return;
            known = true;
            scheduleRender();
        }

        // ---- Open / close ------------------------------------------------

        function place() {
            const d = desk.getBoundingClientRect();
            const b = btn.getBoundingClientRect();
            const width = Math.min(340, d.width - 16);
            pop.style.width = width + 'px';
            const centre = b.left + b.width / 2 - d.left;
            const left = Math.max(8, Math.min(centre - width / 2, d.width - width - 8));
            const top = b.bottom - d.top + 9;
            pop.style.left = left + 'px';
            pop.style.top = top + 'px';
            pop.style.maxHeight = Math.max(160, d.height - top - 10) + 'px';
            arrow.style.left = Math.max(14, Math.min(centre - left, width - 14)) + 'px';
        }

        function open() {
            if (!pop.hidden) return;
            pop.hidden = false;
            btn.setAttribute('aria-expanded', 'true');
            renderPopover(group(entries));
            place();
            pop.focus({ preventScroll: true });
            document.addEventListener('pointerdown', onOutside, true);
            if (window.track) window.track('guestbook_on_this_day', { count: pop.querySelectorAll('.otd-entry').length });
        }

        function close(returnFocus) {
            if (pop.hidden) return;
            pop.hidden = true;
            btn.setAttribute('aria-expanded', 'false');
            document.removeEventListener('pointerdown', onOutside, true);
            if (returnFocus) btn.focus({ preventScroll: true });
        }

        function onOutside(e) {
            if (pop.contains(e.target) || btn.contains(e.target)) return;
            close(false);
        }

        btn.addEventListener('click', () => {
            if (pop.hidden) open();
            else close(true);
        });
        pop.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close(true);
                return;
            }
            // Arrow keys belong to the popover's scroll, not the book's pages
            if (e.key !== 'Tab') e.stopPropagation();
        });
        pop.addEventListener('focusout', (e) => {
            const to = e.relatedTarget;
            if (to && !pop.contains(to) && to !== btn) close(false);
        });
        // Opening the signing card covers the book: the popover goes with it
        signBtn.addEventListener('click', () => close(false));

        let resizeObserver = null;
        if ('ResizeObserver' in window) {
            resizeObserver = new ResizeObserver(() => { if (!pop.hidden) place(); });
            resizeObserver.observe(desk);
        }

        // Relative times, and the date turning over while the window is open
        const tick = setInterval(() => {
            if (!win.isConnected) return unmount(win);
            render();
        }, 60000);
        timers.add(tick);

        // ---- Data ----------------------------------------------------------

        function loadSnapshot() {
            const url = desk.dataset.snapshot;
            if (!url || !window.fetch) return;
            fetch(url).then((res) => (res.ok ? res.json() : null)).then((data) => {
                if (destroyed || !data || !Array.isArray(data.entries)) return;
                data.entries.slice(-MAX_ENTRIES).forEach((raw) => {
                    const id = raw && raw.id;
                    if (typeof id !== 'string' || !id || id.length > MAX_ID_LEN || hidden.has(id)) return;
                    const entry = readEntry(raw);
                    if (!entry) return;
                    snapshot.set(id, entry);
                    if (!entries.has(id)) entries.set(id, entry);
                });
                markKnown();
                scheduleRender();
            }).catch(() => { /* the relay may still answer */ });
        }

        function connect(SiteGun) {
            if (destroyed) return;
            myId = SiteGun.visitorId ? SiteGun.visitorId() : '';
            SiteGun.paths.apps.guestbook().map().on(function (data, id, _msg, ev) {
                if (ev && typeof ev.off === 'function' && subscriptions.indexOf(ev) === -1) subscriptions.push(ev);
                if (destroyed) return;
                markKnown();
                if (typeof id !== 'string' || !id || id.length > MAX_ID_LEN || hidden.has(id)) return;
                const entry = readEntry(data);
                if (!entry) {
                    // A blanked entry is loss or vandalism: keep the snapshot copy
                    const backup = snapshot.get(id);
                    if (backup) entries.set(id, backup);
                    else if (!entries.delete(id)) return;
                } else {
                    if (!entries.has(id) && entries.size >= MAX_ENTRIES && id !== myId) return;
                    entries.set(id, entry);
                }
                scheduleRender();
            });
            if (SiteGun.getConnection) {
                let graceTimer = null;
                offConnection = SiteGun.getConnection().onChange((connected) => {
                    // A relay that stays connected and silent has an empty book
                    clearTimeout(graceTimer);
                    timers.delete(graceTimer);
                    if (connected && !known) {
                        graceTimer = setTimeout(markKnown, EMPTY_BOOK_GRACE_MS);
                        timers.add(graceTimer);
                    }
                    // The invite to sign follows the book's own Sign button
                    scheduleRender();
                });
            }
        }

        loadSnapshot();
        whenGun().then(connect).catch(() => { /* snapshot only, or nothing */ });

        return {
            destroy() {
                destroyed = true;
                close(false);
                timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
                timers.clear();
                subscriptions.forEach((ev) => { try { ev.off(); } catch (e) { /* ignore */ } });
                subscriptions.length = 0;
                if (offConnection) offConnection();
                if (resizeObserver) resizeObserver.disconnect();
                btn.remove();
                pop.remove();
                desk.classList.remove('has-otd');
            }
        };
    }

    window.OnThisDay = { mount: mount, unmount: unmount };
})();
