/**
 * IRC Chat - Gun.js powered real-time chat
 */
(function () {
    'use strict';

    const IRC_CHANNEL = 'general';
    const MAX_MESSAGES = 110;
    const PRESENCE_TIMEOUT = 10000;
    const FLOOD_WINDOW_MS = 10000;
    const FLOOD_MAX_MESSAGES = 8;
    const MAX_TEXT = 500;
    const MAX_NICK = 10;
    const CLOCK_SKEW_MS = 5000;          // how far ahead a peer's timestamp may be
    const LEGACY_EVENT_TTL = 5 * 60 * 1000;
    const LEAVE_GRACE_MS = 90000;        // silent timeout -> "left the room" delay
    const TYPING_TTL_MS = 4000;
    const MAX_ONLINE = 300;              // presence records shown; new ids are ignored once full
    const KLIPY_API_KEY = "zIUfW4jTZIuTIhNTSM66eooPq7WjjcKRnLyLoLd3ikyo15Q4kX2nfwMd0n0CmP96";
    const KLIPY_API_BASE = "https://api.klipy.com/v2";
    // Every media_formats.*.url (and gif.url) Klipy returns lives on this host.
    const GIF_HOSTS = ['static.klipy.com'];
    const MAX_GIF_BYTES = 12 * 1024 * 1024;

    // Verbose logging: localStorage.setItem('irc_debug', '1') and reopen IRC.
    let DEBUG = false;
    try { DEBUG = localStorage.getItem('irc_debug') === '1'; } catch (e) { /* ignore */ }
    function debugLog() {
        if (DEBUG) console.log.apply(console, arguments);
    }

    // Storage that never throws. With site data blocked, touching
    // localStorage raises SecurityError, which used to abort initIRC and
    // leave the window on "This app failed to load". Values fall back to
    // memory so a session still works until the page is closed.
    const memStore = {};
    const ircStore = {
        get(key) {
            try {
                const v = localStorage.getItem(key);
                if (v != null) return v;
            } catch (e) { /* storage blocked */ }
            return key in memStore ? memStore[key] : null;
        },
        set(key, value) {
            memStore[key] = String(value);
            try { localStorage.setItem(key, String(value)); } catch (e) { /* kept in memory only */ }
        },
        remove(key) {
            delete memStore[key];
            try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
        }
    };

    // GIF messages carry a bare URL written by an untrusted peer. Only https
    // URLs on the Klipy media host are ever rendered or sent.
    function isAllowedGifUrl(u) {
        if (typeof u !== 'string' || u.length > MAX_TEXT) return false;
        let url;
        try { url = new URL(u); } catch (e) { return false; }
        return url.protocol === 'https:' &&
            !url.username && !url.password && !url.port &&
            GIF_HOSTS.includes(url.hostname);
    }

    // GIF search goes through the site Worker (<meta name="link-proxy">) when
    // one is configured, so the Klipy key can live there as a secret. With no
    // proxy configured this is the direct Klipy call it always was.
    function gifEndpoint(path, params, direct) {
        const meta = document.querySelector('meta[name="link-proxy"]');
        const proxy = meta ? (meta.getAttribute('content') || '').trim().replace(/\/+$/, '') : '';
        const query = new URLSearchParams(params);
        if (!direct && /^https:\/\//.test(proxy)) return `${proxy}/gif/${path}?${query}`;
        query.set('key', KLIPY_API_KEY);
        return `${KLIPY_API_BASE}/${path}?${query}`;
    }

    function clampTime(t) {
        const now = Date.now();
        const n = Number(t);
        if (!isFinite(n) || n <= 0) return now;
        return Math.min(n, now + CLOCK_SKEW_MS);
    }

    function isJoinLeaveText(text) {
        return text === 'entered the room' || text === 'left the room';
    }

    // Normalise a peer-written message row. Anything not shaped like a message
    // is dropped; strings are capped so one row cannot stall the renderer.
    function sanitizeMessage(m) {
        if (!m || typeof m.nick !== 'string' || typeof m.text !== 'string') return null;
        const nick = m.nick.slice(0, MAX_NICK);
        const text = m.text.slice(0, MAX_TEXT);
        if (!nick || !text) return null;
        return {
            nick: nick,
            text: text,
            uuid: typeof m.uuid === 'string' ? m.uuid.slice(0, 64) : null,
            time: clampTime(m.time),
            action: m.action === true,
            type: m.type === 'system' || m.type === 'gif' ? m.type : 'msg'
        };
    }

    function sanitizePresence(p) {
        if (!p || typeof p.nick !== 'string' || !p.nick || !p.lastSeen) return null;
        const now = Date.now();
        return {
            nick: p.nick.slice(0, MAX_NICK),
            uuid: typeof p.uuid === 'string' ? p.uuid.slice(0, 64) : null,
            status: 'online',
            lastSeen: clampTime(p.lastSeen),
            typingUntil: Math.min(Number(p.typingUntil) || 0, now + TYPING_TTL_MS + CLOCK_SKEW_MS)
        };
    }

    // Generate a UUID v4
    function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // Deterministic nick colour from a UUID. Only the hue comes from the
    // hash: lightness and chroma are the --irc-nick-l / --irc-nick-c tokens
    // in irc.css (OKLCH, so every hue is equally light), which the dark
    // appearance raises, so each nick keeps 4.5:1 on either background and
    // follows a live appearance switch without re-rendering.
    function uuidToColor(uuid) {
        let hue = 230;
        if (uuid) {
            let hash = 0;
            for (let i = 0; i < uuid.length; i++) {
                hash = uuid.charCodeAt(i) + ((hash << 5) - hash);
            }
            hue = Math.abs(hash % 360);
        }
        return `oklch(var(--irc-nick-l, 0.5) var(--irc-nick-c, 0.12) ${hue})`;
    }

    // Text replacement commands (emoticons)
    const TEXT_REPLACEMENTS = {
        'shrug': '¯\\_(ツ)_/¯',
        'tableflip': '(╯°□°)╯︵ ┻━┻',
        'unflip': '┬─┬ノ( º _ ºノ)',
        'lenny': '( ͡° ͜ʖ ͡°)'
    };

    // Fun action commands
    const COMMANDS = {
        'slap': {
            solo: 'slaps the air dramatically',
            target: 'slaps {target} around a bit with a large trout'
        },
        'kill': {
            solo: 'kills themselves',
            target: 'kills {target}'
        },
        'hit': {
            solo: 'swings at the air',
            target: 'hits {target}!'
        },
        'hug': {
            solo: 'hugs themselves',
            target: 'hugs {target} warmly'
        },
        'poke': {
            solo: 'pokes the void',
            target: 'pokes {target}'
        },
        'wave': {
            solo: 'waves at everyone',
            target: 'waves at {target}'
        },
        'dance': {
            solo: 'busts out some sick dance moves',
            target: 'dances with {target}'
        },
        'highfive': {
            solo: 'high-fives the air... awkward',
            target: 'high-fives {target}'
        },
        'fistbump': {
            solo: 'fist-bumps the air',
            target: 'fist-bumps {target}'
        },
        'spank': {
            solo: 'spanks themselves... that\'s weird',
            target: 'spanks {target}!'
        },
        'pat': {
            solo: 'pats their own head',
            target: 'pats {target} on the head'
        },
        'kick': {
            solo: 'kicks the wall in frustration',
            target: 'kicks {target}!'
        },
        'tickle': {
            solo: 'tickles themselves and giggles',
            target: 'tickles {target} mercilessly'
        },
        'boop': {
            solo: 'boops their own nose',
            target: 'boops {target}\'s nose'
        },
        'throw': {
            solo: 'throws something at the wall',
            target: 'throws something at {target}'
        },
        'bonk': {
            solo: 'bonks themselves on the head',
            target: 'bonks {target} with a hammer'
        }
    };

    // One AudioContext for the whole module. Browsers cap how many can exist at
    // once, so this must never be constructed per notification.
    let sharedAudioContext = null;

    function getSharedAudioContext() {
        if (sharedAudioContext) return sharedAudioContext;
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return null;
        try {
            sharedAudioContext = new Ctor();
        } catch (e) {
            return null;
        }
        return sharedAudioContext;
    }

    // Sheet helpers from mavericks.js, with a native fallback if the window
    // manager has not loaded (IRC can be lazy-loaded before it).
    function notify(title, message) {
        if (window.showAlert) return window.showAlert(title, message);
        alert(title + (message ? '\n\n' + message : ''));
        return Promise.resolve(true);
    }

    function confirmSheet(title, message, opts) {
        if (window.showConfirm) return window.showConfirm(title, message, opts);
        return Promise.resolve(confirm(title + (message ? '\n\n' + message : '')));
    }

    let gunLoadPromise = null;

    function loadGun() {
        if (typeof Gun !== 'undefined' && window.SiteGun) return Promise.resolve();
        if (gunLoadPromise) return gunLoadPromise;
        gunLoadPromise = new Promise((resolve, reject) => {
            let attempts = 0;
            (function wait() {
                if (typeof Gun !== 'undefined' && window.SiteGun) return resolve();
                if (++attempts > 100) return reject(new Error('Gun.js unavailable'));
                setTimeout(wait, 50);
            })();
        });
        return gunLoadPromise;
    }

    function parseGunData(data) {
        if (!data) return null;
        if (typeof data === 'string') {
            try { return JSON.parse(data); } catch (e) { return null; }
        }
        return data;
    }

    function scanPresence(presenceRef, timeoutMs) {
        return new Promise((resolve) => {
            const found = {};
            presenceRef.map().once((data, uuid) => {
                const p = parseGunData(data);
                if (p) found[uuid] = p;
            });
            setTimeout(() => resolve(found), timeoutMs || 800);
        });
    }

    function nickTakenByOther(snapshot, nick, myUuid) {
        const now = Date.now();
        return Object.entries(snapshot).some(([uuid, p]) =>
            uuid !== myUuid &&
            p.nick === nick &&
            now - (p.lastSeen || 0) <= PRESENCE_TIMEOUT
        );
    }

    // NSFW.js loading
    let nsfwModel = null;
    let nsfwLoadPromise = null;
    const nsfwCache = new Map(); // Cache NSFW check results by URL

    // Third-party scripts, pinned with subresource integrity.
    //
    // These were previously loaded from @latest. That silently drifts, and the
    // whole NSFW pipeline fails OPEN - a breaking upstream release would post
    // unmoderated GIFs with no visible error. The versions below are exactly
    // what @latest resolved to, so pinning changes no behaviour.
    //
    // Note: nsfwjs "latest" is 4.3.0, but 4.3.0 moved the browser bundle to
    // dist/browser/. jsDelivr was quietly falling back to 4.0.0, the newest
    // version still carrying dist/nsfwjs.min.js. Pinned to 4.0.0 to match what
    // production actually runs; moving to 4.3.0 needs the new path and a test
    // pass against the self-hosted model in /static/models/nsfwjs/.
    const CDN = {
        omggif: {
            url: 'https://cdn.jsdelivr.net/npm/omggif@1.0.10/omggif.min.js',
            sri: 'sha384-Hl3rgTBtnvFd3zuruRruxaN0mFkAsSaHLU/F9QdzRmlK04Fn4oo6sGHmPwoAYv5i'
        },
        tfjs: {
            url: 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js',
            sri: 'sha384-vE8hbVJ4lezako5rlvE7bY0BVzWlFhZncPlckrqNwcUQpVtgbENTgZ8TBbnPjZre'
        },
        nsfwjs: {
            url: 'https://cdn.jsdelivr.net/npm/nsfwjs@4.0.0/dist/nsfwjs.min.js',
            sri: 'sha384-/3A0TkK7UxeMymKT+Hn+vGr5RaOhqRjJcTM4G7xcQzN3n+8AxEiELkN8rV231a6D'
        }
    };

    function loadScript(dep) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = dep.url;
            script.integrity = dep.sri;
            script.crossOrigin = 'anonymous';
            script.onload = resolve;
            script.onerror = () => reject(new Error('Failed to load ' + dep.url));
            document.head.appendChild(script);
        });
    }

    // Load omggif for GIF frame extraction
    let omggifLoaded = false;
    let omggifLoadPromise = null;

    async function loadOmggif() {
        if (omggifLoaded) return Promise.resolve();
        if (omggifLoadPromise) return omggifLoadPromise;

        omggifLoadPromise = loadScript(CDN.omggif).then(() => {
            omggifLoaded = true;
            debugLog('[NSFW] omggif loaded, available:', typeof window.GifReader);
        }).catch((e) => {
            omggifLoadPromise = null;
            throw e;
        });

        return omggifLoadPromise;
    }

    // Disposal method 2 ("restore to background"): the frame's own rect is
    // wiped before the next frame is drawn.
    function clearDisposedFrame(pixels, canvasWidth, frameInfo) {
        if (!frameInfo || frameInfo.disposal !== 2) return;
        for (let y = frameInfo.y; y < frameInfo.y + frameInfo.height; y++) {
            const start = (y * canvasWidth + frameInfo.x) * 4;
            pixels.fill(0, start, start + frameInfo.width * 4);
        }
    }

    // Extract key frames from GIF (sampled at even intervals)
    async function extractGifFrames(gifUrl) {
        try {
            await loadOmggif();

            if (typeof window.GifReader === 'undefined') {
                console.error('[NSFW] GifReader not available');
                return [];
            }

            // Fetch the GIF data
            const response = await fetch(gifUrl, { referrerPolicy: 'no-referrer' });
            if (!response.ok) return [];
            if (Number(response.headers.get('content-length')) > MAX_GIF_BYTES) return [];
            const arrayBuffer = await response.arrayBuffer();
            if (arrayBuffer.byteLength > MAX_GIF_BYTES) return [];
            const uint8Array = new Uint8Array(arrayBuffer);

            // Parse GIF using omggif
            const reader = new window.GifReader(uint8Array);
            const numFrames = reader.numFrames();

            if (numFrames === 0) {
                return [];
            }

            // Sample frames at even intervals (max 10 frames to check)
            const maxFramesToCheck = 10;
            const interval = Math.max(1, Math.floor(numFrames / maxFramesToCheck));
            const framesToCheck = Math.min(maxFramesToCheck, numFrames);

            debugLog(`[NSFW] GIF has ${numFrames} frames, checking ${framesToCheck} frames at interval ${interval}`);

            // Create canvas to render frames
            const canvas = document.createElement('canvas');
            canvas.width = reader.width;
            canvas.height = reader.height;
            const ctx = canvas.getContext('2d');

            const keyFrames = [];

            // Generate indices at even intervals
            const indices = [];
            for (let i = 0; i < framesToCheck; i++) {
                const idx = Math.min(i * interval, numFrames - 1);
                if (!indices.includes(idx)) {
                    indices.push(idx);
                }
            }

            // GIF frames are usually deltas over the previous frame, so decode
            // every frame in order into ONE buffer and snapshot the sampled
            // ones. A fresh buffer per sample gave the classifier fragments.
            const pixels = new Uint8ClampedArray(reader.width * reader.height * 4);
            const lastIdx = indices[indices.length - 1];

            for (let idx = 0; idx <= lastIdx; idx++) {
                reader.decodeAndBlitFrameRGBA(idx, pixels);

                const frameInfo = reader.frameInfo(idx);
                const sampled = indices.includes(idx);

                if (!sampled) {
                    clearDisposedFrame(pixels, reader.width, frameInfo);
                    continue;
                }

                // Create ImageData and draw to canvas
                const imageData = new ImageData(pixels, reader.width, reader.height);
                ctx.putImageData(imageData, 0, 0);

                // Convert canvas to image element
                const img = new Image();
                await new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = reject;
                    img.src = canvas.toDataURL();
                });

                keyFrames.push({ img, frameNumber: idx + 1 });
                clearDisposedFrame(pixels, reader.width, frameInfo);
            }

            return keyFrames;
        } catch (e) {
            console.error('[NSFW] Failed to extract GIF frames:', e);
            return [];
        }
    }

    async function loadNSFWModel() {
        if (nsfwModel) return nsfwModel;
        if (nsfwLoadPromise) return nsfwLoadPromise;

        nsfwLoadPromise = (async () => {
            try {
                // Load TensorFlow.js
                if (!window.tf) {
                    await loadScript(CDN.tfjs);
                }

                // Load NSFW.js
                if (!window.nsfwjs) {
                    await loadScript(CDN.nsfwjs);
                }

                // Set TensorFlow backend to GPU (as recommended in minimal demo)
                // https://github.com/tensorflow/tfjs/issues/1644
                if (window.tf) {
                    await window.tf.setBackend('webgl');
                    await window.tf.ready();
                    debugLog('[NSFW] TensorFlow backend set to:', window.tf.getBackend());
                }

                // Load the self-hosted MobileNetV2Mid model as graph type
                // Model files (model.json and shards) are served from /static/models/nsfwjs/
                debugLog('[NSFW] Loading model from /models/nsfwjs/ with type: graph');
                nsfwModel = await window.nsfwjs.load('/models/nsfwjs/', { type: 'graph' });
                debugLog('[NSFW] Model loaded successfully!', nsfwModel);
                return nsfwModel;
            } catch (e) {
                console.error('Failed to load NSFW model:', e);
                nsfwLoadPromise = null;
                throw e;
            }
        })();

        return nsfwLoadPromise;
    }

    // Helper function to evaluate if predictions are NSFW
    // Checks all 5 categories: Drawing, Hentai, Neutral, Porn, Sexy
    function evaluatePredictions(predictions) {
        // Extract all category scores
        const drawing = predictions.find(p => p.className === 'Drawing');
        const hentai = predictions.find(p => p.className === 'Hentai');
        const neutral = predictions.find(p => p.className === 'Neutral');
        const porn = predictions.find(p => p.className === 'Porn');
        const sexy = predictions.find(p => p.className === 'Sexy');

        const scores = {
            drawing: drawing ? drawing.probability : 0,
            hentai: hentai ? hentai.probability : 0,
            neutral: neutral ? neutral.probability : 0,
            porn: porn ? porn.probability : 0,
            sexy: sexy ? sexy.probability : 0
        };

        // Define thresholds for each category
        const thresholds = {
            porn: 0.1,      // 10% - Real pornography
            hentai: 0.1,    // 10% - Explicit anime/drawn pornography
            sexy: 0.1       // 10% - Suggestive/revealing content
            // Drawing and Neutral are not checked (legitimate art & safe content)
        };

        // Check each category against its threshold
        const violations = [];

        if (scores.porn > thresholds.porn) {
            violations.push({ category: 'Porn', probability: scores.porn });
        }
        if (scores.hentai > thresholds.hentai) {
            violations.push({ category: 'Hentai', probability: scores.hentai });
        }
        if (scores.sexy > thresholds.sexy) {
            violations.push({ category: 'Sexy', probability: scores.sexy });
        }
        // Drawing category is not checked - allows legitimate art and illustrations

        // Block if any category exceeds its threshold
        const isNSFW = violations.length > 0;

        // Get the highest violation for the reason
        const primaryViolation = violations.length > 0
            ? violations.reduce((max, v) => v.probability > max.probability ? v : max, violations[0])
            : null;

        return {
            isNSFW,
            predictions,
            reason: primaryViolation ? primaryViolation.category : null,
            scores,
            violations,
            thresholds
        };
    }

    async function checkImageNSFW(imageUrl) {
        // Check cache first
        if (nsfwCache.has(imageUrl)) {
            debugLog('[NSFW] Using cached result for:', imageUrl);
            return nsfwCache.get(imageUrl);
        }

        debugLog('[NSFW] Checking image:', imageUrl);

        try {
            const model = await loadNSFWModel();

            // Check if this is a GIF
            const isGif = imageUrl.toLowerCase().match(/\.gif(\?|$)/);

            if (isGif) {
                debugLog('[NSFW] Detected GIF, extracting key frames...');

                // Try to extract and check key frames (first, middle, last)
                const keyFrames = await extractGifFrames(imageUrl);

                if (keyFrames.length > 0) {
                    // Check each key frame - check from end to start (bottom to top)
                    // GIF "money shots" or NSFW content often appears at the end
                    keyFrames.reverse();

                    for (const { img, frameNumber } of keyFrames) {
                        debugLog(`[NSFW] Classifying frame ${frameNumber}...`);
                        const predictions = await model.classify(img);
                        const evaluation = evaluatePredictions(predictions);

                        debugLog(`[NSFW] Frame ${frameNumber}:`, evaluation.isNSFW ? '🚫 BLOCKED' : '✅ SAFE', {
                            drawing: `${(evaluation.scores.drawing * 100).toFixed(1)}%`,
                            hentai: `${(evaluation.scores.hentai * 100).toFixed(1)}%`,
                            neutral: `${(evaluation.scores.neutral * 100).toFixed(1)}%`,
                            porn: `${(evaluation.scores.porn * 100).toFixed(1)}%`,
                            sexy: `${(evaluation.scores.sexy * 100).toFixed(1)}%`,
                            violations: evaluation.violations.length > 0 ? evaluation.violations : 'none'
                        });

                        // If any frame is NSFW, block the entire GIF
                        if (evaluation.isNSFW) {
                            debugLog(`[NSFW] GIF BLOCKED due to frame ${frameNumber}`, {
                                reason: evaluation.reason,
                                violations: evaluation.violations
                            });
                            const result = {
                                isNSFW: true,
                                predictions: evaluation.predictions,
                                reason: `${evaluation.reason} (frame ${frameNumber})`
                            };
                            nsfwCache.set(imageUrl, result);
                            return result;
                        }
                    }

                    // All frames passed
                    debugLog('[NSFW] All frames safe ✅');
                    const result = { isNSFW: false, predictions: [], reason: null };
                    nsfwCache.set(imageUrl, result);
                    return result;
                } else {
                    debugLog('[NSFW] Frame extraction failed, falling back to single-frame check');
                    // Fall through to single image check
                }
            }

            // Single image check (non-GIF or GIF frame extraction failed)
            const img = new Image();
            img.crossOrigin = 'anonymous';

            const result = await new Promise((resolve, reject) => {
                img.onload = async () => {
                    try {
                        debugLog('[NSFW] Image loaded, classifying...');
                        const predictions = await model.classify(img);
                        const evaluation = evaluatePredictions(predictions);

                        debugLog('[NSFW] Predictions:', predictions);
                        debugLog('[NSFW] Decision:', evaluation.isNSFW ? '🚫 BLOCKED' : '✅ SAFE', {
                            drawing: `${(evaluation.scores.drawing * 100).toFixed(1)}%`,
                            hentai: `${(evaluation.scores.hentai * 100).toFixed(1)}%`,
                            neutral: `${(evaluation.scores.neutral * 100).toFixed(1)}%`,
                            porn: `${(evaluation.scores.porn * 100).toFixed(1)}%`,
                            sexy: `${(evaluation.scores.sexy * 100).toFixed(1)}%`,
                            reason: evaluation.reason,
                            violations: evaluation.violations.length > 0 ? evaluation.violations : 'none'
                        });

                        resolve({
                            isNSFW: evaluation.isNSFW,
                            predictions: evaluation.predictions,
                            reason: evaluation.reason
                        });
                    } catch (e) {
                        console.error('[NSFW] Classification error:', e);
                        reject(e);
                    }
                };

                img.onerror = () => {
                    // Could not be loaded for classification (CORS, network).
                    // That is "unverified", not "safe" - the caller decides.
                    debugLog('[NSFW] Image failed to load, result is unverified');
                    resolve({ isNSFW: false, unverified: true, predictions: [], reason: null });
                };

                img.referrerPolicy = 'no-referrer';
                img.src = imageUrl;
            });

            // Cache real verdicts only, so a transient failure can be retried
            if (!result.unverified) nsfwCache.set(imageUrl, result);
            return result;
        } catch (e) {
            console.error('[NSFW] Check failed:', e);
            // Model or decode failure: unverified, and deliberately not cached
            return { isNSFW: false, unverified: true, predictions: [], reason: null };
        }
    }

    function initIRC(win) {
        const root = win.querySelector('.irc-window');
        if (!root || root.dataset.init) return;
        root.dataset.init = '1';

        const els = {
            prompt: root.querySelector('.irc-nick-prompt'),
            nickInput: root.querySelector('.irc-nick-dialog input'),
            nickBtn: root.querySelector('.irc-nick-dialog button'),
            status: root.querySelector('.irc-status'),
            log: root.querySelector('.irc-log'),
            users: root.querySelector('.irc-user-list'),
            inputNick: root.querySelector('.irc-input-nick'),
            msgInput: root.querySelector('.irc-msg-input'),
            logoutBtn: root.querySelector('.irc-logout'),
            onlineHeader: root.querySelector('.irc-online-header'),
            gifBtn: root.querySelector('.irc-gif-btn'),
            gifPicker: root.querySelector('.irc-gif-picker'),
            gifSearch: root.querySelector('.irc-gif-search'),
            gifClose: root.querySelector('.irc-gif-close'),
            gifResults: root.querySelector('.irc-gif-results'),
            gifBlur: root.querySelector('.irc-gif-blur-toggle input'),
            charCount: root.querySelector('.irc-char-count'),
            termsInput: root.querySelector('.irc-nick-dialog input[type="checkbox"]')
        };

        // Every document/window listener below is registered with this signal
        // and released in ircCleanup - they close over this window's DOM, which
        // is discarded on close and rebuilt on the next open.
        const lifecycle = new AbortController();
        const signal = lifecycle.signal;

        let chat, presence;
        let myNick = '';
        let myUUID = '';
        let seen = new Set();
        let allMessages = []; // Track all messages with {key, time} for cleanup
        let legacyEvents = []; // Stored join/leave rows from older clients, pruned separately
        let online = {}; // Maps uuid -> {nick, uuid, status, lastSeen}
        let rosterTimer = 0; // pending scheduleRoster() rebuild
        let inRoom = {}; // Maps uuid -> nick for everyone whose join has been shown
        const pendingLeaves = {}; // uuid -> timeout id for a silent (timed out) leave
        let presenceSettled = false; // false while the initial presence snapshot streams in
        const recvTimes = {}; // uuid -> send times of live messages (receive-side flood control)
        let myTypingUntil = 0;
        let lastTypingSent = 0;
        let typingEl = null;
        let logPinned = true; // was the log at the bottom before the last resize?
        let uuidCache = {}; // Maps nick -> uuid (persists even when offline)
        let hasLeft = false;
        let sentFirstMessage = false;
        let joinTime = 0; // Track when user joined to avoid notifying for old messages
        let lastCursorPos = 0; // Track last known cursor position
        let unreadCount = 0;      // messages that arrived while scrolled up
        let unreadMentions = 0;   // mentions that arrived while backgrounded
        let baseWindowTitle = '';
        let unreadPill = null;

        // ---- Connection lifecycle -------------------------------------------
        // Everything connect() registers is recorded here. Without this, logging
        // out and rejoining - or closing and reopening the window - stacked a
        // second set of intervals, Gun subscriptions and unload handlers on top
        // of the first, each one still writing to the relay.
        const timers = new Set();
        const timeouts = new Set();
        const subscriptions = new Set();
        let onBeforeUnload = null;
        let offConnection = null;

        function trackInterval(id) { timers.add(id); return id; }
        function trackTimeout(id) { timeouts.add(id); return id; }

        function trackSubscription(ev) {
            // Gun hands the subscription's event object to every callback
            // invocation; keep the first one so we can .off() it later.
            if (ev && typeof ev.off === 'function') subscriptions.add(ev);
        }

        function teardownConnection() {
            timers.forEach(clearInterval);
            timers.clear();
            timeouts.forEach(clearTimeout);
            timeouts.clear();
            rosterTimer = 0;
            Object.keys(pendingLeaves).forEach((uuid) => { delete pendingLeaves[uuid]; });
            Object.keys(recvTimes).forEach((uuid) => { delete recvTimes[uuid]; });
            presenceSettled = false;
            subscriptions.forEach((ev) => {
                try { ev.off(); } catch (e) { /* ignore */ }
            });
            subscriptions.clear();
            // .map().on() yields a per-key event object, so closing the chains
            // themselves is what actually stops future keys from subscribing.
            try { if (chat) chat.map().off(); } catch (e) { /* ignore */ }
            try { if (presence) presence.map().off(); } catch (e) { /* ignore */ }
            if (onBeforeUnload) {
                window.removeEventListener('beforeunload', onBeforeUnload);
                onBeforeUnload = null;
            }
            if (offConnection) {
                offConnection();
                offConnection = null;
            }
        }

        // Cleanup old messages from Gun.js to keep database size manageable
        function cleanupOldMessages() {
            if (!chat) return;

            // Join/leave rows are no longer written (they are derived from
            // presence), but older clients left some behind. They are never
            // shown, so expire them on their own clock instead of letting
            // them count against - and evict - real conversation.
            const expiry = Date.now() - LEGACY_EVENT_TTL;
            legacyEvents = legacyEvents.filter((ev) => {
                if (ev.time > expiry) return true;
                chat.get(ev.key).put(null);
                seen.delete(ev.key);
                return false;
            });

            if (allMessages.length <= MAX_MESSAGES) return;

            // Sort messages by timestamp (oldest first)
            allMessages.sort((a, b) => (a.time || 0) - (b.time || 0));

            // Calculate how many to delete
            const deleteCount = allMessages.length - MAX_MESSAGES;
            const messagesToDelete = allMessages.slice(0, deleteCount);

            debugLog(`[IRC] Cleaning up ${deleteCount} old messages from Gun.js`);

            // Delete old messages from Gun.js
            messagesToDelete.forEach(msg => {
                chat.get(msg.key).put(null);
                seen.delete(msg.key);
            });

            // Update allMessages array
            allMessages = allMessages.slice(deleteCount);
        }

        // Jump-to-latest pill. Auto-scrolling on every message used to drag the
        // reader away from history they were in the middle of reading.
        (function setupUnreadPill() {
            const col = root.querySelector('.irc-chat-col');
            if (!col) return;
            unreadPill = document.createElement('button');
            unreadPill.type = 'button';
            unreadPill.className = 'irc-unread-pill';
            unreadPill.hidden = true;
            unreadPill.innerHTML = '<span class="irc-unread-count"></span><span aria-hidden="true"> ↓</span>';
            unreadPill.addEventListener('click', (e) => {
                e.stopPropagation();
                scrollToBottom();
                clearUnread();
            });
            unreadPill.addEventListener('mousedown', (e) => e.stopPropagation());
            col.appendChild(unreadPill);

            // "<nick> is typing…" line, floated over the bottom of the log so
            // it never shifts the messages.
            typingEl = document.createElement('div');
            typingEl.className = 'irc-typing';
            typingEl.hidden = true;
            col.appendChild(typingEl);

            els.log.addEventListener('scroll', () => {
                logPinned = isPinnedToBottom();
                if (logPinned) clearUnread();
            }, { passive: true });
        })();

        // Keep the newest message in view when the log itself changes size:
        // on-screen keyboard, window resize/zoom, the input growing a line.
        let logResizeObserver = null;
        if (window.ResizeObserver) {
            logResizeObserver = new ResizeObserver(() => {
                if (logPinned) scrollToBottom();
            });
            logResizeObserver.observe(els.log);
        }

        // Clear the mention badge as soon as the window is looked at
        root.addEventListener('mousedown', () => {
            if (unreadMentions) {
                unreadMentions = 0;
                updateWindowBadge();
            }
        });
        document.addEventListener('visibilitychange', () => updateWindowBadge(), { signal });

        // Events
        els.nickBtn.addEventListener('click', join);
        els.logoutBtn.addEventListener('click', logout);
        els.gifBtn.addEventListener('click', toggleGifPicker);
        els.gifClose.addEventListener('click', closeGifPicker);

        // "Blur GIFs in chat" - a click-to-reveal preference. Nothing is
        // downloaded or classified on the receiving side.
        let blurGifs = false;
        try { blurGifs = localStorage.getItem('irc_blur_gifs') === '1'; } catch (e) { /* ignore */ }
        if (els.gifBlur) {
            els.gifBlur.checked = blurGifs;
            els.gifBlur.addEventListener('change', () => {
                blurGifs = els.gifBlur.checked;
                try { localStorage.setItem('irc_blur_gifs', blurGifs ? '1' : '0'); } catch (e) { /* ignore */ }
                els.log.querySelectorAll('.irc-gif-container').forEach((c) => {
                    if (blurGifs) blurGif(c); else revealGif(c);
                });
            });
        }

        // Terms checkbox handler
        els.termsInput.addEventListener('change', () => {
            els.nickBtn.disabled = !els.termsInput.checked;
        });

        // Replace spaces with underscores in nickname input
        els.nickInput.addEventListener('input', (e) => {
            const cursorPos = e.target.selectionStart;
            const oldValue = e.target.value;
            const newValue = oldValue.replace(/ /g, '_');

            if (oldValue !== newValue) {
                e.target.value = newValue;
                // Restore cursor position
                e.target.setSelectionRange(cursorPos, cursorPos);
            }
        });

        // The user list is a drawer on phones and always visible on desktop;
        // aria-expanded on the "Online" button says which.
        function syncOnlineHeader() {
            const usersCol = els.users.parentElement;
            const expanded = window.innerWidth > 768 || usersCol.classList.contains('mobile-visible');
            els.onlineHeader.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        }
        syncOnlineHeader();

        // Mobile: Toggle user list when clicking "Online" header
        els.onlineHeader.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                els.users.parentElement.classList.toggle('mobile-visible');
                syncOnlineHeader();
            }
        });
        els.onlineHeader.addEventListener('mousedown', e => e.stopPropagation());

        // Mobile: Close user list when clicking outside of it
        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 768) {
                const usersCol = els.users.parentElement;
                if (usersCol.classList.contains('mobile-visible') &&
                    !usersCol.contains(e.target) &&
                    !els.onlineHeader.contains(e.target)) {
                    usersCol.classList.remove('mobile-visible');
                    syncOnlineHeader();
                }
            }
        }, { signal });

        // Mobile: Close GIF picker when clicking outside (only on mobile)
        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 768) {
                if (!els.gifPicker.classList.contains('hidden') &&
                    !els.gifPicker.contains(e.target) &&
                    !els.gifBtn.contains(e.target)) {
                    closeGifPicker();
                }
            }
        }, { signal });


        // Update timestamps when switching between mobile and desktop
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                syncOnlineHeader();
                // Refresh all timestamps
                els.log.querySelectorAll('.irc-msg-time').forEach(timeEl => {
                    const timestamp = parseInt(timeEl.dataset.timestamp);
                    if (timestamp) {
                        timeEl.textContent = formatRelativeTime(timestamp);
                    }
                });
            }, 250); // Debounce for 250ms
        }, { signal });

        // Play notification sound (Discord-like)
        // Reuses one AudioContext: browsers cap concurrent contexts (~6 in Chrome),
        // so constructing one per mention silently kills the ping mid-session.
        function playNotificationSound() {
            try {
                const audioContext = getSharedAudioContext();
                if (!audioContext) return;
                if (audioContext.state === 'suspended') audioContext.resume();

                // First tone (lower pitch)
                const oscillator1 = audioContext.createOscillator();
                const gainNode1 = audioContext.createGain();

                oscillator1.connect(gainNode1);
                gainNode1.connect(audioContext.destination);

                oscillator1.type = 'sine';
                oscillator1.frequency.value = 440; // A4 note, lower and warmer

                // Envelope for smoother sound
                gainNode1.gain.setValueAtTime(0, audioContext.currentTime);
                gainNode1.gain.linearRampToValueAtTime(0.15, audioContext.currentTime + 0.01);
                gainNode1.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);

                oscillator1.start(audioContext.currentTime);
                oscillator1.stop(audioContext.currentTime + 0.15);
            } catch (e) {
                // Silent fail if audio not supported
            }
        }

        // GIF Picker functions
        let gifSearchTimeout = null;

        function toggleGifPicker() {
            if (!myNick) return; // Not logged in
            const isHidden = els.gifPicker.classList.contains('hidden');
            if (isHidden) {
                els.gifPicker.classList.remove('hidden');
                els.gifSearch.value = '';
                setTimeout(() => els.gifSearch.focus(), 50);
                // Load trending GIFs
                searchGifs('');
                // Preload NSFW model in background
                loadNSFWModel().catch(() => {
                    // Silent fail - model will load when needed
                });
            } else {
                closeGifPicker();
            }
        }

        function closeGifPicker() {
            els.gifPicker.classList.add('hidden');
            els.gifResults.innerHTML = '';
        }

        async function searchGifs(query) {
            try {
                const endpointFor = (direct) => query
                    ? gifEndpoint('search', { q: query, client_key: 'irc-chat', limit: 20 }, direct)
                    : gifEndpoint('featured', { client_key: 'irc-chat', limit: 20 }, direct);

                let response = await fetch(endpointFor(false));
                // 503 = the Worker is deployed but has no Klipy secret yet:
                // use the direct call until it does.
                if (response.status === 503) response = await fetch(endpointFor(true));
                if (!response.ok) throw new Error('GIF search returned ' + response.status);
                const data = await response.json();

                els.gifResults.innerHTML = '';

                if (data.results && data.results.length > 0) {
                    data.results.forEach(gif => {
                        const previewUrl = getGifFormatUrl(gif, 'tinygif') || getGifFormatUrl(gif, 'nanogif') || gif.url;
                        const gifUrl = getGifFormatUrl(gif, 'gif') || getGifFormatUrl(gif, 'mediumgif') || gif.url;

                        // Anything off the Klipy media host could not be
                        // rendered by the other side anyway.
                        if (!isAllowedGifUrl(previewUrl) || !isAllowedGifUrl(gifUrl)) return;

                        const gifItem = document.createElement('div');
                        gifItem.className = 'irc-gif-item';
                        gifItem.tabIndex = 0;
                        gifItem.setAttribute('role', 'button');

                        const img = document.createElement('img');
                        img.referrerPolicy = 'no-referrer';
                        img.src = previewUrl;
                        img.alt = gif.content_description || gif.title || 'GIF';

                        gifItem.appendChild(img);
                        gifItem.onclick = () => sendGif(gifUrl);
                        gifItem.onkeydown = (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                sendGif(gifUrl);
                            }
                        };

                        els.gifResults.appendChild(gifItem);
                    });

                    if (!els.gifResults.children.length) {
                        els.gifResults.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 20px; color: var(--text-tertiary);">No GIFs found</div>';
                    }
                } else {
                    els.gifResults.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 20px; color: var(--text-tertiary);">No GIFs found</div>';
                }
            } catch (e) {
                console.error('Failed to fetch GIFs:', e);
                els.gifResults.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 20px; color: var(--danger-text);">Failed to load GIFs</div>';
            }
        }

        function getGifFormatUrl(gif, format) {
            return gif && gif.media_formats && gif.media_formats[format] && gif.media_formats[format].url;
        }

        async function sendGif(gifUrl) {
            if (!chat || !myNick) return;
            if (!isAllowedGifUrl(gifUrl)) return;

            // Show loading state
            const loadingMsg = document.createElement('div');
            loadingMsg.style.cssText = 'grid-column: 1/-1; text-align: center; padding: 20px; color: var(--text-tertiary);';
            loadingMsg.textContent = 'Checking GIF...';
            els.gifResults.innerHTML = '';
            els.gifResults.appendChild(loadingMsg);

            try {
                // Check if GIF is NSFW
                const result = await checkImageNSFW(gifUrl);

                if (result.isNSFW) {
                    // Show error message
                    els.gifResults.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 20px; color: var(--danger-text);">
                        <strong>GIF Blocked</strong><br>
                        This GIF was flagged as potentially inappropriate (${result.reason}).<br>
                        Please choose a different GIF.
                    </div>`;

                    // Reload search results after 2 seconds
                    setTimeout(() => {
                        const currentQuery = els.gifSearch.value.trim();
                        searchGifs(currentQuery);
                    }, 2000);
                    return;
                }

                // The check could not run (model or GIF failed to load). Do
                // not treat that as "safe": the sender decides explicitly.
                if (result.unverified) {
                    const ok = await confirmSheet('Could not check this GIF',
                        'The content check did not run, so this GIF is unverified. Send it anyway?',
                        { confirmLabel: 'Send' });
                    if (!ok) {
                        searchGifs(els.gifSearch.value.trim());
                        return;
                    }
                }

                publishMessage(gifUrl, 'gif');
                closeGifPicker();
            } catch (e) {
                console.error('Error checking GIF:', e);
                els.gifResults.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 20px; color: var(--danger-text);">Could not send GIF</div>';
            }
        }

        // GIF search input handler
        els.gifSearch.addEventListener('input', (e) => {
            clearTimeout(gifSearchTimeout);
            const query = e.target.value.trim();
            gifSearchTimeout = setTimeout(() => {
                searchGifs(query);
            }, 500);
        });

        // GIF search keydown - prevent propagation and handle escape
        els.gifSearch.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
                closeGifPicker();
            }
        });

        // Prevent GIF picker from closing when clicking inside
        els.gifPicker.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Get plain text from contenteditable
        function getInputText() {
            return els.msgInput.textContent || '';
        }

        // Set text in contenteditable and update colors
        function setInputText(text) {
            els.msgInput.textContent = text;
            updateInputColors();
        }

        // Get cursor position in contenteditable
        function getCursorPosition() {
            const sel = window.getSelection();
            if (sel.rangeCount === 0) return 0;
            const range = sel.getRangeAt(0);
            const preCaretRange = range.cloneRange();
            preCaretRange.selectNodeContents(els.msgInput);
            preCaretRange.setEnd(range.endContainer, range.endOffset);
            return preCaretRange.toString().length;
        }

        // Set cursor position in contenteditable
        function setCursorPosition(pos) {
            const sel = window.getSelection();
            const range = document.createRange();

            let charCount = 0;
            let foundNode = null;
            let foundOffset = 0;

            function traverseNodes(node) {
                if (foundNode) return;

                if (node.nodeType === Node.TEXT_NODE) {
                    const nextCharCount = charCount + node.length;
                    if (pos <= nextCharCount) {
                        foundNode = node;
                        foundOffset = pos - charCount;
                    }
                    charCount = nextCharCount;
                } else {
                    for (let i = 0; i < node.childNodes.length; i++) {
                        traverseNodes(node.childNodes[i]);
                        if (foundNode) break;
                    }
                }
            }

            traverseNodes(els.msgInput);

            if (foundNode) {
                range.setStart(foundNode, foundOffset);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
            }
        }

        // Insert text at cursor position in contenteditable
        function insertTextAtCursor(text) {
            const sel = window.getSelection();
            if (sel.rangeCount === 0) return;

            const range = sel.getRangeAt(0);
            range.deleteContents();

            const textNode = document.createTextNode(text);
            range.insertNode(textNode);

            // Move cursor after inserted text
            range.setStartAfter(textNode);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
        }

        // Update colors for @mentions in input
        function updateInputColors() {
            const text = getInputText();

            // Quick check: if no @ symbols, don't parse
            if (!text.includes('@')) {
                return;
            }

            const cursorPos = getCursorPosition();

            // Parse and rebuild with colored mentions
            const parts = parseAndColorMentions(text);

            // Check if we have any mentions
            const hasMentions = parts.some(p => p.type === 'mention');

            if (hasMentions) {
                els.msgInput.innerHTML = '';
                parts.forEach(part => {
                    if (part.type === 'text') {
                        els.msgInput.appendChild(document.createTextNode(part.content));
                    } else if (part.type === 'mention') {
                        const mentionSpan = document.createElement('span');
                        mentionSpan.className = 'irc-mention';
                        mentionSpan.textContent = part.content;

                        if (part.uuid) {
                            mentionSpan.style.color = uuidToColor(part.uuid);
                            mentionSpan.style.fontWeight = '600';
                        } else {
                            // Invalid mention - keep default color but still bold
                            mentionSpan.style.fontWeight = '600';
                        }

                        els.msgInput.appendChild(mentionSpan);
                    }
                });

                // Restore cursor position
                setTimeout(() => setCursorPosition(cursorPos), 0);
            }
        }

        // Insert @mention at cursor position
        function insertMention(nick) {
            const val = getInputText();

            // Use last known cursor position
            let cursorPos = lastCursorPos;

            // If cursor is at start (0) and there's text, it likely means input wasn't focused
            // In that case, move cursor to end for better UX
            if (cursorPos === 0 && val.length > 0) {
                cursorPos = val.length;
            }

            const before = val.substring(0, cursorPos);
            const after = val.substring(cursorPos);

            // Add space before @ if needed
            const needsSpace = before.length > 0 && before[before.length - 1] !== ' ';
            const mention = (needsSpace ? ' ' : '') + '@' + nick + ' ';

            setInputText(before + mention + after);

            // Focus input and set cursor after the mention
            els.msgInput.focus();
            setTimeout(() => {
                const newPos = cursorPos + mention.length;
                setCursorPosition(newPos);
                lastCursorPos = newPos;
            }, 0);
        }

        // Get UUID for a username
        function getUuidForNick(nick) {
            if (nick === myNick) return myUUID;
            if (uuidCache[nick]) return uuidCache[nick];
            for (const p of Object.values(online)) {
                if (p.nick === nick && p.uuid) return p.uuid;
            }
            return null;
        }

        // Parse text and colorize @mentions
        function parseAndColorMentions(text) {
            // Match @username pattern (alphanumeric and underscores)
            const mentionRegex = /@(\w+)/g;
            const parts = [];
            let lastIndex = 0;
            let match;

            while ((match = mentionRegex.exec(text)) !== null) {
                const mentionedNick = match[1];
                const uuid = getUuidForNick(mentionedNick);

                // Add text before mention
                if (match.index > lastIndex) {
                    parts.push({
                        type: 'text',
                        content: text.substring(lastIndex, match.index)
                    });
                }

                // Add mention (colored if valid user)
                parts.push({
                    type: 'mention',
                    content: match[0],
                    nick: mentionedNick,
                    uuid: uuid
                });

                lastIndex = match.index + match[0].length;
            }

            // Add remaining text
            if (lastIndex < text.length) {
                parts.push({
                    type: 'text',
                    content: text.substring(lastIndex)
                });
            }

            return parts;
        }

        // Input handling - ensure we stop propagation so global shortcuts don't fire
        function handleInputKey(e) {
            e.stopPropagation(); // Critical for typing to work!

            // Tab is deliberately left alone: it must move focus out of the
            // message box (it used to insert a tab character and trap focus).

            if (e.key === 'Enter') {
                if (e.target === els.nickInput) {
                    e.preventDefault();
                    join();
                } else if (e.target === els.msgInput && !e.shiftKey) {
                    e.preventDefault();
                    send();
                }
                // Shift+Enter allows newlines - no action needed
            }
        }

        els.nickInput.addEventListener('keydown', handleInputKey);
        els.msgInput.addEventListener('keydown', handleInputKey);

        // Handle paste - only allow plain text, no images
        els.msgInput.addEventListener('paste', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Get plain text from clipboard
            // Capped: nothing longer than MAX_TEXT can be sent anyway, and a
            // multi-megabyte paste would stall the mention colouring.
            const text = (e.clipboardData || window.clipboardData).getData('text/plain').slice(0, MAX_TEXT);

            if (text) {
                // Insert text at cursor position
                insertTextAtCursor(text);
                // Update colors and cursor position after paste
                lastCursorPos = getCursorPosition();
                updateInputColors();
                updateCharCount();
            }
        });

        // Update colors as user types in contenteditable
        els.msgInput.addEventListener('input', () => {
            updateInputColors();
            lastCursorPos = getCursorPosition();
            updateCharCount();
            noteTyping();
        });

        // Length counter, shown only once the limit is in sight
        function updateCharCount() {
            if (!els.charCount) return;
            const len = getInputText().trim().length;
            els.charCount.hidden = len < MAX_TEXT - 100;
            els.charCount.textContent = `${len}/${MAX_TEXT}`;
            els.charCount.classList.toggle('over', len > MAX_TEXT);
        }

        // Typing indicator, carried on the presence record other clients
        // already subscribe to. Throttled so typing costs one write per 2.5s.
        function noteTyping() {
            if (!myNick || !presence) return;
            const now = Date.now();
            const text = getInputText();
            if (!text.trim() || text.startsWith('/')) return;
            if (now - lastTypingSent < 2500) return;
            lastTypingSent = now;
            myTypingUntil = now + TYPING_TTL_MS;
            announce();
        }

        function stopTyping() {
            if (!myTypingUntil) return;
            myTypingUntil = 0;
            lastTypingSent = 0;
            announce();
        }

        function updateTyping() {
            if (!typingEl) return;
            const now = Date.now();
            const names = Object.keys(online)
                .filter(uuid => uuid !== myUUID && online[uuid].typingUntil > now)
                .map(uuid => online[uuid].nick);
            typingEl.hidden = names.length === 0;
            if (!names.length) return;
            typingEl.textContent = names.length === 1
                ? `${names[0]} is typing…`
                : names.length <= 3
                    ? `${names.join(', ')} are typing…`
                    : 'Several people are typing…';
        }

        // Track cursor position on click, keyup, and selection change
        els.msgInput.addEventListener('click', () => {
            lastCursorPos = getCursorPosition();
        });
        els.msgInput.addEventListener('keyup', () => {
            lastCursorPos = getCursorPosition();
        });
        els.msgInput.addEventListener('focus', () => {
            lastCursorPos = getCursorPosition();
        });

        // Prevent window manager from stealing focus
        els.nickInput.addEventListener('mousedown', e => e.stopPropagation());
        els.msgInput.addEventListener('mousedown', e => e.stopPropagation());
        els.logoutBtn.addEventListener('mousedown', e => e.stopPropagation());
        els.gifBtn.addEventListener('mousedown', e => e.stopPropagation());

        // The login footer's markup says "Server Status: Online" whatever the
        // relays are doing. Report the real connection state instead.
        const loginStatus = root.querySelector('.irc-login-footer span');
        if (loginStatus) {
            let offLoginStatus = null;
            let relayUp = false;
            let gaveUpWaiting = false;
            const showLoginStatus = () => {
                loginStatus.textContent = 'Server Status: ' +
                    (relayUp ? 'Online' : (gaveUpWaiting ? 'Offline' : 'Connecting…'));
            };
            showLoginStatus();
            // A first connection takes a moment; only call it offline after that.
            const loginStatusTimer = setTimeout(() => { gaveUpWaiting = true; showLoginStatus(); }, 4000);
            loadGun().then(() => {
                if (signal.aborted || !window.SiteGun.getConnection) return;
                offLoginStatus = window.SiteGun.getConnection().onChange((connected) => {
                    relayUp = connected;
                    showLoginStatus();
                });
            }).catch(() => { gaveUpWaiting = true; showLoginStatus(); });
            signal.addEventListener('abort', () => {
                clearTimeout(loginStatusTimer);
                if (offLoginStatus) offLoginStatus();
            });
        }

        // Load saved nick and auto-join if present
        let savedNick = ircStore.get('irc_nick');
        const termsAccepted = ircStore.get('irc_tos_accepted');

        // Replace spaces with underscores in saved nickname
        if (savedNick) {
            const sanitizedNick = savedNick.replace(/ /g, '_');
            if (sanitizedNick !== savedNick) {
                // Update localStorage with sanitized version
                ircStore.set('irc_nick', sanitizedNick);
                savedNick = sanitizedNick;
            }
        }

        if (termsAccepted) {
            els.termsInput.checked = true;
            els.nickBtn.disabled = false;
        } else {
            els.termsInput.checked = false;
            els.nickBtn.disabled = true;
        }

        if (savedNick && termsAccepted) {
            els.nickInput.value = savedNick;
            // Auto-join after a brief delay
            setTimeout(() => {
                join();
            }, 300);
        } else {
            setTimeout(() => els.nickInput.focus(), 50);
        }

        function join() {
            let nick = els.nickInput.value.trim().slice(0, 10);
            // Replace spaces with underscores
            nick = nick.replace(/ /g, '_');

            if (!nick) return els.nickInput.focus();

            if (!els.termsInput.checked) {
                notify('Content warning', 'You must accept the content warning before joining.');
                return;
            }

            // Save nick and terms acceptance
            ircStore.set('irc_nick', nick);
            ircStore.set('irc_tos_accepted', 'true');

            // Get or generate UUID
            let uuid = ircStore.get('irc_uuid');
            if (!uuid) {
                uuid = generateUUID();
                ircStore.set('irc_uuid', uuid);
            }

            myNick = nick;
            myUUID = uuid;
            lastCursorPos = 0;
            els.prompt.classList.add('hidden');
            els.inputNick.textContent = myNick + '>';
            els.inputNick.style.color = uuidToColor(myUUID); // Apply user's color
            els.msgInput.setAttribute('contenteditable', 'true');
            els.msgInput.setAttribute('aria-disabled', 'false');
            els.msgInput.setAttribute('data-placeholder', 'Write to #general (Shift+Enter for newline)');
            els.msgInput.focus();
            els.logoutBtn.style.display = 'flex'; // Show logout button
            els.gifBtn.disabled = false; // Enable GIF button
            loadGun().then(connect).catch(() => addMsg('', 'Failed to load Gun.js', true));
        }

        function logout() {
            if (!myNick) return;

            // Leaving is signalled by clearing our presence record; other
            // clients derive "left the room" from that.
            if (chat && presence && !hasLeft) {
                hasLeft = true;
                presence.get(myUUID).put(null);
            }

            // Drop every interval, timeout, Gun subscription and unload handler
            // from the previous session before a rejoin can register new ones.
            teardownConnection();

            // Clear localStorage
            ircStore.remove('irc_nick');
            ircStore.remove('irc_tos_accepted');

            // Reset UI
            myNick = '';
            seen.clear();
            allMessages = [];
            legacyEvents = [];
            online = {};
            inRoom = {};
            uuidCache = {};
            hasLeft = false;
            joinTime = 0;
            lastCursorPos = 0;
            myTypingUntil = 0;
            lastTypingSent = 0;
            unreadMentions = 0;
            updateWindowBadge();
            updateTyping();

            els.log.innerHTML = '';
            els.users.innerHTML = '';
            els.prompt.classList.remove('hidden');
            els.nickInput.value = '';
            els.termsInput.checked = false;
            els.nickBtn.disabled = true;
            els.msgInput.setAttribute('contenteditable', 'false');
            els.msgInput.setAttribute('aria-disabled', 'true');
            els.msgInput.textContent = '';
            updateCharCount();
            els.msgInput.setAttribute('data-placeholder', 'Type a message (Shift+Enter for newline)...');
            els.inputNick.textContent = 'guest>';
            els.inputNick.style.color = ''; // Back to the stylesheet colour (either appearance)
            els.status.textContent = 'Connecting...';
            els.logoutBtn.style.display = 'none'; // Hide logout button
            els.gifBtn.disabled = true; // Disable GIF button
            closeGifPicker(); // Close GIF picker if open

            // Focus nickname input
            setTimeout(() => els.nickInput.focus(), 50);
        }

        async function connect() {
            chat = window.SiteGun.paths.apps.ircMessages(IRC_CHANNEL);
            presence = window.SiteGun.paths.live.ircPresence(IRC_CHANNEL);

            joinTime = Date.now();
            els.log.innerHTML = '';
            // History streams in as a burst; keep screen readers from reading
            // all of it out as if it had just been said.
            els.log.setAttribute('aria-busy', 'true');
            trackTimeout(setTimeout(() => els.log.removeAttribute('aria-busy'), 3000));

            const snapshot = await scanPresence(presence);
            if (nickTakenByOther(snapshot, myNick, myUUID)) {
                els.status.textContent = 'Nickname already in use';
                const taken = myNick;
                logout();
                notify('Nickname unavailable', `"${taken}" is already in use. Pick another.`);
                return;
            }

            chat.map().on(function (data, key, _msg, ev) {
                trackSubscription(ev);
                if (!data) return;

                const m = sanitizeMessage(parseGunData(data));
                if (!m) return;

                const isSysMsg = m.type === 'system';

                // Join/leave rows written by older clients: never shown (they
                // are derived from presence now), only tracked for expiry.
                if (isSysMsg && isJoinLeaveText(m.text)) {
                    if (!seen.has(key)) {
                        seen.add(key);
                        legacyEvents.push({ key: key, time: m.time });
                    }
                    return;
                }

                if (m.uuid && !isSysMsg) {
                    uuidCache[m.nick] = m.uuid;
                }

                if (seen.has(key)) {
                    updateMsg(key, m);
                    return;
                }
                seen.add(key);

                allMessages.push({
                    key: key,
                    time: m.time
                });

                // Receive-side flood control for live traffic. Like the send
                // limit this is courtesy, not security: uuids are unsigned.
                if (m.time >= joinTime && m.uuid !== myUUID && isPeerFlooding(m.uuid || m.nick, m.time)) {
                    return;
                }

                addMsg(m.nick, m.text, isSysMsg, m.action, m.time, m.uuid, m.type, key);
            });

            announce();
            trackInterval(setInterval(announce, 5000));

            // Our own join is shown locally; nothing is written to the
            // messages node for it.
            inRoom[myUUID] = myNick;
            addMsg(myNick, 'entered the room', true, false, Date.now(), myUUID);

            // Everyone already in the room arrives in the first presence
            // burst - those are not joins.
            trackTimeout(setTimeout(() => { presenceSettled = true; }, 2500));

            onBeforeUnload = () => {
                if (myNick && presence && !hasLeft) {
                    hasLeft = true;
                    presence.get(myUUID).put(null);
                }
            };
            window.addEventListener('beforeunload', onBeforeUnload);

            presence.map().on(function (data, uuid, _msg, ev) {
                trackSubscription(ev);
                if (!data) {
                    // An explicit leave (logout, window or tab closed)
                    if (online[uuid]) {
                        delete online[uuid];
                        updateUsers();
                        noteLeft(uuid);
                    }
                    return;
                }

                const p = sanitizePresence(parseGunData(data));
                if (p) {
                    const age = Date.now() - p.lastSeen;
                    if (age > PRESENCE_TIMEOUT) {
                        // Abandoned record (tab killed without a clean leave)
                        if (age > STALE_PURGE_MS) presence.get(uuid).put(null);
                        return;
                    }
                    delete stalePresence[uuid];

                    if (p.uuid) {
                        uuidCache[p.nick] = p.uuid;
                    }

                    // A flood of fake ids must not grow the list without
                    // limit; people already listed keep refreshing.
                    if (!online[uuid] && uuid !== myUUID &&
                        Object.keys(online).length >= MAX_ONLINE) return;

                    online[uuid] = p;
                    scheduleRoster();
                    if (uuid !== myUUID) noteJoined(uuid, p.nick);
                }
            });

            trackInterval(setInterval(cleanStale, 10000));
            trackInterval(setInterval(cleanupOldMessages, 30000));
            trackInterval(setInterval(updateTyping, 1000));

            trackInterval(setInterval(() => {
                els.log.querySelectorAll('.irc-msg-time').forEach(timeEl => {
                    const timestamp = parseInt(timeEl.dataset.timestamp);
                    if (timestamp) {
                        timeEl.textContent = formatRelativeTime(timestamp);
                    }
                });
            }, 10000));

            setConnectionStatus();
        }

        // Reflect real relay connectivity rather than unconditionally claiming
        // success - previously the status said "Connected as <nick>" even with
        // every relay unreachable, so people typed into the void.
        function setConnectionStatus() {
            if (offConnection) {
                offConnection();
                offConnection = null;
            }
            if (!window.SiteGun.getConnection) {
                els.status.textContent = 'Connected as ' + myNick;
                return;
            }
            offConnection = window.SiteGun.getConnection().onChange((connected) => {
                if (!myNick) return;
                els.status.textContent = connected
                    ? 'Connected as ' + myNick
                    : 'Offline - reconnecting…';
                els.status.classList.toggle('is-offline', !connected);
            });
        }

        function announce() {
            if (!myNick || !presence) return;
            presence.get(myUUID).put({
                nick: myNick,
                uuid: myUUID,
                status: 'online',
                lastSeen: Date.now(),
                typingUntil: myTypingUntil > Date.now() ? myTypingUntil : 0
            });
        }

        // Join/leave lines are derived here from the presence subscription
        // instead of being stored as messages, where every open/close of the
        // window used to push real conversation out of the 110-row history.
        const STALE_PURGE_MS = 10 * 60 * 1000;
        const stalePresence = {}; // uuid -> lastSeen of records that timed out

        function cancelPendingLeave(uuid) {
            if (!pendingLeaves[uuid]) return;
            clearTimeout(pendingLeaves[uuid]);
            timeouts.delete(pendingLeaves[uuid]);
            delete pendingLeaves[uuid];
        }

        function noteJoined(uuid, nick) {
            cancelPendingLeave(uuid);
            const known = inRoom[uuid];
            inRoom[uuid] = nick;
            if (!presenceSettled) return;
            if (known === undefined) {
                addMsg(nick, 'entered the room', true, false, Date.now(), uuid);
            } else if (known !== nick) {
                addMsg('', `@${known} is now known as @${nick}`, true);
            }
        }

        function noteLeft(uuid) {
            cancelPendingLeave(uuid);
            const nick = inRoom[uuid];
            if (nick === undefined || uuid === myUUID) return;
            delete inRoom[uuid];
            if (presenceSettled) addMsg(nick, 'left the room', true, false, Date.now(), uuid);
        }

        function cleanStale() {
            const now = Date.now();
            let changed = false;

            Object.keys(online).forEach(uuid => {
                if (now - online[uuid].lastSeen > PRESENCE_TIMEOUT) {
                    // A missed heartbeat is not a leave: background tabs are
                    // timer-throttled and come back. Drop them from the list
                    // now, but only say "left" if they stay gone, and leave
                    // the record alone so nobody mistakes this for a clean exit.
                    stalePresence[uuid] = online[uuid].lastSeen;
                    delete online[uuid];
                    changed = true;
                    if (uuid !== myUUID && !pendingLeaves[uuid]) {
                        pendingLeaves[uuid] = trackTimeout(setTimeout(() => {
                            timeouts.delete(pendingLeaves[uuid]);
                            delete pendingLeaves[uuid];
                            noteLeft(uuid);
                        }, LEAVE_GRACE_MS));
                    }
                }
            });

            // Purge records that have been dead long enough to be abandoned
            Object.keys(stalePresence).forEach(uuid => {
                if (now - stalePresence[uuid] > STALE_PURGE_MS) {
                    if (presence) presence.get(uuid).put(null);
                    delete stalePresence[uuid];
                }
            });

            if (changed) {
                updateUsers();
                updateTyping();
            }
        }

        // Counts by the time each message was sent, not when it reached us.
        // A reconnect or a laptop waking up delivers minutes of honest
        // conversation in one batch; counting arrivals hid all but the first
        // ten of those, for good, because the row is already in `seen`.
        function isPeerFlooding(id, sentAt) {
            const times = recvTimes[id] || (recvTimes[id] = []);
            times.push(sentAt);
            if (times.length > 200) times.shift();
            let inWindow = 0;
            for (let i = 0; i < times.length; i++) {
                if (times[i] <= sentAt && sentAt - times[i] < FLOOD_WINDOW_MS) inWindow++;
            }
            // A little slack over the send limit for clock jitter
            return inWindow > FLOOD_MAX_MESSAGES + 2;
        }

        // Presence records arrive in bursts (initial snapshot, heartbeats);
        // rebuild the list and typing line once per burst, not per record.
        function scheduleRoster() {
            if (rosterTimer) return;
            rosterTimer = trackTimeout(setTimeout(() => {
                timeouts.delete(rosterTimer);
                rosterTimer = 0;
                updateUsers();
                updateTyping();
            }, 100));
        }

        function updateUsers() {
            els.users.innerHTML = '';

            const users = Object.values(online).sort((a, b) =>
                a.nick.toLowerCase().localeCompare(b.nick.toLowerCase())
            );

            els.onlineHeader.textContent = `Online [${users.length}]`;

            users.forEach(userData => {
                const n = userData.nick;
                const d = document.createElement('div');
                d.className = 'irc-user' + (n === myNick ? ' me' : '');
                d.textContent = n;

                if (userData.uuid) {
                    d.style.color = uuidToColor(userData.uuid);
                }

                if (n !== myNick) {
                    d.style.cursor = 'pointer';
                    d.onclick = (e) => {
                        e.stopPropagation();
                        insertMention(n);
                    };
                }

                els.users.appendChild(d);
            });
        }


        // Client-side flood control. Not a security boundary - anyone can write
        // to the relay directly - but it stops the UI being used to spam and
        // keeps an accidental key-repeat from filling the channel.
        const sendTimes = [];

        function isFlooding() {
            const now = Date.now();
            while (sendTimes.length && now - sendTimes[0] > FLOOD_WINDOW_MS) {
                sendTimes.shift();
            }
            return sendTimes.length >= FLOOD_MAX_MESSAGES;
        }

        function publishMessage(text, type = 'msg', forceAction = false) {
            if (!chat) return;

            // System messages (join/leave/delete) are not user-initiated.
            if (type !== 'system') {
                if (isFlooding()) {
                    addMsg('', `Slow down - max ${FLOOD_MAX_MESSAGES} messages per ${FLOOD_WINDOW_MS / 1000}s.`, true);
                    return;
                }
                sendTimes.push(Date.now());
                // First message of this chat window (shell analytics hook)
                if (!sentFirstMessage) {
                    sentFirstMessage = true;
                    if (window.track) window.track('irc_first_message');
                }
            }

            const isAction = forceAction;
            const key = Date.now() + '-' + Math.random().toString(36).substr(2, 6);
            chat.get(key).put({
                nick: myNick,
                uuid: myUUID,
                text: text,
                time: Date.now(),
                action: isAction,
                type: type
            });
            // The desktop's unread dot on the IRC icon (mavericks.js, setupIrcUnreadDot)
            if (type !== 'system' && window.SiteGun.paths.apps.ircLatest) {
                window.SiteGun.paths.apps.ircLatest(IRC_CHANNEL).put(Date.now());
            }
        }

        // /nick <name>: rename in place. Unlike logging out and back in this
        // keeps the terms acceptance, the uuid (so the colour) and the session.
        function changeNick(requested) {
            const nick = requested.trim().replace(/ /g, '_').slice(0, MAX_NICK);
            if (!nick) {
                addMsg('', 'Usage: /nick newname', true);
                return;
            }
            if (nick === myNick) return;
            if (nickTakenByOther(online, nick, myUUID)) {
                addMsg('', `"${nick}" is already in use.`, true);
                return;
            }
            const old = myNick;
            myNick = nick;
            inRoom[myUUID] = nick;
            ircStore.set('irc_nick', nick);
            els.inputNick.textContent = myNick + '>';
            announce();
            setConnectionStatus();
            addMsg('', `@${old} is now known as @${nick}`, true);
        }

        // /notify: opt in to (or out of) desktop notifications for mentions.
        // Permission is only ever requested from this explicit command.
        function toggleNotifications() {
            if (!('Notification' in window)) {
                addMsg('', 'This browser does not support notifications.', true);
                return;
            }
            let enabled = false;
            try { enabled = localStorage.getItem('irc_notify') === '1'; } catch (e) { /* ignore */ }
            if (enabled) {
                try { localStorage.setItem('irc_notify', '0'); } catch (e) { /* ignore */ }
                addMsg('', 'Mention notifications turned off.', true);
                return;
            }
            const granted = (permission) => {
                if (permission === 'granted') {
                    try { localStorage.setItem('irc_notify', '1'); } catch (e) { /* ignore */ }
                    addMsg('', 'Mention notifications turned on. /notify again to turn them off.', true);
                } else {
                    addMsg('', 'Notifications are blocked for this site in your browser settings.', true);
                }
            };
            if (Notification.permission === 'default') {
                try {
                    const req = Notification.requestPermission(granted);
                    if (req && typeof req.then === 'function') req.then(granted, () => granted('denied'));
                } catch (e) {
                    granted('denied');
                }
            } else {
                granted(Notification.permission);
            }
        }

        function send() {
            const text = getInputText().trim();
            if (!text) return;

            if (text.length > MAX_TEXT) {
                // Keep the draft so it can be shortened rather than retyped
                addMsg('', `Message too long (${text.length}/${MAX_TEXT} characters).`, true);
                updateCharCount();
                return;
            }

            setInputText('');
            updateCharCount();
            stopTyping();

            // Check for help command
            if (text === '/help' || text === '/commands') {
                const actionCmds = Object.keys(COMMANDS).sort().map(c => `/${c}`).join(', ');
                const textReplacements = Object.keys(TEXT_REPLACEMENTS).sort().map(c => `/${c}`).join(', ');

                const helpText = `### Available Commands
**Chat:**
\`/me does something, /nick newname, /clear, /notify\`

**Actions:**
\`${actionCmds}\`

**Text Shortcuts:**
\`${textReplacements}\`

*(Usage: /command or /command username)*`;
                addMsg('', helpText, true);
                return;
            }

            // Check for commands
            if (text.startsWith('/')) {
                const parts = text.slice(1).split(' ');
                const command = parts[0].toLowerCase();
                const target = parts.slice(1).join(' ').trim();

                if (command === 'me') {
                    if (target) publishMessage(target, 'msg', true);
                    else addMsg('', 'Usage: /me does something', true);
                    return;
                }

                if (command === 'nick') {
                    changeNick(target);
                    return;
                }

                if (command === 'clear') {
                    // Local only - the history is still there for everyone else
                    els.log.innerHTML = '';
                    clearUnread();
                    return;
                }

                if (command === 'notify') {
                    toggleNotifications();
                    return;
                }

                // Check for text replacement commands
                if (TEXT_REPLACEMENTS[command]) {
                    // Send the emoticon text (with optional message after)
                    const replacement = TEXT_REPLACEMENTS[command];
                    const messageText = target ? replacement + ' ' + target : replacement;
                    publishMessage(messageText);
                    return;
                }

                // Check for action commands
                if (COMMANDS[command]) {
                    const cmd = COMMANDS[command];
                    let actionText;

                    if (target) {
                        // Targeted action
                        actionText = cmd.target.replace('{target}', target);
                    } else {
                        // Solo action
                        actionText = cmd.solo;
                    }

                    // Send as action message
                    publishMessage(actionText, 'msg', true);
                    return;
                }

                // A bare /word that is not a command is almost always a typo;
                // anything else starting with a slash (a path, say) is sent.
                if (/^[a-z0-9]+$/.test(command)) {
                    addMsg('', `Unknown command /${command}. Try /help`, true);
                    return;
                }
            }

            publishMessage(text);
        }

        function formatRelativeTime(timestamp) {
            const date = new Date(timestamp || Date.now());
            const now = new Date();

            // Check if message is from today
            const isToday = date.getDate() === now.getDate() &&
                date.getMonth() === now.getMonth() &&
                date.getFullYear() === now.getFullYear();

            // Check if mobile (screen width <= 768px)
            const isMobile = window.innerWidth <= 768;

            if (isToday) {
                // Show time for today's messages
                const hours = date.getHours().toString().padStart(2, '0');
                const minutes = date.getMinutes().toString().padStart(2, '0');

                if (isMobile) {
                    // Mobile: [HH:MM] (7 chars)
                    return `[${hours}:${minutes}]`;
                } else {
                    // Desktop: [HH:MM:SS] (11 chars)
                    const seconds = date.getSeconds().toString().padStart(2, '0');
                    return `[${hours}:${minutes}:${seconds}]`;
                }
            } else {
                // Show date for messages from other days
                const day = date.getDate().toString().padStart(2, '0');
                const month = (date.getMonth() + 1).toString().padStart(2, '0');

                if (isMobile) {
                    // Mobile: [DD/MM] (7 chars)
                    return `[${day}/${month}]`;
                } else {
                    // Desktop: [DD/MM/YY] (11 chars)
                    const year = date.getFullYear().toString().slice(-2);
                    return `[${day}/${month}/${year}]`;
                }
            }
        }

        function parseMarkdown(text) {
            let parts = [{ type: 'text', content: text }];

            function splitParts(regex, type, tag) {
                for (let i = 0; i < parts.length; i++) {
                    if (parts[i].type === 'text') {
                        const match = regex.exec(parts[i].content);
                        if (match) {
                            const before = parts[i].content.substring(0, match.index);
                            const inner = match[1];
                            const after = parts[i].content.substring(match.index + match[0].length);

                            const newParts = [];
                            if (before) newParts.push({ type: 'text', content: before });
                            newParts.push({ type: type, content: inner, tag: tag });
                            if (after) newParts.push({ type: 'text', content: after });

                            parts.splice(i, 1, ...newParts);
                            i--; // Re-process to handle multiple matches
                        }
                    }
                }
            }

            // Order matters (processed sequentially)
            splitParts(/```([\s\S]+?)```/, 'pre', 'pre');
            splitParts(/`([^`]+)`/, 'code', 'code');
            splitParts(/(?:^|\n)# ([^\n]+)/, 'header', 'h1');
            splitParts(/(?:^|\n)## ([^\n]+)/, 'header', 'h2');
            splitParts(/(?:^|\n)### ([^\n]+)/, 'header', 'h3');
            splitParts(/(?:^|\n)> ([^\n]+)/, 'quote', 'blockquote');
            splitParts(/\*\*([^*]+)\*\*/, 'bold', 'strong');
            splitParts(/__([^_]+)__/, 'bold', 'strong');
            splitParts(/\*([^*]+)\*/, 'italic', 'em');
            splitParts(/(?<!@\w*)_([^_]+)_/, 'italic', 'em');
            splitParts(/~~([^~]+)~~/, 'strike', 's');

            return parts;
        }

        // Helper to render text with mentions and markdown
        function renderMessageText(containerEl, text) {
            // Add indentation for multiline messages
            // Calculate padding: [HH:MM:SS] (11) + space (1) + | (1) + space (1) + username (10) = 24 chars (aligns with '>')
            // const INDENT_PADDING = ' '.repeat(24);

            // Replace newlines with newline + padding (except for code blocks which preserve formatting)
            // const indentedText = text.replace(/\n/g, '\n' + INDENT_PADDING);

            // First, parse markdown structure (blocks, bold, code, etc.)
            const mdParts = parseMarkdown(text);

            mdParts.forEach(mdp => {
                let targetEl = containerEl;
                let content = mdp.content;

                if (mdp.type === 'text') {
                    // Plain text, directly in container
                } else {
                    // Wrapper element
                    const el = document.createElement(mdp.tag);
                    if (mdp.type === 'quote') el.className = 'irc-quote';

                    targetEl = el;
                    containerEl.appendChild(el);

                    if (mdp.type === 'pre') {
                        const code = document.createElement('code');
                        code.textContent = content;
                        el.appendChild(code);
                        return;
                    } else if (mdp.type === 'code') {
                        targetEl.textContent = content; // No mentions in inline code
                        return;
                    }
                }

                // Process mentions within the content (except for code/pre which returned above)
                const mentionParts = parseAndColorMentions(content);
                mentionParts.forEach(part => {
                    if (part.type === 'text') {
                        targetEl.appendChild(document.createTextNode(part.content));
                    } else if (part.type === 'mention') {
                        const mentionSpan = document.createElement('span');
                        mentionSpan.className = 'irc-mention';
                        mentionSpan.textContent = part.content;

                        if (part.uuid) {
                            mentionSpan.style.color = uuidToColor(part.uuid);
                            mentionSpan.style.fontWeight = '600';
                        }

                        if (part.nick !== myNick) {
                            mentionSpan.style.cursor = 'pointer';
                            mentionSpan.onclick = (e) => {
                                e.stopPropagation();
                                insertMention(part.nick);
                            };
                        }

                        targetEl.appendChild(mentionSpan);
                    }
                });
            });
        }

        function addMsg(nick, text, isSystem, isAction, timestamp, userUuid, msgType, key) {
            // Determine the full text to display immediately for deduplication using consistent logic
            let fullText;
            if (isSystem && nick) {
                fullText = '@' + nick + ' ' + text;
            } else if (isAction) {
                fullText = '@' + nick + ' ' + text;
            } else {
                fullText = text;
            }

            // Check if this is a GIF message
            const isGif = msgType === 'gif';

            // Collapse consecutive duplicate join/leave messages
            const isJoinLeave = isSystem && (text.includes('entered the room') || text.includes('left the room'));

            // Skip old join/leave messages (before user joined)
            if (isJoinLeave) {
                const msgTime = timestamp || Date.now();
                const isOldMessage = msgTime < joinTime;

                if (isOldMessage) {
                    // Don't display old join/leave messages
                    return;
                }

                // Check last message in the log to see if it's the same user + action
                const lastChild = els.log.lastElementChild;
                if (lastChild) {
                    const lastMsg = lastChild.querySelector('.irc-msg-text');
                    const lastNickEl = lastChild.querySelector('.irc-msg-nick .irc-nick-text');

                    // Get the last message's nickname (trim spaces from padding)
                    const lastNick = lastNickEl?.textContent?.trim();
                    const currentNick = (isSystem ? 'system' : nick).trim();

                    // If last message is same user doing same action, skip this duplicate
                    if (lastNick === currentNick && lastMsg?.textContent?.trim() === fullText?.trim()) {
                        debugLog(`[IRC] Skipping duplicate ${text} for ${nick}`);
                        return;
                    }
                }
            }

            // Check if this message mentions the current user (and is not from self)
            const mentionsMe = !isSystem && nick !== myNick && myNick && text.toLowerCase().includes('@' + myNick.toLowerCase());

            const row = document.createElement('div');
            const isLeave = isSystem && text.includes('left the room');
            row.className = 'irc-msg' + (isLeave ? ' leave' : isSystem ? ' system' : '') + (isAction ? ' action' : '') + (mentionsMe ? ' mentioned' : '');
            if (key) row.id = 'msg-' + key;

            // Format timestamp as relative time
            const timeEl = document.createElement('div');
            timeEl.className = 'irc-msg-time';
            timeEl.textContent = formatRelativeTime(timestamp);
            // Store timestamp for updates
            timeEl.dataset.timestamp = timestamp || Date.now();

            const nickEl = document.createElement('div');
            nickEl.className = 'irc-msg-nick';
            const displayNick = isSystem ? 'system' : nick;
            // Ensure username is exactly 10 characters: truncate if longer, right-align if shorter
            const truncatedNick = displayNick.substring(0, 10);
            const paddedNick = truncatedNick.padStart(10, ' ');

            // Create structure: pipe (not italic) + nickname + angle bracket (not italic)
            const pipeSpan = document.createElement('span');
            pipeSpan.className = 'irc-nick-pipe';
            pipeSpan.textContent = '| ';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'irc-nick-text';
            nameSpan.textContent = paddedNick;

            const angleSpan = document.createElement('span');
            angleSpan.className = 'irc-nick-angle';
            angleSpan.textContent = '> ';

            nickEl.appendChild(pipeSpan);
            nickEl.appendChild(nameSpan);
            nickEl.appendChild(angleSpan);

            // Apply color to nickname based on UUID
            if (!isSystem && nick) {
                // Try to get UUID from multiple sources (message, online users, or self)
                let uuid = null;
                if (nick === myNick) {
                    uuid = myUUID;
                } else if (userUuid) {
                    uuid = userUuid;
                } else {
                    uuid = getUuidForNick(nick);
                }

                if (uuid) {
                    nameSpan.style.color = uuidToColor(uuid);
                }

                // Make clickable to insert mention (except for self and system)
                if (nick !== myNick) {
                    nickEl.style.cursor = 'pointer';
                    nickEl.onclick = (e) => {
                        e.stopPropagation();
                        insertMention(nick);
                    };
                }
            }

            const textEl = document.createElement('div');
            textEl.className = 'irc-msg-text';

            // Handle GIF messages
            if (isGif && !isAllowedGifUrl(text)) {
                // A "GIF" that is not an https URL on the Klipy media host is
                // some peer trying to make every reader's browser fetch an
                // arbitrary address. Never load it, never link it.
                const blocked = document.createElement('span');
                blocked.className = 'irc-msg-blocked';
                blocked.textContent = '[blocked link]';
                textEl.appendChild(blocked);
            } else if (isGif) {
                const gifContainer = document.createElement('div');
                gifContainer.className = 'irc-gif-container';

                // A real link (not window.open on untrusted text): opens in a
                // new tab, never in a proxied desktop window.
                const gifLink = document.createElement('a');
                gifLink.className = 'irc-gif-link';
                gifLink.href = text;
                gifLink.target = '_blank';
                gifLink.rel = 'noopener noreferrer';
                gifLink.dataset.open = 'tab';
                gifLink.title = 'Open GIF in a new tab';
                gifLink.addEventListener('click', (e) => e.stopPropagation());

                const gifImg = document.createElement('img');
                gifImg.referrerPolicy = 'no-referrer';
                gifImg.src = text;
                gifImg.className = 'irc-msg-gif';
                gifImg.alt = 'GIF from ' + nick;
                gifImg.loading = 'lazy';
                // Only chase the bottom if the reader is already there
                gifImg.onload = () => { if (isPinnedToBottom(true)) scrollToBottom(); };

                gifLink.appendChild(gifImg);
                gifContainer.appendChild(gifLink);
                textEl.appendChild(gifContainer);

                // No receiver-side classification: the URL is pinned to the
                // Klipy media host, and readers who want more can keep GIFs
                // blurred until clicked (GIF picker > "Blur GIFs in chat").
                if (blurGifs) blurGif(gifContainer);
            } else {
                // Determine the full text to display
                // fullText is now calculated at top of function

                // Render with markdown and mentions
                renderMessageText(textEl, fullText);
            }

            row.appendChild(timeEl);
            row.appendChild(nickEl);
            row.appendChild(textEl);

            // Delete button on your own messages only. This is a UI courtesy,
            // not access control: rows are unsigned, so a peer writing to the
            // relay directly can still overwrite any key.
            if (!isSystem && key && userUuid && userUuid === myUUID) {
                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.setAttribute('aria-label', 'Delete message');
                delBtn.className = 'irc-delete-btn';
                delBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
                delBtn.title = 'Delete message';
                delBtn.onclick = (e) => {
                    e.stopPropagation();
                    confirmSheet('Delete this message?', 'It will be replaced by a system message for everyone in the channel.', {
                        confirmLabel: 'Delete',
                        danger: true
                    }).then((ok) => {
                        if (ok) deleteMessage(key, nick);
                    });
                };
                row.appendChild(delBtn);
            }

            // Was the reader at the bottom BEFORE this message landed? Decided
            // up front, because inserting changes scrollHeight.
            const wasPinned = isPinnedToBottom();

            // Insert in chronological order
            const msgTime = timestamp || Date.now();
            const existingRows = els.log.children;
            let inserted = false;

            for (let i = existingRows.length - 1; i >= 0; i--) {
                const el = existingRows[i];
                const timeEl = el.querySelector('.irc-msg-time');
                const t = timeEl ? parseInt(timeEl.dataset.timestamp) : 0;

                if (msgTime >= t) {
                    // New message is newer/same as this one, insert after
                    if (i === existingRows.length - 1) {
                        els.log.appendChild(row);
                    } else {
                        els.log.insertBefore(row, existingRows[i + 1]);
                    }
                    inserted = true;
                    break;
                }
            }

            if (!inserted) {
                // Older than everything, insert at top
                if (existingRows.length > 0) {
                    els.log.insertBefore(row, existingRows[0]);
                } else {
                    els.log.appendChild(row);
                }
            }

            // Play notification sound if mentioned (only for new messages, not old ones on load)
            const messageTime = timestamp || Date.now();
            const isNewMessage = messageTime >= joinTime;

            if (mentionsMe && isNewMessage) {
                playNotificationSound();
            }

            while (els.log.children.length > MAX_MESSAGES) els.log.removeChild(els.log.firstChild);

            if (wasPinned) {
                scrollToBottom();
                // Again after layout settles (images, wrapped text)
                setTimeout(() => { if (isPinnedToBottom(true)) scrollToBottom(); }, 100);
            } else if (isNewMessage && !isSystem) {
                // Reader is up in the history - do not yank them down.
                unreadCount++;
                updateUnreadPill();
            }

            if (mentionsMe && isNewMessage) {
                unreadMentions++;
                updateWindowBadge();
                notifyMention(nick, isGif ? 'sent a GIF' : text);
            }
        }

        function blurGif(container) {
            if (container.classList.contains('nsfw-blurred')) return;
            container.classList.add('nsfw-blurred');
            const link = container.querySelector('.irc-gif-link');
            if (link) link.tabIndex = -1;

            const overlay = document.createElement('button');
            overlay.type = 'button';
            overlay.className = 'irc-gif-nsfw-overlay';
            overlay.innerHTML = '<strong>GIF hidden</strong><small>Click to reveal</small>';
            overlay.addEventListener('click', (e) => {
                e.stopPropagation();
                revealGif(container);
            });
            overlay.addEventListener('mousedown', (e) => e.stopPropagation());
            container.appendChild(overlay);
        }

        function revealGif(container) {
            container.classList.remove('nsfw-blurred');
            const link = container.querySelector('.irc-gif-link');
            if (link) link.removeAttribute('tabindex');
            const overlay = container.querySelector('.irc-gif-nsfw-overlay');
            if (overlay) overlay.remove();
        }

        // Desktop notification for a mention, only after an explicit /notify
        // opt-in and only while the tab is in the background.
        function notifyMention(fromNick, body) {
            if (document.visibilityState === 'visible') return;
            if (!('Notification' in window) || Notification.permission !== 'granted') return;
            try {
                if (localStorage.getItem('irc_notify') !== '1') return;
                const n = new Notification(`${fromNick} mentioned you in #${IRC_CHANNEL}`, {
                    body: String(body).slice(0, 140),
                    tag: 'irc-mention',
                    icon: '/pfp.png'
                });
                n.onclick = () => {
                    window.focus();
                    n.close();
                };
            } catch (e) {
                // Constructor throws on some mobile browsers - the beep and
                // title prefix still fire.
            }
        }

        const PIN_TOLERANCE_PX = 48;

        /** True when the log is scrolled to (or very near) the newest message. */
        function isPinnedToBottom(loose) {
            const el = els.log;
            const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
            return distance <= (loose ? PIN_TOLERANCE_PX * 4 : PIN_TOLERANCE_PX);
        }

        function scrollToBottom() {
            els.log.scrollTop = els.log.scrollHeight;
        }

        function updateUnreadPill() {
            if (!unreadPill) return;
            if (unreadCount <= 0) {
                unreadPill.hidden = true;
                return;
            }
            unreadPill.hidden = false;
            unreadPill.querySelector('.irc-unread-count').textContent =
                unreadCount === 1 ? '1 new message' : `${unreadCount} new messages`;
        }

        function clearUnread() {
            unreadCount = 0;
            updateUnreadPill();
        }

        /** Mention badge on the window title, visible when IRC is not focused. */
        function updateWindowBadge() {
            const titleEl = win.querySelector('.window-title-text');
            if (!titleEl) return;
            if (!baseWindowTitle) baseWindowTitle = titleEl.textContent;

            const isForeground = !win.classList.contains('inactive')
                && win.style.display !== 'none'
                && document.visibilityState === 'visible';

            if (isForeground || unreadMentions === 0) {
                unreadMentions = 0;
                titleEl.textContent = baseWindowTitle;
            } else {
                titleEl.textContent = `${baseWindowTitle} (${unreadMentions})`;
            }

            updateTabTitle();

            const chip = document.querySelector(`.menubar-min-chip[data-tray-for="irc-chat"] .menubar-min-label`);
            if (chip && baseWindowTitle) {
                chip.textContent = unreadMentions > 0
                    ? `${baseWindowTitle} (${unreadMentions})`
                    : baseWindowTitle;
            }
        }

        // "(n) " mention prefix on the browser tab while it is in the
        // background. The shell owns document.title, so this only ever adds or
        // strips its own prefix around whatever the title currently is.
        function updateTabTitle() {
            const current = document.title.replace(/^\(\d+\) /, '');
            const next = unreadMentions > 0 && document.visibilityState !== 'visible'
                ? `(${unreadMentions}) ${current}`
                : current;
            if (next !== document.title) document.title = next;
        }

        function updateMsg(key, m) {
            const row = document.getElementById('msg-' + key);
            if (!row) return;

            // Check if type changed to system (deletion)
            const isSystem = m.type === 'system';
            const isLeave = isSystem && m.text.includes('left the room');
            const isAction = m.action;

            // Re-apply classes
            row.className = 'irc-msg' + (isLeave ? ' leave' : isSystem ? ' system' : '') + (isAction ? ' action' : '');

            // Re-build content, especially text
            // Ideally we should reuse addMsg logic but it creates a new element.
            // For simplicity, we'll just update the text part for deletions.

            const textEl = row.querySelector('.irc-msg-text');
            const nickEl = row.querySelector('.irc-msg-nick');

            if (isSystem) {
                // If it became a system message (deleted), update nick and style
                if (nickEl) {
                    const truncatedNick = 'system'.substring(0, 10);
                    const paddedNick = truncatedNick.padStart(10, ' ');

                    // Rebuild nickname structure
                    nickEl.innerHTML = '';

                    const pipeSpan = document.createElement('span');
                    pipeSpan.className = 'irc-nick-pipe';
                    pipeSpan.textContent = '| ';

                    const nameSpan = document.createElement('span');
                    nameSpan.className = 'irc-nick-text';
                    nameSpan.textContent = paddedNick;

                    const angleSpan = document.createElement('span');
                    angleSpan.className = 'irc-nick-angle';
                    angleSpan.textContent = '> ';

                    nickEl.appendChild(pipeSpan);
                    nickEl.appendChild(nameSpan);
                    nickEl.appendChild(angleSpan);

                    nickEl.style.cursor = 'default';
                    nickEl.onclick = null;
                }
                if (textEl) {
                    // Reconstruct fullText logic to match addMsg
                    // For join/leave, nick is the user. For deleted, nick is 'system'.
                    let fullText = m.text;
                    if (m.nick && m.nick !== 'system' && (m.text.includes('entered the room') || m.text.includes('left the room'))) {
                        fullText = '@' + m.nick + ' ' + m.text;
                    }

                    // Clear previous content
                    textEl.innerHTML = '';

                    // Render with markdown and mentions
                    renderMessageText(textEl, fullText);

                    // Only apply specific styles for "deleted" messages (generic system messages)
                    // Join/Leave messages should inherit from CSS classes
                    if (m.text.includes('entered the room') || m.text.includes('left the room')) {
                        textEl.style.color = '';
                        textEl.style.fontStyle = '';
                    } else {
                        textEl.style.color = 'var(--text-tertiary)'; // Grey for deleted/system, themed
                        textEl.style.fontStyle = 'italic';
                    }
                }

                // Remove delete button if it exists
                const delBtn = row.querySelector('.irc-delete-btn');
                if (delBtn) delBtn.remove();
            }
        }

        function deleteMessage(key, originalNick) {
            if (!chat || !myNick) return;

            // "anyone can delete anyones message"
            // "replaced by a system message that says @username deleted @usernames message"

            const deleteText = `@${myNick} deleted @${originalNick}'s message`;

            chat.get(key).put({
                nick: 'system',
                uuid: null,
                text: deleteText,
                time: Date.now(),
                action: false,
                type: 'system'
            });
        }

        root.onclick = e => {
            // Close GIF picker if clicking outside of it
            if (!els.gifPicker.classList.contains('hidden') &&
                !els.gifPicker.contains(e.target) &&
                e.target !== els.gifBtn) {
                closeGifPicker();
            }

            // Clicking empty chat space focuses the message box. Not for
            // keyboard-activated controls (detail 0), other controls, or while
            // text in the log is selected - each of those lost its focus or
            // its selection to the message box before.
            if (els.prompt.classList.contains('hidden') &&
                e.detail !== 0 &&
                !e.target.closest('input, button, a, label') &&
                !String(window.getSelection()).trim()) {
                els.msgInput.focus();
            }
        };

        // Expose cleanup function for when window is closed.
        // Must release everything connect() registered - the window element is
        // discarded, but intervals and Gun subscriptions would otherwise keep
        // running against detached DOM for the rest of the session.
        win.ircCleanup = function () {
            if (myNick && presence && chat && !hasLeft) {
                hasLeft = true;
                presence.get(myUUID).put(null);
            }
            teardownConnection();
            // Document/window listeners, which teardownConnection does not own
            lifecycle.abort();
            clearTimeout(resizeTimeout);
            if (logResizeObserver) logResizeObserver.disconnect();
            unreadMentions = 0;
            updateTabTitle();
        };
    }

    window.initIRCChat = initIRC;
})();
