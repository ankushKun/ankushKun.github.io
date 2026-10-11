/**
 * Paint - a shared canvas everyone draws on at once.
 *
 * The canvas has a FIXED logical size (960x600) and is CSS-scaled to fit the
 * window. That is the whole trick: unlike cursors, which had to be anchored to
 * elements because the desktop layout differs per viewer, a drawing lives in
 * its own coordinate space. Everyone agrees on where pixel (480, 300) is, so
 * strokes can be published as plain logical coordinates.
 *
 * A stroke is published once, on pointer-up, as a whole polyline. Publishing
 * per-segment would multiply relay traffic by the number of points in a line
 * for no visual gain, since remote strokes are replayed instantly anyway.
 *
 * There is one canvas per UTC day (board key 'd-YYYY-MM-DD'), so everybody is
 * on the same one wherever they are, and each board stops growing at midnight.
 * Only today's board can be drawn on. Earlier days are replayed read-only from
 * their strokes, one at a time or as thumbnails in the Gallery.
 */
(function () {
    'use strict';

    const CANVAS_W = 960;
    const CANVAS_H = 600;
    const MAX_STROKES = 600;        // per day: keeps the graph (and replay time) bounded
    const MAX_POINTS_PER_STROKE = 400;
    const SIMPLIFY_MIN_DIST = 1.5;  // px between recorded points
    // Timestamps come from other people's clocks. Anything further ahead of
    // ours than this is not a clock difference, it is a made-up value.
    const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
    const MAX_PENDING = 300;        // strokes held while the relay is away
    const MAX_KEY_LENGTH = 96;      // stroke keys are ours to mint, theirs to forge

    const DAY_MS = 24 * 60 * 60 * 1000;
    // Daily boards began here. Board keys dated earlier are junk, not days,
    // and are ignored; that also caps how many days the gallery can list.
    const FIRST_DAY = '2026-10-11';
    const LEGACY_BOARD = 'main';    // the single canvas the site had before that
    const GALLERY_PAGE = 8;         // thumbnails replayed at once
    const THUMB_W = 480;
    const THUMB_H = 300;
    const SETTLE_MS = 700;          // time given to a board's first replay
    const TICK_MS = 20000;          // midnight watch + countdown refresh

    const PALETTE = [
        '#1d1d1f', '#ffffff', '#e0524a', '#f0872b', '#f0c419',
        '#5ac85a', '#2f6fd0', '#7b5ce0', '#e05fa8', '#8f5c2c'
    ];

    // Something to draw when the page is blank. One per day, the same for
    // everyone. The pick below walks the list in steps of 37, so every prompt
    // comes round once before any repeats - as long as the list's length is
    // not a multiple of 37. (Changing the length re-deals the prompts shown
    // next to past days; the drawings themselves are untouched.)
    const PROMPTS = [
        'a cat that has seen too much',
        'your desk, from memory',
        'a house on a very small island',
        'the weather where you are',
        'a robot learning to cook',
        'the last thing you ate',
        'a fish with a job',
        'a lighthouse in a storm',
        'a plant that needs water',
        'a bicycle built for five',
        'the view from your window',
        'a snail in a hurry',
        'a castle made of cheese',
        'a very tall sandwich',
        'a dog wearing a jumper',
        'a mountain with a face',
        'your favourite mug',
        'a rocket that missed the moon',
        'a tree in all four seasons',
        'an octopus doing chores',
        'a ghost who is afraid of people',
        'a map to buried treasure',
        'a bird with too many hats',
        'a city on the back of a whale',
        'breakfast',
        'a dragon the size of a teacup',
        'a train going somewhere nice',
        'a frog on a lily pad',
        'the inside of a computer',
        'a wizard on a day off',
        'a boat in a bottle',
        'a sleepy volcano',
        'a cactus that wants a hug',
        'shoes for a centipede',
        'a tiny door in a big wall',
        'a moon made of something else',
        'a penguin somewhere warm',
        'a garden on a rooftop',
        'a monster under a very small bed',
        'a kite stuck in a tree',
        'a bee with a to-do list',
        'a bridge between two clouds',
        'an umbrella for two',
        'a bowl of noodles',
        'a spider knitting',
        'a tent under the stars',
        'a whale saying hello',
        'a hot air balloon race',
        'a bug you fixed',
        'a snowman in summer',
        'a mushroom house',
        'an owl up past its bedtime',
        'a keyboard with one key',
        'a crab with a secret',
        'a street you know well',
        'a cloud shaped like an animal',
        'a turtle carrying its luggage',
        'a duck in a raincoat',
        'a pile of books',
        'a submarine with windows',
        'a fox reading the news',
        'a clock that melted',
        'an alien tourist',
        'a bear who found the honey',
        'a paper plane mid-flight',
        'a campfire and whoever is around it',
        'a giraffe in a small car',
        'a self-portrait, eyes closed',
        'a windmill on a hill',
        'a jellyfish chandelier',
        'a pizza with everything',
        'a hedgehog and a balloon',
        'a staircase to nowhere',
        'a satellite waving at Earth',
        'a mouse in a library',
        'a treehouse with a slide',
        'a pirate ship in a bathtub',
        'a sunflower that is too tall',
        'a sloth winning a race',
        'the first thing you see when you look up',
        'a teapot pouring a rainbow',
        'a village in the snow',
        'a parrot that knows the password',
        'a planet with rings and a hat',
        'a hammock between two palm trees',
        'a knight and a very small dragon',
        'a road that goes over the horizon',
        'a rabbit pulling a magician out of a hat',
        'a market stall selling stars',
        'a goodnight scene'
    ];

    // ---- Days ---------------------------------------------------------
    // A day is 'YYYY-MM-DD' in UTC; its board is 'd-' + day.

    function utcDay(ms) {
        return new Date(ms).toISOString().slice(0, 10);
    }

    function dayStart(day) {
        return Date.parse(day + 'T00:00:00Z');
    }

    function isDay(s) {
        if (typeof s !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(s)) return false;
        const t = dayStart(s);
        return !isNaN(t) && utcDay(t) === s;   // rejects 2026-02-31 and friends
    }

    function shiftDay(day, n) {
        return utcDay(dayStart(day) + n * DAY_MS);
    }

    function boardOf(day) {
        return 'd-' + day;
    }

    /** The day a board key stands for, or null for the legacy board / junk. */
    function dayOf(board) {
        if (typeof board !== 'string' || board.slice(0, 2) !== 'd-') return null;
        const day = board.slice(2);
        return isDay(day) ? day : null;
    }

    function promptFor(day) {
        const n = Math.round(dayStart(day) / DAY_MS);
        return PROMPTS[(((n * 37 + 11) % PROMPTS.length) + PROMPTS.length) % PROMPTS.length];
    }

    function formatter(options) {
        try {
            return new Intl.DateTimeFormat(undefined, Object.assign({ timeZone: 'UTC' }, options));
        } catch (e) {
            return null;
        }
    }
    const DAY_FORMAT = formatter({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

    function dayLabel(day) {
        return DAY_FORMAT ? DAY_FORMAT.format(dayStart(day)) : day;
    }

    /** "5 h 12 min" until the next UTC midnight. */
    function untilMidnight() {
        const now = Date.now();
        const mins = Math.ceil((dayStart(utcDay(now)) + DAY_MS - now) / 60000);
        if (mins <= 1) return 'under a minute';
        if (mins < 60) return mins + ' min';
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return h + ' h' + (m ? ' ' + m + ' min' : '');
    }

    // ---- Strokes ------------------------------------------------------

    function drawStroke(ctx, stroke) {
        if (!stroke || !stroke.pts || stroke.pts.length < 2) return;

        const pts = stroke.pts;
        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(1, Math.min(40, stroke.w || 4));
        ctx.strokeStyle = stroke.t === 'eraser' ? '#ffffff' : (stroke.c || '#1d1d1f');

        ctx.beginPath();
        ctx.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) {
            ctx.lineTo(pts[i], pts[i + 1]);
        }
        ctx.stroke();
        ctx.restore();
    }

    /**
     * Turn whatever a peer wrote into a stroke, or null. `day` is the UTC day
     * of the board it was found on (null on the legacy board).
     */
    function parseStroke(data, day) {
        if (!data || typeof data.pts !== 'string') return null;
        // Longest honest value: 800 numbers of at most 6 characters each.
        if (data.pts.length > MAX_POINTS_PER_STROKE * 2 * 8) return null;
        const pts = data.pts.split(',').map(Number);
        if (pts.length < 4 || pts.some((n) => !isFinite(n))) return null;
        const ts = Number(data.ts) || 0;
        // A stroke dated in the future would outlive every Clear and never
        // be pruned (pruning is oldest-first). It is ignored, not deleted:
        // a viewer whose own clock is wrong must not wipe valid strokes.
        if (ts > Date.now() + MAX_CLOCK_SKEW_MS) return null;
        // A daily board only shows strokes dated on its day, so an honest
        // client drawing after midnight cannot add to a finished day. The
        // date is the writer's own claim, though; a forged one still gets
        // in, which is why read-only boards also cap what they keep
        // (capInsert).
        if (day) {
            const start = dayStart(day);
            if (ts < start - MAX_CLOCK_SKEW_MS || ts >= start + DAY_MS + MAX_CLOCK_SKEW_MS) return null;
        }
        return {
            t: data.t === 'eraser' ? 'eraser' : 'pencil',
            c: typeof data.c === 'string' && data.c.length <= 32 ? data.c : '#1d1d1f',
            w: Math.max(1, Math.min(40, Number(data.w) || 4)),
            pts: pts.slice(0, MAX_POINTS_PER_STROKE * 2),
            ts: ts,
            by: typeof data.by === 'string' ? data.by.slice(0, 64) : ''
        };
    }

    /**
     * Add a stroke to `map` without letting it grow past MAX_STROKES. Past
     * days keep their earliest strokes (a flood written later cannot push
     * out the real drawing); today keeps its newest, like pruneOldStrokes.
     * Returns the key it evicted, '' when nothing was, or null when the
     * stroke itself was not kept.
     */
    function capInsert(map, key, stroke, keepNewest) {
        if (map.has(key) || map.size < MAX_STROKES) {
            map.set(key, stroke);
            return '';
        }
        let edgeKey = null;
        let edgeTs = keepNewest ? Infinity : -Infinity;
        map.forEach((s, k) => {
            const t = s.ts || 0;
            if (keepNewest ? t <= edgeTs : t >= edgeTs) { edgeTs = t; edgeKey = k; }
        });
        const ts = stroke.ts || 0;
        if (keepNewest ? ts <= edgeTs : ts >= edgeTs) return null;
        map.delete(edgeKey);
        map.set(key, stroke);
        return edgeKey;
    }

    /**
     * Follow one board. `onStroke(key, stroke)` is called with a parsed stroke,
     * or null when the stroke was removed. `onCleared(ts)` only ever fires for
     * the legacy board: daily boards have no clear-for-everyone at all.
     * Returns a function that stops following.
     */
    function watchBoard(board, onStroke, onCleared) {
        const day = dayOf(board);
        const paths = window.SiteGun.paths.apps;
        const offs = new Set();
        let closed = false;
        let clearedAt = 0;

        // Gun only hands over the unsubscribe handle with an event, so a
        // watcher that was closed before anything arrived unhooks itself here.
        function live(ev) {
            if (ev && typeof ev.off === 'function') {
                if (closed) {
                    try { ev.off(); } catch (e) { /* ignore */ }
                } else {
                    offs.add(ev);
                }
            }
            return !closed;
        }

        paths.paintStrokes(board).map().on(function (data, key, _msg, ev) {
            if (!live(ev)) return;
            if (typeof key !== 'string' || !key || key.length > MAX_KEY_LENGTH) return;
            if (!data) { onStroke(key, null); return; }
            const stroke = parseStroke(data, day);
            if (stroke) onStroke(key, stroke);
        });

        if (!day && onCleared) {
            paths.paintMeta(board).on(function (data, _key, _msg, ev) {
                if (!live(ev)) return;
                const t = data && Number(data.clearedAt);
                // Only ever forwards: an older value would bring back
                // everything cleared since.
                if (!t || t <= clearedAt) return;
                // Anyone can write this node. A "cleared at" in the future
                // would hide every stroke drawn from now until that date, so
                // it is not a clear at all and is ignored.
                if (t > Date.now() + MAX_CLOCK_SKEW_MS) return;
                clearedAt = t;
                onCleared(t);
            });
        }

        return function close() {
            closed = true;
            offs.forEach((ev) => {
                try { ev.off(); } catch (e) { /* ignore */ }
            });
            offs.clear();
        };
    }

    function initPaint(win) {
        const root = win.querySelector('.paint-window');
        if (!root || root.dataset.init) return;
        root.dataset.init = '1';

        const canvas = root.querySelector('.paint-canvas');
        const ctx = canvas.getContext('2d');
        const els = {
            stage: root.querySelector('.paint-stage'),
            loading: root.querySelector('.paint-loading'),
            status: root.querySelector('.paint-status'),
            palette: root.querySelector('.paint-palette'),
            clear: root.querySelector('.paint-clear'),
            undo: root.querySelector('.paint-undo'),
            save: root.querySelector('.paint-save'),
            offline: root.querySelector('.paint-offline'),
            tools: root.querySelectorAll('.paint-tool'),
            sizes: root.querySelectorAll('.paint-size'),
            hint: root.querySelector('.paint-hint'),
            empty: root.querySelector('.paint-empty'),
            prev: root.querySelector('.paint-prev'),
            next: root.querySelector('.paint-next'),
            dayTitle: root.querySelector('.paint-day-title'),
            dayDate: root.querySelector('.paint-day-date'),
            dayPrompt: root.querySelector('.paint-day-prompt'),
            galleryToggle: root.querySelector('.paint-gallery-toggle'),
            backToday: root.querySelector('.paint-today'),
            gallery: root.querySelector('.paint-gallery'),
            grid: root.querySelector('.paint-gallery-grid'),
            galleryNote: root.querySelector('.paint-gallery-note'),
            pager: root.querySelector('.paint-gallery-pager'),
            pageLabel: root.querySelector('.paint-gallery-page'),
            newer: root.querySelector('.paint-gallery-newer'),
            older: root.querySelector('.paint-gallery-older')
        };

        // Same identity the cursors use. Storage can be blocked, in which
        // case the id only lives for this page view.
        function visitorId() {
            if (window.SiteGun && window.SiteGun.visitorId) return window.SiteGun.visitorId();
            let id = null;
            try { id = localStorage.getItem('multiplayer-cursor-id'); } catch (e) { /* blocked */ }
            if (!id) id = window.__siteVisitorId || Math.random().toString(36).slice(2, 11);
            try { localStorage.setItem('multiplayer-cursor-id', id); } catch (e) { /* blocked */ }
            window.__siteVisitorId = id;
            return id;
        }
        const myId = visitorId();

        let tool = 'pencil';
        let size = 4;
        let colour = PALETTE[0];

        // Which canvas is on screen. `today` moves at UTC midnight; `board`
        // is today's (the only one that can be drawn on), an earlier day's,
        // or the legacy board.
        let today = utcDay(Date.now());
        let board = boardOf(today);
        let readOnly = false;
        let view = 'canvas';       // or 'gallery'
        let hasGun = false;
        let notice = '';           // one-off status line, e.g. after midnight

        let strokesRef = null;     // today's strokes; null while looking at another day
        let stopWatching = null;
        let revealTimer = null;
        let settled = false;       // the open board has had time to replay
        let clearedAt = 0;

        const known = new Map();   // strokeKey -> stroke, for the open board
        const drawn = new Set();   // strokeKeys already painted
        const mine = [];           // { key, g } for this visitor's strokes, oldest first
        const mineKeys = new Set();
        const gestures = new Map();// strokeKey -> gesture, survives switching boards
        const pending = new Map(); // strokeKey -> { board, payload } not yet confirmed sent
        const boards = new Set();  // board keys the relay says exist
        const timers = new Set();
        let stopBoards = null;
        let offConnection = null;
        let isConnected = false;
        let gesture = 0;           // one pointer-down..up, however many strokes it took
        let repaintQueued = false;
        let drewOn = '';           // board already reported to the event bus

        // ---- Canvas setup -------------------------------------------------

        function resetCanvas() {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        }

        resetCanvas();

        function isVisible(stroke) {
            return (stroke.ts || 0) > clearedAt;
        }

        /** Repaint from scratch - used after a clear, or on first load. */
        function repaintAll() {
            resetCanvas();
            drawn.clear();
            [...known.entries()]
                .filter(([, s]) => isVisible(s))
                .sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0))
                .forEach(([key, s]) => {
                    drawStroke(ctx, s);
                    drawn.add(key);
                });
            // A stroke in progress is not in `known` yet - keep it on screen.
            if (drawing && current) drawStroke(ctx, current);
            updateEmpty();
        }

        /** Coalesce repaints: an undo or a prune can remove many strokes at once. */
        function scheduleRepaint() {
            if (repaintQueued) return;
            repaintQueued = true;
            requestAnimationFrame(() => {
                repaintQueued = false;
                repaintAll();
            });
        }

        // ---- Coordinate mapping -------------------------------------------
        // The canvas is CSS-scaled, so pointer coords must be converted back
        // into the fixed logical space everyone shares.

        function toLogical(e) {
            const rect = canvas.getBoundingClientRect();
            return {
                x: Math.round(((e.clientX - rect.left) / rect.width) * CANVAS_W),
                y: Math.round(((e.clientY - rect.top) / rect.height) * CANVAS_H)
            };
        }

        // ---- Drawing ------------------------------------------------------

        let drawing = false;
        let current = null;
        let lastPt = null;

        function beginStroke(e) {
            if (readOnly || view !== 'canvas') return;
            if (e.button != null && e.button !== 0) return;
            const p = toLogical(e);

            drawing = true;
            lastPt = p;
            gesture++;
            current = { t: tool, c: colour, w: size, pts: [p.x, p.y] };

            canvas.setPointerCapture?.(e.pointerId);
            e.preventDefault();
        }

        function extendStroke(e) {
            if (!drawing || !current) return;
            const p = toLogical(e);

            const dx = p.x - lastPt.x;
            const dy = p.y - lastPt.y;
            if ((dx * dx + dy * dy) < SIMPLIFY_MIN_DIST * SIMPLIFY_MIN_DIST) return;

            // Paint the new segment immediately - the local artist should never
            // wait on the network to see their own line.
            ctx.save();
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.lineWidth = current.w;
            ctx.strokeStyle = current.t === 'eraser' ? '#ffffff' : current.c;
            ctx.beginPath();
            ctx.moveTo(lastPt.x, lastPt.y);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
            ctx.restore();

            current.pts.push(p.x, p.y);
            lastPt = p;
            e.preventDefault();

            // A stroke has a point budget. Rather than keep drawing locally
            // while silently recording nothing (everyone else then saw a line
            // that stopped short), publish this piece and carry on in a new
            // one that starts where it ended.
            if (current.pts.length >= MAX_POINTS_PER_STROKE * 2) {
                publishStroke(current);
                current = { t: current.t, c: current.c, w: current.w, pts: [p.x, p.y], continued: true };
            }
        }

        function endStroke() {
            if (!drawing) return;
            drawing = false;

            const stroke = current;
            current = null;
            lastPt = null;

            if (stroke) {
                if (stroke.pts.length < 4) {
                    if (stroke.continued) {
                        // The leftover seed point of a split stroke is already drawn.
                        stroke.pts.length = 0;
                    } else {
                        // A click is a dot: a hair-length line with round caps.
                        stroke.pts.push(stroke.pts[0] + 0.1, stroke.pts[1]);
                        drawStroke(ctx, stroke);
                    }
                }
                if (stroke.pts.length) publishStroke(stroke);
            }
            // Midnight may have passed mid-line; the move to the new canvas
            // was held back so the line could be finished where it began.
            tick();
        }

        function publishStroke(stroke) {
            const now = Date.now();
            const key = now + '-' + myId + '-' + Math.random().toString(36).slice(2, 6);
            const payload = {
                t: stroke.t,
                c: stroke.c,
                w: stroke.w,
                // Gun stores scalars, not arrays - a packed string round-trips
                // cleanly and is far smaller than a nested node per point.
                pts: stroke.pts.join(','),
                by: myId,
                ts: now
            };

            known.set(key, { t: stroke.t, c: stroke.c, w: stroke.w, pts: stroke.pts, ts: now, by: myId });
            drawn.add(key);
            mine.push({ key: key, g: gesture });
            mineKeys.add(key);
            gestures.set(key, gesture);
            updateUndo();
            updateEmpty();

            // Held until the relay is reachable, so drawing while offline (or
            // before Gun has loaded) is not thrown away.
            if (!strokesRef || !isConnected) {
                if (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value);
                pending.set(key, { board: board, payload: payload });
            }
            if (strokesRef) strokesRef.get(key).put(payload);

            if (drewOn !== board) {
                drewOn = board;
                if (window.track) window.track('paint_draw', { day: dayOf(board) });
            }
        }

        function flushPending() {
            if (!hasGun || !isConnected || !pending.size) return;
            const paths = window.SiteGun.paths.apps;
            // Re-putting an identical value is a no-op for anyone who already
            // has it, so this is safe even if Gun delivered some by itself.
            // Each stroke goes back to the board it was drawn on, which after
            // midnight is no longer the one on screen.
            pending.forEach((entry, key) => paths.paintStrokes(entry.board).get(key).put(entry.payload));
            pending.clear();
        }

        // ---- Undo ---------------------------------------------------------
        // Only this visitor's own strokes, newest first. A long line that was
        // split into several strokes comes off as the one gesture it was.

        function undoable() {
            while (mine.length) {
                const last = mine[mine.length - 1];
                const s = known.get(last.key);
                if (s && isVisible(s)) return last;
                mine.pop();   // cleared, pruned or removed by someone else
            }
            return null;
        }

        function updateUndo() {
            const none = readOnly || !undoable();
            if (els.undo) els.undo.disabled = none;
            if (els.clear) els.clear.disabled = none;
        }

        function removeMine(entry) {
            known.delete(entry.key);
            drawn.delete(entry.key);
            pending.delete(entry.key);
            gestures.delete(entry.key);
            if (strokesRef) strokesRef.get(entry.key).put(null);
        }

        function undo() {
            if (drawing || readOnly || view !== 'canvas') return;
            const last = undoable();
            if (!last) return;

            do {
                removeMine(mine.pop());
            } while (last.g != null && mine.length && mine[mine.length - 1].g === last.g);

            repaintAll();
            updateUndo();
        }

        canvas.addEventListener('pointerdown', beginStroke);
        canvas.addEventListener('pointermove', extendStroke);
        canvas.addEventListener('pointerup', endStroke);
        canvas.addEventListener('pointercancel', endStroke);
        canvas.addEventListener('pointerleave', endStroke);

        // Don't let the window manager treat drawing as a window drag
        canvas.addEventListener('mousedown', (e) => e.stopPropagation());

        // ---- Tool UI ------------------------------------------------------

        function selectIn(list, el, apply) {
            list.forEach((b) => {
                const on = b === el;
                b.classList.toggle('is-selected', on);
                b.setAttribute('aria-checked', on ? 'true' : 'false');
            });
            apply();
        }

        els.tools.forEach((btn) => {
            btn.addEventListener('click', () => {
                selectIn(els.tools, btn, () => { tool = btn.dataset.tool; });
                canvas.classList.toggle('is-eraser', tool === 'eraser');
            });
        });

        els.sizes.forEach((btn) => {
            btn.addEventListener('click', () => {
                selectIn(els.sizes, btn, () => { size = parseInt(btn.dataset.size, 10) || 4; });
            });
        });

        PALETTE.forEach((hex, i) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'paint-swatch' + (i === 0 ? ' is-selected' : '');
            btn.style.background = hex;
            btn.setAttribute('role', 'radio');
            btn.setAttribute('aria-checked', i === 0 ? 'true' : 'false');
            // No data-tip here: the swatch already shows the colour, so a hex
            // tooltip is noise that only risks clipping against the toolbar.
            btn.setAttribute('aria-label', 'Colour ' + hex);
            btn.addEventListener('click', () => {
                const all = els.palette.querySelectorAll('.paint-swatch');
                all.forEach((b) => {
                    const on = b === btn;
                    b.classList.toggle('is-selected', on);
                    b.setAttribute('aria-checked', on ? 'true' : 'false');
                });
                colour = hex;
                // Choosing a colour implies you want to draw, not erase
                if (tool === 'eraser') {
                    const pencil = root.querySelector('.paint-tool[data-tool="pencil"]');
                    if (pencil) pencil.click();
                }
            });
            els.palette.appendChild(btn);
        });

        // ---- Clear --------------------------------------------------------

        function tell(title, message) {
            if (window.showAlert) window.showAlert(title, message);
            else alert(title + '\n\n' + message);
        }

        // There is no clear-for-everyone on a daily canvas: one visitor could
        // wipe a whole day of other people's drawings with it, and the canvas
        // starts fresh at midnight anyway. Clear takes away your own strokes
        // and nobody else's - Undo, all the way back.
        els.clear.addEventListener('click', async () => {
            if (drawing || readOnly || view !== 'canvas' || !undoable()) return;
            // A removal sent while the relay is away can be lost, leaving the
            // strokes up for everyone else while they vanish here.
            if (!isConnected) {
                tell('Not connected', 'Your strokes can only be removed while you are online.');
                return;
            }
            const openBoardWas = board;

            const ok = window.showConfirm
                ? await window.showConfirm('Remove everything you drew today?',
                    'Your own strokes come off the canvas for everyone and cannot be brought back. ' +
                    'What other people drew stays where it is.',
                    { confirmLabel: 'Remove Mine', danger: true })
                : confirm('Remove everything you drew today? This cannot be undone.');
            // The sheet is asynchronous: midnight or a trip to the gallery
            // may have happened while it was up.
            if (!ok || drawing || readOnly || board !== openBoardWas) return;

            while (undoable()) removeMine(mine.pop());
            repaintAll();
            updateUndo();
            if (window.track) window.track('paint_clear_mine', { day: dayOf(board) });
        });

        // ---- Undo / Save --------------------------------------------------

        if (els.undo) els.undo.addEventListener('click', undo);

        // Cmd/Ctrl+Z, but only while Paint is the frontmost window and the
        // keystroke is not headed for a text field somewhere else.
        function onKeydown(e) {
            if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
            if (e.key !== 'z' && e.key !== 'Z') return;
            if (!win.isConnected || win.classList.contains('inactive') ||
                win.classList.contains('minimized')) return;
            const t = e.target;
            if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
            e.preventDefault();
            undo();
        }
        document.addEventListener('keydown', onKeydown);

        function savePng() {
            if (!canvas.toBlob || view !== 'canvas') return;
            const day = dayOf(board);
            const name = 'paint-' + (day || 'original') + '.png';
            canvas.toBlob((blob) => {
                if (!blob) return;
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = name;
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            }, 'image/png');
            if (window.track) window.track('paint_save', { day: day });
        }

        if (els.save) els.save.addEventListener('click', savePng);

        // ---- The open board -------------------------------------------------

        function setStatus(msg, offline) {
            els.status.textContent = msg;
            els.status.classList.toggle('is-offline', !!offline);
        }

        /** Says so when a past day turns out to hold nothing. */
        function updateEmpty() {
            if (!els.empty) return;
            const blank = settled && readOnly && drawn.size === 0;
            els.empty.hidden = !blank;
            if (!blank) return;
            els.empty.textContent = !isConnected
                ? 'This canvas cannot be loaded while offline.'
                : 'Nothing is left on this canvas.';
        }

        function adoptMine(key, stroke) {
            if (stroke.by !== myId || mineKeys.has(key)) return;
            // Drawn in an earlier visit, or before a trip to another day -
            // still ours to undo.
            mineKeys.add(key);
            mine.push({ key: key, g: gestures.has(key) ? gestures.get(key) : null });
            mine.sort((a, b) =>
                ((known.get(a.key) || {}).ts || 0) - ((known.get(b.key) || {}).ts || 0));
            updateUndo();
        }

        function onStroke(key, stroke) {
            if (!stroke) {
                // Someone undid or pruned a stroke that is on screen.
                if (known.delete(key) && drawn.delete(key)) {
                    scheduleRepaint();
                    updateUndo();
                }
                return;
            }

            if (readOnly) {
                // Nobody prunes a past day, so cap it here.
                const evicted = capInsert(known, key, stroke, false);
                if (evicted === null) return;
                if (evicted && drawn.delete(evicted)) scheduleRepaint();
            } else {
                known.set(key, stroke);
            }
            adoptMine(key, stroke);
            if (!isVisible(stroke) || drawn.has(key)) return;

            drawn.add(key);
            drawStroke(ctx, stroke);
            if (els.empty && !els.empty.hidden) updateEmpty();
        }

        function onCleared(t) {
            clearedAt = t;
            repaintAll();
            updateUndo();
        }

        const replayed = new Set();   // boards already fetched in this window

        function openBoard(next) {
            if (stopWatching) { stopWatching(); stopWatching = null; }
            if (revealTimer) { clearTimeout(revealTimer); timers.delete(revealTimer); }

            board = next;
            readOnly = board !== boardOf(today);
            strokesRef = hasGun && !readOnly ? window.SiteGun.paths.apps.paintStrokes(board) : null;
            clearedAt = 0;
            settled = false;
            known.clear();
            drawn.clear();
            mine.length = 0;
            mineKeys.clear();

            // Strokes the relay has not taken yet exist nowhere but here.
            pending.forEach((entry, key) => {
                if (entry.board !== board) return;
                const stroke = parseStroke(entry.payload, null);
                if (!stroke) return;
                known.set(key, stroke);
                adoptMine(key, stroke);
            });
            repaintAll();

            // A board seen before replays from memory at once; only a first
            // visit waits on the relay behind the loading cover.
            const first = hasGun && !replayed.has(board);
            replayed.add(board);
            els.loading.hidden = !first;
            if (hasGun) stopWatching = watchBoard(board, onStroke, onCleared);

            const timer = revealTimer = setTimeout(() => {
                timers.delete(timer);
                if (revealTimer === timer) revealTimer = null;
                settled = true;
                els.loading.hidden = true;
                repaintAll();
            }, first ? SETTLE_MS : 120);
            timers.add(timer);

            syncChrome();
            updateUndo();
        }

        function pruneOldStrokes() {
            // Only ever on today's board: a past day is never written to.
            if (!strokesRef || readOnly || known.size <= MAX_STROKES) return;
            const sorted = [...known.entries()].sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
            const excess = sorted.slice(0, known.size - MAX_STROKES);
            let wasVisible = false;
            excess.forEach(([key]) => {
                strokesRef.get(key).put(null);
                known.delete(key);
                if (drawn.delete(key)) wasVisible = true;
            });
            // Match what every other viewer now shows.
            if (wasVisible) scheduleRepaint();
            updateUndo();
        }

        // ---- Days: title, arrows, midnight ----------------------------------

        /** Sorts boards by age: the legacy board before every day. */
        function rank(b) {
            return dayOf(b) || '';
        }

        /**
         * The nearest canvas older (-1) or newer (+1) than the open one.
         * Only days somebody drew on are stops, so the arrows never walk
         * through a run of blank days one click at a time.
         */
        function neighbour(dir) {
            const cur = rank(board);
            let best = null;
            galleryList().forEach((b) => {
                const r = rank(b);
                if (dir < 0 ? r >= cur : r <= cur) return;
                if (best === null || (dir < 0 ? r > rank(best) : r < rank(best))) best = b;
            });
            return best;
        }

        function updateHint() {
            let text;
            if (view === 'gallery') {
                text = 'One canvas per day, midnight to midnight UTC. Past days last as long as the relay keeps them.';
            } else if (notice) {
                text = notice;
            } else if (!readOnly) {
                text = 'Everyone here draws on the same canvas — be kind to each other\'s work. ' +
                    'A fresh one starts in ' + untilMidnight() + '.';
            } else if (board === LEGACY_BOARD) {
                text = 'The shared canvas from before there was a new one every day.';
            } else {
                text = 'This canvas closed at midnight UTC. Past days can be looked at and saved, not drawn on.';
            }
            if (els.hint && els.hint.textContent !== text) els.hint.textContent = text;
        }

        function syncChrome() {
            const gallery = view === 'gallery';
            const day = dayOf(board);
            const isToday = board === boardOf(today);

            root.classList.toggle('is-readonly', readOnly);
            root.classList.toggle('is-gallery', gallery);
            els.stage.hidden = gallery;
            els.gallery.hidden = !gallery;
            els.galleryToggle.setAttribute('aria-pressed', gallery ? 'true' : 'false');

            let title, date = '', prompt;
            if (gallery) {
                title = 'Gallery';
                prompt = 'One canvas a day. Pick one to look at it.';
            } else if (!day) {
                title = 'The original canvas';
                prompt = 'From before the daily canvases';
            } else if (isToday) {
                title = 'Today';
                date = dayLabel(day);
                prompt = 'Today\'s prompt: ' + promptFor(day);
            } else {
                title = dayLabel(day);
                prompt = 'The prompt was: ' + promptFor(day);
            }
            els.dayTitle.textContent = title;
            els.dayDate.textContent = date;
            els.dayDate.hidden = !date;
            els.dayPrompt.textContent = prompt;

            els.prev.disabled = gallery || !neighbour(-1);
            els.next.disabled = gallery || !neighbour(1);
            canvas.setAttribute('aria-label',
                isToday ? 'Today\'s shared canvas' : title + ', read-only');

            updateHint();
            updateEmpty();
        }

        /** Put a board on the canvas (from an arrow, a thumbnail or Back to Today). */
        function show(next) {
            if (drawing) endStroke();
            notice = '';
            view = 'canvas';
            closeTiles();
            if (next !== board) openBoard(next);
            else { syncChrome(); updateUndo(); }
            if (readOnly && window.track) window.track('paint_day_view', { day: dayOf(board) });
        }

        function step(dir) {
            const next = neighbour(dir);
            if (!next) return;
            show(next);
            // The arrow just used may have reached the end of the line.
            const used = dir < 0 ? els.prev : els.next;
            const other = dir < 0 ? els.next : els.prev;
            if (used.disabled) (other.disabled ? els.galleryToggle : other).focus();
        }

        els.prev.addEventListener('click', () => step(-1));
        els.next.addEventListener('click', () => step(1));

        els.backToday.addEventListener('click', () => {
            show(boardOf(today));
            const pencil = root.querySelector('.paint-tool.is-selected');
            if (pencil) pencil.focus();
        });

        /** Runs every few seconds, and after each stroke: has UTC midnight passed? */
        function tick() {
            const now = utcDay(Date.now());
            if (now === today || drawing) {
                updateHint();
                return;
            }
            const wasOnToday = board === boardOf(today);
            today = now;
            if (wasOnToday) {
                notice = 'A new day has started, so here is a fresh canvas. Yesterday\'s is in the Gallery.';
                openBoard(boardOf(today));
            } else {
                syncChrome();
            }
            if (view === 'gallery') renderGallery();
        }

        // ---- Gallery --------------------------------------------------------
        // A page of thumbnails, each replayed from that day's strokes exactly
        // as the full canvas is. Nothing is stored as an image, so a thumbnail
        // cannot disagree with the day it opens.

        let galleryPage = 0;
        let galleryShown = '';
        let tileStops = [];

        function galleryList() {
            const list = [];
            boards.forEach((b) => {
                const day = dayOf(b);
                if (day && day >= FIRST_DAY && day < today) list.push(b);
            });
            list.sort().reverse();              // newest day first
            list.unshift(boardOf(today));
            if (boards.has(LEGACY_BOARD)) list.push(LEGACY_BOARD);
            return list;
        }

        function closeTiles() {
            tileStops.forEach((stop) => stop());
            tileStops = [];
            galleryShown = '';
            if (els.grid) els.grid.textContent = '';
        }

        function makeTile(b) {
            const day = dayOf(b);
            const isToday = b === boardOf(today);
            const title = !day ? 'The original canvas' : (isToday ? 'Today' : dayLabel(day));
            const sub = !day ? 'From before the daily canvases' : promptFor(day);

            const item = document.createElement('li');
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'paint-tile';
            btn.dataset.board = b;
            if (b === board) btn.setAttribute('aria-current', 'true');
            btn.setAttribute('aria-label',
                title + (day ? ', prompt: ' + sub : '') + (isToday ? '' : ', read-only'));

            const thumb = document.createElement('canvas');
            thumb.className = 'paint-tile-canvas';
            thumb.width = THUMB_W;
            thumb.height = THUMB_H;
            thumb.setAttribute('aria-hidden', 'true');

            const name = document.createElement('span');
            name.className = 'paint-tile-title';
            name.textContent = title;
            const caption = document.createElement('span');
            caption.className = 'paint-tile-prompt';
            caption.textContent = sub;

            btn.append(thumb, name, caption);
            item.appendChild(btn);
            btn.addEventListener('click', () => {
                show(b);
                els.galleryToggle.focus();
            });

            const tctx = thumb.getContext('2d');
            const strokes = new Map();
            let cleared = 0;
            let queued = false;
            let full = true;       // next paint starts from a blank tile
            let lastTs = -Infinity;// newest stroke already on the tile
            const fresh = [];      // strokes to draw on top at the next paint

            // Strokes mostly stream in oldest first, so they are drawn on
            // top of what is there; only a removal, a clear or an
            // out-of-order arrival repaints the whole tile.
            function paint() {
                queued = false;
                let list;
                if (full) {
                    full = false;
                    lastTs = -Infinity;
                    tctx.setTransform(1, 0, 0, 1, 0, 0);
                    tctx.fillStyle = '#ffffff';
                    tctx.fillRect(0, 0, THUMB_W, THUMB_H);
                    list = [...strokes.values()];
                    fresh.length = 0;
                } else {
                    list = fresh.splice(0);
                }
                tctx.setTransform(THUMB_W / CANVAS_W, 0, 0, THUMB_H / CANVAS_H, 0, 0);
                list.filter((s) => (s.ts || 0) > cleared)
                    .sort((a, c) => (a.ts || 0) - (c.ts || 0))
                    .forEach((s) => {
                        drawStroke(tctx, s);
                        lastTs = Math.max(lastTs, s.ts || 0);
                    });
            }

            function schedule() {
                if (queued) return;
                queued = true;
                requestAnimationFrame(paint);
            }

            paint();
            if (hasGun) {
                tileStops.push(watchBoard(b, (key, stroke) => {
                    if (stroke) {
                        const had = strokes.has(key);
                        const evicted = capInsert(strokes, key, stroke, isToday);
                        if (evicted === null) return;
                        if (had || evicted || (stroke.ts || 0) < lastTs) full = true;
                        else fresh.push(stroke);
                    } else {
                        if (!strokes.delete(key)) return;
                        full = true;
                    }
                    schedule();
                }, (t) => { cleared = t; full = true; schedule(); }));
            }
            return item;
        }

        function renderGallery() {
            const list = galleryList();
            const pages = Math.max(1, Math.ceil(list.length / GALLERY_PAGE));
            galleryPage = Math.max(0, Math.min(galleryPage, pages - 1));
            const slice = list.slice(galleryPage * GALLERY_PAGE, (galleryPage + 1) * GALLERY_PAGE);

            // New days trickle in from the relay; only rebuild (and replay)
            // the thumbnails when this page's set of days really changed.
            const shown = slice.join(' ') + '|' + board;
            if (shown !== galleryShown) {
                const active = document.activeElement;
                const focused = active && els.grid.contains(active) ? active.dataset.board : null;
                closeTiles();
                galleryShown = shown;
                slice.forEach((b) => els.grid.appendChild(makeTile(b)));
                if (focused) {
                    const again = [...els.grid.querySelectorAll('.paint-tile')]
                        .find((t) => t.dataset.board === focused);
                    if (again) again.focus();
                }
            }

            els.pager.hidden = pages < 2;
            els.pageLabel.textContent = 'Page ' + (galleryPage + 1) + ' of ' + pages;
            els.newer.disabled = galleryPage === 0;
            els.older.disabled = galleryPage >= pages - 1;
            els.galleryNote.hidden = isConnected;
        }

        function turnPage(by) {
            galleryPage += by;
            renderGallery();
            els.gallery.scrollTop = 0;
            const used = by < 0 ? els.newer : els.older;
            if (used.disabled) (by < 0 ? els.older : els.newer).focus();
        }

        els.newer.addEventListener('click', () => turnPage(-1));
        els.older.addEventListener('click', () => turnPage(1));

        els.galleryToggle.addEventListener('click', () => {
            if (drawing) endStroke();
            if (view === 'gallery') {
                view = 'canvas';
                closeTiles();
            } else {
                view = 'gallery';
                galleryPage = 0;
                renderGallery();
                if (window.track) window.track('paint_gallery_open', {});
            }
            syncChrome();
            updateUndo();
        });

        /** Learn which days have a canvas from the keys of the boards node. */
        function watchBoards() {
            const paths = window.SiteGun.paths.apps;
            if (!paths.paintBoards) return null;
            const offs = new Set();
            let closed = false;

            paths.paintBoards().on(function (data, _key, _msg, ev) {
                if (ev && typeof ev.off === 'function') {
                    if (closed) {
                        try { ev.off(); } catch (e) { /* ignore */ }
                        return;
                    }
                    offs.add(ev);
                }
                if (!data || typeof data !== 'object') return;

                // Anyone can add keys here. Only real days between the first
                // daily board and tomorrow count, which also caps how many
                // there can ever be.
                const latest = shiftDay(utcDay(Date.now()), 1);
                let changed = false;
                Object.keys(data).forEach((key) => {
                    if (key === '_' || !data[key] || boards.has(key)) return;
                    if (key !== LEGACY_BOARD) {
                        const day = dayOf(key);
                        if (!day || day < FIRST_DAY || day > latest) return;
                    }
                    boards.add(key);
                    changed = true;
                });
                if (!changed) return;
                if (view === 'gallery') renderGallery();
                syncChrome();
            });

            return function close() {
                closed = true;
                offs.forEach((ev) => {
                    try { ev.off(); } catch (e) { /* ignore */ }
                });
                offs.clear();
            };
        }

        // ---- Gun ----------------------------------------------------------

        function connect() {
            hasGun = true;
            openBoard(boardOf(today));
            stopBoards = watchBoards();

            const prune = setInterval(pruneOldStrokes, 30000);
            timers.add(prune);

            function onConnection(connected) {
                isConnected = connected;
                setStatus(connected ? 'Live' : 'Offline', !connected);
                // Said on the canvas itself, not only in the footer: a
                // stroke drawn offline looks exactly like one that synced.
                if (els.offline) els.offline.hidden = connected;
                if (els.galleryNote) els.galleryNote.hidden = connected;
                updateEmpty();
                if (connected) flushPending();
            }

            if (window.SiteGun.getConnection) {
                offConnection = window.SiteGun.getConnection().onChange(onConnection);
            } else {
                onConnection(true);
            }
        }

        function waitSiteGun() {
            return new Promise((resolve, reject) => {
                let attempts = 0;
                (function wait() {
                    if (window.SiteGun) return resolve();
                    if (++attempts > 100) return reject(new Error('SiteGun unavailable'));
                    setTimeout(wait, 50);
                })();
            });
        }

        waitSiteGun().then(connect).catch(() => {
            // No realtime at all: today's canvas still works as a scratchpad.
            els.loading.hidden = true;
            settled = true;
            setStatus('Offline', true);
            if (els.offline) els.offline.hidden = false;
            if (els.galleryNote) els.galleryNote.hidden = false;
            syncChrome();
        });

        const ticker = setInterval(tick, TICK_MS);
        timers.add(ticker);

        syncChrome();
        updateUndo();

        win.paintCleanup = function () {
            document.removeEventListener('keydown', onKeydown);
            timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
            timers.clear();
            closeTiles();
            if (stopWatching) { stopWatching(); stopWatching = null; }
            if (stopBoards) { stopBoards(); stopBoards = null; }
            if (offConnection) {
                offConnection();
                offConnection = null;
            }
        };
    }

    window.initPaint = initPaint;
})();
