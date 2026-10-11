/**
 * Passport - the visitor's own passport booklet.
 *
 * A data page with their visit record (holder, issue date, streaks, MRZ) and
 * visa pages where every achievement is an entry stamp, inked once earned.
 *
 * Only a view: the state lives in retention.js (window.Achievements), in
 * this browser's storage. Loaded the first time the Passport window opens.
 * Markup: layouts/partials/apps/passport/window.html
 * Styles: assets/css/apps/passport.css
 */
(function () {
    'use strict';

    // Stamp pictograms (24x24 line drawings, one per stamp) live with the
    // achievements in retention.js, which also draws them in the unlock banner.
    function picture(name) {
        return window.Achievements && window.Achievements.pictogram ? window.Achievements.pictogram(name) : '';
    }

    const INKS = ['red', 'blue', 'violet', 'green'];
    const SHAPES = ['circle', 'rect', 'oval', 'octagon'];
    const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

    function hash(str) {
        let h = 2166136261 >>> 0;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
        return h >>> 0;
    }

    function seeded(seed) {
        let a = hash(seed);
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function esc(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
    }

    /** A pictogram drawn `size` units wide at (x, y) inside a larger SVG. */
    function pict(name, x, y, size, width) {
        const s = size / 24;
        return '<g transform="translate(' + x + ' ' + y + ') scale(' + s.toFixed(3) + ')" fill="none" stroke="currentColor"'
            + ' stroke-width="' + ((width || 1.8) / s).toFixed(2) + '" stroke-linecap="round" stroke-linejoin="round">'
            + picture(name) + '</g>';
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    /** "03 OCT 2026", the way passports print dates. */
    function stampDate(ts) {
        if (!ts) return '–';
        const d = new Date(ts);
        return (d.getDate() < 10 ? '0' : '') + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    }

    /** "3 Oct 2026", for sentences. */
    function plainDate(ts) {
        return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    function days(n) {
        return n === 1 ? '1 day' : n + ' days';
    }

    function readStore(key) {
        try {
            return window.SiteStore ? window.SiteStore.get(key) : localStorage.getItem(key);
        } catch (e) {
            return null;
        }
    }

    function cleanName(value) {
        if (typeof value !== 'string') return '';
        return value.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
    }

    /** The name this visitor gave the Daily Puzzle's scoreboard, if any. */
    function puzzleName() {
        try {
            const saved = JSON.parse(readStore('daily-puzzle-v1') || 'null');
            return saved && typeof saved === 'object' ? cleanName(saved.name) : '';
        } catch (e) {
            return '';
        }
    }

    function reducedMotion() {
        try {
            return document.documentElement.getAttribute('data-motion') === 'reduce'
                || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        } catch (e) {
            return false;
        }
    }

    // ---- The data page ---------------------------------------------------

    /** MRZ characters: A-Z, 0-9 and the filler '<'. */
    function mrzText(s) {
        let t = String(s || '');
        try { t = t.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* older engines */ }
        return t.toUpperCase().replace(/[^A-Z0-9]+/g, '<').replace(/^<+|<+$/g, '');
    }

    /** ICAO 9303 check digit (weights 7, 3, 1). */
    function checkDigit(s) {
        const weights = [7, 3, 1];
        let sum = 0;
        for (let i = 0; i < s.length; i++) {
            const c = s.charAt(i);
            const v = c === '<' ? 0 : (c >= '0' && c <= '9') ? +c : c.charCodeAt(0) - 55;
            sum += v * weights[i % 3];
        }
        return String(sum % 10);
    }

    function yymmdd(ts) {
        if (!ts) return '<<<<<<';
        const d = new Date(ts);
        const two = (n) => (n < 10 ? '0' : '') + n;
        return two(d.getFullYear() % 100) + two(d.getMonth() + 1) + two(d.getDate());
    }

    /**
     * The two 44-character lines at the foot of a data page (ICAO TD3 layout,
     * with real check digits). Only true facts go in: the holder's own name
     * (or VISITOR), their visitor number, the day they first came (where a
     * passport keeps the birth date), days visited and points.
     */
    function mrz(id, holder, stats, points) {
        const pad = (s, n) => (s + '<'.repeat(n)).slice(0, n);
        const words = mrzText(holder).split('<').filter(Boolean);
        let name = 'VISITOR';
        if (words.length) {
            const surname = words.pop();
            name = words.length ? surname + '<<' + words.join('<') : surname;
        }
        const doc = pad(mrzText(id).replace(/</g, '').slice(0, 9), 9);
        const born = yymmdd(stats.first);
        const expiry = '<<<<<<';
        const personal = pad('D' + stats.days + '<P' + points, 14);
        const composite = doc + checkDigit(doc) + born + checkDigit(born) + expiry + checkDigit(expiry)
            + personal + checkDigit(personal);
        return [
            pad('P<ONE' + name, 44),
            doc + checkDigit(doc) + 'WEB' + born + checkDigit(born) + '<' + expiry + checkDigit(expiry)
                + personal + checkDigit(personal) + checkDigit(composite)
        ];
    }

    /** The cover's crest (a globe in a laurel), printed in ink. */
    function crestSVG(size) {
        let leaves = '';
        [1, -1].forEach((side) => {
            for (let i = 0; i < 5; i++) {
                const deg = 112 + i * 27;                    // up the left side
                const a = (side > 0 ? deg : 180 - deg) * Math.PI / 180;
                const x = 32 + 24 * Math.cos(a);
                const y = 32 + 24 * Math.sin(a);
                // Each leaf points up along the branch and leans outward
                const rot = side > 0 ? deg + 90 - 35 : 180 - deg - 90 + 35;
                leaves += '<ellipse cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" rx="6" ry="2.6" transform="rotate('
                    + rot.toFixed(0) + ' ' + x.toFixed(1) + ' ' + y.toFixed(1) + ')"/>';
            }
        });
        return '<svg class="pp-crest" viewBox="0 0 64 64" width="' + size + '" height="' + size + '" aria-hidden="true" focusable="false">'
            + '<g fill="currentColor">' + leaves + '</g>'
            + '<g fill="none" stroke="currentColor" stroke-width="2">'
            + '<circle cx="32" cy="31" r="13.5"/><ellipse cx="32" cy="31" rx="5.8" ry="13.5"/>'
            + '<path d="M18.5 31h27M20.5 24c6.5 2.2 16.5 2.2 23 0M20.5 38c6.5-2.2 16.5-2.2 23 0"/>'
            + '<path d="M24 57c3-1.6 13-1.6 16 0" stroke-width="1.6"/>'
            + '</g></svg>';
    }

    /**
     * A guilloché rosette drawn from a seed: the visitor's own emblem in the
     * photo slot (honest - a pattern made from their visitor number, not a
     * face), and the faint security print on the page.
     */
    function rosetteSVG(seed, w, h, cls) {
        const rnd = seeded(seed || 'ankush.one');
        const cx = w / 2;
        const cy = h / 2;
        const R = Math.min(w, h) * 0.42;
        const petals = 5 + Math.floor(rnd() * 7);
        const amp = 0.16 + rnd() * 0.14;
        const twist = rnd() * Math.PI;
        const layers = 11;
        let out = '';
        for (let l = 0; l < layers; l++) {
            const f = l / (layers - 1);
            const r0 = R * (0.28 + 0.72 * f);
            const ph = twist + f * Math.PI / petals * 1.6;
            let d = '';
            for (let s = 0; s <= 180; s++) {
                const t = s / 180 * Math.PI * 2;
                const r = r0 * (1 + amp * (0.45 + 0.55 * f) * Math.cos(petals * t + ph));
                d += (s ? 'L' : 'M') + (cx + r * Math.cos(t)).toFixed(1) + ' ' + (cy + r * Math.sin(t)).toFixed(1);
            }
            out += '<path class="' + (l % 2 ? 'pp-ro-b' : 'pp-ro-a') + '" d="' + d + 'Z"/>';
        }
        return '<svg class="' + cls + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true" focusable="false" fill="none">' + out + '</svg>';
    }

    function visitorId() {
        try {
            if (window.SiteGun && window.SiteGun.visitorId) return window.SiteGun.visitorId();
            const id = (window.SiteStore ? window.SiteStore.get('multiplayer-cursor-id') : null) || window.__siteVisitorId;
            return id || '';
        } catch (e) {
            return '';
        }
    }

    // ---- Entry stamps ------------------------------------------------------

    const STAMPS_PER_PAGE = 8;

    /**
     * Shape and ink come with the stamp (retention.js picks them by slot so
     * that neighbours, 4 across or 2 on a phone, never share either); a small
     * tilt and offset from the id, so a stamp lands the same way every time.
     */
    function stampStyle(a, index) {
        const h = hash(a.id);
        return {
            shape: SHAPES.indexOf(a.shape) >= 0 ? a.shape : SHAPES[index % 4],
            ink: INKS.indexOf(a.ink) >= 0 ? a.ink : INKS[(index * 3 + 1) % 4],
            rot: (((h % 11) - 5) * 0.9).toFixed(1),
            dx: ((h >>> 5) % 9) - 4,
            dy: ((h >>> 9) % 7) - 3
        };
    }

    /** At most two lines, the second taking whatever is left. */
    function wrapTitle(title, max) {
        const lines = [];
        title.toUpperCase().split(/\s+/).filter(Boolean).forEach((w) => {
            const last = lines[lines.length - 1];
            if (last != null && (last + ' ' + w).length <= max) lines[lines.length - 1] = last + ' ' + w;
            else lines.push(w);
        });
        return lines.length > 2 ? [lines[0], lines.slice(1).join(' ')] : lines;
    }

    function svgText(str, x, y, size, max, cls, anchor) {
        return '<text x="' + x + '" y="' + y + '" font-size="' + size + '" text-anchor="' + (anchor || 'middle')
            + '" class="' + cls + '" data-max="' + max + '">' + esc(str) + '</text>';
    }

    function titleLines(lines, x, y, size, max, anchor) {
        if (lines.length === 1) return svgText(lines[0], x, y + size * 0.55, size, max, 'pp-t-title', anchor);
        return svgText(lines[0], x, y, size, max, 'pp-t-title', anchor)
            + svgText(lines[1], x, y + size * 1.1, size, max, 'pp-t-title', anchor);
    }

    /** The impression itself: border, small print, pictogram, title, date. */
    function stampSVG(a, st, blank) {
        const icon = blank && a.secret ? 'secret' : a.icon;
        const lines = wrapTitle(a.title, 13);
        const date = stampDate(a.unlockedAt);
        let w;
        let h;
        let art = '';
        if (st.shape === 'circle') {
            w = 120; h = 120;
            art = '<circle class="pp-edge" cx="60" cy="60" r="56.5" stroke-width="3"/>'
                + '<circle class="pp-edge pp-edge-in" cx="60" cy="60" r="50.5" stroke-width="1"/>';
            if (blank) {
                art += pict(icon, 44, 44, 32, 1.4);
            } else {
                const top = 'pp-arc-' + a.id + '-t';
                const bottom = 'pp-arc-' + a.id + '-b';
                art += '<defs><path id="' + top + '" d="M19 60a41 41 0 0 1 82 0"/>'
                    + '<path id="' + bottom + '" d="M14 60a46 46 0 0 0 92 0"/></defs>'
                    + '<text class="pp-t-kicker" font-size="8"><textPath href="#' + top + '" startOffset="50%" text-anchor="middle">ANKUSH.ONE</textPath></text>'
                    + '<text class="pp-t-date" font-size="8.5"><textPath href="#' + bottom + '" startOffset="50%" text-anchor="middle">' + date + '</textPath></text>'
                    + '<circle cx="13" cy="60" r="1.6" fill="currentColor"/><circle cx="107" cy="60" r="1.6" fill="currentColor"/>'
                    + pict(icon, 49, 28, 22) + titleLines(lines, 60, 65, 10.5, 84);
            }
        } else if (st.shape === 'oval') {
            w = 144; h = 100;
            art = '<ellipse class="pp-edge" cx="72" cy="50" rx="69.5" ry="46.5" stroke-width="3"/>'
                + '<ellipse class="pp-edge pp-edge-in" cx="72" cy="50" rx="63.5" ry="40.5" stroke-width="1"/>';
            art += blank ? pict(icon, 56, 34, 32, 1.4)
                : svgText('ADMITTED', 72, 22, 7.5, 70, 'pp-t-kicker') + pict(icon, 62, 26, 20)
                    + titleLines(lines, 72, 57, 10.5, 104) + svgText(date, 72, 84, 8, 70, 'pp-t-date');
        } else if (st.shape === 'rect') {
            w = 140; h = 96;
            art = '<rect class="pp-edge" x="1.5" y="1.5" width="137" height="93" rx="3" stroke-width="2.5"/>'
                + '<rect class="pp-edge pp-edge-in" x="6.5" y="6.5" width="127" height="83" rx="1.5" stroke-width="0.9"/>';
            art += blank ? pict(icon, 54, 32, 32, 1.4)
                : svgText('ANKUSH.ONE', 13, 19, 7.5, 70, 'pp-t-kicker', 'start') + svgText('ENTRY', 127, 19, 7.5, 40, 'pp-t-kicker', 'end')
                    + '<path d="M12 24.5h116M12 67.5h116" stroke="currentColor" stroke-width="0.9"/>'
                    + pict(icon, 14, 33, 26) + titleLines(lines, 48, 43.5, 10.5, 80, 'start')
                    + svgText(date, 70, 81, 8.5, 110, 'pp-t-date');
        } else {
            w = 116; h = 116;
            art = '<polygon class="pp-edge" points="35,2 81,2 114,35 114,81 81,114 35,114 2,81 2,35" stroke-width="3"/>'
                + '<polygon class="pp-edge pp-edge-in" points="37.5,8 78.5,8 108,37.5 108,78.5 78.5,108 37.5,108 8,78.5 8,37.5" stroke-width="1"/>';
            art += blank ? pict(icon, 42, 42, 32, 1.4)
                : svgText('ARRIVED', 58, 24, 7.5, 58, 'pp-t-kicker') + pict(icon, 47, 29, 22)
                    + titleLines(lines, 58, 64, 10.5, 84) + svgText(date, 58, 95, 8, 62, 'pp-t-date');
        }
        return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" fill="none" stroke="currentColor"'
            + ' focusable="false" aria-hidden="true"><g class="pp-impression">' + art.replace(/<text /g, '<text fill="currentColor" stroke="none" ') + '</g></svg>';
    }

    /** Squeeze any line of stamp lettering that would run past its border. */
    function fitText(scope) {
        scope.querySelectorAll('text[data-max]').forEach((t) => {
            const max = +t.getAttribute('data-max');
            try {
                if (t.getComputedTextLength() > max) {
                    t.setAttribute('textLength', String(max));
                    t.setAttribute('lengthAdjust', 'spacingAndGlyphs');
                }
            } catch (e) { /* not rendered: left as is */ }
        });
    }

    /** What a screen reader hears for one stamp. */
    function stampLabel(a) {
        if (a.unlockedAt) return a.title + '. Stamped ' + plainDate(a.unlockedAt) + '. ' + a.points + ' points.';
        if (a.secret) return 'Secret stamp, not yet found.';
        return a.title + '. Not yet stamped: ' + a.desc + '.' + (a.goal ? ' ' + a.progress + ' of ' + a.goal + ' so far.' : '');
    }

    /** One slot on a visa page; `fresh` (>= 0) inks it in with a thunk. */
    function buildStamp(a, index, fresh) {
        const unlocked = !!a.unlockedAt;
        const st = stampStyle(a, index);
        const li = el('li', 'pp-cell');
        const btn = el('button', 'pp-stamp ' + (unlocked ? 'is-inked' : 'is-blank') + (a.secret && !unlocked ? ' is-secret' : ''));
        btn.type = 'button';
        btn.dataset.id = a.id;
        btn.setAttribute('aria-haspopup', 'dialog');
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-label', stampLabel(a));

        const art = el('span', 'pp-art pp-shape-' + st.shape + (unlocked ? ' pp-ink-' + st.ink : ''));
        art.setAttribute('aria-hidden', 'true');
        if (unlocked) {
            art.style.setProperty('--rot', st.rot + 'deg');
            art.style.setProperty('--dx', st.dx + 'px');
            art.style.setProperty('--dy', st.dy + 'px');
            // Each impression takes the ink a little differently
            art.style.setProperty('--grain-x', (hash(a.id + 'x') % 160) + 'px');
            art.style.setProperty('--grain-y', (hash(a.id + 'y') % 160) + 'px');
            if (fresh >= 0) {
                art.classList.add('is-fresh');
                btn.style.setProperty('--delay', (220 + fresh * 150) + 'ms');
            }
        }
        art.innerHTML = stampSVG(a, st, !unlocked);
        btn.appendChild(art);
        if (unlocked && fresh >= 0) {
            // The slot's pencilled outline waits underneath until the stamp lands on it
            const under = el('span', 'pp-under pp-shape-' + st.shape);
            under.setAttribute('aria-hidden', 'true');
            under.innerHTML = stampSVG(a, st, true);
            btn.appendChild(under);
        }

        if (!unlocked) {
            const cap = el('span', 'pp-cap');
            cap.setAttribute('aria-hidden', 'true');
            cap.appendChild(el('span', 'pp-cap-title', a.secret ? 'Classified' : a.title));
            cap.appendChild(el('span', 'pp-cap-hint', a.secret ? 'Keep exploring' : a.desc));
            if (a.goal && !a.secret) cap.appendChild(el('span', 'pp-cap-count', a.progress + ' of ' + a.goal));
            btn.appendChild(cap);
        }
        li.appendChild(btn);
        return li;
    }

    /**
     * A filtered view (Collected or Remaining) keeps every stamp's own shape
     * and ink, so an impression looks the same wherever it is shown, but
     * nudges the order so that, as in the full book, no stamp sits next to or
     * under one of the same shape (or, both inked, the same ink). Tried for
     * 4, 3 and 2 across, relaxed one width at a time when the set left over
     * cannot avoid it; `cols`, the width the page has now, is kept longest.
     */
    function arrangeFiltered(items, cols) {
        const look = items.map((item) => stampStyle(item.a, item.i));
        const pool = items.map((item, k) => k);
        const out = [];
        const clash = (p, q) => look[p].shape === look[q].shape
            || (!!items[p].a.unlockedAt && !!items[q].a.unlockedAt && look[p].ink === look[q].ink);
        const fits = (k, slot, widths) => widths.every((cols) => {
            const base = out.length - slot;
            const left = slot % cols ? out[base + slot - 1] : -1;
            const above = slot >= cols ? out[base + slot - cols] : -1;
            return (left < 0 || !clash(k, left)) && (above < 0 || !clash(k, above));
        });
        // A small backtracking search (bounded, the sets are at most 21),
        // staying as close to the book's own order as it can
        function solve(widths, budget) {
            if (!pool.length) return true;
            const slot = out.length % STAMPS_PER_PAGE;
            for (let j = 0; j < pool.length; j++) {
                if (--budget.n < 0) return false;
                const k = pool[j];
                if (!fits(k, slot, widths)) continue;
                out.push(k);
                pool.splice(j, 1);
                if (solve(widths, budget)) return true;
                pool.splice(j, 0, k);
                out.pop();
            }
            return false;
        }
        const tiers = [[4, 3, 2], [4, 2], [cols], [4], [2]];
        for (let t = 0; t < tiers.length; t++) {
            if (solve(tiers[t], { n: 30000 })) return out.map((k) => items[k]);
        }
        // Nothing clean: greedy, avoiding what it can
        while (pool.length) {
            const slot = out.length % STAMPS_PER_PAGE;
            let pick = 0;
            for (let t = 0; t < tiers.length; t++) {
                const j = pool.findIndex((k) => fits(k, slot, tiers[t]));
                if (j >= 0) { pick = j; break; }
            }
            out.push(pool.splice(pick, 1)[0]);
        }
        return out.map((k) => items[k]);
    }

    function openApp(appId) {
        try {
            const reg = JSON.parse(document.getElementById('app-registry').textContent);
            const app = reg.find((x) => x && x.id === appId);
            if (app && typeof window.openWindow === 'function') {
                window.openWindow(appId, app.title || appId, { width: app.width || 1000, height: app.height || 700 });
            }
        } catch (e) { /* no registry: nothing to open */ }
    }

    let signatureLoad = null;
    function loadSignature() {
        if (window.Signature) return Promise.resolve();
        if (signatureLoad) return signatureLoad;
        signatureLoad = new Promise((resolve, reject) => {
            const src = window.SIGNATURE_URL;
            if (!src) return reject(new Error('No signature engine'));
            const s = document.createElement('script');
            s.src = src;
            s.async = true;
            s.onload = resolve;
            s.onerror = () => { signatureLoad = null; reject(new Error('Failed to load ' + src)); };
            document.head.appendChild(s);
        });
        return signatureLoad;
    }

    function initPassport(win) {
        const root = win.querySelector('.pp-window');
        if (!root || root.dataset.init) return;
        root.dataset.init = '1';

        const $ = (sel) => root.querySelector(sel);
        const content = $('.pp-content');
        const visas = $('.pp-visas');
        const summary = $('.pp-summary');
        const meter = $('.pp-bar');
        const meterFill = $('.pp-bar-fill');
        const reset = $('.pp-reset');
        const seg = $('.pp-seg');
        const hud = $('.pp-hud');

        const timers = new Set();
        let closed = false;
        let teardown = null;
        const later = (fn, ms) => {
            const t = setTimeout(() => {
                timers.delete(t);
                if (!closed) fn();
            }, ms);
            timers.add(t);
        };
        win.passportCleanup = function () {
            closed = true;
            timers.forEach(clearTimeout);
            timers.clear();
            if (teardown) teardown();
        };

        // Printed on every booklet: the crest and the security rosette
        $('.pp-crest-slot').innerHTML = crestSVG(38);
        $('.pp-watermark').innerHTML = rosetteSVG('ankush.one', 220, 220, 'pp-rosette');

        // retention.js rides in the idle bundle, which a Passport opened by a
        // link at page load can beat: wait for it before giving up
        let waited = 0;
        (function waitForAchievements() {
            if (window.Achievements) return start(window.Achievements);
            if (!waited) {
                summary.textContent = 'Loading…';
                reset.disabled = true;
            }
            waited += 200;
            if (waited > 15000) {
                // Without it there is nothing to show, and saying so beats an empty booklet
                summary.textContent = '';
                visas.replaceChildren(el('p', 'pp-note pp-failed', 'Your passport could not be loaded. Reload the page to try again.'));
                reset.hidden = true;
                return;
            }
            later(waitForAchievements, 200);
        })();

        function start(A) {
            const id = visitorId();
            // The holder: the name they signed the guestbook with (read back
            // from the guestbook itself), else the one they gave the Daily
            // Puzzle's scoreboard, else nobody in particular.
            const holder = { name: puzzleName(), variant: 0, fromGuestbook: false };
            const inked = new Set();          // stamps already shown inked
            let lastViewed = A.stats().viewed || 0;
            let filter = 'all';
            let facts = null;                 // { stats, points } as last drawn
            let hudFor = null;                // the stamp the HUD points at

            $('.pp-photo').innerHTML = rosetteSVG(id || 'visitor', 100, 124, 'pp-portrait');
            $('.pp-ghost').innerHTML = rosetteSVG(id || 'visitor', 100, 124, 'pp-portrait');

            function setText(sel, text) {
                const node = typeof sel === 'string' ? $(sel) : sel;
                if (node && node.textContent !== text) node.textContent = text;
            }

            // ---- Data page ----

            function renderMrz() {
                if (!facts) return;
                const box = $('.pp-mrz');
                box.replaceChildren();
                mrz(id, holder.name, facts.stats, facts.points)
                    .forEach((line) => box.appendChild(el('span', 'pp-mrz-line', line)));
            }

            function renderHolder() {
                const name = $('.pp-f-holder');
                setText(name, holder.name || 'Anonymous visitor');
                name.classList.toggle('is-unset', !holder.name);
                const ink = $('.pp-sign-ink');
                ink.replaceChildren();
                if (holder.name) {
                    const wanted = holder.name + '#' + holder.variant;
                    ink.dataset.sig = wanted;
                    // The name in a script face stands in until the pen arrives
                    ink.appendChild(el('span', 'pp-sign-name', holder.name));
                    loadSignature().then(() => {
                        if (closed || !window.Signature || ink.dataset.sig !== wanted) return;
                        const svg = window.Signature.toSVG(holder.name, id + '#' + (holder.variant || 0), { colour: '#1c2a4a' });
                        if (svg) ink.innerHTML = svg;
                    }).catch(() => { /* the script-face name stays */ });
                } else {
                    delete ink.dataset.sig;
                    // A narrow page keeps the short form (the tail is hidden there)
                    const sign = el('button', 'pp-sign-btn', 'Sign the Guestbook');
                    sign.appendChild(el('span', 'pp-sign-more', ' to add your signature'));
                    sign.type = 'button';
                    sign.addEventListener('click', () => openApp('guestbook'));
                    ink.appendChild(sign);
                }
                renderMrz();
            }

            function lookupGuestbook(tries) {
                if (closed || !id || readStore('guestbook-signed') !== id) return;
                const G = window.SiteGun;
                if (!G || !G.paths || !G.paths.apps || !G.paths.apps.guestbook) {
                    // The realtime bundle loads when the browser is idle
                    if (tries < 30) later(() => lookupGuestbook(tries + 1), 500);
                    return;
                }
                try {
                    G.paths.apps.guestbook().get(id).once((entry) => {
                        const name = entry && cleanName(entry.name);
                        if (closed || !name) return;
                        const variant = Number(entry.variant) || 0;
                        if (holder.fromGuestbook && holder.name === name && holder.variant === variant) return;
                        holder.name = name;
                        holder.variant = variant;
                        holder.fromGuestbook = true;
                        renderHolder();
                    });
                } catch (e) { /* the page keeps what it has */ }
            }

            // ---- Visa pages ----

            const landing = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
                let n = 0;
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) return;
                    landing.unobserve(entry.target);
                    // (on the slot, so the outline underneath fades in step)
                    entry.target.parentNode.style.setProperty('--delay', (140 + n++ * 160) + 'ms');
                    entry.target.classList.add('is-landing');
                });
            }, { threshold: 0.35 }) : null;

            function renderVisas(list) {
                let shown = [];
                list.forEach((a, i) => {
                    if (filter === 'all' || (filter === 'collected') === !!a.unlockedAt) shown.push({ a: a, i: i });
                });
                if (filter !== 'all') {
                    // Stamps across at this window width (the @container pp steps in passport.css)
                    const w = root.clientWidth;
                    shown = arrangeFiltered(shown, w <= 520 ? 2 : w <= 660 ? 3 : 4);
                }
                const calm = reducedMotion();
                const pages = Math.max(1, Math.ceil(shown.length / STAMPS_PER_PAGE));
                const frag = document.createDocumentFragment();
                let fresh = 0;
                for (let p = 0; p < pages; p++) {
                    const page = el('section', 'pp-page pp-visa');
                    page.setAttribute('aria-label', 'Visas, page ' + (p + 1) + ' of ' + pages);
                    const head = el('div', 'pp-visa-head', 'Visas');
                    head.setAttribute('aria-hidden', 'true');
                    page.appendChild(head);
                    const items = shown.slice(p * STAMPS_PER_PAGE, (p + 1) * STAMPS_PER_PAGE);
                    if (items.length) {
                        const ul = el('ul', 'pp-stamps');
                        ul.setAttribute('role', 'list');
                        items.forEach((item) => {
                            let k = -1;
                            if (item.a.unlockedAt && !inked.has(item.a.id)) {
                                inked.add(item.a.id);
                                if (!calm && item.a.unlockedAt > lastViewed && fresh < 8) k = fresh++;
                            }
                            ul.appendChild(buildStamp(item.a, item.i, k));
                        });
                        page.appendChild(ul);
                    } else {
                        page.appendChild(el('p', 'pp-empty', filter === 'collected'
                            ? 'No stamps yet. Each one is inked in here as you find your way around the desktop.'
                            : 'Every stamp collected. Well travelled!'));
                    }
                    const no = el('span', 'pp-pgno', String(p + 2));
                    no.setAttribute('aria-hidden', 'true');
                    page.appendChild(no);
                    frag.appendChild(page);
                }
                visas.replaceChildren(frag);
                fitText(visas);
                visas.querySelectorAll('.pp-art.is-fresh').forEach((art) => {
                    art.addEventListener('animationend', () => {
                        art.classList.remove('is-fresh', 'is-landing');
                        const under = art.parentNode && art.parentNode.querySelector('.pp-under');
                        if (under) under.remove();
                    }, { once: true });
                    if (landing) landing.observe(art);
                    else art.classList.add('is-landing');
                });
            }

            // ---- The HUD that explains a stamp ----

            function hudFill(a) {
                const secret = a.secret && !a.unlockedAt;
                setText('.pp-hud-title', secret ? 'Secret stamp' : a.title);
                setText('.pp-hud-desc', secret ? 'Some stamps stay blank until they are found. Keep exploring.' : a.desc + '.');
                setText('.pp-hud-meta', (a.unlockedAt ? 'Stamped ' + plainDate(a.unlockedAt) : 'Not yet stamped')
                    + ' · ' + a.points + ' points');
                $('.pp-hud-icon').innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor"'
                    + ' stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
                    + picture(secret ? 'secret' : a.icon) + '</svg>';
                const prog = $('.pp-hud-progress');
                const counting = a.goal && !a.unlockedAt && !secret;
                prog.hidden = !counting;
                if (counting) {
                    const bar = $('.pp-hud-bar');
                    bar.setAttribute('aria-valuemax', String(a.goal));
                    bar.setAttribute('aria-valuenow', String(a.progress));
                    bar.setAttribute('aria-valuetext', a.progress + ' of ' + a.goal);
                    $('.pp-hud-bar-fill').style.width = Math.round(a.progress / a.goal * 100) + '%';
                    setText('.pp-hud-count', a.progress + ' of ' + a.goal);
                }
            }

            function placeHud() {
                if (!hudFor || hud.hidden) return;
                // A blank stamp: the whole slot, so its pencilled hint stays
                // readable. An inked one: the impression itself.
                const art = hudFor.classList.contains('is-inked') ? hudFor.querySelector('.pp-art svg') : null;
                const r = (art || hudFor).getBoundingClientRect();
                const box = root.getBoundingClientRect();
                const view = content.getBoundingClientRect();
                // Scrolled away: let it go
                if (r.bottom < view.top || r.top > view.bottom) return closeHud(false);
                const w = hud.offsetWidth;
                const h = hud.offsetHeight;
                const mid = r.left + r.width / 2 - box.left;
                const left = Math.max(8, Math.min(box.width - w - 8, mid - w / 2));
                let top = r.bottom - box.top + 10;
                let side = 'below';
                if (top + h > box.height - 8 && r.top - box.top - h - 10 > 0) {
                    top = r.top - box.top - h - 10;
                    side = 'above';
                }
                hud.style.left = Math.round(left) + 'px';
                hud.style.top = Math.round(top) + 'px';
                hud.dataset.side = side;
                hud.style.setProperty('--arrow-x', Math.round(Math.max(16, Math.min(w - 16, mid - left))) + 'px');
            }

            function openHud(btn) {
                const a = A.list().find((x) => x.id === btn.dataset.id);
                if (!a) return;
                if (hudFor && hudFor !== btn) hudFor.setAttribute('aria-expanded', 'false');
                hudFor = btn;
                hudFill(a);
                hud.hidden = false;
                btn.setAttribute('aria-expanded', 'true');
                placeHud();
                hud.focus({ preventScroll: true });
            }

            function closeHud(refocus) {
                if (hud.hidden) return;
                hud.hidden = true;
                const btn = hudFor;
                hudFor = null;
                if (!btn) return;
                btn.setAttribute('aria-expanded', 'false');
                if (refocus && btn.isConnected) btn.focus({ preventScroll: true });
            }

            // ---- Drawing ----

            function render() {
                const list = A.list();
                const stats = A.stats();
                const done = list.filter((a) => a.unlockedAt);
                const points = done.reduce((sum, a) => sum + a.points, 0);
                facts = { stats: stats, points: points };

                setText('.pp-f-no', id ? id.toUpperCase() : '–');
                setText('.pp-f-issued', stampDate(stats.first));
                setText('.pp-f-days', String(stats.days));
                setText('.pp-f-streak', days(stats.streak));
                setText('.pp-f-best', days(stats.best));
                renderMrz();

                const text = done.length + ' of ' + list.length + ' stamps · ' + points + ' points';
                setText(summary, text);
                meter.setAttribute('aria-valuemax', String(list.length));
                meter.setAttribute('aria-valuenow', String(done.length));
                meter.setAttribute('aria-valuetext', text);
                meterFill.style.width = (list.length ? done.length / list.length * 100 : 0).toFixed(1) + '%';
                reset.disabled = !done.length && stats.days <= 1;

                const openId = hudFor && !hud.hidden ? hudFor.dataset.id : null;
                renderVisas(list);
                if (openId) {
                    const again = visas.querySelector('.pp-stamp[data-id="' + openId + '"]');
                    if (again) {
                        hudFor = again;
                        again.setAttribute('aria-expanded', 'true');
                        hudFill(list.find((x) => x.id === openId));
                        placeHud();
                    } else {
                        closeHud(false);
                    }
                }
                // Everything stamped so far has now been seen
                lastViewed = Date.now();
                if (typeof A.markViewed === 'function') A.markViewed();
            }

            // ---- Controls ----

            const segButtons = Array.from(seg.querySelectorAll('[data-filter]'));
            function setFilter(next, focus) {
                if (next === filter) return;
                filter = next;
                segButtons.forEach((b) => {
                    const on = b.dataset.filter === next;
                    b.setAttribute('aria-checked', String(on));
                    b.tabIndex = on ? 0 : -1;
                    if (on && focus) b.focus();
                });
                closeHud(false);
                renderVisas(A.list());
            }
            seg.addEventListener('click', (e) => {
                const b = e.target.closest('[data-filter]');
                if (b) setFilter(b.dataset.filter, false);
            });
            seg.addEventListener('keydown', (e) => {
                const i = segButtons.findIndex((b) => b.dataset.filter === filter);
                const n = segButtons.length;
                const j = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: n - 1 }[e.key];
                if (j == null) return;
                e.preventDefault();
                setFilter(segButtons[(j + n) % n].dataset.filter, true);
            });

            root.addEventListener('click', (e) => {
                const stamp = e.target.closest('.pp-stamp');
                if (stamp) {
                    if (hudFor === stamp && !hud.hidden) closeHud(true);
                    else openHud(stamp);
                    return;
                }
                if (!hud.hidden && !e.target.closest('.pp-hud')) closeHud(false);
            });
            root.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && !hud.hidden) {
                    e.preventDefault();
                    e.stopPropagation();
                    closeHud(true);
                }
            });
            hud.addEventListener('focusout', (e) => {
                const to = e.relatedTarget;
                if (!hud.hidden && to && !hud.contains(to) && to !== hudFor) closeHud(false);
            });
            content.addEventListener('scroll', placeHud, { passive: true });
            const onResize = () => closeHud(false);
            window.addEventListener('resize', onResize);

            const off = A.onChange((changedId) => {
                render();
                // Just signed: read the entry back for the signature line
                if (changedId === 'guestbook') later(() => lookupGuestbook(0), 1500);
            });
            // Another tab may have unlocked something
            const onStorage = (e) => { if (!e.key || e.key === 'site-passport-v1') render(); };
            window.addEventListener('storage', onStorage);

            reset.addEventListener('click', () => {
                const ask = typeof window.showConfirm === 'function'
                    ? window.showConfirm('Reset your passport?',
                        'Your achievements and visit streak in this browser will be cleared. This cannot be undone.',
                        { confirmLabel: 'Reset', danger: true })
                    : Promise.resolve(window.confirm('Reset your passport? Your achievements and visit streak in this browser will be cleared.'));
                Promise.resolve(ask).then((ok) => { if (ok) A.reset(); });
            });

            render();
            renderHolder();
            lookupGuestbook(0);

            teardown = function () {
                off();
                window.removeEventListener('storage', onStorage);
                window.removeEventListener('resize', onResize);
                if (landing) landing.disconnect();
            };
        }
    }

    window.initPassport = initPassport;
})();
