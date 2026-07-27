/**
 * Procedural signature generator.
 *
 * Turns a typed name into a stylised handwritten signature. Deterministic:
 * the same (name, seed) pair always draws the same signature, so a visitor's
 * mark is stable across sessions and devices.
 *
 * How it works, in three stages:
 *
 *   1. SKELETON - each character contributes a small run of control points in
 *      an em box (baseline y=0, x-height y=1). Real signatures are mostly
 *      illegible past the first letter, so capitals get deliberate, roughly
 *      legible forms while lowercase letters are gestural: loops, humps,
 *      ovals and descenders chosen per letter, chained along a drifting
 *      baseline.
 *
 *   2. SMOOTHING - the control points are run through a Catmull-Rom spline and
 *      densely resampled, which turns the polyline into one continuous, fluid
 *      pen path.
 *
 *   3. INKING - width is not constant. A broad-nib pen held at a fixed angle
 *      lays down a stroke whose thickness depends on the angle between the
 *      direction of travel and the nib:  w = nib * |sin(theta - alpha)| + min.
 *      That single rule is what produces thick downstrokes and hairline
 *      cross-strokes, and it is the difference between reading as ink and
 *      reading as a font. Each sample is offset along its normal by w/2 to
 *      build a closed ribbon polygon.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.Signature = api;
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // ------------------------------------------------------------------
    // Seeded randomness
    // ------------------------------------------------------------------

    function hashString(str) {
        let h = 2166136261 >>> 0;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
        return h >>> 0;
    }

    function mulberry32(a) {
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // ------------------------------------------------------------------
    // Glyph shapes
    // Points are [x, y] with baseline y = 0 and x-height y = 1, y pointing up.
    // Each entry: { adv, pts, marks } - marks are separate pen-lifts (i dots,
    // t bars) drawn as their own strokes.
    // ------------------------------------------------------------------

    // Capitals: deliberate and roughly legible, drawn large with a lead-in.
    const CAPS = {
        A: { adv: 1.05, pts: [[0, 0], [0.28, 1.1], [0.5, 1.75], [0.72, 1.05], [0.95, 0], [0.85, 0.36], [0.24, 0.5]] },
        B: { adv: 0.95, pts: [[0.1, 0], [0.16, 0.9], [0.2, 1.75], [0.6, 1.68], [0.72, 1.3], [0.3, 0.95], [0.78, 0.8], [0.72, 0.24], [0.2, 0.05], [0.9, 0.1]] },
        C: { adv: 0.95, pts: [[0.92, 1.5], [0.6, 1.78], [0.2, 1.5], [0.1, 0.75], [0.28, 0.12], [0.72, 0.05], [0.95, 0.35]] },
        D: { adv: 1, pts: [[0.12, 0], [0.18, 0.9], [0.22, 1.75], [0.62, 1.66], [0.88, 1.1], [0.76, 0.34], [0.3, 0.04], [0.12, 0.06], [0.95, 0.12]] },
        E: { adv: 0.9, pts: [[0.9, 1.6], [0.45, 1.78], [0.2, 1.4], [0.5, 1.0], [0.22, 0.92], [0.12, 0.4], [0.42, 0.05], [0.88, 0.28]] },
        F: { adv: 0.95, pts: [[0.95, 1.72], [0.4, 1.75], [0.26, 1.0], [0.22, 0.1], [0.7, 1.05], [0.15, 1.02]] },
        G: { adv: 1, pts: [[0.95, 1.5], [0.55, 1.8], [0.16, 1.35], [0.16, 0.5], [0.55, 0.05], [0.86, 0.4], [0.6, 0.62], [0.95, 0.58]] },
        H: { adv: 1.05, pts: [[0.1, 0], [0.18, 0.95], [0.26, 1.75], [0.34, 0.9], [0.78, 0.95], [0.86, 1.72], [0.8, 0.85], [0.76, 0], [0.98, 0.28]] },
        I: { adv: 0.7, pts: [[0.12, 0.15], [0.42, 0.6], [0.5, 1.75], [0.2, 1.5], [0.58, 1.62], [0.46, 0.7], [0.3, 0.06], [0.68, 0.22]] },
        J: { adv: 0.85, pts: [[0.2, 1.55], [0.55, 1.8], [0.66, 1.0], [0.6, 0.1], [0.4, -0.5], [0.08, -0.42], [0.05, -0.1]] },
        K: { adv: 1, pts: [[0.12, 0], [0.2, 0.9], [0.28, 1.75], [0.24, 0.75], [0.85, 1.7], [0.36, 0.6], [0.9, 0.02], [0.98, 0.3]] },
        L: { adv: 0.95, pts: [[0.9, 1.7], [0.4, 1.72], [0.3, 1.0], [0.16, 0.28], [0.34, 0.02], [0.72, 0.1], [0.95, 0.32]] },
        M: { adv: 1.25, pts: [[0.06, 0], [0.16, 1.0], [0.24, 1.75], [0.5, 0.5], [0.72, 1.7], [0.9, 0.45], [1.02, 1.55], [1.1, 0.04], [1.22, 0.3]] },
        N: { adv: 1.15, pts: [[0.08, 0], [0.18, 1.0], [0.26, 1.75], [0.66, 0.55], [0.96, 1.7], [0.98, 0.85], [1.0, 0.04], [1.12, 0.3]] },
        O: { adv: 1, pts: [[0.85, 1.4], [0.5, 1.8], [0.14, 1.3], [0.14, 0.5], [0.5, 0.03], [0.88, 0.5], [0.82, 1.32], [0.5, 1.62], [0.95, 1.1]] },
        P: { adv: 0.9, pts: [[0.14, 0], [0.2, 0.9], [0.26, 1.75], [0.68, 1.7], [0.82, 1.25], [0.4, 0.88], [0.22, 0.85], [0.88, 0.5]] },
        Q: { adv: 1, pts: [[0.85, 1.4], [0.5, 1.8], [0.14, 1.3], [0.14, 0.5], [0.5, 0.03], [0.88, 0.5], [0.8, 1.3], [0.62, 0.4], [1.0, -0.2]] },
        R: { adv: 0.98, pts: [[0.12, 0], [0.2, 0.9], [0.26, 1.75], [0.66, 1.7], [0.8, 1.28], [0.36, 0.9], [0.66, 0.55], [0.94, 0.02], [1.0, 0.3]] },
        S: { adv: 0.88, pts: [[0.88, 1.55], [0.5, 1.8], [0.2, 1.5], [0.5, 1.0], [0.72, 0.65], [0.5, 0.06], [0.12, 0.22], [0.16, 0.5]] },
        T: { adv: 0.95, pts: [[0.08, 1.6], [0.5, 1.78], [0.95, 1.66], [0.55, 1.7], [0.46, 0.8], [0.4, 0.05], [0.9, 0.24]] },
        U: { adv: 1.05, pts: [[0.1, 1.72], [0.16, 0.8], [0.3, 0.06], [0.66, 0.08], [0.8, 0.85], [0.86, 1.72], [0.84, 0.8], [0.82, 0.05], [1.0, 0.3]] },
        V: { adv: 1, pts: [[0.06, 1.72], [0.3, 0.9], [0.5, 0.02], [0.74, 0.95], [0.94, 1.7], [0.98, 1.2]] },
        W: { adv: 1.3, pts: [[0.04, 1.7], [0.22, 0.6], [0.38, 0.04], [0.56, 1.2], [0.74, 0.04], [0.9, 0.6], [1.08, 1.7], [1.2, 1.2]] },
        X: { adv: 0.95, pts: [[0.08, 1.7], [0.45, 0.9], [0.88, 0.04], [0.5, 0.85], [0.1, 0.06], [0.5, 0.9], [0.92, 1.68]] },
        Y: { adv: 1, pts: [[0.08, 1.72], [0.32, 1.0], [0.5, 0.55], [0.86, 1.7], [0.7, 0.7], [0.55, -0.05], [0.28, -0.5], [0.02, -0.35]] },
        Z: { adv: 0.95, pts: [[0.1, 1.68], [0.55, 1.75], [0.88, 1.62], [0.42, 0.85], [0.1, 0.1], [0.55, 0.02], [0.95, 0.22]] }
    };

    // Lowercase gestures. Legibility fades after the first letter in real
    // signatures, so these are shapes with the right *rhythm* - ascender
    // loops, x-height humps, ovals, descender tails - rather than careful
    // letterforms.
    const LOWER = {
        a: { adv: 0.62, pts: [[0, 0.06], [0.14, 0.62], [0.34, 0.88], [0.5, 0.6], [0.5, 0.2], [0.44, 0.02], [0.6, 0.14]] },
        b: { adv: 0.6, pts: [[0, 0.05], [0.1, 0.85], [0.22, 1.6], [0.12, 0.8], [0.16, 0.16], [0.42, 0.04], [0.54, 0.36], [0.34, 0.5], [0.58, 0.2]] },
        c: { adv: 0.55, pts: [[0.52, 0.72], [0.28, 0.9], [0.08, 0.6], [0.14, 0.16], [0.4, 0.02], [0.56, 0.2]] },
        d: { adv: 0.62, pts: [[0.5, 0.8], [0.26, 0.9], [0.08, 0.55], [0.2, 0.1], [0.46, 0.08], [0.5, 0.85], [0.52, 1.6], [0.5, 0.6], [0.5, 0.06], [0.62, 0.2]] },
        e: { adv: 0.55, pts: [[0.08, 0.4], [0.42, 0.48], [0.4, 0.85], [0.16, 0.78], [0.1, 0.3], [0.32, 0.02], [0.56, 0.2]] },
        f: { adv: 0.58, pts: [[0.06, -0.42], [0.2, 0.3], [0.3, 1.1], [0.4, 1.62], [0.28, 1.2], [0.22, 0.4], [0.16, -0.3], [0.02, -0.5], [0.55, 0.55], [0.05, 0.5]] },
        g: { adv: 0.6, pts: [[0.5, 0.78], [0.26, 0.9], [0.08, 0.5], [0.22, 0.08], [0.46, 0.16], [0.5, 0.7], [0.44, -0.05], [0.3, -0.48], [0.04, -0.4], [0.02, -0.12]] },
        h: { adv: 0.62, pts: [[0, 0.05], [0.1, 0.85], [0.2, 1.6], [0.14, 0.8], [0.16, 0.1], [0.32, 0.62], [0.5, 0.7], [0.54, 0.24], [0.5, 0.04], [0.62, 0.2]] },
        i: { adv: 0.4, pts: [[0, 0.06], [0.14, 0.5], [0.24, 0.78], [0.3, 0.3], [0.28, 0.04], [0.42, 0.2]], marks: [[[0.24, 1.06], [0.32, 1.14]]] },
        j: { adv: 0.42, pts: [[0.08, 0.72], [0.22, 0.3], [0.24, -0.1], [0.16, -0.48], [-0.04, -0.42], [-0.04, -0.14]], marks: [[[0.2, 1.06], [0.28, 1.14]]] },
        k: { adv: 0.62, pts: [[0, 0.05], [0.1, 0.85], [0.2, 1.6], [0.14, 0.8], [0.14, 0.08], [0.5, 0.62], [0.26, 0.34], [0.56, 0.02], [0.64, 0.24]] },
        l: { adv: 0.45, pts: [[0, 0.06], [0.12, 0.9], [0.26, 1.62], [0.2, 0.85], [0.2, 0.14], [0.34, 0.02], [0.48, 0.22]] },
        m: { adv: 0.86, pts: [[0, 0.05], [0.08, 0.6], [0.18, 0.76], [0.3, 0.3], [0.34, 0.06], [0.44, 0.6], [0.56, 0.76], [0.66, 0.3], [0.7, 0.06], [0.86, 0.22]] },
        n: { adv: 0.62, pts: [[0, 0.05], [0.08, 0.6], [0.2, 0.78], [0.36, 0.4], [0.42, 0.06], [0.52, 0.04], [0.64, 0.22]] },
        o: { adv: 0.58, pts: [[0.5, 0.6], [0.4, 0.88], [0.14, 0.82], [0.08, 0.4], [0.24, 0.04], [0.48, 0.2], [0.46, 0.6], [0.6, 0.5]] },
        p: { adv: 0.62, pts: [[0.02, 0.7], [0.1, 0.1], [0.1, -0.5], [0.16, 0.2], [0.24, 0.72], [0.5, 0.78], [0.58, 0.4], [0.34, 0.06], [0.64, 0.18]] },
        q: { adv: 0.62, pts: [[0.5, 0.78], [0.24, 0.9], [0.08, 0.5], [0.22, 0.08], [0.46, 0.18], [0.5, 0.7], [0.48, 0.0], [0.46, -0.5], [0.66, -0.25]] },
        r: { adv: 0.52, pts: [[0, 0.05], [0.1, 0.6], [0.16, 0.8], [0.3, 0.56], [0.46, 0.72], [0.4, 0.2], [0.38, 0.04], [0.54, 0.2]] },
        s: { adv: 0.5, pts: [[0.46, 0.72], [0.24, 0.88], [0.1, 0.6], [0.34, 0.36], [0.42, 0.14], [0.16, 0.02], [0.06, 0.2]] },
        t: { adv: 0.5, pts: [[0.14, 0.05], [0.24, 0.9], [0.32, 1.42], [0.26, 0.8], [0.24, 0.16], [0.4, 0.04], [0.54, 0.24]], marks: [[[0.02, 0.82], [0.5, 0.9]]] },
        u: { adv: 0.62, pts: [[0.02, 0.78], [0.08, 0.3], [0.22, 0.04], [0.42, 0.16], [0.48, 0.72], [0.5, 0.24], [0.5, 0.05], [0.64, 0.22]] },
        v: { adv: 0.58, pts: [[0.02, 0.8], [0.18, 0.36], [0.3, 0.04], [0.46, 0.5], [0.52, 0.82], [0.62, 0.5]] },
        w: { adv: 0.82, pts: [[0.02, 0.8], [0.14, 0.3], [0.24, 0.04], [0.38, 0.6], [0.5, 0.06], [0.62, 0.4], [0.72, 0.8], [0.84, 0.5]] },
        x: { adv: 0.55, pts: [[0.04, 0.8], [0.28, 0.42], [0.52, 0.04], [0.3, 0.4], [0.06, 0.06]], marks: [[[0.06, 0.72], [0.52, 0.14]]] },
        y: { adv: 0.6, pts: [[0.02, 0.8], [0.1, 0.36], [0.24, 0.06], [0.44, 0.3], [0.5, 0.78], [0.42, 0.1], [0.3, -0.46], [0.02, -0.5], [0.0, -0.18]] },
        z: { adv: 0.56, pts: [[0.04, 0.78], [0.32, 0.84], [0.5, 0.72], [0.22, 0.4], [0.06, 0.06], [0.34, -0.3], [0.14, -0.46], [0.02, -0.28]] }
    };

    const DIGITS = {
        '0': { adv: 0.55, pts: [[0.44, 0.6], [0.34, 0.9], [0.12, 0.78], [0.08, 0.3], [0.28, 0.04], [0.48, 0.28], [0.44, 0.72]] },
        '1': { adv: 0.4, pts: [[0.04, 0.6], [0.22, 0.9], [0.26, 0.4], [0.24, 0.04], [0.4, 0.16]] },
        '2': { adv: 0.5, pts: [[0.06, 0.72], [0.28, 0.92], [0.46, 0.62], [0.2, 0.26], [0.04, 0.04], [0.5, 0.1]] },
        '3': { adv: 0.5, pts: [[0.06, 0.78], [0.34, 0.92], [0.36, 0.55], [0.18, 0.48], [0.44, 0.36], [0.3, 0.02], [0.04, 0.16]] },
        '4': { adv: 0.52, pts: [[0.36, 0.9], [0.06, 0.32], [0.5, 0.3], [0.36, 0.62], [0.34, 0.02]] },
        '5': { adv: 0.5, pts: [[0.44, 0.88], [0.14, 0.84], [0.12, 0.5], [0.36, 0.5], [0.44, 0.2], [0.16, 0.02], [0.04, 0.18]] },
        '6': { adv: 0.5, pts: [[0.44, 0.86], [0.18, 0.66], [0.1, 0.24], [0.32, 0.04], [0.46, 0.28], [0.22, 0.42], [0.12, 0.36]] },
        '7': { adv: 0.5, pts: [[0.04, 0.86], [0.46, 0.9], [0.3, 0.44], [0.2, 0.02]] },
        '8': { adv: 0.5, pts: [[0.32, 0.5], [0.12, 0.72], [0.28, 0.9], [0.44, 0.68], [0.14, 0.32], [0.26, 0.02], [0.46, 0.24], [0.3, 0.5]] },
        '9': { adv: 0.5, pts: [[0.44, 0.5], [0.24, 0.66], [0.14, 0.86], [0.4, 0.9], [0.46, 0.5], [0.34, 0.16], [0.1, 0.04]] }
    };

    function glyphFor(ch) {
        if (CAPS[ch]) return { g: CAPS[ch], cap: true };
        const lower = ch.toLowerCase();
        if (LOWER[lower]) return { g: LOWER[lower], cap: false };
        if (DIGITS[ch]) return { g: DIGITS[ch], cap: false };
        return null;
    }

    // ------------------------------------------------------------------
    // Spline + inking
    // ------------------------------------------------------------------

    /**
     * One Chaikin corner-cutting pass. The glyph skeletons are deliberately
     * terse, which leaves sharp reversals where consecutive control points
     * meet at a tight angle; rounding those first stops the spline from
     * overshooting into spikes. Endpoints are preserved so letters still
     * start and finish on the baseline.
     */
    function chaikin(pts) {
        if (pts.length < 3) return pts.slice();
        const out = [pts[0]];
        for (let i = 0; i < pts.length - 1; i++) {
            const p = pts[i], q = pts[i + 1];
            out.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25]);
            out.push([p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
        }
        out.push(pts[pts.length - 1]);
        return out;
    }

    /** Catmull-Rom through pts, resampled at `per` samples per segment. */
    function smooth(pts, per) {
        if (pts.length < 2) return pts.slice();
        const out = [];
        const p = [pts[0]].concat(pts, [pts[pts.length - 1]]);

        for (let i = 1; i < p.length - 2; i++) {
            const p0 = p[i - 1], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2];
            for (let s = 0; s < per; s++) {
                const t = s / per, t2 = t * t, t3 = t2 * t;
                out.push([
                    0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t +
                        (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
                        (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
                    0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t +
                        (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
                        (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
                ]);
            }
        }
        out.push(pts[pts.length - 1]);
        return out;
    }

    /**
     * Build a closed ribbon polygon around a path, with width set by the
     * broad-nib model. `taper` thins the very start and end so strokes enter
     * and leave the page rather than starting at full weight.
     */
    function inkPath(samples, nibAngle, nibWidth, minWidth, taper) {
        if (samples.length < 2) return '';
        const left = [], right = [];
        const n = samples.length;

        for (let i = 0; i < n; i++) {
            const prev = samples[Math.max(0, i - 1)];
            const next = samples[Math.min(n - 1, i + 1)];
            let dx = next[0] - prev[0], dy = next[1] - prev[1];
            const len = Math.hypot(dx, dy) || 1;
            dx /= len; dy /= len;

            // Angle between direction of travel and the nib
            const theta = Math.atan2(dy, dx);
            let w = nibWidth * Math.abs(Math.sin(theta - nibAngle)) + minWidth;

            if (taper) {
                const t = i / (n - 1);
                const ease = Math.min(1, Math.min(t, 1 - t) / 0.08);
                w *= 0.35 + 0.65 * ease;
            }

            // Normal to travel
            const nx = -dy * w * 0.5, ny = dx * w * 0.5;
            left.push([samples[i][0] + nx, samples[i][1] + ny]);
            right.push([samples[i][0] - nx, samples[i][1] - ny]);
        }

        const fmt = (p) => p[0].toFixed(2) + ' ' + p[1].toFixed(2);
        let d = 'M' + fmt(left[0]);
        for (let i = 1; i < left.length; i++) d += 'L' + fmt(left[i]);
        for (let i = right.length - 1; i >= 0; i--) d += 'L' + fmt(right[i]);
        return d + 'Z';
    }

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------

    /**
     * @param {string} name
     * @param {string} seed  stable per-person value (visitor id)
     * @param {Object} [opts]
     * @returns {{paths: string[], width: number, height: number, viewBox: string}}
     */
    function build(name, seed, opts) {
        opts = opts || {};
        // Fold diacritics onto their base letters so "María José" signs as
        // Maria Jose rather than dropping the accented characters entirely.
        let clean = String(name || '');
        try {
            clean = clean.normalize('NFD').replace(/[̀-ͯ]/g, '');
        } catch (e) { /* older engines: fall through with the raw string */ }
        clean = clean.replace(/\s+/g, ' ').trim().slice(0, 24);
        if (!clean) return { paths: [], width: 0, height: 0, viewBox: '0 0 1 1' };

        const rnd = mulberry32(hashString(seed + '|' + clean));

        // Per-person hand
        const slant = (-0.06 + rnd() * 0.30);            // radians, mostly forward
        const nibAngle = (30 + rnd() * 28) * Math.PI / 180;
        const nibWidth = 0.13 + rnd() * 0.08;
        const minWidth = 0.022 + rnd() * 0.018;
        const capScale = 1.5 + rnd() * 0.35;
        const drift = -0.05 + rnd() * 0.1;               // baseline slope
        const wobbleAmp = 0.02 + rnd() * 0.035;
        const wobbleFreq = 1.1 + rnd() * 1.6;
        const flourish = Math.floor(rnd() * 3);

        const words = clean.split(' ');
        const skeleton = [];   // main continuous stroke, per word
        const marks = [];      // pen-lifts: i dots, t bars

        let x = 0;

        words.forEach((word, wi) => {
            const wordPts = [];

            for (let ci = 0; ci < word.length; ci++) {
                const ch = word[ci];
                // First letter of a word is drawn as a deliberate capital
                const wantCap = ci === 0;
                const found = glyphFor(wantCap ? ch.toUpperCase() : ch);
                if (!found) { x += 0.3; continue; }

                const scale = found.cap && wantCap ? capScale : 1;
                const jitter = 0.94 + rnd() * 0.12;
                const sx = scale * jitter;
                const sy = scale * (0.95 + rnd() * 0.1);

                const place = (p) => {
                    const px = x + p[0] * sx;
                    const py = p[1] * sy
                        + px * drift
                        + Math.sin(px * wobbleFreq) * wobbleAmp;
                    return [px, py];
                };

                found.g.pts.forEach((p) => wordPts.push(place(p)));

                (found.g.marks || []).forEach((m) => {
                    marks.push(m.map(place));
                });

                x += found.g.adv * sx + 0.02;
            }

            if (wordPts.length) skeleton.push(wordPts);
            // Gap between words - real signatures keep the pen moving, but a
            // small lift reads more like separate names.
            if (wi < words.length - 1) x += 0.28;
        });

        const totalW = x;

        // Flourish: a swash under the whole signature
        const swash = [];
        if (flourish === 0) {
            swash.push([[-0.05, -0.28], [totalW * 0.35, -0.5], [totalW * 0.8, -0.16], [totalW * 1.02, -0.42]]);
        } else if (flourish === 1) {
            swash.push([[totalW * 0.98, 0.15], [totalW * 0.55, -0.42], [totalW * 0.1, -0.24], [totalW * 0.42, -0.05], [totalW * 1.05, -0.3]]);
        }

        // Ink everything
        const paths = [];
        skeleton.forEach((pts) => {
            paths.push(inkPath(smooth(chaikin(pts), 8), nibAngle, nibWidth, minWidth, true));
        });
        marks.forEach((m) => {
            paths.push(inkPath(smooth(m, 8), nibAngle, nibWidth * 0.55, minWidth * 0.9, true));
        });
        swash.forEach((s) => {
            paths.push(inkPath(smooth(chaikin(s), 12), nibAngle, nibWidth * 0.7, minWidth * 0.8, true));
        });

        // Bounds, then flip y (SVG grows downward) into a padded viewBox
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        const scan = (pts) => pts.forEach((p) => {
            if (p[0] < minX) minX = p[0];
            if (p[0] > maxX) maxX = p[0];
            if (p[1] < minY) minY = p[1];
            if (p[1] > maxY) maxY = p[1];
        });
        skeleton.forEach(scan); marks.forEach(scan); swash.forEach(scan);

        const pad = 0.22;
        minX -= pad; maxX += pad; minY -= pad; maxY += pad;
        const w = Math.max(0.1, maxX - minX);
        const h = Math.max(0.1, maxY - minY);

        return {
            paths: paths,
            // Applied by the caller so the ink is authored in natural units
            transform: `translate(${(-minX).toFixed(3)} ${maxY.toFixed(3)}) scale(1 -1) skewX(${(-slant * 18).toFixed(2)})`,
            width: w,
            height: h,
            viewBox: `0 0 ${w.toFixed(3)} ${h.toFixed(3)}`
        };
    }

    /** Convenience: a complete <svg> string. */
    function toSVG(name, seed, opts) {
        opts = opts || {};
        const sig = build(name, seed, opts);
        if (!sig.paths.length) return '';
        const colour = opts.colour || '#1a2340';
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${sig.viewBox}" ` +
            `preserveAspectRatio="xMidYMid meet" aria-hidden="true">` +
            `<g transform="${sig.transform}" fill="${colour}">` +
            sig.paths.map((d) => `<path d="${d}"/>`).join('') +
            `</g></svg>`;
    }

    return { build: build, toSVG: toSVG };
}));
