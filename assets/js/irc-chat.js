/**
 * IRC Chat - Gun.js powered real-time chat
 */
(function () {
    'use strict';

    const GUN_RELAY = "https://arweave.tech/gun";
    const CHANNEL = "ankush-irc-general";
    const MAX_MESSAGES = 69;
    const PRESENCE_TIMEOUT = 10000;
    const TENOR_API_KEY = "AIzaSyCWXyv4rNfkoSA-mNYdQZh8KlX3lDCgakc"; // Tenor API key (public demo key)

    // Generate a UUID v4
    function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // Generate deterministic color from UUID
    function uuidToColor(uuid) {
        if (!uuid) return '#2980b9';

        // Use the UUID to generate a hash
        let hash = 0;
        for (let i = 0; i < uuid.length; i++) {
            hash = uuid.charCodeAt(i) + ((hash << 5) - hash);
        }

        // Generate HSL color with good saturation and lightness for readability
        const hue = Math.abs(hash % 360);
        const saturation = 60 + (Math.abs(hash >> 8) % 20); // 60-80%
        const lightness = 35 + (Math.abs(hash >> 16) % 15); // 35-50% (dark enough to read)

        return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
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

    let gunLoaded = false;
    let gunLoadPromise = null;

    function loadGun() {
        if (gunLoaded) return Promise.resolve();
        if (gunLoadPromise) return gunLoadPromise;
        gunLoadPromise = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/gun/gun.min.js';
            s.onload = () => { gunLoaded = true; resolve(); };
            s.onerror = reject;
            document.head.appendChild(s);
        });
        return gunLoadPromise;
    }

    // NSFW.js loading
    let nsfwModel = null;
    let nsfwLoadPromise = null;
    const nsfwCache = new Map(); // Cache NSFW check results by URL

    // Load omggif for GIF frame extraction
    let omggifLoaded = false;
    let omggifLoadPromise = null;

    async function loadOmggif() {
        if (omggifLoaded) return Promise.resolve();
        if (omggifLoadPromise) return omggifLoadPromise;

        omggifLoadPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/omggif@1.0.10/omggif.min.js';
            script.onload = () => {
                omggifLoaded = true;
                console.log('[NSFW] omggif loaded, available:', typeof window.GifReader);
                resolve();
            };
            script.onerror = reject;
            document.head.appendChild(script);
        });

        return omggifLoadPromise;
    }

    // Extract key frames from GIF (first, middle, last)
    async function extractGifFrames(gifUrl) {
        try {
            await loadOmggif();

            if (typeof window.GifReader === 'undefined') {
                console.error('[NSFW] GifReader not available');
                return [];
            }

            // Fetch the GIF data
            const response = await fetch(gifUrl);
            const arrayBuffer = await response.arrayBuffer();
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

            console.log(`[NSFW] GIF has ${numFrames} frames, checking ${framesToCheck} frames at interval ${interval}`);

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

            for (const idx of indices) {
                // Decode frame
                const frameInfo = reader.frameInfo(idx);
                const pixels = new Uint8ClampedArray(reader.width * reader.height * 4);
                reader.decodeAndBlitFrameRGBA(idx, pixels);

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
                    await new Promise((resolve, reject) => {
                        const tfScript = document.createElement('script');
                        tfScript.src = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@latest/dist/tf.min.js';
                        tfScript.onload = resolve;
                        tfScript.onerror = reject;
                        document.head.appendChild(tfScript);
                    });
                }

                // Load NSFW.js
                if (!window.nsfwjs) {
                    await new Promise((resolve, reject) => {
                        const nsfwScript = document.createElement('script');
                        nsfwScript.src = 'https://cdn.jsdelivr.net/npm/nsfwjs@latest/dist/nsfwjs.min.js';
                        nsfwScript.onload = resolve;
                        nsfwScript.onerror = reject;
                        document.head.appendChild(nsfwScript);
                    });
                }

                // Set TensorFlow backend to GPU (as recommended in minimal demo)
                // https://github.com/tensorflow/tfjs/issues/1644
                if (window.tf) {
                    await window.tf.setBackend('webgl');
                    await window.tf.ready();
                    console.log('[NSFW] TensorFlow backend set to:', window.tf.getBackend());
                }

                // Load the self-hosted MobileNetV2Mid model as graph type
                // Model files (model.json and shards) are served from /static/models/nsfwjs/
                console.log('[NSFW] Loading model from /models/nsfwjs/ with type: graph');
                nsfwModel = await window.nsfwjs.load('/models/nsfwjs/', { type: 'graph' });
                console.log('[NSFW] Model loaded successfully!', nsfwModel);
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
            console.log('[NSFW] Using cached result for:', imageUrl);
            return nsfwCache.get(imageUrl);
        }

        console.log('[NSFW] Checking image:', imageUrl);

        try {
            const model = await loadNSFWModel();

            // Check if this is a GIF
            const isGif = imageUrl.toLowerCase().match(/\.gif(\?|$)/);

            if (isGif) {
                console.log('[NSFW] Detected GIF, extracting key frames...');

                // Try to extract and check key frames (first, middle, last)
                const keyFrames = await extractGifFrames(imageUrl);

                if (keyFrames.length > 0) {
                    // Check each key frame - check from end to start (bottom to top)
                    // GIF "money shots" or NSFW content often appears at the end
                    keyFrames.reverse();

                    for (const { img, frameNumber } of keyFrames) {
                        console.log(`[NSFW] Classifying frame ${frameNumber}...`);
                        const predictions = await model.classify(img);
                        const evaluation = evaluatePredictions(predictions);

                        console.log(`[NSFW] Frame ${frameNumber}:`, evaluation.isNSFW ? '🚫 BLOCKED' : '✅ SAFE', {
                            drawing: `${(evaluation.scores.drawing * 100).toFixed(1)}%`,
                            hentai: `${(evaluation.scores.hentai * 100).toFixed(1)}%`,
                            neutral: `${(evaluation.scores.neutral * 100).toFixed(1)}%`,
                            porn: `${(evaluation.scores.porn * 100).toFixed(1)}%`,
                            sexy: `${(evaluation.scores.sexy * 100).toFixed(1)}%`,
                            violations: evaluation.violations.length > 0 ? evaluation.violations : 'none'
                        });

                        // If any frame is NSFW, block the entire GIF
                        if (evaluation.isNSFW) {
                            console.log(`[NSFW] GIF BLOCKED due to frame ${frameNumber}`, {
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
                    console.log('[NSFW] All frames safe ✅');
                    const result = { isNSFW: false, predictions: [], reason: null };
                    nsfwCache.set(imageUrl, result);
                    return result;
                } else {
                    console.log('[NSFW] Frame extraction failed, falling back to single-frame check');
                    // Fall through to single image check
                }
            }

            // Single image check (non-GIF or GIF frame extraction failed)
            const img = new Image();
            img.crossOrigin = 'anonymous';

            const result = await new Promise((resolve, reject) => {
                img.onload = async () => {
                    try {
                        console.log('[NSFW] Image loaded, classifying...');
                        const predictions = await model.classify(img);
                        const evaluation = evaluatePredictions(predictions);

                        console.log('[NSFW] Predictions:', predictions);
                        console.log('[NSFW] Decision:', evaluation.isNSFW ? '🚫 BLOCKED' : '✅ SAFE', {
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
                    console.warn('[NSFW] Image failed to load (CORS or network issue), allowing by default');
                    // If image fails to load (CORS issues, etc.), allow it
                    // Better to allow some potential NSFW than block all GIFs
                    resolve({ isNSFW: false, predictions: [], reason: null });
                };

                img.src = imageUrl;
            });

            // Cache the result
            nsfwCache.set(imageUrl, result);
            return result;
        } catch (e) {
            console.error('[NSFW] Check failed:', e);
            // If NSFW check fails, allow the image (fail open)
            const result = { isNSFW: false, predictions: [], reason: null };
            nsfwCache.set(imageUrl, result);
            return result;
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
            termsInput: root.querySelector('.irc-nick-dialog input[type="checkbox"]')
        };

        let gun, chat, presence;
        let myNick = '';
        let myUUID = '';
        let seen = new Set();
        let online = {}; // Maps nick -> {nick, uuid, status, lastSeen}
        let uuidCache = {}; // Maps nick -> uuid (persists even when offline)
        let presenceInt = null;
        let hasLeft = false;
        let recentLeaves = new Set(); // Track recent leave broadcasts to prevent duplicates
        let lastSystemMsg = {}; // Track last system message per user to collapse duplicates
        let joinTime = 0; // Track when user joined to avoid notifying for old messages
        let lastCursorPos = 0; // Track last known cursor position
        const nsfwQueue = []; // Queue for NSFW checks
        let isProcessingQueue = false; // Flag for queue processing

        async function processNSFWQueue() {
            if (isProcessingQueue) return;
            if (nsfwQueue.length === 0) return;

            isProcessingQueue = true;

            try {
                // Sort queue by timestamp descending (newest first)
                nsfwQueue.sort((a, b) => b.timestamp - a.timestamp);

                // Process items one by one
                while (nsfwQueue.length > 0) {
                    const item = nsfwQueue.shift(); // Take the highest priority item
                    const { url, onSuccess, onFailure } = item;

                    try {
                        const result = await checkImageNSFW(url);
                        onSuccess(result);
                    } catch (e) {
                        onFailure(e);
                    }

                    // Small delay to allow UI updates and prevent freezing
                    await new Promise(r => setTimeout(r, 50));
                }
            } finally {
                isProcessingQueue = false;
            }
        }

        // Events
        els.nickBtn.addEventListener('click', join);
        els.logoutBtn.addEventListener('click', logout);
        els.gifBtn.addEventListener('click', toggleGifPicker);
        els.gifClose.addEventListener('click', closeGifPicker);

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

        // Mobile: Toggle user list when clicking "Online" header
        els.onlineHeader.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                els.users.parentElement.classList.toggle('mobile-visible');
            }
        });

        // Mobile: Close user list when clicking outside of it
        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 768) {
                const usersCol = els.users.parentElement;
                if (usersCol.classList.contains('mobile-visible') &&
                    !usersCol.contains(e.target) &&
                    !els.onlineHeader.contains(e.target)) {
                    usersCol.classList.remove('mobile-visible');
                }
            }
        });

        // Mobile: Close GIF picker when clicking outside (only on mobile)
        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 768) {
                if (!els.gifPicker.classList.contains('hidden') &&
                    !els.gifPicker.contains(e.target) &&
                    !els.gifBtn.contains(e.target)) {
                    closeGifPicker();
                }
            }
        });


        // Update timestamps when switching between mobile and desktop
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                // Refresh all timestamps
                els.log.querySelectorAll('.irc-msg-time').forEach(timeEl => {
                    const timestamp = parseInt(timeEl.dataset.timestamp);
                    if (timestamp) {
                        timeEl.textContent = formatRelativeTime(timestamp);
                    }
                });
            }, 250); // Debounce for 250ms
        });

        // Play notification sound (Discord-like)
        function playNotificationSound() {
            try {
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();

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
                const endpoint = query
                    ? `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}&key=${TENOR_API_KEY}&client_key=irc-chat&limit=20`
                    : `https://tenor.googleapis.com/v2/featured?key=${TENOR_API_KEY}&client_key=irc-chat&limit=20`;

                const response = await fetch(endpoint);
                const data = await response.json();

                els.gifResults.innerHTML = '';

                if (data.results && data.results.length > 0) {
                    data.results.forEach(gif => {
                        const gifItem = document.createElement('div');
                        gifItem.className = 'irc-gif-item';

                        const img = document.createElement('img');
                        img.src = gif.media_formats.tinygif.url;
                        img.alt = gif.content_description || 'GIF';

                        gifItem.appendChild(img);
                        gifItem.onclick = () => sendGif(gif.media_formats.gif.url);

                        els.gifResults.appendChild(gifItem);
                    });
                } else {
                    els.gifResults.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 20px; color: #999;">No GIFs found</div>';
                }
            } catch (e) {
                console.error('Failed to fetch GIFs:', e);
                els.gifResults.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 20px; color: #e74c3c;">Failed to load GIFs</div>';
            }
        }

        async function sendGif(gifUrl) {
            if (!chat || !myNick) return;

            // Show loading state
            const loadingMsg = document.createElement('div');
            loadingMsg.style.cssText = 'grid-column: 1/-1; text-align: center; padding: 20px; color: #5a9;';
            loadingMsg.textContent = 'Checking GIF...';
            els.gifResults.innerHTML = '';
            els.gifResults.appendChild(loadingMsg);

            try {
                // Check if GIF is NSFW
                const result = await checkImageNSFW(gifUrl);

                if (result.isNSFW) {
                    // Show error message
                    els.gifResults.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 20px; color: #e74c3c;">
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

                // GIF is safe, send it
                publishMessage(gifUrl, 'gif');
                closeGifPicker();
            } catch (e) {
                console.error('Error checking GIF:', e);
                // If check fails, allow the GIF (fail open)
                publishMessage(gifUrl, 'gif');
                closeGifPicker();
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
            if (online[nick] && online[nick].uuid) return online[nick].uuid;
            // Check cache for offline users
            if (uuidCache[nick]) return uuidCache[nick];
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

            // Handle Tab key in message input
            if (e.key === 'Tab' && e.target === els.msgInput) {
                e.preventDefault();
                insertTextAtCursor('\t');
                // Update colors and cursor position after tab insertion
                lastCursorPos = getCursorPosition();
                updateInputColors();
                return;
            }

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
            const text = (e.clipboardData || window.clipboardData).getData('text/plain');

            if (text) {
                // Insert text at cursor position
                insertTextAtCursor(text);
                // Update colors and cursor position after paste
                lastCursorPos = getCursorPosition();
                updateInputColors();
            }
        });

        // Update colors as user types in contenteditable
        els.msgInput.addEventListener('input', () => {
            updateInputColors();
            lastCursorPos = getCursorPosition();
        });

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

        // Load saved nick and auto-join if present
        let savedNick = localStorage.getItem('irc_nick');
        const termsAccepted = localStorage.getItem('irc_tos_accepted');

        // Replace spaces with underscores in saved nickname
        if (savedNick) {
            const sanitizedNick = savedNick.replace(/ /g, '_');
            if (sanitizedNick !== savedNick) {
                // Update localStorage with sanitized version
                localStorage.setItem('irc_nick', sanitizedNick);
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
                alert('You must accept the content warning to join.');
                return;
            }

            // Save nick and terms acceptance
            localStorage.setItem('irc_nick', nick);
            localStorage.setItem('irc_tos_accepted', 'true');

            // Get or generate UUID
            let uuid = localStorage.getItem('irc_uuid');
            if (!uuid) {
                uuid = generateUUID();
                localStorage.setItem('irc_uuid', uuid);
            }

            myNick = nick;
            myUUID = uuid;
            lastCursorPos = 0;
            els.prompt.classList.add('hidden');
            els.inputNick.textContent = myNick + '>';
            els.inputNick.style.color = uuidToColor(myUUID); // Apply user's color
            els.msgInput.setAttribute('contenteditable', 'true');
            els.msgInput.setAttribute('data-placeholder', 'Write to #general (Shift+Enter for newline)');
            els.msgInput.focus();
            els.logoutBtn.style.display = 'flex'; // Show logout button
            els.gifBtn.disabled = false; // Enable GIF button
            loadGun().then(connect).catch(() => addMsg('', 'Failed to load Gun.js', true));
        }

        function logout() {
            if (!myNick) return;

            // Broadcast leave message
            if (chat && presence && !hasLeft) {
                hasLeft = true;
                publishMessage('left the room', 'system');
                presence.get(myNick).put(null);
                if (presenceInt) clearInterval(presenceInt);
            }

            // Clear localStorage
            localStorage.removeItem('irc_nick');
            localStorage.removeItem('irc_tos_accepted');

            // Reset UI
            myNick = '';
            seen.clear();
            online = {};
            uuidCache = {};
            hasLeft = false;
            recentLeaves.clear();
            lastSystemMsg = {};
            joinTime = 0;
            lastCursorPos = 0;

            els.log.innerHTML = '';
            els.users.innerHTML = '';
            els.prompt.classList.remove('hidden');
            els.nickInput.value = '';
            els.termsInput.checked = false;
            els.nickBtn.disabled = true;
            els.msgInput.setAttribute('contenteditable', 'false');
            els.msgInput.textContent = '';
            els.msgInput.setAttribute('data-placeholder', 'Type a message (Shift+Enter for newline)...');
            els.inputNick.textContent = 'guest>';
            els.inputNick.style.color = '#333'; // Reset to default color
            els.status.textContent = 'Connecting...';
            els.logoutBtn.style.display = 'none'; // Hide logout button
            els.gifBtn.disabled = true; // Disable GIF button
            closeGifPicker(); // Close GIF picker if open

            // Focus nickname input
            setTimeout(() => els.nickInput.focus(), 50);
        }

        function connect() {
            gun = Gun({ peers: [GUN_RELAY] });
            chat = gun.get(CHANNEL + '-messages');
            presence = gun.get(CHANNEL + '-presence');

            // Mark join time to avoid notifying for old messages
            joinTime = Date.now();

            els.log.innerHTML = '';

            chat.map().on((data, key) => {
                if (!data) return;

                let m;
                try {
                    m = typeof data === 'string' ? JSON.parse(data) : data;
                } catch (e) { return; }

                if (!m || !m.nick || !m.text) return;

                // Cache UUID from message
                if (m.uuid && m.nick) {
                    uuidCache[m.nick] = m.uuid;
                }

                if (seen.has(key)) {
                    // Update existing message
                    updateMsg(key, m);
                    return;
                }
                seen.add(key);

                // Filter old join/leave messages (older than 5 minutes)
                const isSysMsg = m.type === 'system';
                const isJoinLeave = isSysMsg && (m.text.includes('entered the room') || m.text.includes('left the room'));
                const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);

                if (isJoinLeave && m.time && m.time < fiveMinutesAgo) {
                    return; // Skip old join/leave messages
                }

                addMsg(m.nick, m.text, isSysMsg, m.action, m.time, m.uuid, m.type, key);
            });

            announce();
            // Faster heartbeat (5s) for responsiveness
            if (presenceInt) clearInterval(presenceInt);
            presenceInt = setInterval(announce, 5000);

            // Broadcast join message after a brief delay (let presence sync first)
            setTimeout(() => {
                publishMessage('entered the room', 'system');
            }, 500);

            // Remove presence on unload
            window.addEventListener('beforeunload', () => {
                if (myNick && presence && !hasLeft) {
                    hasLeft = true;
                    publishMessage('left the room', 'system');
                    presence.get(myNick).put(null);
                    if (presenceInt) clearInterval(presenceInt);
                }
            });

            presence.map().on((data, key) => {
                // If data is null/undefined, user logic: user is gone
                if (!data) {
                    if (online[key]) {
                        const leftNick = online[key].nick;
                        delete online[key];
                        updateUsers();

                        // Prevent duplicate leave broadcasts from multiple clients
                        if (recentLeaves.has(leftNick)) return;
                        recentLeaves.add(leftNick);

                        // Broadcast leave message with delay (give the leaving client time to broadcast first)
                        setTimeout(() => {
                            if (chat && myNick && leftNick) {
                                const leaveKey = Date.now() + '-leave-' + leftNick;
                                chat.get(leaveKey).put(JSON.stringify({
                                    nick: leftNick,
                                    text: 'left the room',
                                    time: Date.now(),
                                    action: false,
                                    type: 'system'
                                }));
                            }

                            // Clear from recentLeaves after 2 seconds
                            setTimeout(() => {
                                recentLeaves.delete(leftNick);
                            }, 2000);
                        }, 800);
                    }
                    return;
                }

                try {
                    const p = typeof data === 'string' ? JSON.parse(data) : data;
                    if (p && p.nick && p.lastSeen) {
                        // Ignore stale data (older than timeout)
                        if (Date.now() - p.lastSeen > PRESENCE_TIMEOUT) return;

                        // Cache UUID for this user
                        if (p.uuid) {
                            uuidCache[p.nick] = p.uuid;
                        }

                        // Check for join event (if not in online list and not self)
                        if (!online[key] && key !== myNick) {
                            // Let updateUsers handle the message or do it here?
                            // Doing it in updateUsers is safer to batch updates
                        }
                        online[key] = p;
                        updateUsers();
                    }
                } catch (e) { }
            });

            setInterval(cleanStale, 10000);

            // Update relative timestamps every 10 seconds
            setInterval(() => {
                els.log.querySelectorAll('.irc-msg-time').forEach(timeEl => {
                    const timestamp = parseInt(timeEl.dataset.timestamp);
                    if (timestamp) {
                        timeEl.textContent = formatRelativeTime(timestamp);
                    }
                });
            }, 10000);

            els.status.textContent = 'Connected as ' + myNick;
        }

        function announce() {
            if (!myNick || !presence) return;
            // Use nick as key for stable identity
            presence.get(myNick).put({
                nick: myNick,
                uuid: myUUID,
                status: 'online',
                lastSeen: Date.now()
            });
        }

        function cleanStale() {
            const now = Date.now();
            let changed = false;

            // Clean up stale users
            Object.keys(online).forEach(nick => {
                if (now - online[nick].lastSeen > PRESENCE_TIMEOUT) {
                    // Remove from shared relay state (Garbage Collection)
                    if (presence) presence.get(nick).put(null);

                    delete online[nick];
                    changed = true;
                }
            });

            if (changed) updateUsers();
        }

        function updateUsers() {
            els.users.innerHTML = '';

            // Get sorted list of nicks (keys are nicks now)
            const nicks = Object.keys(online).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

            // Update online count in header
            els.onlineHeader.textContent = `Online [${nicks.length}]`;

            nicks.forEach(n => {
                const d = document.createElement('div');
                d.className = 'irc-user' + (n === myNick ? ' me' : '');
                d.textContent = n;

                // Apply color based on UUID
                const userData = online[n];
                if (userData && userData.uuid) {
                    d.style.color = uuidToColor(userData.uuid);
                }

                // Make clickable to insert mention (except for self)
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


        function publishMessage(text, type = 'msg', forceAction = false) {
            if (!chat) return;
            const isAction = forceAction;
            const key = Date.now() + '-' + Math.random().toString(36).substr(2, 6);
            chat.get(key).put(JSON.stringify({
                nick: myNick,
                uuid: myUUID,
                text: text,
                time: Date.now(),
                action: isAction,
                type: type
            }));
        }

        function send() {
            const text = getInputText().trim();
            if (!text) return;
            setInputText('');

            // Check for help command
            if (text === '/help' || text === '/commands') {
                const actionCmds = Object.keys(COMMANDS).sort().map(c => `/${c}`).join(', ');
                const textReplacements = Object.keys(TEXT_REPLACEMENTS).sort().map(c => `/${c}`).join(', ');

                const helpText = `### Available Commands
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

                const msgKey = fullText;

                // Check last message in the log to see if it's the same user + action
                const lastChild = els.log.lastElementChild;
                if (lastChild) {
                    const lastNick = lastChild.querySelector('.irc-msg-nick')?.textContent;
                    const lastText = lastChild.querySelector('.irc-msg-text')?.textContent;

                    // If last message is same user doing same action, replace it
                    if (lastNick === 'system' && lastText === fullText) {
                        lastChild.remove();
                    }
                }

                if (nick) lastSystemMsg[nick] = msgKey;
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
                    // Use UUID from the message (preserves color for offline users)
                    uuid = userUuid;
                } else if (online[nick] && online[nick].uuid) {
                    // Fallback to online user's UUID
                    uuid = online[nick].uuid;
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
            if (isGif) {
                const gifContainer = document.createElement('div');
                gifContainer.className = 'irc-gif-container';

                const gifImg = document.createElement('img');
                gifImg.src = text;
                gifImg.className = 'irc-msg-gif';
                gifImg.alt = 'GIF';
                gifImg.loading = 'lazy';
                gifImg.onload = scrollToBottom;

                gifContainer.appendChild(gifImg);
                textEl.appendChild(gifContainer);

                // Check if GIF is NSFW (second layer of protection)
                // Check if GIF is NSFW (second layer of protection)
                // Add to queue with timestamp for prioritization
                nsfwQueue.push({
                    url: text,
                    timestamp: timestamp || Date.now(),
                    onSuccess: (result) => {
                        if (result.isNSFW) {
                            // Blur the GIF
                            gifContainer.classList.add('nsfw-blurred');

                            // Add overlay
                            const overlay = document.createElement('div');
                            overlay.className = 'irc-gif-nsfw-overlay';
                            overlay.innerHTML = `
                                <strong>Blocked content</strong>
                                <small>Click to reveal</small>
                            `;

                            // Click to reveal
                            overlay.onclick = (e) => {
                                e.stopPropagation();
                                gifContainer.classList.remove('nsfw-blurred');
                                overlay.remove();
                                // After revealing, allow opening in new tab
                                gifImg.onclick = () => window.open(text, '_blank');
                            };

                            gifContainer.appendChild(overlay);
                        } else {
                            // Safe GIF - allow opening in new tab
                            gifImg.onclick = () => window.open(text, '_blank');
                        }
                    },
                    onFailure: (e) => {
                        // If check fails, allow the GIF
                        gifImg.onclick = () => window.open(text, '_blank');
                    }
                });

                // Trigger queue processing
                processNSFWQueue();
            } else {
                // Determine the full text to display
                // fullText is now calculated at top of function

                // Render with markdown and mentions
                renderMessageText(textEl, fullText);
            }

            row.appendChild(timeEl);
            row.appendChild(nickEl);
            row.appendChild(textEl);

            // Add delete button for non-system messages (or all messages as requested)
            // Allowing deletion of any message, but visually only easy to click on hover
            if (!isSystem && key) {
                const delBtn = document.createElement('button');
                delBtn.className = 'irc-delete-btn';
                delBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
                delBtn.title = 'Delete message';
                delBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (confirm('Are you sure you want to delete this message?')) {
                        deleteMessage(key, nick);
                    }
                };
                row.appendChild(delBtn);
            }

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
            scrollToBottom();
            // Scroll again after a short delay to account for layout shifts
            setTimeout(scrollToBottom, 100);
        }

        function scrollToBottom() {
            els.log.scrollTop = els.log.scrollHeight;
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
                        textEl.style.color = '#7f8c8d'; // Grey for deleted/system
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

            chat.get(key).put(JSON.stringify({
                nick: 'system', // Change nick to system so it renders as system msg
                uuid: null,
                text: deleteText,
                time: Date.now(), // Update time? Or keep original? Updating time moves it to bottom? 
                // Gun updates usually don't reorder unless we sort by something else. 
                // But we want to keep it in place.
                // We are not changing the key, so it stays in place.
                // If we change time, it might affect relative time display but that's fine.
                // Let's keep original time if we could, but we don't have it easily here without querying.
                // Actually, we don't need to send all fields if we just merge, but we are storing stringified JSON.
                // So we must rewrite the whole object.
                // We will lose the original time if we don't pass it.
                // For now, let's just use current time, it's a "deletion event" timestamp.

                action: false,
                type: 'system'
            }));
        }

        root.onclick = e => {
            // Close GIF picker if clicking outside of it
            if (!els.gifPicker.classList.contains('hidden') &&
                !els.gifPicker.contains(e.target) &&
                e.target !== els.gifBtn) {
                closeGifPicker();
            }

            if (els.prompt.classList.contains('hidden') && e.target.tagName !== 'INPUT') {
                els.msgInput.focus();
            }
        };

        // Expose cleanup function for when window is closed
        win.ircCleanup = function () {
            if (myNick && presence && chat && !hasLeft) {
                hasLeft = true;
                publishMessage('left the room', 'system');
                presence.get(myNick).put(null);
                if (presenceInt) clearInterval(presenceInt);
            }
        };
    }

    window.initIRCChat = initIRC;
})();
