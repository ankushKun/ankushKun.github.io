/**
 * Personal desktop: what one visitor makes of the desktop, kept in their own
 * browser and never sent anywhere.
 *
 *   - Icon arrangement: drag desktop icons onto a grid; View > Clean Up,
 *     Sort Icons by Name and Restore Default Arrangement.
 *   - Private sticky notes: File > New Sticky Note (or the desktop's context
 *     menu). Unlike the shared note, only this browser ever sees them.
 *   - The welcome tour, shown once on a first visit; Help > Welcome Tour
 *     replays it.
 *
 * It extends the shell through window.SiteShell (assets/js/mavericks.js), and
 * the shell's menus call back through window.DesktopPersonal. Loaded on the
 * home page only, deferred after mavericks.js (layouts/_default/baseof.html).
 * Styles: assets/css/apps/desktop-personal.css and first-run.css.
 *
 * localStorage:
 *   desktop-icons-v1     { v: 1, cells: { <app id>: [column from the right, row] } }
 *   desktop-stickies-v1  [{ id, x, y, w, h, color, text }]  (at most 12 notes, 2000 characters each)
 *   site-welcome-v1      "done" once the tour was finished or skipped, "pending"
 *                        when a first visit landed on a deep link
 */
(function () {
    'use strict';

    const shell = window.SiteShell;
    if (!shell || !shell.isDesktop || window.DesktopPersonal) return;

    const desktop = document.getElementById('desktop');
    const iconsEl = desktop && desktop.querySelector('.desktop-icons');
    if (!desktop || !iconsEl) return;

    const ICONS_KEY = 'desktop-icons-v1';
    const STICKIES_KEY = 'desktop-stickies-v1';
    const WELCOME_KEY = 'site-welcome-v1';

    const track = (name, props) => {
        if (typeof window.track === 'function') window.track(name, props || {});
    };

    const store = {
        read(key) {
            try {
                const raw = localStorage.getItem(key);
                return raw ? JSON.parse(raw) : null;
            } catch (e) {
                return null; // blocked storage or a damaged value: start fresh
            }
        },
        write(key, value) {
            try {
                localStorage.setItem(key, JSON.stringify(value));
                return true;
            } catch (e) {
                return false;
            }
        },
        remove(key) {
            try { localStorage.removeItem(key); } catch (e) { /* storage blocked */ }
        }
    };

    const reducedMotion = () => (shell.prefersReducedMotion ? shell.prefersReducedMotion() : false);
    const isCompact = () => shell.isCompact();
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

    // ================================================
    // Icon arrangement
    // The default layout is the stylesheet's right-to-left column grid, in
    // balanced columns (see columnCounts). The
    // first time an icon is dragged, every icon is given a cell on a grid
    // measured from the top-right corner, and from then on they are placed
    // absolutely (.desktop-icons.is-arranged). Phones keep their launcher
    // grid: the arrangement only applies outside compact mode.
    // ================================================

    const DRAG_THRESHOLD = 5;
    // About this many icons a column, so a dozen apps read as two or three
    // even columns instead of one full-height column and a straggler.
    // layouts/index.html uses the same number for the first paint.
    const TARGET_ROWS = 5;
    let arrangement = loadArrangement();   // id -> [col, row], or null for the default flow
    let grid = null;

    function loadArrangement() {
        const saved = store.read(ICONS_KEY);
        if (!saved || saved.v !== 1 || !saved.cells || typeof saved.cells !== 'object') return null;
        const cells = {};
        Object.keys(saved.cells).slice(0, 200).forEach((id) => {
            const cell = saved.cells[id];
            if (Array.isArray(cell) && cell.length === 2 &&
                Number.isInteger(cell[0]) && Number.isInteger(cell[1]) &&
                cell[0] >= 0 && cell[1] >= 0 && cell[0] < 100 && cell[1] < 100) {
                cells[String(id).slice(0, 80)] = [cell[0], cell[1]];
            }
        });
        return Object.keys(cells).length ? cells : null;
    }

    function saveArrangement() {
        if (arrangement) store.write(ICONS_KEY, { v: 1, cells: arrangement });
        else store.remove(ICONS_KEY);
    }

    function icons() {
        return [...iconsEl.children].filter(el => el.classList.contains('desktop-icon'));
    }

    function iconKey(icon) {
        return icon.dataset.window || icon.dataset.title || '';
    }

    function iconName(icon) {
        const label = icon.querySelector('.icon-label');
        return (label ? label.textContent : icon.getAttribute('aria-label') || iconKey(icon)).trim();
    }

    /**
     * The grid pitch comes from the icons themselves: a single-line icon plus
     * the flow's gap, so an arranged column lines up with the default one.
     * Two-line labels hang into the gap below, as they do in the Finder.
     */
    function measureGrid() {
        const style = getComputedStyle(iconsEl);
        const gap = parseFloat(style.rowGap) || 8;
        const padRight = parseFloat(style.paddingRight) || 0;
        let height = Infinity;
        let width = 0;
        icons().forEach((icon) => {
            if (!icon.offsetHeight) return;
            height = Math.min(height, icon.offsetHeight);
            width = Math.max(width, icon.offsetWidth);
        });
        const cellW = (width || 80) + gap;
        const cellH = (Number.isFinite(height) ? height : 98) + gap;
        return {
            cellW,
            cellH,
            padRight,
            cols: Math.max(1, Math.floor((iconsEl.clientWidth - padRight + gap) / cellW)),
            rows: Math.max(1, Math.floor((iconsEl.clientHeight + gap) / cellH))
        };
    }

    /**
     * How many icons go in each column, right to left, for `count` icons
     * when at most `maxRows` fit. The fewest columns of about TARGET_ROWS;
     * the right-hand columns are full and the leftmost holds the remainder
     * (10 -> 5+5, 13 -> 5+5+3, 9 -> 5+4, 11 -> 4+4+3). A remainder under half
     * a column would be a straggler, so then the icons are spread evenly
     * instead (13 on a four-row screen -> 4+3+3+3, not 4+4+4+1).
     */
    function columnCounts(count, maxRows) {
        const cap = Math.max(1, Math.min(TARGET_ROWS, maxRows));
        const columns = Math.max(1, Math.ceil(count / cap));
        const rows = Math.ceil(count / columns);
        const last = count - rows * (columns - 1);
        if (columns === 1 || last * 2 >= rows) {
            return Array.from({ length: columns }, (_, i) => (i < columns - 1 ? rows : last));
        }
        const base = Math.floor(count / columns);
        const extra = count % columns;
        return Array.from({ length: columns }, (_, i) => base + (i < extra ? 1 : 0));
    }

    /** [col, row] for each of `count` icons in order, down each column, right to left. */
    function balancedCells(count, maxRows) {
        const cells = [];
        columnCounts(count, maxRows).forEach((n, col) => {
            for (let row = 0; row < n; row++) cells.push([col, row]);
        });
        return cells;
    }

    /**
     * The unarranged layout. The stylesheet's grid (rows from the template's
     * --icon-rows) is right for a normal screen; here every icon gets its
     * balanced cell for this screen, at the arranged grid's pitch, so the
     * first drag does not shift anything.
     */
    function fitDefaultLayout() {
        if (isCompact()) return;
        const list = icons();
        const g = measureGrid();
        const gap = parseFloat(getComputedStyle(iconsEl).rowGap) || 8;
        const cells = balancedCells(list.length, g.rows);
        iconsEl.style.setProperty('--icon-pitch', `${Math.round(g.cellH - gap)}px`);
        iconsEl.style.setProperty('--icon-rows', String(Math.max(1, ...cells.map(c => c[1] + 1))));
        list.forEach((icon, i) => {
            icon.style.gridColumn = String(cells[i][0] + 1);
            icon.style.gridRow = String(cells[i][1] + 1);
        });
    }

    /** Free cells in reading order for a Mac desktop: down each column, right to left. */
    function* freeCells(taken, g) {
        for (let col = 0; col < g.cols + 20; col++) {
            for (let row = 0; row < g.rows; row++) {
                if (!taken.has(col + ',' + row)) yield [col, row];
            }
        }
    }

    function nearestFreeCell(target, taken, g) {
        let best = null;
        let bestDistance = Infinity;
        for (const cell of freeCells(taken, g)) {
            const distance = Math.hypot(cell[0] - target[0], cell[1] - target[1]);
            if (distance < bestDistance) {
                best = cell;
                bestDistance = distance;
                if (distance === 0) break;
            }
            if (cell[0] > target[0] + bestDistance + 1) break;
        }
        return best || [0, 0];
    }

    /**
     * Where every icon goes on the current grid. Saved cells are honoured
     * when they fit and are free; anything else (a new app, a smaller window,
     * a clash) takes the nearest free cell. The saved cells themselves are
     * left alone, so a window that grows back restores the arrangement.
     */
    function resolveCells(g) {
        const taken = new Set();
        const result = new Map();
        const pending = [];
        icons().forEach((icon) => {
            const key = iconKey(icon);
            const cell = arrangement && arrangement[key];
            if (cell && cell[0] < g.cols && cell[1] < g.rows && !taken.has(cell.join(','))) {
                taken.add(cell.join(','));
                result.set(icon, cell);
            } else {
                pending.push([icon, cell]);
            }
        });
        pending.forEach(([icon, wanted]) => {
            const cell = wanted
                ? nearestFreeCell([Math.min(wanted[0], g.cols - 1), Math.min(wanted[1], g.rows - 1)], taken, g)
                : freeCells(taken, g).next().value;
            taken.add(cell.join(','));
            result.set(icon, cell);
        });
        return result;
    }

    function placeIcon(icon, cell) {
        icon.style.right = `${grid.padRight + cell[0] * grid.cellW}px`;
        icon.style.top = `${cell[1] * grid.cellH}px`;
        icon._cell = cell;
    }

    /** Lay the icons out from `arrangement` (or hand them back to the flow). */
    function applyArrangement(animate) {
        if (!arrangement) {
            iconsEl.classList.remove('is-arranged');
            icons().forEach((icon) => {
                icon.style.removeProperty('right');
                icon.style.removeProperty('top');
                icon._cell = null;
            });
            fitDefaultLayout();
            return;
        }
        if (isCompact()) return; // inert there; re-applied when the window widens

        settle(animate);
        iconsEl.classList.add('is-arranged');
        grid = measureGrid();
        resolveCells(grid).forEach((cell, icon) => placeIcon(icon, cell));
    }

    function settle(animate) {
        if (!animate || reducedMotion()) return;
        iconsEl.classList.add('is-settling');
        clearTimeout(iconsEl._settleTimer);
        iconsEl._settleTimer = setTimeout(() => iconsEl.classList.remove('is-settling'), 320);
    }

    /** Cells for the icons as the default flow laid them out (the first drag starts from these). */
    function cellsFromFlow(g) {
        const box = iconsEl.getBoundingClientRect();
        const columns = new Map();
        icons().forEach((icon) => {
            const rect = icon.getBoundingClientRect();
            const col = Math.max(0, Math.round((box.right - g.padRight - rect.right) / g.cellW));
            if (!columns.has(col)) columns.set(col, []);
            columns.get(col).push([icon, rect.top]);
        });
        const cells = {};
        columns.forEach((list, col) => {
            list.sort((a, b) => a[1] - b[1]).forEach(([icon], row) => { cells[iconKey(icon)] = [col, row]; });
        });
        return cells;
    }

    /** Snapshot of what is on screen, written back as the arrangement. */
    function commitCurrentCells() {
        const cells = {};
        icons().forEach((icon) => { if (icon._cell) cells[iconKey(icon)] = icon._cell.slice(); });
        arrangement = cells;
        saveArrangement();
    }

    /** Re-pack every icon, in the given order, into the first free cells. */
    function packIcons(ordered, action) {
        if (isCompact()) return;
        if (!arrangement) {
            grid = measureGrid();
            arrangement = cellsFromFlow(grid);
        }
        grid = measureGrid();
        // The same balanced columns as the default layout
        const balanced = balancedCells(ordered.length, grid.rows);
        const cells = {};
        ordered.forEach((icon, i) => {
            cells[iconKey(icon)] = balanced[i];
        });
        arrangement = cells;
        saveArrangement();
        applyArrangement(true);
        track('desktop_icons_arranged', { action });
    }

    function cleanUp() {
        // Keep the visitor's order, close the gaps
        const order = icons().map(icon => [icon, icon._cell || [0, 0]]);
        order.sort((a, b) => (a[1][0] - b[1][0]) || (a[1][1] - b[1][1]));
        packIcons(order.map(([icon]) => icon), 'clean_up');
    }

    function sortByName() {
        const order = icons().sort((a, b) => iconName(a).localeCompare(iconName(b), undefined, { sensitivity: 'base' }));
        packIcons(order, 'sort');
    }

    function resetArrangement() {
        arrangement = null;
        saveArrangement();
        settle(true);
        applyArrangement(false);
        track('desktop_icons_arranged', { action: 'reset' });
    }

    function setupIconDrag() {
        let drag = null;

        const slot = document.createElement('div');
        slot.className = 'desktop-icon-slot';
        slot.setAttribute('aria-hidden', 'true');
        slot.hidden = true;

        const targetCell = (icon) => {
            const box = iconsEl.getBoundingClientRect();
            const rect = icon.getBoundingClientRect();
            const centreX = rect.left + rect.width / 2;
            const centreY = rect.top + Math.min(rect.height, grid.cellH) / 2;
            const col = clamp(Math.floor((box.right - grid.padRight - centreX) / grid.cellW), 0, grid.cols - 1);
            const row = clamp(Math.floor((centreY - box.top) / grid.cellH), 0, grid.rows - 1);
            const taken = new Set();
            icons().forEach((other) => { if (other !== icon && other._cell) taken.add(other._cell.join(',')); });
            return nearestFreeCell([col, row], taken, grid);
        };

        const begin = () => {
            if (!arrangement) {
                grid = measureGrid();
                arrangement = cellsFromFlow(grid);
            }
            applyArrangement(false);
            if (!slot.isConnected) iconsEl.appendChild(slot);
            drag.icon.classList.add('is-dragging');
            document.body.classList.add('is-icon-dragging');
            drag.started = true;
        };

        const move = (e) => {
            if (!drag || e.pointerId !== drag.pointerId) return;
            const dx = e.clientX - drag.x;
            const dy = e.clientY - drag.y;
            if (!drag.started) {
                if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
                begin();
            }
            drag.icon.style.transform = `translate(${dx}px, ${dy}px)`;
            const cell = targetCell(drag.icon);
            drag.target = cell;
            slot.hidden = false;
            slot.style.right = `${grid.padRight + cell[0] * grid.cellW}px`;
            slot.style.top = `${cell[1] * grid.cellH}px`;
            slot.style.width = `${grid.cellW - 8}px`;
            slot.style.height = `${grid.cellH - 8}px`;
        };

        const end = (e, cancelled) => {
            if (!drag || (e && e.pointerId !== drag.pointerId)) return;
            const { icon, started, target } = drag;
            drag = null;
            window.removeEventListener('pointermove', move, true);
            window.removeEventListener('pointerup', onUp, true);
            window.removeEventListener('pointercancel', onCancel, true);
            if (!started) return;

            // Where the visitor let go, before the drag offset is dropped
            const released = icon.getBoundingClientRect();

            slot.hidden = true;
            icon.classList.remove('is-dragging');
            document.body.classList.remove('is-icon-dragging');
            icon.style.removeProperty('transform');

            // The release must not also open the icon
            const swallow = (click) => {
                click.preventDefault();
                click.stopImmediatePropagation();
            };
            window.addEventListener('click', swallow, { capture: true, once: true });
            setTimeout(() => window.removeEventListener('click', swallow, true), 0);

            if (cancelled || !target) {
                applyArrangement(false);
            } else {
                placeIcon(icon, target);
                commitCurrentCells();
                track('desktop_icons_arranged', { action: 'drag' });
            }
            glideFrom(icon, released);
        };

        // FLIP: the icon already sits in its final cell; start it at the
        // release point and let it glide in from there
        const glideFrom = (icon, from) => {
            if (reducedMotion() || typeof icon.animate !== 'function') return;
            const to = icon.getBoundingClientRect();
            const dx = from.left - to.left;
            const dy = from.top - to.top;
            if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
            icon.animate(
                [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
                { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
            );
        };
        const onUp = (e) => end(e, false);
        const onCancel = (e) => end(e, true);

        iconsEl.addEventListener('pointerdown', (e) => {
            // Mouse and pen: a finger taps (and long-presses for the menu)
            if (e.button !== 0 || e.pointerType === 'touch' || !e.isPrimary || isCompact()) return;
            const icon = e.target.closest('.desktop-icon');
            if (!icon || icon.parentElement !== iconsEl) return;
            drag = { icon, pointerId: e.pointerId, x: e.clientX, y: e.clientY, started: false, target: null };
            window.addEventListener('pointermove', move, true);
            window.addEventListener('pointerup', onUp, true);
            window.addEventListener('pointercancel', onCancel, true);
        });

        // Escape puts a dragged icon back
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && drag && drag.started) {
                e.stopPropagation();
                end(null, true);
            }
        }, true);
    }

    // ================================================
    // Private sticky notes
    // ================================================

    const STICKY_MAX = 12;
    const STICKY_TEXT_MAX = 2000;
    const STICKY_MIN = { w: 160, h: 120 };
    const STICKY_MAX_SIZE = { w: 480, h: 480 };
    const STICKY_DEFAULT = { w: 210, h: 190 };
    // The colours of the Stickies app (styles: desktop-personal.css)
    const STICKY_COLORS = [
        ['yellow', 'Yellow'], ['blue', 'Blue'], ['green', 'Green'],
        ['pink', 'Pink'], ['purple', 'Purple'], ['gray', 'Gray']
    ];
    const COLOR_IDS = new Set(STICKY_COLORS.map(([id]) => id));

    let notes = loadNotes();
    let stickiesLayer = null;
    let saveTimer = null;

    function sanitizeNote(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const number = (value, fallback) => (Number.isFinite(value) ? Math.round(value) : fallback);
        return {
            id: typeof raw.id === 'string' && /^[a-z0-9]{1,24}$/i.test(raw.id) ? raw.id : newId(),
            x: clamp(number(raw.x, 340), 0, 10000),
            y: clamp(number(raw.y, 40), 0, 10000),
            w: clamp(number(raw.w, STICKY_DEFAULT.w), STICKY_MIN.w, STICKY_MAX_SIZE.w),
            h: clamp(number(raw.h, STICKY_DEFAULT.h), STICKY_MIN.h, STICKY_MAX_SIZE.h),
            color: COLOR_IDS.has(raw.color) ? raw.color : 'yellow',
            text: typeof raw.text === 'string' ? raw.text.slice(0, STICKY_TEXT_MAX) : ''
        };
    }

    function loadNotes() {
        const saved = store.read(STICKIES_KEY);
        return Array.isArray(saved) ? saved.slice(0, STICKY_MAX).map(sanitizeNote).filter(Boolean) : [];
    }

    function newId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    function saveNotesSoon() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveNotesNow, 300);
    }

    function saveNotesNow() {
        clearTimeout(saveTimer);
        saveTimer = null;
        if (notes.length) store.write(STICKIES_KEY, notes);
        else store.remove(STICKIES_KEY);
    }

    function ensureLayer() {
        if (stickiesLayer) return stickiesLayer;
        stickiesLayer = document.createElement('div');
        stickiesLayer.className = 'private-stickies';
        desktop.appendChild(stickiesLayer);
        return stickiesLayer;
    }

    function noteElement(id) {
        return stickiesLayer ? stickiesLayer.querySelector(`.private-sticky[data-note="${id}"]`) : null;
    }

    /** Keep a note on the desktop (it may have been saved on a larger screen). */
    function fitNote(note) {
        const maxX = Math.max(0, desktop.clientWidth - note.w);
        const maxY = Math.max(0, desktop.clientHeight - 30);
        note.x = clamp(note.x, 0, maxX);
        note.y = clamp(note.y, 0, maxY);
    }

    function renderNote(note) {
        fitNote(note);
        const el = document.createElement('section');
        el.className = 'private-sticky';
        el.dataset.note = note.id;
        el.dataset.color = note.color;
        el.setAttribute('aria-label', 'Private sticky note');
        el.style.left = `${note.x}px`;
        el.style.top = `${note.y}px`;
        el.style.width = `${note.w}px`;
        el.style.height = `${note.h}px`;
        el.innerHTML =
            '<div class="private-sticky-titlebar">' +
            '<button type="button" class="private-sticky-close" aria-label="Delete note"></button>' +
            '<button type="button" class="private-sticky-grip" aria-label="Move note. Use the arrow keys, or open its menu with Shift+F10"></button>' +
            '</div>' +
            '<textarea class="private-sticky-text" spellcheck="true" aria-label="Note text"></textarea>';

        const text = el.querySelector('textarea');
        text.maxLength = STICKY_TEXT_MAX;
        text.placeholder = 'A note only you can see. It stays in this browser.';
        text.value = note.text;
        text.addEventListener('input', () => {
            note.text = text.value.slice(0, STICKY_TEXT_MAX);
            saveNotesSoon();
        });

        el.querySelector('.private-sticky-close').addEventListener('click', () => deleteNote(note.id));
        el.addEventListener('pointerdown', () => raiseNote(el), true);
        setupNoteDrag(el, note);
        setupNoteResize(el, note);

        ensureLayer().appendChild(el);
        return el;
    }

    function raiseNote(el) {
        if (el.parentElement && el.parentElement.lastElementChild !== el) {
            // Moving the element would blur a field being typed in
            const active = document.activeElement;
            el.parentElement.appendChild(el);
            if (active && el.contains(active)) active.focus({ preventScroll: true });
            // Stacking order is the saved order
            const id = el.dataset.note;
            const index = notes.findIndex(n => n.id === id);
            if (index > -1) notes.push(notes.splice(index, 1)[0]);
            saveNotesSoon();
        }
    }

    function setupNoteDrag(el, note) {
        const bar = el.querySelector('.private-sticky-titlebar');
        const grip = el.querySelector('.private-sticky-grip');

        bar.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 || e.target.closest('.private-sticky-close')) return;
            e.preventDefault();
            const start = { x: e.clientX, y: e.clientY, left: note.x, top: note.y };
            el.classList.add('is-dragging');
            try { bar.setPointerCapture(e.pointerId); } catch (err) { /* already released */ }

            const move = (ev) => {
                note.x = start.left + ev.clientX - start.x;
                note.y = start.top + ev.clientY - start.y;
                fitNote(note);
                el.style.left = `${note.x}px`;
                el.style.top = `${note.y}px`;
            };
            const up = () => {
                el.classList.remove('is-dragging');
                bar.removeEventListener('pointermove', move);
                bar.removeEventListener('pointerup', up);
                bar.removeEventListener('pointercancel', up);
                saveNotesSoon();
            };
            bar.addEventListener('pointermove', move);
            bar.addEventListener('pointerup', up);
            bar.addEventListener('pointercancel', up);
        });

        // Keyboard: arrows move the note (Shift for bigger steps)
        grip.addEventListener('keydown', (e) => {
            const step = e.shiftKey ? 40 : 10;
            const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
            const delta = moves[e.key];
            if (!delta) return;
            e.preventDefault();
            note.x += delta[0];
            note.y += delta[1];
            fitNote(note);
            el.style.left = `${note.x}px`;
            el.style.top = `${note.y}px`;
            saveNotesSoon();
        });
    }

    /** The CSS resize handle changes the size; remember it once the visitor lets go. */
    function setupNoteResize(el, note) {
        if (typeof ResizeObserver !== 'function') return;
        const observer = new ResizeObserver(() => {
            const w = Math.round(el.offsetWidth);
            const h = Math.round(el.offsetHeight);
            if (!w || !h || (w === note.w && h === note.h)) return;
            note.w = clamp(w, STICKY_MIN.w, STICKY_MAX_SIZE.w);
            note.h = clamp(h, STICKY_MIN.h, STICKY_MAX_SIZE.h);
            saveNotesSoon();
        });
        observer.observe(el);
    }

    function newSticky(at) {
        if (isCompact()) return;
        if (notes.length >= STICKY_MAX) {
            shell.notify({
                title: 'Stickies',
                message: `You have ${STICKY_MAX} notes already. Delete one to make room for another.`,
                duration: 5000,
                sound: false
            });
            return;
        }
        const box = desktop.getBoundingClientRect();
        const offset = (notes.length % 6) * 26;
        const note = sanitizeNote({
            id: newId(),
            // Where the context menu was opened, else cascading from beside the widget
            x: at ? at.x - box.left - 20 : 330 + offset,
            y: at ? at.y - box.top - 10 : 30 + offset,
            color: notes.length ? notes[notes.length - 1].color : 'yellow'
        });
        notes.push(note);
        saveNotesNow();
        const el = renderNote(note);
        if (!reducedMotion()) {
            el.classList.add('is-new');
            setTimeout(() => el.classList.remove('is-new'), 260);
        }
        el.querySelector('textarea').focus({ preventScroll: true });
        track('sticky_private_created', { count: notes.length });
    }

    function deleteNote(id) {
        const index = notes.findIndex(n => n.id === id);
        if (index === -1) return;
        const [note] = notes.splice(index, 1);
        saveNotesNow();
        const el = noteElement(id);
        if (el) el.remove();
        track('sticky_private_deleted', { count: notes.length });

        // An empty note goes quietly; one with writing on it can come back
        if (!note.text.trim()) return;
        shell.notify({
            title: 'Note Deleted',
            message: 'Click here to put it back.',
            duration: 6000,
            sound: false,
            onClick: () => {
                if (notes.length >= STICKY_MAX || notes.some(n => n.id === note.id)) return;
                notes.splice(Math.min(index, notes.length), 0, note);
                saveNotesNow();
                renderNote(note);
            }
        });
    }

    function setNoteColor(id, color) {
        const note = notes.find(n => n.id === id);
        if (!note || !COLOR_IDS.has(color)) return;
        note.color = color;
        const el = noteElement(id);
        if (el) el.dataset.color = color;
        saveNotesSoon();
    }

    function renderAllNotes() {
        if (stickiesLayer) stickiesLayer.textContent = '';
        notes.forEach(renderNote);
    }

    /** Menu for a note's titlebar (right-click, long press, Shift+F10 on its grip). */
    function noteMenu(node) {
        const el = node.closest('.private-sticky');
        if (!el || node.closest('textarea')) return null;
        const id = el.dataset.note;
        const note = notes.find(n => n.id === id);
        if (!note) return null;
        return {
            label: 'Sticky note',
            anchor: el.querySelector('.private-sticky-titlebar'),
            items: STICKY_COLORS.map(([color, name]) => ({
                label: name,
                checked: note.color === color,
                action: () => setNoteColor(id, color)
            })).concat([
                '-',
                { label: 'New Sticky Note', action: () => newSticky() },
                { label: 'Delete Note', action: () => deleteNote(id) }
            ])
        };
    }

    // ================================================
    // Welcome tour
    // A few help tags, each pointing at the thing it explains. Shown once,
    // on a first visit; skipping counts as seen. Help > Welcome Tour (and
    // the Apple menu on phones) replays it.
    // ================================================

    let tour = null;
    let touredThisVisit = false;

    function searchChord() {
        return shell.formatShortcut ? shell.formatShortcut('mod+K') : 'Ctrl+K';
    }

    function tourSteps() {
        const compact = isCompact();
        // A tablet: the desktop layout, but a finger (no icon dragging, no
        // keyboard shortcuts, no cursor to share)
        const touch = !compact && window.matchMedia('(pointer: coarse)').matches;
        const tapping = compact || touch;
        const visible = (selector) => {
            const el = document.querySelector(selector);
            return el && el.getClientRects().length > 0 ? el : null;
        };
        // Laid out and not hidden under a window. About opens on every visit
        // and fills a phone's screen, so the icons are usually behind it there.
        const uncovered = (selector) => {
            const el = visible(selector);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            const x = r.left + r.width / 2;
            const y = r.top + r.height / 2;
            if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return null;
            const hit = document.elementFromPoint(x, y);
            return hit && (el.contains(hit) || hit.closest('.tour-card, .tour-ring')) ? el : null;
        };
        const iconTarget = () => uncovered('.desktop-icon[data-window="about"]') || uncovered('.desktop-icon');
        const steps = [
            {
                id: 'welcome',
                title: 'Welcome to Ankush’s desktop',
                body: compact
                    ? 'It works like a Mac from 2013, shrunk to fit your phone. Everything here opens: the about page, projects, blog posts and games.'
                    : 'It works like a Mac from 2013. Everything here opens: the about page, projects, blog posts, games, even a terminal.',
                next: 'Show Me Around',
                skip: 'Skip'
            },
            {
                id: 'icons',
                target: iconTarget,
                // Still worth saying when the icons are behind a window:
                // the card then sits in the middle and says how to reach them
                optional: true,
                title: tapping ? 'Tap to open' : 'One click opens anything',
                body: () => {
                    if (iconTarget()) {
                        return tapping
                            ? 'Tap an icon to open it. Press and hold one for more options.'
                            : 'Icons open with a single click. Drag them wherever you like and they stay there next time.';
                    }
                    if (touch) return 'The icons behind this window open with a single tap. Press and hold one for more options.';
                    return compact
                        ? 'Behind this window is the home screen. Tap Back to see it, then tap an icon to open it. Press and hold one for more options.'
                        : 'The icons behind this window open with a single click. Drag them wherever you like and they stay there next time.';
                }
            },
            !compact && {
                id: 'dock',
                target: () => visible('#dock .dock-shelf'),
                title: 'The Dock',
                body: 'Every app lives down here too. A light under an icon means it is open, and minimized windows wait here.'
            },
            {
                id: 'people',
                target: () => visible('#online-count'),
                title: 'Other people are here',
                body: tapping
                    ? 'This counts who is on the site right now. Tap it to send a reaction everyone sees.'
                    : 'Visitors show up as live cursors. Press 1 to 8 to send a reaction everyone sees, or click this counter.'
            },
            {
                id: 'search',
                target: () => visible('#menubar-spotlight'),
                title: 'Search everything',
                body: tapping
                    ? 'Find any post, project or app from here.'
                    : `Press ${searchChord()} to find any post, project or app.`,
                action: { label: 'Search Now', run: () => shell.openSearch() }
            },
            {
                id: 'done',
                target: () => (compact ? visible('#apple-menu-trigger') : visible('#menu-help-trigger')),
                title: 'That’s the tour',
                body: compact
                    ? 'Find it again in the Apple menu. If you enjoy your visit, sign the Guestbook.'
                    : 'Find it again under Help. If you enjoy your visit, sign the Guestbook.',
                next: 'Done',
                action: shell.resolveApp('guestbook')
                    ? { label: 'Sign the Guestbook', run: () => shell.openApp('guestbook', null, 'tour') }
                    : null
            }
        ];
        return steps.filter(Boolean);
    }

    function startTour() {
        if (tour) return;
        touredThisVisit = true;
        if (typeof shell.closeMenu === 'function') shell.closeMenu(false);

        const card = document.createElement('div');
        card.className = 'tour-card';
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-modal', 'false');
        card.setAttribute('aria-labelledby', 'tour-title');
        card.setAttribute('aria-describedby', 'tour-body');
        card.innerHTML =
            '<span class="tour-arrow" aria-hidden="true"></span>' +
            '<div class="tour-title" id="tour-title"></div>' +
            '<p class="tour-body" id="tour-body"></p>' +
            '<div class="tour-footer">' +
            '<span class="tour-progress" aria-live="polite"></span>' +
            '<button type="button" class="tour-link" data-tour="skip"></button>' +
            '<button type="button" class="mac-btn small" data-tour="action" hidden></button>' +
            '<button type="button" class="mac-btn small primary" data-tour="next"></button>' +
            '</div>';

        const ring = document.createElement('div');
        ring.className = 'tour-ring';
        ring.setAttribute('aria-hidden', 'true');

        document.body.append(ring, card);

        tour = {
            card,
            ring,
            steps: tourSteps(),
            index: -1,
            returnFocus: document.activeElement && document.activeElement !== document.body ? document.activeElement : null
        };

        card.addEventListener('click', (e) => {
            const button = e.target.closest('[data-tour]');
            if (!button) return;
            const kind = button.dataset.tour;
            if (kind === 'skip') endTour('skipped');
            else if (kind === 'next') showStep(tour.index + 1);
            else if (kind === 'action') {
                const step = tour.steps[tour.index];
                endTour('action:' + step.id);
                if (step.action) step.action.run();
            }
        });
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                endTour('skipped');
            }
        });

        tour.onResize = () => positionTour();
        window.addEventListener('resize', tour.onResize);

        track('welcome_tour', { action: 'start', compact: isCompact() });
        showStep(0);
    }

    function showStep(index) {
        if (!tour) return;
        // Steps whose subject is not on screen (no realtime, no Dock) are left out
        let next = index;
        const shown = (s) => !s.target || s.optional || s.target();
        while (next < tour.steps.length && !shown(tour.steps[next])) next++;
        if (next >= tour.steps.length) {
            endTour('finished');
            return;
        }
        tour.index = next;
        const step = tour.steps[next];
        const remaining = tour.steps.slice(next + 1).filter(shown).length;
        const last = remaining === 0;
        const total = next + 1 + remaining;

        const { card } = tour;
        card.dataset.step = step.id;
        card.querySelector('.tour-title').textContent = step.title;
        card.querySelector('.tour-body').textContent = typeof step.body === 'function' ? step.body() : step.body;
        card.querySelector('.tour-progress').textContent = next === 0 ? '' : `${next + 1} of ${total}`;

        const skip = card.querySelector('[data-tour="skip"]');
        skip.textContent = step.skip || 'Skip Tour';
        skip.hidden = last;

        const action = card.querySelector('[data-tour="action"]');
        action.hidden = !step.action;
        if (step.action) action.textContent = step.action.label;

        const nextBtn = card.querySelector('[data-tour="next"]');
        nextBtn.textContent = step.next || (last ? 'Done' : 'Next');

        if (!reducedMotion()) {
            card.classList.remove('is-stepping');
            void card.offsetWidth; // restart the fade for each step
            card.classList.add('is-stepping');
        }
        positionTour();
        nextBtn.focus({ preventScroll: true });
        track('welcome_tour', { action: 'step', step: step.id });
    }

    /** Beside the subject, with the arrow pointing at it; centred under the menubar without one. */
    function positionTour() {
        if (!tour) return;
        const { card, ring } = tour;
        const step = tour.steps[tour.index];
        const target = step && step.target ? step.target() : null;
        const margin = 12;
        const width = card.offsetWidth;
        const height = card.offsetHeight;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const top = (shell.menubarHeight ? shell.menubarHeight() : 24) + margin;

        if (!target) {
            ring.hidden = true;
            card.dataset.placement = 'center';
            card.style.left = `${Math.round((vw - width) / 2)}px`;
            card.style.top = `${Math.round(Math.max(top, vh * 0.2))}px`;
            return;
        }

        const rect = target.getBoundingClientRect();
        ring.hidden = false;
        const pad = 6;
        ring.style.left = `${Math.round(rect.left - pad)}px`;
        ring.style.top = `${Math.round(rect.top - pad)}px`;
        ring.style.width = `${Math.round(rect.width + pad * 2)}px`;
        ring.style.height = `${Math.round(rect.height + pad * 2)}px`;
        ring.classList.toggle('is-round', target.id === 'online-count' || target.closest('.menubar') !== null);

        // Prefer below, then above, then to the left, then to the right
        const room = {
            below: vh - rect.bottom - margin,
            above: rect.top - top,
            left: rect.left - margin,
            right: vw - rect.right - margin
        };
        let placement = 'below';
        if (room.below < height + 16) placement = room.above >= height + 16 ? 'above' : (room.left >= width + 16 ? 'left' : 'right');

        let x;
        let y;
        if (placement === 'below' || placement === 'above') {
            x = rect.left + rect.width / 2 - width / 2;
            y = placement === 'below' ? rect.bottom + 14 : rect.top - height - 14;
        } else {
            x = placement === 'left' ? rect.left - width - 14 : rect.right + 14;
            y = rect.top + rect.height / 2 - height / 2;
        }
        x = clamp(x, margin, vw - width - margin);
        y = clamp(y, top, vh - height - margin);
        card.dataset.placement = placement;
        card.style.left = `${Math.round(x)}px`;
        card.style.top = `${Math.round(y)}px`;

        // The arrow still points at the subject after the card was nudged on screen
        const arrow = card.querySelector('.tour-arrow');
        if (placement === 'below' || placement === 'above') {
            arrow.style.left = `${clamp(rect.left + rect.width / 2 - x, 18, width - 18)}px`;
            arrow.style.removeProperty('top');
        } else {
            arrow.style.top = `${clamp(rect.top + rect.height / 2 - y, 18, height - 18)}px`;
            arrow.style.removeProperty('left');
        }
    }

    function endTour(how) {
        if (!tour) return;
        const { card, ring, returnFocus, steps, index } = tour;
        window.removeEventListener('resize', tour.onResize);
        tour = null;
        store.write(WELCOME_KEY, 'done');
        const hadFocus = card.contains(document.activeElement);
        card.remove();
        ring.remove();
        if (hadFocus && returnFocus && returnFocus.isConnected) {
            try { returnFocus.focus({ preventScroll: true }); } catch (e) { /* gone */ }
        }
        track('welcome_tour', { action: how, step: steps[index] ? steps[index].id : '' });
    }

    /** First visit: once the boot screen has gone and the greeting window is up. */
    function scheduleFirstRunTour() {
        const state = store.read(WELCOME_KEY);
        if (state === 'done') return;
        // Not location.search: the boot About has already reset the address
        // to "/" by now. The shell kept what the visitor arrived with.
        let deepLinked = shell.bootDeepLinked;
        if (typeof deepLinked !== 'boolean') {
            let arrived = window.location.href;
            try {
                const nav = performance.getEntriesByType('navigation')[0];
                if (nav && nav.name) arrived = nav.name;
            } catch (e) { /* no navigation timing: the address will do */ }
            const params = new URL(arrived, window.location.href).searchParams;
            deepLinked = !!((params.get('open') || '').trim() || (params.get('q') || '').trim());
        }
        if (state !== 'pending' && !window.__firstBoot) return;
        if (deepLinked) {
            // They came for something in particular: show it on a later visit
            store.write(WELCOME_KEY, 'pending');
            return;
        }

        const loader = document.getElementById('macos-boot-loader');
        let waited = 0;
        const ready = () => {
            const booting = loader && loader.isConnected && getComputedStyle(loader).display !== 'none' &&
                getComputedStyle(loader).visibility !== 'hidden' && parseFloat(getComputedStyle(loader).opacity) > 0;
            const busy = document.getElementById('spotlight-overlay') || document.querySelector('.context-menu');
            if ((booting || busy) && (waited += 400) < 15000) {
                setTimeout(ready, 400);
                return;
            }
            startTour();
        };
        setTimeout(ready, 1400);
    }

    // ================================================
    // Wiring
    // ================================================

    window.DesktopPersonal = {
        newSticky,
        cleanUp,
        sortByName,
        resetArrangement,
        hasArrangement: () => !!arrangement,
        startTour,
        touredThisVisit: () => touredThisVisit,
        /** The shell asks this for anything it does not have a menu for itself */
        contextMenu(node) {
            return node && node.closest && node.closest('.private-sticky') ? noteMenu(node) : null;
        }
    };

    setupIconDrag();
    renderAllNotes();
    applyArrangement(false);

    let resizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (arrangement) applyArrangement(false);
            else fitDefaultLayout();
            if (!isCompact()) notes.forEach((note) => {
                const el = noteElement(note.id);
                if (!el) return;
                fitNote(note);
                el.style.left = `${note.x}px`;
                el.style.top = `${note.y}px`;
            });
        }, 150);
    });

    // Another tab changed the notes or the arrangement
    window.addEventListener('storage', (e) => {
        if (e.key === STICKIES_KEY) {
            if (stickiesLayer && stickiesLayer.contains(document.activeElement)) return;
            notes = loadNotes();
            renderAllNotes();
        } else if (e.key === ICONS_KEY) {
            arrangement = loadArrangement();
            applyArrangement(true);
        }
    });

    // Typing is saved within a moment; a closing tab must not lose that moment
    window.addEventListener('pagehide', () => { if (saveTimer) saveNotesNow(); });

    scheduleFirstRunTour();
})();
