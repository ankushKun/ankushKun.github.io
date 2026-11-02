/**
 * All Apps, as the Lion to Mavericks Launchpad.
 *
 * A full-screen overlay instead of a window: every app over the blurred
 * desktop picture, a search field (typing anywhere goes into it), pages of
 * 7x5 (4 across on a phone) with dots, swipes, the scroll wheel and the arrow
 * keys to move between them, and the games in a folder that opens as a band
 * across the grid. Opened from the Dock, F4, /?open=launchpad, Spotlight and
 * the Go menu: mavericks.js hands any request for the "launchpad" app here.
 *
 * Markup: #launchpad-template (layouts/partials/apps/launchpad/overlay.html),
 * stamped out on first open. Styles: the "launchpad" app stylesheet
 * (assets/css/apps/launchpad.css), loaded on first open if the Dock hover has
 * not already warmed it. Apps open through SiteShell.openApp, which knows the
 * page behind each app (Privacy, Credits and the rest open from here too).
 */
(function () {
    'use strict';

    const template = document.getElementById('launchpad-template');
    if (!template || window.SiteLaunchpad) return;

    const CLOSE_MS = 200;
    const STYLE_WAIT_MS = 2500;
    const SWIPE_FRACTION = 0.14;   // of the page width, to flip by dragging
    const WHEEL_STEP = 60;         // accumulated delta that flips a page
    const WHEEL_LOCK_MS = 520;

    let root = null;
    let els = {};
    let topItems = [];             // the first level: apps and the folder
    let folderItems = [];          // inside the folder
    let shown = [];                // what the grid is showing now
    let layout = { cols: 7, rows: 5, perPage: 35, width: 0 };
    let page = 0;
    let pages = 1;
    let isOpen = false;
    let folder = null;             // the open folder's tile
    let opener = null;
    let closeTimer = null;

    const shell = () => window.SiteShell || {};
    const reduced = () => (shell().prefersReducedMotion ? shell().prefersReducedMotion()
        : window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const compact = () => (shell().isCompact ? shell().isCompact() : window.innerWidth <= 768);

    // ---- Build ---------------------------------------------------------

    function build() {
        if (root) return;
        root = template.content.firstElementChild.cloneNode(true);
        document.body.appendChild(root);
        els = {
            input: root.querySelector('.lp-search-input'),
            pages: root.querySelector('.lp-pages'),
            track: root.querySelector('.lp-track'),
            dots: root.querySelector('.lp-dots'),
            empty: root.querySelector('.lp-empty'),
            band: root.querySelector('.lp-band'),
            bandGrid: root.querySelector('.lp-band-grid')
        };
        const all = [...root.querySelectorAll('.lp-source .lp-item')];
        topItems = all.filter((el) => !el.dataset.folder);
        folderItems = all.filter((el) => el.dataset.folder);
        root.querySelector('.lp-source').remove();
        // A folder with nothing in it is not a folder
        if (!folderItems.length) topItems = topItems.filter((el) => !el.classList.contains('lp-folder'));

        root.addEventListener('click', onClick);
        root.addEventListener('keydown', onKeydown);
        root.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });
        root.addEventListener('wheel', onWheel, { passive: false });
        els.pages.addEventListener('pointerdown', onPointerDown);
        els.input.addEventListener('input', () => search(els.input.value));
        window.addEventListener('resize', () => {
            if (!isOpen) return;
            closeFolder(true);
            measure();
            render(shown);
        });
    }

    function stylesReady() {
        const s = shell();
        const ready = s.stylesReady ? s.stylesReady('launchpad') : Promise.resolve();
        return Promise.race([
            Promise.resolve(ready).catch(() => { /* shown unstyled beats not shown */ }),
            new Promise((resolve) => setTimeout(resolve, STYLE_WAIT_MS))
        ]);
    }

    // ---- Layout --------------------------------------------------------

    function dockHeight() {
        const dock = document.getElementById('dock');
        if (!dock || dock.hidden) return 0;
        const rect = dock.getBoundingClientRect();
        return rect.height ? window.innerHeight - rect.top : 0;
    }

    /** Fit the grid to the screen: 7x5 like Launchpad, fewer on small screens. */
    function measure() {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const small = compact();
        const searchRect = root.querySelector('.lp-search').getBoundingClientRect();
        const top = Math.round(searchRect.bottom + (small ? 18 : 34));
        const bottom = Math.round(dockHeight() + (small ? 30 : 44));
        const availW = vw - (small ? 16 : Math.max(48, vw * 0.08));
        const availH = Math.max(120, vh - top - bottom);

        const cols = small ? 4 : (vw < 760 ? 5 : vw < 1000 ? 6 : 7);
        const minCellH = small ? 92 : 112;
        const rows = Math.max(2, Math.min(small ? 6 : 5, Math.floor(availH / minCellH)));
        const cellW = Math.floor(Math.min(availW / cols, small ? 96 : 176));
        const cellH = Math.floor(Math.min(availH / rows, small ? 108 : 168));
        const icon = Math.round(Math.max(44, Math.min(cellW * (small ? 0.7 : 0.62), cellH - (small ? 32 : 40), small ? 64 : 104)));

        layout = { cols, rows, perPage: cols * rows, width: vw, cellH, top };
        root.classList.toggle('is-compact', small);
        const style = root.style;
        style.setProperty('--lp-cols', cols);
        style.setProperty('--lp-cell-w', cellW + 'px');
        style.setProperty('--lp-cell-h', cellH + 'px');
        style.setProperty('--lp-icon', icon + 'px');
        style.setProperty('--lp-top', top + 'px');
        style.setProperty('--lp-bottom', bottom + 'px');
    }

    /** Lay `list` out in pages and keep the current page where it can be. */
    function render(list) {
        shown = list;
        pages = Math.max(1, Math.ceil(list.length / layout.perPage));
        page = Math.min(page, pages - 1);
        const frag = document.createDocumentFragment();
        for (let p = 0; p < pages; p++) {
            const el = document.createElement('div');
            el.className = 'lp-page';
            list.slice(p * layout.perPage, (p + 1) * layout.perPage).forEach((item) => {
                item.style.removeProperty('--lp-shift');
                el.appendChild(item);
            });
            frag.appendChild(el);
        }
        els.track.replaceChildren(frag);
        els.empty.hidden = list.length > 0;
        renderDots();
        goTo(page, true);
    }

    function renderDots() {
        els.dots.hidden = pages < 2;
        if (pages < 2) {
            els.dots.replaceChildren();
            return;
        }
        const frag = document.createDocumentFragment();
        for (let p = 0; p < pages; p++) {
            const dot = document.createElement('button');
            dot.type = 'button';
            dot.className = 'lp-dot';
            dot.dataset.page = String(p);
            dot.setAttribute('aria-label', 'Page ' + (p + 1) + ' of ' + pages);
            frag.appendChild(dot);
        }
        els.dots.replaceChildren(frag);
    }

    function goTo(target, instant) {
        page = Math.max(0, Math.min(pages - 1, target));
        if (instant) els.track.classList.add('is-dragging');
        els.track.style.transform = 'translateX(' + (-page * 100) + '%)';
        if (instant) {
            void els.track.offsetWidth;
            els.track.classList.remove('is-dragging');
        }
        els.dots.querySelectorAll('.lp-dot').forEach((dot, i) => {
            dot.setAttribute('aria-current', i === page ? 'true' : 'false');
        });
        // Only the page on screen is reachable by Tab
        els.track.querySelectorAll('.lp-page').forEach((el, i) => { el.inert = i !== page; });
    }

    // ---- Search --------------------------------------------------------

    function search(value) {
        const terms = String(value || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
        closeFolder(true);
        page = 0;
        if (!terms.length) {
            render(topItems);
            return;
        }
        const pool = topItems.filter((el) => !el.classList.contains('lp-folder')).concat(folderItems);
        // Every term starts a word of the name or an alias ("pre" finds
        // System Preferences, "cv" the Resume), as Launchpad matches
        render(pool.filter((el) => {
            const words = (el.dataset.search || '').split(/[\s\-]+/);
            return terms.every((t) => words.some((word) => word.indexOf(t) === 0));
        }));
    }

    // ---- Folder --------------------------------------------------------

    /** Split the grid under the folder's row and open the band in the gap. */
    function openFolder(tile) {
        if (folder === tile) return;
        closeFolder(true);
        folder = tile;
        tile.setAttribute('aria-expanded', 'true');
        root.classList.add('has-folder');

        els.bandGrid.replaceChildren(...folderItems);
        folderItems.forEach((el) => el.style.removeProperty('--lp-shift'));
        const rows = Math.ceil(folderItems.length / layout.cols);
        const bandH = 10 + 44 + rows * layout.cellH + 8;

        const pagesRect = els.pages.getBoundingClientRect();
        const tileRect = tile.getBoundingClientRect();
        const limit = window.innerHeight - dockHeight() - 8;
        let bandTop = tileRect.bottom;
        // No room under the folder: the rows above move up instead
        const lift = Math.max(0, Math.min(bandTop + bandH - limit, bandTop - pagesRect.top));

        const rowOf = (el) => Math.round(el.offsetTop / layout.cellH);
        const tileRow = rowOf(tile);
        tile.parentElement.querySelectorAll('.lp-item').forEach((el) => {
            const shift = rowOf(el) > tileRow ? bandH - lift : -lift;
            if (shift) el.style.setProperty('--lp-shift', shift + 'px');
        });
        bandTop -= lift;

        const band = els.band;
        band.style.setProperty('--lp-band-top', bandTop + 'px');
        band.style.setProperty('--lp-band-h', bandH + 'px');
        band.style.setProperty('--lp-notch-x', (tileRect.left + tileRect.width / 2) + 'px');
        band.hidden = false;
        void band.offsetWidth;
        band.classList.add('is-open');
        // Only the folder is reachable while it is open
        els.track.inert = true;
        const first = folderItems[0];
        if (first) first.focus({ preventScroll: true });
    }

    function closeFolder(instant) {
        if (!folder) return;
        const tile = folder;
        folder = null;
        tile.setAttribute('aria-expanded', 'false');
        root.classList.remove('has-folder');
        els.track.inert = false;
        goTo(page, true);
        tile.parentElement && tile.parentElement.querySelectorAll('.lp-item').forEach((el) => {
            el.style.removeProperty('--lp-shift');
        });
        const band = els.band;
        band.classList.remove('is-open');
        const done = () => { if (!folder) band.hidden = true; };
        if (instant || reduced()) done();
        else setTimeout(done, 280);
        if (!instant && isOpen) tile.focus({ preventScroll: true });
    }

    // ---- Open and close ------------------------------------------------

    async function open(origin) {
        if (isOpen) return;
        isOpen = true;
        clearTimeout(closeTimer);
        build();
        opener = origin && origin.focus ? origin : document.activeElement;
        await stylesReady();
        if (!isOpen) return;

        root.classList.toggle('is-still', reduced());
        root.hidden = false;
        document.body.classList.add('launchpad-open');
        els.input.value = '';
        measure();
        page = 0;
        render(topItems);
        void root.offsetWidth;
        root.classList.add('is-open');
        // A phone would put its keyboard up over the grid
        if (window.matchMedia('(pointer: fine)').matches) els.input.focus({ preventScroll: true });
        else root.focus({ preventScroll: true });
        if (typeof window.track === 'function') window.track('launchpad_opened');
    }

    function close(options) {
        if (!isOpen) return;
        const restoreFocus = !options || options.restoreFocus !== false;
        isOpen = false;
        closeFolder(true);
        root.classList.remove('is-open');
        const done = () => {
            if (isOpen) return;
            root.hidden = true;
            document.body.classList.remove('launchpad-open');
        };
        clearTimeout(closeTimer);
        if (reduced()) done();
        else closeTimer = setTimeout(done, CLOSE_MS);
        if (restoreFocus && opener && opener.isConnected) opener.focus({ preventScroll: true });
        opener = null;
        forgetDeepLink();
    }

    /** /?open=launchpad has been carried out: the address goes back to the desktop. */
    function forgetDeepLink() {
        try {
            const url = new URL(window.location.href);
            const token = url.searchParams.get('open');
            const app = token && shell().resolveApp ? shell().resolveApp(token) : null;
            if (!app || app.id !== 'launchpad') return;
            url.searchParams.delete('open');
            history.replaceState(history.state, '', url.pathname + url.search + url.hash);
        } catch (e) { /* history unavailable: the address keeps the link */ }
    }

    function launch(item) {
        const id = item.dataset.app;
        close({ restoreFocus: false });
        const s = shell();
        const origin = item.querySelector('.app-icon') || item;
        if (s.openApp && s.openApp(id, origin, 'launchpad')) return;
        if (typeof window.openContentWindow === 'function') window.openContentWindow(id, item.textContent.trim(), null);
    }

    // ---- Input ---------------------------------------------------------

    let suppressClick = false;

    function onClick(e) {
        if (suppressClick) {
            suppressClick = false;
            e.preventDefault();
            return;
        }
        const item = e.target.closest('.lp-item');
        if (item) {
            if (item.dataset.openFolder) {
                if (folder === item) closeFolder();
                else openFolder(item);
            } else {
                launch(item);
            }
            return;
        }
        const dot = e.target.closest('.lp-dot');
        if (dot) {
            goTo(Number(dot.dataset.page));
            return;
        }
        if (e.target.closest('.lp-search, .lp-band')) return;
        // Empty space: out of a folder first, then out of Launchpad
        if (folder) closeFolder();
        else close();
    }

    /** The items Tab and the arrow keys move through right now. */
    function navigable() {
        if (folder) return folderItems;
        const current = els.track.children[page];
        return current ? [...current.children] : [];
    }

    function onKeydown(e) {
        const key = e.key;
        if (key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (folder) closeFolder();
            else if (els.input.value) {
                els.input.value = '';
                search('');
                els.input.focus({ preventScroll: true });
            } else close();
            return;
        }

        if (key === 'Tab') {
            e.preventDefault();
            const ring = [els.input].concat(navigable(), [...els.dots.querySelectorAll('.lp-dot')]);
            const at = ring.indexOf(document.activeElement);
            const next = at === -1 ? 0 : (at + (e.shiftKey ? -1 : 1) + ring.length) % ring.length;
            ring[next].focus({ preventScroll: true });
            return;
        }

        const inInput = e.target === els.input;
        if (key === 'Enter' && inInput) {
            e.preventDefault();
            const first = shown.find((el) => !el.dataset.openFolder) || shown[0];
            if (first) first.click();
            return;
        }

        if (key.indexOf('Arrow') === 0) {
            const items = navigable();
            const at = items.indexOf(document.activeElement);
            if (inInput) {
                // Out of an empty search field, the arrows browse the grid
                if (key === 'ArrowDown' && items.length) {
                    e.preventDefault();
                    items[0].focus({ preventScroll: true });
                } else if (!els.input.value && (key === 'ArrowLeft' || key === 'ArrowRight') && !folder) {
                    e.preventDefault();
                    goTo(page + (key === 'ArrowRight' ? 1 : -1));
                }
                return;
            }
            e.preventDefault();
            // From a dot or nowhere in particular: onto the page's first item
            if (at === -1) {
                if (items.length) items[0].focus({ preventScroll: true });
                return;
            }
            const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -layout.cols, ArrowDown: layout.cols }[key];
            if (folder) {
                const target = items[at + step];
                if (target) target.focus({ preventScroll: true });
                return;
            }
            // Across the whole list, so moving past a page's edge turns it
            const index = page * layout.perPage + at + step;
            if (index < 0 || index >= shown.length) {
                if (key === 'ArrowUp') els.input.focus({ preventScroll: true });
                return;
            }
            const target = Math.floor(index / layout.perPage);
            if (target !== page) goTo(target);
            shown[index].focus({ preventScroll: true });
            return;
        }

        // Typing anywhere searches, as in Launchpad
        if (!inInput && key.length === 1 && key !== ' ' && !e.metaKey && !e.ctrlKey && !e.altKey) {
            els.input.focus({ preventScroll: true });
        }
    }

    let wheelSum = 0;
    let wheelLockedUntil = 0;
    let wheelReset = null;

    function onWheel(e) {
        e.preventDefault();
        if (folder || pages < 2) return;
        const now = Date.now();
        if (now < wheelLockedUntil) return;
        wheelSum += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        clearTimeout(wheelReset);
        wheelReset = setTimeout(() => { wheelSum = 0; }, 200);
        if (Math.abs(wheelSum) < WHEEL_STEP) return;
        goTo(page + (wheelSum > 0 ? 1 : -1));
        wheelSum = 0;
        wheelLockedUntil = now + WHEEL_LOCK_MS;
    }

    // Drag or swipe the pages sideways
    function onPointerDown(e) {
        if (folder || pages < 2 || (e.pointerType === 'mouse' && e.button !== 0)) return;
        const startX = e.clientX;
        const startY = e.clientY;
        const startT = Date.now();
        const width = els.pages.clientWidth || window.innerWidth;
        let dragging = false;
        let dx = 0;

        const move = (ev) => {
            if (ev.pointerId !== e.pointerId) return;
            dx = ev.clientX - startX;
            if (!dragging) {
                if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(ev.clientY - startY)) return;
                dragging = true;
                els.track.classList.add('is-dragging');
                try { els.pages.setPointerCapture(ev.pointerId); } catch (err) { /* ignore */ }
            }
            // Resist past the first and last page
            const edge = (page === 0 && dx > 0) || (page === pages - 1 && dx < 0);
            const offset = edge ? dx / 3 : dx;
            els.track.style.transform = 'translateX(calc(' + (-page * 100) + '% + ' + Math.round(offset) + 'px))';
        };
        const up = (ev) => {
            if (ev.pointerId !== e.pointerId) return;
            els.pages.removeEventListener('pointermove', move);
            els.pages.removeEventListener('pointerup', up);
            els.pages.removeEventListener('pointercancel', up);
            if (!dragging) return;
            els.track.classList.remove('is-dragging');
            const fast = Math.abs(dx) > 30 && Date.now() - startT < 250;
            if (Math.abs(dx) > width * SWIPE_FRACTION || fast) goTo(page + (dx < 0 ? 1 : -1));
            else goTo(page);
            // The click that ends a drag is not a click on what it ended over
            suppressClick = ev.type === 'pointerup';
            setTimeout(() => { suppressClick = false; }, 0);
        };
        els.pages.addEventListener('pointermove', move);
        els.pages.addEventListener('pointerup', up);
        els.pages.addEventListener('pointercancel', up);
    }

    document.addEventListener('keydown', (e) => {
        // Escape with focus outside (the Dock was clicked, say) still closes it
        if (e.key === 'Escape' && isOpen && !root.contains(e.target)) {
            e.preventDefault();
            close();
            return;
        }
        // F4, the Launchpad key on Mac keyboards
        if (e.key !== 'F4' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
        e.preventDefault();
        if (isOpen) close();
        else open(null);
    });

    window.SiteLaunchpad = {
        open,
        close,
        toggle(origin) {
            if (isOpen) close();
            else open(origin);
        },
        isOpen: () => isOpen
    };
})();
