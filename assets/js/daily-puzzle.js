/**
 * Daily Puzzle - one Minesweeper field per UTC day, the same for everyone.
 *
 * The field is generated in the browser from the date alone, so there is
 * nothing to fetch and no server that knows the answer. Every day's field is
 * checked by a solver before it is accepted: it can always be cleared by logic
 * from the opening it starts with, never by a coin flip, which is what makes
 * a shared clock fair.
 *
 * A mine does not end the game - it costs ten seconds. The finishing time
 * (clock plus penalties) goes on a leaderboard kept on the Gun graph, one row
 * per visitor per day. Rows from peers are untrusted: they are validated,
 * clamped and capped before anything is drawn, and the board is honest about
 * being casual (writes are unauthenticated, so times are taken on trust).
 *
 * Progress, streaks and the chosen name live in localStorage under
 * `daily-puzzle-v1`. Lazy-loaded by mavericks.js when the window opens.
 */
(function () {
    'use strict';

    const SIZE = 9;
    const CELLS = SIZE * SIZE;
    const MINES = 12;
    const PENALTY_MS = 10000;
    const MIN_MS = 3000;              // nothing human finishes faster
    const MAX_MS = 3599900;           // 59:59.9 - the clock stops counting there
    const MAX_NAME = 20;
    const MAX_ROWS = 300;             // leaderboard rows kept in memory
    const TOP_N = 10;
    const PUT_GAP_MS = 4000;          // at most one write every four seconds...
    const PUT_LIMIT = 8;              // ...and eight per window
    const ACK_WAIT_MS = 10000;        // after the last write, give up waiting for the relay
    const LONG_PRESS_MS = 380;
    const STORE_KEY = 'daily-puzzle-v1';
    const GAME_ID = 'daily-puzzle';
    const SEED_PREFIX = 'ankush.one/daily-puzzle/v1/';

    const HIDDEN = 0, OPEN = 1, FLAG = 2, BOOM = 3;

    // ------------------------------------------------------------------
    // Field generation (pure, deterministic, shared by every visitor)
    // ------------------------------------------------------------------

    const NEIGHBOURS = [];
    for (let i = 0; i < CELLS; i++) {
        const r = Math.floor(i / SIZE), c = i % SIZE, list = [];
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                if (!dr && !dc) continue;
                const rr = r + dr, cc = c + dc;
                if (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE) list.push(rr * SIZE + cc);
            }
        }
        NEIGHBOURS.push(list);
    }

    /** FNV-1a, 32 bit. */
    function hashString(str) {
        let h = 2166136261;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return h >>> 0;
    }

    /** Integer-only PRNG, so every engine deals the same field. */
    function mulberry32(seed) {
        let a = seed | 0;
        return function () {
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function deal(seed) {
        const rng = mulberry32(seed);
        // The opening sits away from the walls so it is never a cramped corner
        const start = (2 + Math.floor(rng() * (SIZE - 4))) * SIZE + (2 + Math.floor(rng() * (SIZE - 4)));
        const sr = Math.floor(start / SIZE), sc = start % SIZE;

        const pool = [];
        for (let i = 0; i < CELLS; i++) {
            const r = Math.floor(i / SIZE), c = i % SIZE;
            if (Math.abs(r - sr) <= 1 && Math.abs(c - sc) <= 1) continue;
            pool.push(i);
        }

        const mines = new Uint8Array(CELLS);
        for (let k = 0; k < MINES; k++) {
            const j = k + Math.floor(rng() * (pool.length - k));
            const tmp = pool[k]; pool[k] = pool[j]; pool[j] = tmp;
            mines[pool[k]] = 1;
        }

        const counts = new Uint8Array(CELLS);
        for (let i = 0; i < CELLS; i++) {
            let n = 0;
            const nb = NEIGHBOURS[i];
            for (let k = 0; k < nb.length; k++) n += mines[nb[k]];
            counts[i] = n;
        }
        return { mines, counts, start };
    }

    /**
     * True when the field can be cleared from its opening by deduction alone:
     * single-number rules, one number's cells being a subset of another's, and
     * the count of mines left. Fields that need more than that are not dealt.
     */
    function solvable(field) {
        const mines = field.mines, counts = field.counts;
        const state = new Uint8Array(CELLS); // 0 unknown, 1 open, 2 known mine
        let opened = 0, marked = 0;

        function open(first) {
            const stack = [first];
            while (stack.length) {
                const i = stack.pop();
                if (state[i]) continue;
                state[i] = 1;
                opened++;
                if (!counts[i]) {
                    const nb = NEIGHBOURS[i];
                    for (let k = 0; k < nb.length; k++) if (!state[nb[k]]) stack.push(nb[k]);
                }
            }
        }
        function mark(i) {
            if (!state[i]) { state[i] = 2; marked++; }
        }

        open(field.start);

        for (let guard = 0; guard < 400; guard++) {
            let progress = false;
            const constraints = [];

            for (let i = 0; i < CELLS; i++) {
                if (state[i] !== 1 || !counts[i]) continue;
                const nb = NEIGHBOURS[i], unknown = [];
                let known = 0;
                for (let k = 0; k < nb.length; k++) {
                    if (state[nb[k]] === 0) unknown.push(nb[k]);
                    else if (state[nb[k]] === 2) known++;
                }
                if (!unknown.length) continue;
                const need = counts[i] - known;
                if (need === 0) { unknown.forEach(open); progress = true; }
                else if (need === unknown.length) { unknown.forEach(mark); progress = true; }
                else constraints.push({ cells: unknown, need: need });
            }
            if (progress) continue;

            subsets:
            for (let a = 0; a < constraints.length; a++) {
                for (let b = 0; b < constraints.length; b++) {
                    const A = constraints[a], B = constraints[b];
                    if (a === b || A.cells.length >= B.cells.length) continue;
                    let inside = true;
                    for (let k = 0; k < A.cells.length; k++) {
                        if (B.cells.indexOf(A.cells[k]) === -1) { inside = false; break; }
                    }
                    if (!inside) continue;
                    const rest = B.cells.filter((x) => A.cells.indexOf(x) === -1);
                    const diff = B.need - A.need;
                    if (diff === 0) { rest.forEach(open); progress = true; break subsets; }
                    if (diff === rest.length) { rest.forEach(mark); progress = true; break subsets; }
                }
            }
            if (progress) continue;

            const unknown = [];
            for (let i = 0; i < CELLS; i++) if (!state[i]) unknown.push(i);
            if (unknown.length) {
                const left = MINES - marked;
                if (left === 0) { unknown.forEach(open); progress = true; }
                else if (left === unknown.length) { unknown.forEach(mark); progress = true; }
            }
            if (!progress) break;
        }

        // Sound rules never open a mine, so this is exactly "every safe cell"
        return opened === CELLS - MINES && !mines[field.start];
    }

    const fieldCache = {};

    /** The field for a UTC date key (YYYY-MM-DD). */
    function generate(dateKey) {
        if (fieldCache[dateKey]) return fieldCache[dateKey];
        let field = null;
        for (let attempt = 0; attempt < 4000; attempt++) {
            field = deal(hashString(SEED_PREFIX + dateKey + '/' + attempt));
            if (solvable(field)) break;
        }
        fieldCache[dateKey] = field;
        return field;
    }

    function dateKey(date) {
        return (date || new Date()).toISOString().slice(0, 10);
    }

    function dayStart(key) {
        return Date.parse(key + 'T00:00:00Z');
    }

    function previousDay(key) {
        return dateKey(new Date(dayStart(key) - 86400000));
    }

    // ------------------------------------------------------------------
    // Storage, formatting, validation
    // ------------------------------------------------------------------

    const memory = {};
    const store = {
        get(key) {
            try {
                const s = window.SiteStore;
                const v = s && s.get ? s.get(key) : localStorage.getItem(key);
                return v == null ? (key in memory ? memory[key] : null) : v;
            } catch (e) {
                return key in memory ? memory[key] : null;
            }
        },
        set(key, value) {
            memory[key] = value;
            try {
                const s = window.SiteStore;
                if (s && s.set) s.set(key, value); else localStorage.setItem(key, value);
            } catch (e) { /* kept in memory only */ }
        }
    };

    function int(value, min, max, fallback) {
        return (typeof value === 'number' && isFinite(value) && Math.floor(value) === value &&
            value >= min && value <= max) ? value : fallback;
    }

    function isDateKey(value) {
        return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(dayStart(value));
    }

    // Control, zero-width and bidi-override characters never reach the board.
    // Built from escapes so no invisible character ever sits in this file.
    const UNSAFE_CHARS = new RegExp('[' + ['0000-'+'001f', '007f-'+'009f', '200b-'+'200f', '2028-'+'202f', '2066-'+'2069', 'feff']
        .map((range) => range.split('-').map((hex) => String.fromCharCode(92) + 'u' + hex).join('-')).join('') + ']', 'g');

    function cleanName(value) {
        if (typeof value !== 'string') return '';
        return value.replace(UNSAFE_CHARS, ' ')
            .replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim();
    }

    function loadSaved() {
        let raw = null;
        try { raw = JSON.parse(store.get(STORE_KEY) || 'null'); } catch (e) { raw = null; }
        const src = raw && typeof raw === 'object' ? raw : {};
        return {
            v: 1,
            name: cleanName(src.name),
            streak: int(src.streak, 0, 100000, 0),
            best: int(src.best, 0, 100000, 0),
            solved: int(src.solved, 0, 100000, 0),
            bestMs: int(src.bestMs, MIN_MS, MAX_MS, 0),
            lastWon: isDateKey(src.lastWon) ? src.lastWon : '',
            game: src.game && typeof src.game === 'object' ? src.game : null
        };
    }

    /** The streak as it stands today: it lapses once a whole day is missed. */
    function liveStreak(saved, today) {
        if (!saved.lastWon) return 0;
        return (saved.lastWon === today || saved.lastWon === previousDay(today)) ? saved.streak : 0;
    }

    /** 67412 -> "1:07.4" */
    function formatTime(ms) {
        const tenths = Math.floor(Math.max(0, ms) / 100);
        const m = Math.floor(tenths / 600);
        const s = Math.floor(tenths / 10) % 60;
        return m + ':' + (s < 10 ? '0' : '') + s + '.' + (tenths % 10);
    }

    function formatCountdown(ms) {
        const total = Math.max(0, Math.ceil(ms / 1000));
        const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60;
        return h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    function led(value) {
        const n = Math.max(-99, Math.min(999, Math.floor(value)));
        if (n < 0) return '-' + String(-n).padStart(2, '0');
        return String(n).padStart(3, '0');
    }

    /** A leaderboard row from a peer, or null when it does not hold up. */
    function parseRow(data, id, key, now) {
        if (!data || typeof data !== 'object') return null;
        if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{4,40}$/.test(id)) return null;
        const name = cleanName(data.name);
        if (!name) return null;
        if (typeof data.ms !== 'number' || !isFinite(data.ms)) return null;
        const ms = Math.round(data.ms);
        const hits = int(data.hits, 0, MINES, -1);
        if (hits < 0 || ms > MAX_MS || ms < MIN_MS + hits * PENALTY_MS) return null;
        const ts = data.ts;
        const from = dayStart(key);
        // Finished on that day (a late finisher gets one more day of grace),
        // and not from the future.
        if (typeof ts !== 'number' || !isFinite(ts) || ts < from + MIN_MS ||
            ts > from + 2 * 86400000 || ts > now + 300000) return null;
        return { id: id, name: name, ms: ms, hits: hits, ts: ts };
    }

    function byTime(a, b) {
        return (a.ms - b.ms) || (a.ts - b.ts) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    }

    // ------------------------------------------------------------------
    // Glyphs (static markup; colours come from puzzle.css)
    // ------------------------------------------------------------------

    const FLAG_SVG = '<svg class="dp-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
        '<path class="dp-glyph-pole" d="M5 2.2h1.3v11.6H5z"/>' +
        '<path class="dp-glyph-base" d="M2.6 12.6h6.1v1.5H2.6z"/>' +
        '<path class="dp-glyph-flag" d="M6.3 2.4l6.6 2.9-6.6 2.9z"/></svg>';

    const MINE_SVG = '<svg class="dp-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
        '<path class="dp-glyph-mine" d="M8 1.2v13.6M1.2 8h13.6M3.3 3.3l9.4 9.4M12.7 3.3l-9.4 9.4" ' +
        'fill="none" stroke-width="1.5" stroke-linecap="round"/>' +
        '<circle class="dp-glyph-mine-body" cx="8" cy="8" r="4.4"/>' +
        '<circle class="dp-glyph-mine-shine" cx="6.4" cy="6.4" r="1.2"/></svg>';

    // ------------------------------------------------------------------
    // The app
    // ------------------------------------------------------------------

    function initDailyPuzzle(win) {
        const root = win.querySelector('.dp-window');
        if (!root || root.dataset.ready) return;
        root.dataset.ready = 'true';

        const $ = (sel) => root.querySelector(sel);
        const els = {
            date: $('.dp-date'),
            board: $('.dp-board'),
            cover: $('.dp-cover'),
            coverTitle: $('.dp-cover-title'),
            coverText: $('.dp-cover-text'),
            coverBtn: $('.dp-cover-btn'),
            ledMines: $('.dp-led-mines'),
            ledTime: $('.dp-led-time'),
            penalty: $('.dp-penalty'),
            mode: $('.dp-mode'),
            live: $('.dp-live'),
            result: $('.dp-result'),
            resultTime: $('.dp-result-time'),
            resultDetail: $('.dp-result-detail'),
            form: $('.dp-name-form'),
            nameInput: $('.dp-name-input'),
            posted: $('.dp-posted'),
            postedName: $('.dp-posted-name'),
            postedState: $('.dp-posted-state'),
            rename: $('.dp-rename'),
            copy: $('.dp-copy'),
            statStreak: $('.dp-stat-streak'),
            statBest: $('.dp-stat-best'),
            statSolved: $('.dp-stat-solved'),
            statFastest: $('.dp-stat-fastest'),
            scoresTitle: $('.dp-scores-title'),
            scoresCount: $('.dp-scores-count'),
            scores: $('.dp-scores'),
            scoresEmpty: $('.dp-scores-empty'),
            next: $('.dp-next'),
            status: $('.dp-status')
        };

        const saved = loadSaved();
        const cellEls = [];
        let myId = '';
        let field = null;        // today's { mines, counts, start }
        let game = null;         // { date, cells, ms, hits, started, done, finishedAt, share, posted }
        let running = false;
        let lastTick = 0;
        let lastSave = 0;
        let flagMode = false;
        let focusIndex = 0;
        let destroyed = false;

        let scoresRef = null;
        let scoresMap = null;
        let offConnection = null;
        let connected = false;
        let gunReady = false;
        const rows = new Map();
        let renderTimer = null;
        let lastPut = 0;
        let putCount = 0;
        let putTimer = null;
        let penaltyTimer = null;
        let editingName = false;

        function getMyId() {
            try {
                if (window.SiteGun && window.SiteGun.visitorId) return window.SiteGun.visitorId();
            } catch (e) { /* fall through */ }
            let id = store.get('multiplayer-cursor-id') || window.__siteVisitorId;
            if (!id) {
                id = Math.random().toString(36).slice(2, 11);
                store.set('multiplayer-cursor-id', id);
            }
            window.__siteVisitorId = id;
            return id;
        }

        function persist() {
            lastSave = Date.now();
            saved.game = game ? {
                date: game.date,
                cells: Array.prototype.join.call(game.cells, ''),
                ms: Math.round(game.ms),
                hits: game.hits,
                started: game.started,
                done: game.done,
                finishedAt: game.finishedAt,
                share: game.share,
                posted: game.posted
            } : null;
            store.set(STORE_KEY, JSON.stringify(saved));
        }

        function announce(text) {
            els.live.textContent = '';
            // A fresh node change, so the same sentence twice is read twice
            setTimeout(() => { if (!destroyed) els.live.textContent = text; }, 30);
        }

        function total() {
            return Math.min(MAX_MS, Math.round(game.ms) + game.hits * PENALTY_MS);
        }

        // ---------------- Loading a day ----------------

        function freshGame(key) {
            return {
                date: key, cells: new Uint8Array(CELLS), ms: 0, hits: 0,
                started: false, done: false, finishedAt: 0, share: false, posted: ''
            };
        }

        /** A saved game is only resumed when it is consistent with the field. */
        function restoreGame(key) {
            const g = saved.game;
            if (!g || g.date !== key || typeof g.cells !== 'string' || g.cells.length !== CELLS) return null;
            const cells = new Uint8Array(CELLS);
            let hits = 0, open = 0;
            for (let i = 0; i < CELLS; i++) {
                const s = g.cells.charCodeAt(i) - 48;
                if (s < 0 || s > 3) return null;
                if (s === OPEN && field.mines[i]) return null;
                if (s === BOOM && !field.mines[i]) return null;
                if (s === BOOM) hits++;
                if (s === OPEN) open++;
                cells[i] = s;
            }
            const done = g.done === true;
            if (done !== (open === CELLS - MINES)) return null;
            if (!g.started && (open || hits)) return null;
            return {
                date: key,
                cells: cells,
                ms: Math.min(MAX_MS, Math.max(0, Number(g.ms) || 0)),
                hits: hits,
                started: g.started === true,
                done: done,
                finishedAt: done ? (Number(g.finishedAt) || Date.now()) : 0,
                share: done && g.share === true && !!saved.name,
                posted: typeof g.posted === 'string' ? g.posted : ''
            };
        }

        function loadDay(key) {
            stopClock();
            unsubscribe();
            field = generate(key);
            game = restoreGame(key) || freshGame(key);
            focusIndex = field.start;
            editingName = false;
            setFlagMode(false);

            const day = new Date(dayStart(key));
            let label = key;
            try {
                label = day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
            } catch (e) { /* keep the key */ }
            els.date.textContent = label;
            els.date.setAttribute('datetime', key);
            els.board.setAttribute('aria-label', 'Minefield for ' + label + ', ' + SIZE + ' by ' + SIZE + ', ' + MINES + ' mines');

            for (let i = 0; i < CELLS; i++) paintCell(i);
            rows.clear();
            renderAll();
            subscribe();
        }

        // ---------------- Board ----------------

        function buildBoard() {
            const frag = document.createDocumentFragment();
            for (let r = 0; r < SIZE; r++) {
                const row = document.createElement('div');
                row.className = 'dp-row';
                row.setAttribute('role', 'row');
                for (let c = 0; c < SIZE; c++) {
                    const cell = document.createElement('div');
                    cell.className = 'dp-cell';
                    cell.setAttribute('role', 'gridcell');
                    cell.tabIndex = -1;
                    cell.dataset.i = String(r * SIZE + c);
                    cellEls.push(cell);
                    row.appendChild(cell);
                }
                frag.appendChild(row);
            }
            els.board.appendChild(frag);
        }

        function paintCell(i) {
            const el = cellEls[i];
            const s = game.cells[i];
            const where = 'Row ' + (Math.floor(i / SIZE) + 1) + ', column ' + (i % SIZE + 1) + ': ';
            let cls = 'dp-cell', label;

            if (s === OPEN) {
                const n = field.counts[i];
                cls += ' is-open' + (n ? ' dp-n' + n : '');
                el.textContent = n ? String(n) : '';
                label = n ? n + (n === 1 ? ' mine nearby' : ' mines nearby') : 'clear';
            } else if (s === FLAG) {
                cls += ' is-flag';
                el.innerHTML = FLAG_SVG;
                label = 'flagged';
            } else if (s === BOOM) {
                cls += ' is-boom';
                el.innerHTML = MINE_SVG;
                label = 'mine, set off';
            } else {
                el.textContent = '';
                label = 'covered';
            }
            el.className = cls;
            el.setAttribute('aria-label', where + label);
            el.tabIndex = i === focusIndex ? 0 : -1;
        }

        function setFocus(i, focus) {
            const prev = focusIndex;
            focusIndex = i;
            if (cellEls[prev]) cellEls[prev].tabIndex = -1;
            cellEls[i].tabIndex = 0;
            if (focus) {
                try { cellEls[i].focus({ preventScroll: true }); } catch (e) { cellEls[i].focus(); }
            }
        }

        function playing() {
            return !!game && game.started && !game.done && running;
        }

        function openFrom(first) {
            const stack = [first];
            let opened = 0;
            while (stack.length) {
                const i = stack.pop();
                if (game.cells[i] !== HIDDEN) continue;
                game.cells[i] = OPEN;
                opened++;
                paintCell(i);
                if (!field.counts[i]) {
                    const nb = NEIGHBOURS[i];
                    for (let k = 0; k < nb.length; k++) {
                        if (game.cells[nb[k]] === HIDDEN) stack.push(nb[k]);
                    }
                }
            }
            return opened;
        }

        /** Returns true when the cell was a mine. */
        function reveal(i) {
            if (game.cells[i] !== HIDDEN) return false;
            if (field.mines[i]) {
                game.cells[i] = BOOM;
                game.hits++;
                paintCell(i);
                return true;
            }
            openFrom(i);
            return false;
        }

        function afterMove(hits, quiet) {
            if (hits) {
                showPenalty(hits);
                if (navigator.vibrate) { try { navigator.vibrate(60); } catch (e) { /* ignore */ } }
            }
            renderHud();
            let open = 0;
            for (let i = 0; i < CELLS; i++) if (game.cells[i] === OPEN) open++;
            if (open === CELLS - MINES) { finish(); return; }
            if (hits) {
                announce('Mine. ' + (hits * PENALTY_MS / 1000) + ' seconds added to your time.');
            } else if (!quiet) {
                announce((CELLS - MINES - open) + ' safe squares left.');
            }
            persist();
        }

        function toggleFlag(i) {
            if (!playing()) return;
            const s = game.cells[i];
            if (s !== HIDDEN && s !== FLAG) return;
            game.cells[i] = s === HIDDEN ? FLAG : HIDDEN;
            paintCell(i);
            renderHud();
            announce(s === HIDDEN ? 'Flag placed.' : 'Flag removed.');
            persist();
        }

        /** Tap / click / Enter on a cell. */
        function act(i) {
            if (!playing()) return;
            const s = game.cells[i];
            if (s === HIDDEN) {
                if (flagMode) { toggleFlag(i); return; }
                afterMove(reveal(i) ? 1 : 0);
            } else if (s === FLAG) {
                // A flag is a safety catch: it only comes off deliberately
                if (flagMode) toggleFlag(i);
            } else if (s === OPEN && field.counts[i]) {
                // Chord: a number with all its mines accounted for opens the rest
                const nb = NEIGHBOURS[i];
                let known = 0;
                const rest = [];
                for (let k = 0; k < nb.length; k++) {
                    const t = game.cells[nb[k]];
                    if (t === FLAG || t === BOOM) known++;
                    else if (t === HIDDEN) rest.push(nb[k]);
                }
                if (known !== field.counts[i] || !rest.length) return;
                let hits = 0;
                rest.forEach((j) => { if (reveal(j)) hits++; });
                afterMove(hits);
            }
        }

        function showPenalty(hits) {
            els.penalty.textContent = '+' + (hits * PENALTY_MS / 1000) + 's';
            els.penalty.classList.remove('is-shown');
            els.board.classList.remove('is-shaken');
            void els.penalty.offsetWidth; // restart the animations
            els.penalty.classList.add('is-shown');
            els.board.classList.add('is-shaken');
            // With reduced motion the badge is static, so it is taken down here
            clearTimeout(penaltyTimer);
            penaltyTimer = setTimeout(() => els.penalty.classList.remove('is-shown'), 1500);
        }

        function setFlagMode(on) {
            flagMode = !!on;
            els.mode.setAttribute('aria-pressed', flagMode ? 'true' : 'false');
            root.classList.toggle('is-flagging', flagMode);
        }

        // ---------------- Clock ----------------

        function startClock() {
            if (running || !game.started || game.done) return;
            running = true;
            lastTick = performance.now();
            renderCover();
        }

        function stopClock() {
            if (!running) return;
            const now = performance.now();
            game.ms = Math.min(MAX_MS, game.ms + (now - lastTick));
            running = false;
        }

        function pause() {
            if (!running) return;
            stopClock();
            persist();
            renderCover();
        }

        function visible() {
            return !document.hidden && !win.classList.contains('minimized');
        }

        function tick() {
            if (destroyed) return;
            const now = performance.now();
            if (running) {
                if (!visible()) { pause(); return; }
                game.ms = Math.min(MAX_MS, game.ms + (now - lastTick));
                lastTick = now;
                renderHud();
                if (Date.now() - lastSave > 3000) persist();
            }
            if (!visible()) return;

            const today = dateKey();
            if (game.date !== today) {
                // Untouched field from yesterday: just deal today's. A game in
                // progress may be finished; a finished one offers the new day.
                if (!game.started) { loadDay(today); return; }
                if (game.done && !els.cover.classList.contains('is-next')) renderCover();
            }
            const left = dayStart(today) + 86400000 - Date.now();
            const text = 'Next puzzle in ' + formatCountdown(left);
            if (els.next.textContent !== text) els.next.textContent = text;
        }

        // ---------------- Start / finish ----------------

        function begin() {
            if (game.done) { loadDay(dateKey()); return; }
            if (!game.started) {
                game.started = true;
                reveal(field.start);
                paintCell(field.start);
                window.track?.('puzzle_started', { date: game.date });
                startClock();
                afterMove(0, true);
                announce('Clock started. ' + MINES + ' mines to find.');
            } else {
                startClock();
            }
            setFocus(focusIndex, true);
        }

        function finish() {
            stopClock();
            game.done = true;
            game.finishedAt = Date.now();
            for (let i = 0; i < CELLS; i++) {
                if (field.mines[i] && game.cells[i] === HIDDEN) { game.cells[i] = FLAG; paintCell(i); }
            }

            const time = total();
            if (saved.lastWon !== game.date) {
                saved.streak = saved.lastWon === previousDay(game.date) ? saved.streak + 1 : 1;
                saved.best = Math.max(saved.best, saved.streak);
                saved.solved++;
                saved.lastWon = game.date;
            }
            if (!saved.bestMs || time < saved.bestMs) saved.bestMs = time;
            // Someone who has posted before keeps posting under the same name
            game.share = !!saved.name;
            persist();

            root.classList.add('is-celebrating');
            setTimeout(() => root.classList.remove('is-celebrating'), 1600);
            renderAll();
            announce('Solved in ' + formatTime(time) + (game.hits ? ', including ' + game.hits +
                (game.hits === 1 ? ' mine' : ' mines') + ' set off.' : ' without touching a mine.'));
            window.track?.('puzzle_solved', {
                date: game.date, ms: time, hits: game.hits, streak: saved.streak
            });
            publish();
            if (!game.share) prefillFromGuestbook();
            // On a phone the result sits below the field
            try {
                const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
                    document.documentElement.getAttribute('data-motion') === 'reduce';
                els.result.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
            } catch (e) { /* older engines: it is one swipe away */ }
        }

        // ---------------- Rendering ----------------

        function renderHud() {
            let marked = 0;
            for (let i = 0; i < CELLS; i++) if (game.cells[i] === FLAG || game.cells[i] === BOOM) marked++;
            const minesText = led(MINES - marked);
            if (els.ledMines.textContent !== minesText) {
                els.ledMines.textContent = minesText;
                els.ledMines.setAttribute('aria-label', 'Mines left: ' + (MINES - marked));
            }
            const seconds = Math.floor(total() / 1000);
            const timeText = led(seconds);
            if (els.ledTime.textContent !== timeText) {
                els.ledTime.textContent = timeText;
                els.ledTime.setAttribute('aria-label', 'Time: ' + seconds + ' seconds');
            }
            els.mode.disabled = !playing();
        }

        function renderCover() {
            const stale = game.date !== dateKey();
            let title = '', text = '', button = '';
            if (!game.started) {
                title = 'Today’s Minefield';
                text = 'Clear every safe square. It can always be done by logic alone, and a mine costs ' +
                    (PENALTY_MS / 1000) + ' seconds instead of the game.';
                button = 'Start the Clock';
            } else if (!game.done && !running) {
                title = 'Paused';
                text = formatTime(total()) + ' on the clock. The field stays covered while you are away.';
                button = 'Resume';
            } else if (game.done && stale) {
                title = 'A New Puzzle Is Ready';
                text = 'The day has rolled over. Your time for this one is saved.';
                button = 'Play Today’s Puzzle';
            }
            const show = !!button;
            els.cover.hidden = !show;
            els.cover.classList.toggle('is-next', show && game.done);
            // While a game is covered the field must not be readable or reachable
            const sealed = show && !game.done;
            root.classList.toggle('is-sealed', sealed);
            if ('inert' in els.board) els.board.inert = sealed;
            els.board.setAttribute('aria-hidden', sealed ? 'true' : 'false');
            if (show) {
                els.coverTitle.textContent = title;
                els.coverText.textContent = text;
                els.coverBtn.textContent = button;
            }
            root.classList.toggle('is-done', game.done);
            els.mode.disabled = !playing();
        }

        function renderStats() {
            els.statStreak.textContent = String(liveStreak(saved, dateKey()));
            els.statBest.textContent = String(saved.best);
            els.statSolved.textContent = String(saved.solved);
            els.statFastest.textContent = saved.bestMs ? formatTime(saved.bestMs) : '–';
        }

        function renderResult() {
            els.result.hidden = !game.done;
            if (!game.done) return;
            els.resultTime.textContent = formatTime(total());
            const streak = liveStreak(saved, game.date);
            const parts = [game.hits ? game.hits + (game.hits === 1 ? ' mine' : ' mines') + ' set off (+' +
                (game.hits * PENALTY_MS / 1000) + 's)' : 'No mines set off'];
            if (streak > 1) parts.push(streak + '-day streak');
            els.resultDetail.textContent = parts.join(' · ');

            const showForm = !game.share || editingName;
            els.form.hidden = !showForm;
            els.posted.hidden = showForm;
            els.rename.hidden = !game.share || editingName;
            if (showForm) {
                if (document.activeElement !== els.nameInput && !els.nameInput.value) {
                    els.nameInput.value = saved.name;
                }
            } else {
                els.postedName.textContent = saved.name;
                renderPostState();
            }
        }

        function renderPostState() {
            if (!game || !game.done || !game.share) return;
            let text;
            if (game.posted === saved.name) text = 'Your time is on the board.';
            else if (!gunReady) text = 'Leaderboard is unavailable; your time is saved on this device.';
            else if (!connected) text = 'Offline. It will be posted when the connection returns.';
            else if (putCount >= PUT_LIMIT && Date.now() - lastPut >= ACK_WAIT_MS) {
                // Every write this window may make is spent and none was confirmed
                text = 'Couldn\'t post your time. Reopen the puzzle to try again.';
            } else text = 'Posting…';
            els.postedState.textContent = text;
        }

        function myRow() {
            if (!game.done || !game.share || !saved.name) return null;
            return { id: myId, name: saved.name, ms: total(), hits: game.hits, ts: game.finishedAt, mine: true };
        }

        function scoreItem(row, rank) {
            const li = document.createElement('li');
            li.className = 'dp-score' + (row.mine ? ' is-mine' : '');
            const pos = document.createElement('span');
            pos.className = 'dp-score-rank';
            pos.textContent = rank + '.';
            const name = document.createElement('span');
            name.className = 'dp-score-name';
            name.textContent = row.name;
            if (row.mine) {
                const you = document.createElement('span');
                you.className = 'dp-score-you';
                you.textContent = 'you';
                name.appendChild(document.createTextNode(' '));
                name.appendChild(you);
            }
            const time = document.createElement('span');
            time.className = 'dp-score-time';
            time.textContent = formatTime(row.ms);
            if (row.hits) {
                time.title = row.hits + (row.hits === 1 ? ' mine' : ' mines') + ' set off';
                const mark = document.createElement('span');
                mark.className = 'dp-score-hits';
                mark.textContent = '+' + row.hits;
                mark.setAttribute('aria-label', ', ' + time.title);
                time.appendChild(mark);
            }
            li.appendChild(pos);
            li.appendChild(name);
            li.appendChild(time);
            return li;
        }

        function renderScores() {
            renderTimer = null;
            if (destroyed) return;
            const list = [];
            const mine = myRow();
            rows.forEach((row) => { if (!mine || row.id !== myId) list.push(row); });
            if (mine) list.push(mine);
            list.sort(byTime);

            els.scoresTitle.textContent = game.date === dateKey() ? 'Today’s Fastest' : 'Fastest for This Puzzle';
            els.scoresCount.textContent = list.length ? list.length + (list.length === 1 ? ' solver' : ' solvers') : '';

            const frag = document.createDocumentFragment();
            list.slice(0, TOP_N).forEach((row, i) => frag.appendChild(scoreItem(row, i + 1)));
            const myRank = mine ? list.indexOf(mine) + 1 : 0;
            if (myRank > TOP_N) {
                const gap = document.createElement('li');
                gap.className = 'dp-score-gap';
                gap.setAttribute('aria-hidden', 'true');
                gap.textContent = '⋯';
                frag.appendChild(gap);
                frag.appendChild(scoreItem(mine, myRank));
            }
            els.scores.textContent = '';
            els.scores.appendChild(frag);
            els.scores.hidden = !list.length;

            els.scoresEmpty.hidden = !!list.length;
            if (!list.length) {
                els.scoresEmpty.textContent = !gunReady
                    ? 'The leaderboard is loading…'
                    : (connected ? 'No times yet today. The board is yours to open.'
                        : 'The leaderboard is offline right now. Times will appear when the connection returns.');
            }
        }

        function scheduleScores() {
            if (!renderTimer) renderTimer = setTimeout(renderScores, 120);
        }

        function renderStatus() {
            let text = 'Connecting…', state = 'wait';
            if (gunReady && connected) { text = 'Live'; state = 'live'; }
            else if (gunReady) { text = 'Offline'; state = 'off'; }
            els.status.textContent = text;
            els.status.dataset.state = state;
        }

        function renderAll() {
            renderCover();
            renderHud();
            renderStats();
            renderResult();
            renderScores();
        }

        // ---------------- Leaderboard (Gun) ----------------

        function scoresNode(key) {
            const G = window.SiteGun;
            if (!G) return null;
            try {
                if (G.paths && G.paths.apps && G.paths.apps.scores) return G.paths.apps.scores(key, GAME_ID);
                return G.getGun().get(G.ROOT).get('apps').get('scores').get(GAME_ID).get(key);
            } catch (e) {
                return null;
            }
        }

        function subscribe() {
            if (!gunReady || destroyed) return;
            const key = game.date;
            scoresRef = scoresNode(key);
            if (!scoresRef) return;
            putCount = 0;
            scoresMap = scoresRef.map();
            scoresMap.on((data, id) => {
                if (destroyed || !game || game.date !== key) return;
                const row = parseRow(data, id, key, Date.now());
                if (!row) {
                    if (rows.delete(id)) scheduleScores();
                    return;
                }
                if (id === myId && game.done && row.name === saved.name && row.ms === total() && !game.posted) {
                    game.posted = saved.name;
                    renderPostState();
                }
                rows.set(id, row);
                // Bounded: once full, the slowest row makes way
                if (rows.size > MAX_ROWS) {
                    let worst = null;
                    rows.forEach((r) => { if (!worst || byTime(r, worst) > 0) worst = r; });
                    if (worst) rows.delete(worst.id);
                }
                scheduleScores();
            });
            publish();
        }

        function unsubscribe() {
            if (scoresMap) { try { scoresMap.off(); } catch (e) { /* ignore */ } }
            scoresMap = null;
            scoresRef = null;
            clearTimeout(putTimer);
            putTimer = null;
        }

        /** Write this visitor's one row for the day. Rate limited and bounded. */
        function publish() {
            if (destroyed || !scoresRef || !game.done || !game.share || !saved.name) return;
            if (game.posted === saved.name || putCount >= PUT_LIMIT) return;
            const wait = lastPut + PUT_GAP_MS - Date.now();
            if (wait > 0) {
                if (!putTimer) putTimer = setTimeout(() => { putTimer = null; publish(); }, wait + 20);
                return;
            }
            lastPut = Date.now();
            putCount++;
            const name = saved.name, key = game.date;
            renderPostState();
            // That was the last write allowed: if no ack comes, say so
            // instead of showing "Posting…" for good.
            if (putCount >= PUT_LIMIT) {
                clearTimeout(putTimer);
                putTimer = setTimeout(() => { putTimer = null; renderPostState(); }, ACK_WAIT_MS + 20);
            }
            try {
                scoresRef.get(myId).put({ name: name, ms: total(), hits: game.hits, ts: game.finishedAt }, (ack) => {
                    if (destroyed || !ack || ack.err || !game || game.date !== key) return;
                    if (saved.name !== name || game.posted === name) return;
                    game.posted = name;
                    persist();
                    renderPostState();
                    window.track?.('puzzle_score_posted', { date: key });
                });
            } catch (e) { /* stays unposted; retried on reconnect */ }
        }

        function prefillFromGuestbook() {
            const G = window.SiteGun;
            if (saved.name || !G || !G.paths || !G.paths.apps.guestbook) return;
            if (store.get('guestbook-signed') !== myId) return;
            try {
                G.paths.apps.guestbook().get(myId).once((entry) => {
                    const name = entry && cleanName(entry.name);
                    if (destroyed || !name || saved.name || els.nameInput.value) return;
                    els.nameInput.value = name;
                });
            } catch (e) { /* the field just stays empty */ }
        }

        function connectGun() {
            if (destroyed) return;
            gunReady = true;
            myId = getMyId();
            if (window.SiteGun.getConnection) {
                offConnection = window.SiteGun.getConnection().onChange((on) => {
                    connected = on;
                    renderStatus();
                    renderPostState();
                    scheduleScores();
                    if (on) publish();
                });
            }
            renderStatus();
            subscribe();
            scheduleScores();
            if (game.done && !game.share) prefillFromGuestbook();
        }

        function waitSiteGun() {
            if (window.__loadRealtime) { try { window.__loadRealtime(); } catch (e) { /* ignore */ } }
            let attempts = 0;
            (function poll() {
                if (destroyed) return;
                if (window.SiteGun) { connectGun(); return; }
                if (++attempts > 100) {
                    els.status.textContent = 'Leaderboard unavailable';
                    els.status.dataset.state = 'off';
                    els.scoresEmpty.textContent = 'The leaderboard could not be reached. The puzzle and your streak still work.';
                    renderPostState();
                    return;
                }
                setTimeout(poll, 100);
            })();
        }

        // ---------------- Events ----------------

        function cellIndex(target) {
            const cell = target && target.closest ? target.closest('.dp-cell') : null;
            return cell && els.board.contains(cell) ? Number(cell.dataset.i) : -1;
        }

        let pressTimer = null;
        let pressX = 0, pressY = 0;
        let swallowClickUntil = 0;
        let lastPressFlag = 0;

        function cancelPress() {
            clearTimeout(pressTimer);
            pressTimer = null;
        }

        els.board.addEventListener('pointerdown', (e) => {
            cancelPress();
            if (e.pointerType === 'mouse' || !playing()) return;
            const i = cellIndex(e.target);
            if (i < 0) return;
            pressX = e.clientX; pressY = e.clientY;
            pressTimer = setTimeout(() => {
                pressTimer = null;
                if (game.cells[i] !== HIDDEN && game.cells[i] !== FLAG) return;
                swallowClickUntil = Date.now() + 700;
                lastPressFlag = Date.now();
                setFocus(i, false);
                toggleFlag(i);
                if (navigator.vibrate) { try { navigator.vibrate(18); } catch (err) { /* ignore */ } }
            }, LONG_PRESS_MS);
        });
        els.board.addEventListener('pointermove', (e) => {
            if (pressTimer && (Math.abs(e.clientX - pressX) > 9 || Math.abs(e.clientY - pressY) > 9)) cancelPress();
        });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach((type) => {
            els.board.addEventListener(type, cancelPress);
        });

        els.board.addEventListener('click', (e) => {
            const i = cellIndex(e.target);
            if (i < 0) return;
            if (Date.now() < swallowClickUntil) { swallowClickUntil = 0; return; }
            setFocus(i, false);
            act(i);
        });

        els.board.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            // Android reports a long press as a context menu too
            if (Date.now() - lastPressFlag < 900) return;
            const i = cellIndex(e.target);
            if (i < 0) return;
            setFocus(i, false);
            toggleFlag(i);
        });

        els.board.addEventListener('keydown', (e) => {
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            const i = cellIndex(e.target);
            if (i < 0) return;
            const r = Math.floor(i / SIZE), c = i % SIZE;
            let to = -1;
            switch (e.key) {
                case 'ArrowUp': to = r > 0 ? i - SIZE : i; break;
                case 'ArrowDown': to = r < SIZE - 1 ? i + SIZE : i; break;
                case 'ArrowLeft': to = c > 0 ? i - 1 : i; break;
                case 'ArrowRight': to = c < SIZE - 1 ? i + 1 : i; break;
                case 'Home': to = r * SIZE; break;
                case 'End': to = r * SIZE + SIZE - 1; break;
                case 'Enter':
                case ' ':
                    act(i);
                    break;
                case 'f':
                case 'F':
                    toggleFlag(i);
                    break;
                default:
                    return;
            }
            e.preventDefault();
            e.stopPropagation();
            if (to >= 0 && to !== i) setFocus(to, true);
        });

        els.board.addEventListener('animationend', (e) => {
            if (e.target === els.board) els.board.classList.remove('is-shaken');
        });

        els.coverBtn.addEventListener('click', begin);

        els.mode.addEventListener('click', () => setFlagMode(!flagMode));

        els.form.addEventListener('submit', (e) => {
            e.preventDefault();
            const name = cleanName(els.nameInput.value);
            if (!name) {
                els.nameInput.value = '';
                els.nameInput.focus();
                return;
            }
            if (!game.done) return;
            saved.name = name;
            game.share = true;
            editingName = false;
            persist();
            renderResult();
            renderScores();
            publish();
            els.rename.focus();
        });

        els.rename.addEventListener('click', () => {
            editingName = true;
            els.nameInput.value = saved.name;
            renderResult();
            els.nameInput.focus();
            els.nameInput.select();
        });

        let copyTimer = null;
        els.copy.addEventListener('click', () => {
            const streak = liveStreak(saved, game.date);
            const text = 'Daily Puzzle ' + game.date + '\n' +
                'Cleared in ' + formatTime(total()) +
                (game.hits ? ' (' + game.hits + (game.hits === 1 ? ' mine' : ' mines') + ' set off)' : ' without touching a mine') +
                (streak > 1 ? ' · ' + streak + '-day streak' : '') + '\n' +
                window.location.origin + '/?open=puzzle';
            const done = (ok) => {
                els.copy.textContent = ok ? 'Copied' : 'Copy Failed';
                clearTimeout(copyTimer);
                copyTimer = setTimeout(() => { els.copy.textContent = 'Copy Result'; }, 1800);
                if (ok) window.track?.('puzzle_result_copied', { date: game.date });
            };
            const fallback = () => {
                const area = document.createElement('textarea');
                area.value = text;
                area.setAttribute('readonly', '');
                area.style.position = 'fixed';
                area.style.opacity = '0';
                root.appendChild(area);
                area.select();
                let ok = false;
                try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
                area.remove();
                els.copy.focus();
                done(ok);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(() => done(true), fallback);
            } else {
                fallback();
            }
        });

        function onVisibility() {
            if (document.hidden) pause();
        }
        function onPageHide() {
            if (running) stopClock();
            if (game) persist();
            if (game && game.started && !game.done) renderCover();
        }
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('pagehide', onPageHide);

        // Minimizing the window stops the clock just like hiding the tab
        const minimizeWatch = new MutationObserver(() => {
            if (win.classList.contains('minimized')) pause();
        });
        minimizeWatch.observe(win, { attributes: true, attributeFilter: ['class'] });

        // ---------------- Boot ----------------

        myId = getMyId();
        buildBoard();
        loadDay(dateKey());
        renderStatus();
        tick();
        const tickTimer = setInterval(tick, 250);
        waitSiteGun();

        win.dailyPuzzleCleanup = function () {
            if (destroyed) return;
            if (running) stopClock();
            if (game) persist();
            destroyed = true;
            clearInterval(tickTimer);
            clearTimeout(renderTimer);
            clearTimeout(copyTimer);
            clearTimeout(penaltyTimer);
            cancelPress();
            unsubscribe();
            if (offConnection) { try { offConnection(); } catch (e) { /* ignore */ } }
            minimizeWatch.disconnect();
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('pagehide', onPageHide);
        };
    }

    /** What other parts of the site may want to know without opening the app. */
    function status() {
        const saved = loadSaved();
        const today = dateKey();
        const g = saved.game;
        return {
            date: today,
            started: !!(g && g.date === today && g.started === true),
            solved: saved.lastWon === today,
            streak: liveStreak(saved, today),
            best: saved.best
        };
    }

    window.initDailyPuzzle = initDailyPuzzle;
    window.DailyPuzzle = { SIZE: SIZE, MINES: MINES, dateKey: dateKey, generate: generate, status: status };
})();
