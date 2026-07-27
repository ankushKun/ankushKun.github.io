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
 */
(function () {
    'use strict';

    const CANVAS_W = 960;
    const CANVAS_H = 600;
    const MAX_STROKES = 600;        // keep the graph (and replay time) bounded
    const MAX_POINTS_PER_STROKE = 400;
    const SIMPLIFY_MIN_DIST = 1.5;  // px between recorded points

    const PALETTE = [
        '#1d1d1f', '#ffffff', '#e0524a', '#f0872b', '#f0c419',
        '#5ac85a', '#2f6fd0', '#7b5ce0', '#e05fa8', '#8f5c2c'
    ];

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
            tools: root.querySelectorAll('.paint-tool'),
            sizes: root.querySelectorAll('.paint-size')
        };

        let myId = localStorage.getItem('multiplayer-cursor-id');
        if (!myId) {
            myId = Math.random().toString(36).slice(2, 11);
            localStorage.setItem('multiplayer-cursor-id', myId);
        }

        let tool = 'pencil';
        let size = 4;
        let colour = PALETTE[0];

        let strokesRef = null;
        let metaRef = null;
        let clearedAt = 0;

        const known = new Map();   // strokeKey -> stroke
        const drawn = new Set();   // strokeKeys already painted
        const subscriptions = new Set();
        const timers = new Set();
        let offConnection = null;

        // ---- Canvas setup -------------------------------------------------

        function resetCanvas() {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        }

        resetCanvas();

        function drawStroke(stroke) {
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

        /** Repaint from scratch - used after a clear, or on first load. */
        function repaintAll() {
            resetCanvas();
            drawn.clear();
            [...known.entries()]
                .filter(([, s]) => (s.ts || 0) > clearedAt)
                .sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0))
                .forEach(([key, s]) => {
                    drawStroke(s);
                    drawn.add(key);
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
            if (e.button != null && e.button !== 0) return;
            const p = toLogical(e);

            drawing = true;
            lastPt = p;
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

            if (current.pts.length < MAX_POINTS_PER_STROKE * 2) {
                current.pts.push(p.x, p.y);
            }
            lastPt = p;
            e.preventDefault();
        }

        function endStroke() {
            if (!drawing) return;
            drawing = false;

            const stroke = current;
            current = null;
            lastPt = null;

            if (!stroke || stroke.pts.length < 4) return; // a click, not a line
            if (!strokesRef) return;

            const key = Date.now() + '-' + myId + '-' + Math.random().toString(36).slice(2, 6);
            const payload = {
                t: stroke.t,
                c: stroke.c,
                w: stroke.w,
                // Gun stores scalars, not arrays - a packed string round-trips
                // cleanly and is far smaller than a nested node per point.
                pts: stroke.pts.join(','),
                by: myId,
                ts: Date.now()
            };

            known.set(key, { ...stroke, ts: payload.ts });
            drawn.add(key);
            strokesRef.get(key).put(payload);
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
            btn.setAttribute('aria-label', 'Colour ' + hex);
            btn.dataset.tip = hex;
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

        els.clear.addEventListener('click', async () => {
            const ok = window.showConfirm
                ? await window.showConfirm('Clear the canvas?',
                    'This wipes the drawing for everyone, not just you.',
                    { confirmLabel: 'Clear it', danger: true })
                : confirm('Clear the canvas for everyone?');
            if (!ok || !metaRef) return;

            // A clear is a timestamp, not a delete. Strokes older than it are
            // ignored on replay, which keeps the operation a single tiny write
            // instead of hundreds of deletions racing across peers.
            metaRef.put({ clearedAt: Date.now(), by: myId });
        });

        // ---- Gun ----------------------------------------------------------

        function setStatus(msg, offline) {
            els.status.textContent = msg;
            els.status.classList.toggle('is-offline', !!offline);
        }

        function parseStroke(data) {
            if (!data || typeof data.pts !== 'string') return null;
            const pts = data.pts.split(',').map(Number);
            if (pts.length < 4 || pts.some((n) => !isFinite(n))) return null;
            return {
                t: data.t === 'eraser' ? 'eraser' : 'pencil',
                c: typeof data.c === 'string' ? data.c : '#1d1d1f',
                w: Math.max(1, Math.min(40, Number(data.w) || 4)),
                pts: pts.slice(0, MAX_POINTS_PER_STROKE * 2),
                ts: Number(data.ts) || 0
            };
        }

        function pruneOldStrokes() {
            if (!strokesRef || known.size <= MAX_STROKES) return;
            const sorted = [...known.entries()].sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
            const excess = sorted.slice(0, known.size - MAX_STROKES);
            excess.forEach(([key]) => {
                strokesRef.get(key).put(null);
                known.delete(key);
                drawn.delete(key);
            });
        }

        function connect() {
            strokesRef = window.SiteGun.paths.apps.paintStrokes();
            metaRef = window.SiteGun.paths.apps.paintMeta();

            metaRef.on(function (data, _key, _msg, ev) {
                if (ev && typeof ev.off === 'function') subscriptions.add(ev);
                const t = data && Number(data.clearedAt);
                if (!t || t === clearedAt) return;
                clearedAt = t;
                repaintAll();
            });

            strokesRef.map().on(function (data, key, _msg, ev) {
                if (ev && typeof ev.off === 'function') subscriptions.add(ev);

                if (!data) {
                    if (known.delete(key)) drawn.delete(key);
                    return;
                }

                const stroke = parseStroke(data);
                if (!stroke) return;

                known.set(key, stroke);
                if (stroke.ts <= clearedAt) return;
                if (drawn.has(key)) return;

                drawn.add(key);
                drawStroke(stroke);
            });

            // Give the initial replay a moment, then reveal the canvas
            const reveal = setTimeout(() => {
                els.loading.hidden = true;
                repaintAll();
            }, 700);
            timers.add(reveal);

            const prune = setInterval(pruneOldStrokes, 30000);
            timers.add(prune);

            if (window.SiteGun.getConnection) {
                offConnection = window.SiteGun.getConnection().onChange((connected) => {
                    setStatus(connected ? 'Live' : 'Offline — strokes will not sync', !connected);
                });
            } else {
                setStatus('Live');
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
            els.loading.hidden = true;
            setStatus('Offline', true);
        });

        win.paintCleanup = function () {
            timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
            timers.clear();
            subscriptions.forEach((ev) => {
                try { ev.off(); } catch (e) { /* ignore */ }
            });
            subscriptions.clear();
            try { if (strokesRef) strokesRef.map().off(); } catch (e) { /* ignore */ }
            try { if (metaRef) metaRef.off(); } catch (e) { /* ignore */ }
            if (offConnection) {
                offConnection();
                offConnection = null;
            }
        };
    }

    window.initPaint = initPaint;
})();
