/**
 * Software Update - the site's changelog, App Store "Updates" style.
 *
 * Loaded the first time the window opens. The list comes from
 * data/changelog.json (written from `git log` by scripts/changelog.mjs),
 * published as its own file and named by the window's data-src.
 *
 * "New since your last visit" is everything committed after the newest update
 * this visitor has already been shown. That mark lives in localStorage under
 * "software-update-v1" and is shared with the Apple menu badge
 * (layouts/partials/apps/updates/boot.html, window.SoftwareUpdate).
 */
(function () {
    'use strict';

    if (window.initSoftwareUpdate) return;

    const STORE_KEY = 'software-update-v1';
    const SELF_ID = 'software-update';
    const NOTES_SHOWN = 3;       // notes visible before "More"
    const EARLIER_SHOWN = 8;     // earlier updates listed before "Show Older Updates"
    const MAX_UPDATES = 500;
    const MAX_NOTES = 40;
    const MAX_LOG = 200;

    const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'
    });

    let changelogLoad = null; // one fetch, shared by every open of the window
    let rowSeq = 0;

    // ---- data ------------------------------------------------------------

    function text(value, max) {
        return typeof value === 'string' ? value.trim().slice(0, max) : '';
    }

    /** Keep only what the window renders, in the shape it expects. */
    function normalise(raw) {
        if (!raw || !Array.isArray(raw.updates)) throw new Error('Malformed changelog');
        const repo = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(raw.repo || '') ? raw.repo : '';

        const updates = [];
        for (const item of raw.updates.slice(0, MAX_UPDATES)) {
            if (!item || typeof item !== 'object') continue;
            const date = /^\d{4}-\d{2}-\d{2}$/.test(item.date || '') ? item.date : '';
            const ts = Number(item.ts);
            const title = text(item.title, 120);
            const notes = (Array.isArray(item.notes) ? item.notes : [])
                .map((note) => text(note, 240)).filter(Boolean).slice(0, MAX_NOTES);
            if (!date || !(ts > 0) || !title || !notes.length) continue;

            const log = (Array.isArray(item.log) ? item.log : [])
                .filter((entry) => Array.isArray(entry) && /^[0-9a-f]{7,40}$/.test(entry[0] || ''))
                .map((entry) => ({ hash: entry[0], subject: text(entry[1], 200) }))
                .slice(0, MAX_LOG);

            updates.push({
                date, ts, title, notes, log,
                build: Number.isInteger(item.build) && item.build > 0 ? item.build : 0,
                app: text(item.app, 60)
            });
        }
        if (!updates.length) throw new Error('Empty changelog');
        updates.sort((a, b) => b.ts - a.ts);

        return {
            repo,
            head: /^[0-9a-f]{7,40}$/.test(raw.head || '') ? raw.head : '',
            commits: Number.isInteger(raw.commits) && raw.commits > 0 ? raw.commits : 0,
            updates
        };
    }

    function loadChangelog(src) {
        if (!changelogLoad) {
            changelogLoad = fetch(src, { credentials: 'same-origin' })
                .then((res) => {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.json();
                })
                .then(normalise)
                .catch((err) => {
                    changelogLoad = null; // let Retry fetch again
                    throw err;
                });
        }
        return changelogLoad;
    }

    function readSeen() {
        if (window.SoftwareUpdate && typeof window.SoftwareUpdate.seen === 'function') {
            return window.SoftwareUpdate.seen();
        }
        try {
            const state = JSON.parse(localStorage.getItem(STORE_KEY));
            return (state && Number(state.seen)) || 0;
        } catch (e) {
            return 0;
        }
    }

    function markSeen(stamp) {
        if (window.SoftwareUpdate && typeof window.SoftwareUpdate.markSeen === 'function') {
            window.SoftwareUpdate.markSeen(stamp);
            return;
        }
        try {
            const state = JSON.parse(localStorage.getItem(STORE_KEY)) || {};
            state.seen = Math.max(Number(state.seen) || 0, stamp);
            localStorage.setItem(STORE_KEY, JSON.stringify(state));
        } catch (e) { /* storage blocked: nothing to remember */ }
    }

    /** id -> registry entry (title, size, permalink, icon markup). */
    function readRegistry() {
        const apps = new Map();
        try {
            const list = JSON.parse(document.getElementById('app-registry').textContent);
            for (const app of list) {
                if (app && typeof app.id === 'string') apps.set(app.id, app);
            }
        } catch (e) { /* no registry: rows simply have no icon or Open button */ }
        return apps;
    }

    // ---- rendering -------------------------------------------------------

    function el(tag, className, content) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (content !== undefined) node.textContent = content;
        return node;
    }

    function formatDate(date) {
        return DATE_FORMAT.format(new Date(date + 'T12:00:00Z'));
    }

    function plural(n, word) {
        return n + ' ' + word + (n === 1 ? '' : 's');
    }

    function commitLink(repo, hash) {
        const code = el('code', '', hash.slice(0, 7));
        if (!repo) return code;
        const link = el('a', 'su-commit');
        link.href = repo + '/commit/' + hash;
        link.target = '_blank';
        link.rel = 'noopener';
        link.dataset.open = 'tab'; // GitHub does not embed: always a new tab
        link.setAttribute('aria-label', 'Commit ' + hash.slice(0, 7) + ' on GitHub');
        link.appendChild(code);
        return link;
    }

    function buildRow(update, ctx) {
        const app = ctx.apps.get(update.app);
        const iconSource = app || ctx.apps.get(SELF_ID);
        const isNew = update.ts > ctx.seen;
        const seq = ++rowSeq;

        const row = el('article', 'su-row' + (isNew ? ' is-new' : ''));
        const titleId = 'su-title-' + seq;
        row.setAttribute('aria-labelledby', titleId);

        const icon = el('div', 'su-icon');
        icon.setAttribute('aria-hidden', 'true');
        // Site-generated markup from the app registry (never visitor data)
        if (iconSource && iconSource.iconHtml) icon.innerHTML = iconSource.iconHtml;
        row.appendChild(icon);

        const main = el('div', 'su-main');

        const title = el('h4', 'su-title');
        title.id = titleId;
        title.tabIndex = -1;
        if (isNew) {
            title.appendChild(el('span', 'su-new', 'New'));
        }
        title.appendChild(el('span', 'su-title-text', update.title));
        main.appendChild(title);

        const meta = el('div', 'su-meta');
        const time = el('time', '', formatDate(update.date));
        time.dateTime = update.date;
        meta.appendChild(time);
        if (update.build) meta.appendChild(el('span', '', 'Build ' + update.build));
        main.appendChild(meta);

        const notes = el('ul', 'su-notes');
        // A one-commit day is titled with its own note: say it once
        const titleOnly = update.notes.length === 1
            && update.notes[0].toLowerCase() === update.title.toLowerCase();
        if (titleOnly) notes.hidden = true;
        update.notes.forEach((note, i) => {
            const li = el('li', '', note);
            if (i >= NOTES_SHOWN) {
                li.hidden = true;
                li.dataset.extra = '';
            }
            notes.appendChild(li);
        });
        main.appendChild(notes);

        // "More" opens the rest of the notes and the commits behind the update
        if (update.notes.length > NOTES_SHOWN || update.log.length) {
            const detailsId = 'su-log-' + seq;
            const more = el('button', 'su-more', 'More…');
            more.type = 'button';
            more.setAttribute('aria-expanded', 'false');
            more.setAttribute('aria-controls', detailsId);

            const details = el('div', 'su-details');
            details.id = detailsId;
            details.hidden = true;
            if (update.log.length) {
                details.appendChild(el('div', 'su-log-label', plural(update.log.length, 'commit')));
                const log = el('ul', 'su-log');
                for (const entry of update.log) {
                    const li = el('li');
                    li.appendChild(commitLink(ctx.repo, entry.hash));
                    li.appendChild(el('span', 'su-log-subject', entry.subject));
                    log.appendChild(li);
                }
                details.appendChild(log);
            }

            more.addEventListener('click', () => {
                const open = more.getAttribute('aria-expanded') !== 'true';
                more.setAttribute('aria-expanded', String(open));
                more.textContent = open ? 'Less' : 'More…';
                details.hidden = !open;
                notes.querySelectorAll('li[data-extra]').forEach((li) => { li.hidden = !open; });
                if (open && window.track) window.track('software_update_details', { date: update.date });
            });

            main.appendChild(more);
            main.appendChild(details);
        }
        row.appendChild(main);

        if (app && typeof window.openWindow === 'function') {
            const action = el('div', 'su-action');
            const open = el('button', 'mac-btn small su-open', 'Open');
            open.type = 'button';
            open.setAttribute('aria-label', 'Open ' + (app.label || app.title || app.id));
            open.addEventListener('click', () => {
                if (window.track) window.track('software_update_open_app', { app: app.id, date: update.date });
                window.openWindow(app.id, app.title || app.id,
                    { width: app.width || 1000, height: app.height || 700 }, app.contentPermalink || null);
            });
            action.appendChild(open);
            row.appendChild(action);
        }

        return row;
    }

    function buildSection(label, updates, ctx) {
        const section = el('section', 'su-section');
        const heading = el('h3', 'su-section-title', label);
        section.appendChild(heading);
        for (const update of updates) section.appendChild(buildRow(update, ctx));
        return section;
    }

    /** Earlier updates, one section per year. */
    function appendByYear(parent, updates, ctx) {
        let year = '';
        let batch = [];
        const sections = [];
        const flush = () => {
            if (!batch.length) return;
            // Carry on under the last heading when "Show Older Updates" lands mid-year
            const last = parent.lastElementChild;
            if (last && last.dataset && last.dataset.year === year) {
                for (const update of batch) last.appendChild(buildRow(update, ctx));
                sections.push(last);
            } else {
                const section = buildSection(year, batch, ctx);
                section.dataset.year = year;
                parent.appendChild(section);
                sections.push(section);
            }
            batch = [];
        };
        for (const update of updates) {
            const y = update.date.slice(0, 4);
            if (y !== year) {
                flush();
                year = y;
            }
            batch.push(update);
        }
        flush();
        return sections;
    }

    function render(win, data) {
        const root = win.querySelector('.su-window');
        const scroll = root.querySelector('.su-scroll');
        const status = root.querySelector('.su-status');
        const build = root.querySelector('.su-build');
        const total = root.querySelector('.su-total');

        const ctx = { apps: readRegistry(), repo: data.repo, seen: readSeen() };
        // No mark at all (storage blocked, or the badge script did not run):
        // a first look, where nothing counts as new
        if (!ctx.seen) ctx.seen = data.updates[0].ts;

        const fresh = data.updates.filter((update) => update.ts > ctx.seen);
        const earlier = data.updates.filter((update) => update.ts <= ctx.seen);

        const list = el('div', 'su-list');

        if (fresh.length) {
            list.appendChild(buildSection('New Since Your Last Visit', fresh, ctx));
        } else {
            const caughtUp = el('div', 'su-uptodate');
            const mark = el('div', 'su-uptodate-icon');
            mark.setAttribute('aria-hidden', 'true');
            const self = ctx.apps.get(SELF_ID);
            if (self && self.iconHtml) mark.innerHTML = self.iconHtml;
            caughtUp.appendChild(mark);
            const copy = el('div', 'su-uptodate-copy');
            copy.appendChild(el('div', 'su-uptodate-title', 'You’re up to date'));
            copy.appendChild(el('div', 'su-uptodate-text',
                'Nothing new since your last visit. The latest update was on ' + formatDate(data.updates[0].date) + '.'));
            caughtUp.appendChild(copy);
            list.appendChild(caughtUp);
        }

        const firstBatch = earlier.slice(0, EARLIER_SHOWN);
        const rest = earlier.slice(EARLIER_SHOWN);
        appendByYear(list, firstBatch, ctx);

        if (rest.length) {
            const footer = el('div', 'su-older');
            const button = el('button', 'mac-btn su-older-btn', 'Show Older Updates');
            button.type = 'button';
            button.addEventListener('click', () => {
                const before = list.querySelectorAll('.su-row').length;
                footer.remove();
                appendByYear(list, rest, ctx);
                // Keyboard focus moves to the first update that just appeared
                const first = list.querySelectorAll('.su-row')[before];
                const target = first && first.querySelector('.su-title');
                if (target) target.focus({ preventScroll: true });
                if (first) first.scrollIntoView({ block: 'nearest' });
                if (window.track) window.track('software_update_show_older', { count: rest.length });
            });
            footer.appendChild(button);
            list.appendChild(footer);
        }

        scroll.replaceChildren(list);
        scroll.scrollTop = 0;

        status.textContent = fresh.length
            ? fresh.length + ' new since your last visit'
            : 'Up to date';

        if (build && data.head) {
            build.textContent = '';
            build.appendChild(document.createTextNode('Build ' + (data.updates[0].build || data.commits) + ' '));
            build.appendChild(el('code', '', data.head.slice(0, 7)));
            if (data.repo) {
                build.href = data.repo + '/commit/' + data.head;
                build.setAttribute('aria-label', 'Latest commit ' + data.head.slice(0, 7) + ' on GitHub');
                build.hidden = false;
            }
        }

        if (total) {
            total.textContent = plural(data.updates.length, 'update')
                + (data.commits ? ' from ' + plural(data.commits, 'commit') : '');
        }

        // Everything listed has now been shown: clear the Apple menu badge.
        // The "New" markers stay until this window is closed.
        markSeen(data.updates[0].ts);
        if (window.track) window.track('software_update_viewed', { new: fresh.length });
    }

    function renderError(win, retry) {
        const root = win.querySelector('.su-window');
        const scroll = root.querySelector('.su-scroll');
        const status = root.querySelector('.su-status');

        const box = el('div', 'window-empty');
        box.setAttribute('role', 'alert');
        box.appendChild(el('div', 'window-empty-title', 'Can’t check for updates'));
        box.appendChild(el('p', 'window-empty-text', 'The update list could not be loaded. Check your connection and try again.'));
        if (retry) {
            const button = el('button', 'mac-btn', 'Try Again');
            button.type = 'button';
            button.addEventListener('click', retry);
            box.appendChild(button);
        }
        scroll.replaceChildren(box);
        status.textContent = 'Unavailable';
    }

    function renderLoading(win) {
        const root = win.querySelector('.su-window');
        const loading = el('div', 'su-loading');
        const spinner = el('span', 'mac-spinner');
        spinner.setAttribute('aria-hidden', 'true');
        loading.appendChild(spinner);
        root.querySelector('.su-scroll').replaceChildren(loading);
        root.querySelector('.su-status').textContent = 'Checking for updates…';
    }

    // ---- entry point -----------------------------------------------------

    window.initSoftwareUpdate = function (win) {
        const root = win && win.querySelector('.su-window');
        if (!root || root.dataset.ready) return;
        root.dataset.ready = '1';

        let closed = false;
        win.softwareUpdateCleanup = () => { closed = true; };

        const src = root.dataset.src;
        const start = () => {
            if (!src) {
                renderError(win, null);
                return;
            }
            renderLoading(win);
            loadChangelog(src).then((data) => {
                if (!closed && win.isConnected) render(win, data);
            }).catch((err) => {
                console.error('Software Update:', err);
                if (!closed && win.isConnected) renderError(win, start);
            });
        };
        start();
    };
})();
