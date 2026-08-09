/**
 * Music - shared YouTube engine, menubar miniplayer, and iTunes-style Music window.
 *
 * Playback is official IFrame API only (no hosted audio). The player iframe
 * lives in a 1x1 offscreen mount - the video surface is never shown.
 */
(function () {
    'use strict';

    const STATE_KEY = 'music-player-v1';
    const CATALOG_URL = '/music/music.json';
    const DEFAULT_VOLUME = 80;
    const AMBIENT_VOLUME = 32;
    const PREV_RESTART_SEC = 3;
    const AMBIENT_DELAY_MIN_MS = 3000;
    const AMBIENT_DELAY_SPAN_MS = 4000;
    const CF_WINDOW = 6; // covers each side of center
    const CF_SIZE = 150;
    const CF_SIZE_NARROW = 108;
    const CF_SPACING = 58; // gap between successive side covers
    const CF_ANGLE = 56;
    const CF_CENTER_Z = 70;
    const CF_DEPTH = 48;
    const CF_GAP = 52; // gap between center edge and first neighbor
    const CF_MS = 480;
    const MARQUEE_DEBOUNCE_MS = 180;

    let ytApiPromise = null;

    function loadYouTubeAPI() {
        if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
        if (ytApiPromise) return ytApiPromise;

        ytApiPromise = new Promise((resolve, reject) => {
            const prior = window.onYouTubeIframeAPIReady;
            window.onYouTubeIframeAPIReady = function () {
                if (typeof prior === 'function') {
                    try { prior(); } catch (e) { /* ignore */ }
                }
                resolve(window.YT);
            };
            if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
                const tag = document.createElement('script');
                tag.src = 'https://www.youtube.com/iframe_api';
                tag.onerror = () => reject(new Error('YouTube IFrame API failed to load'));
                document.head.appendChild(tag);
            }
            if (window.YT && window.YT.Player) resolve(window.YT);
        });
        return ytApiPromise;
    }

    function formatTime(sec) {
        const s = Math.max(0, Math.floor(Number(sec) || 0));
        const m = Math.floor(s / 60);
        const r = s % 60;
        return m + ':' + String(r).padStart(2, '0');
    }

    function formatRemaining(cur, dur) {
        const left = Math.max(0, Math.floor((Number(dur) || 0) - (Number(cur) || 0)));
        return '-' + formatTime(left);
    }

    function clamp(n, min, max) {
        return Math.min(max, Math.max(min, n));
    }

    /**
     * Bind a range input as a seek scrubber.
     * Keeps a local scrub lock through pointer-up + seek commit so progress
     * ticks cannot yank the thumb before SiteMusic's optimistic time settles.
     */
    function bindSeekScrubber(el, opts) {
        if (!el) return;
        let pointerDown = false;
        let unlockTimer = null;

        function setLock(on) {
            opts.setSeeking(!!on);
        }

        function clearUnlockTimer() {
            if (unlockTimer) {
                clearTimeout(unlockTimer);
                unlockTimer = null;
            }
        }

        function unlockAfterSettle() {
            clearUnlockTimer();
            unlockTimer = setTimeout(() => {
                unlockTimer = null;
                if (!pointerDown) setLock(false);
            }, 180);
        }

        el.addEventListener('pointerdown', () => {
            pointerDown = true;
            clearUnlockTimer();
            setLock(true);
        });
        el.addEventListener('pointerup', () => {
            pointerDown = false;
            unlockAfterSettle();
        });
        el.addEventListener('pointercancel', () => {
            pointerDown = false;
            clearUnlockTimer();
            setLock(false);
        });
        el.addEventListener('blur', () => {
            if (pointerDown) return;
            unlockAfterSettle();
        });
        el.addEventListener('input', () => {
            setLock(true);
            if (typeof opts.onInput === 'function') opts.onInput();
        });
        el.addEventListener('change', () => {
            setLock(true);
            SiteMusic.seek(Number(el.value) || 0);
            pointerDown = false;
            unlockAfterSettle();
        });
    }

    function readState() {
        try {
            const raw = localStorage.getItem(STATE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    function writeState(partial) {
        try {
            const prev = readState() || {};
            localStorage.setItem(STATE_KEY, JSON.stringify(Object.assign({}, prev, partial)));
        } catch (e) { /* private mode */ }
    }

    function monogram(title) {
        const t = (title || '?').trim();
        return t ? t.charAt(0).toUpperCase() : '?';
    }

    function prefersReducedMotion() {
        try {
            return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        } catch (e) {
            return false;
        }
    }

    // ------------------------------------------------------------------
    // SiteMusic - single engine
    // ------------------------------------------------------------------

    const listeners = new Set();

    const SiteMusic = {
        tracks: [],
        mixTitle: "Ankush's Mix",
        manifestHash: 'empty',
        index: 0,
        volume: DEFAULT_VOLUME,
        shuffle: false,
        player: null,
        ready: false,
        playing: false,
        ambientStarted: false,
        ambientSuppressed: false,
        catalogPromise: null,
        _resumeTime: 0,
        _resumeApplied: false,
        _seekTarget: null,
        _seekGuardUntil: 0,

        on(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },

        emit() {
            const snap = this.snapshot();
            listeners.forEach((fn) => {
                try { fn(snap); } catch (e) { /* ignore */ }
            });
        },

        snapshot() {
            return {
                tracks: this.tracks,
                mixTitle: this.mixTitle,
                manifestHash: this.manifestHash,
                index: this.index,
                track: this.tracks[this.index] || null,
                volume: this.volume,
                shuffle: this.shuffle,
                playing: this.playing,
                currentTime: this._currentTime(),
                duration: this._duration()
            };
        },

        _clearSeekGuard() {
            this._seekTarget = null;
            this._seekGuardUntil = 0;
        },

        _currentTime() {
            const now = Date.now();
            if (this._seekTarget != null && now < this._seekGuardUntil) {
                let live = null;
                try {
                    if (this.player && this.ready) live = this.player.getCurrentTime();
                } catch (e) { /* ignore */ }
                // Drop the optimistic value once YT has caught up
                if (typeof live === 'number' && Math.abs(live - this._seekTarget) <= 1.25) {
                    this._clearSeekGuard();
                    return live;
                }
                return this._seekTarget;
            }
            if (this._seekTarget != null) this._clearSeekGuard();

            try {
                if (this.player && this.ready) return this.player.getCurrentTime() || 0;
            } catch (e) { /* ignore */ }
            return this._resumeTime || 0;
        },

        _duration() {
            try {
                if (this.player && this.ready) {
                    const d = this.player.getDuration();
                    if (d) return d;
                }
            } catch (e) { /* ignore */ }
            const t = this.tracks[this.index];
            return t ? Number(t.durationSec) || 0 : 0;
        },

        /** Intentional play may show the menubar again after Stop and hide. */
        _allowMenubar() {
            this.ambientSuppressed = false;
            showMenubarMusic(true);
        },

        loadCatalog() {
            if (this.catalogPromise) return this.catalogPromise;
            this.catalogPromise = fetch(CATALOG_URL)
                .then((r) => {
                    if (!r.ok) throw new Error('catalog ' + r.status);
                    return r.json();
                })
                .then((data) => {
                    this.tracks = Array.isArray(data.tracks)
                        ? data.tracks.filter((t) => t && t.videoId)
                        : [];
                    this.manifestHash = data.manifestHash || 'empty';
                    this.mixTitle = data.title || this.mixTitle;

                    const saved = readState();
                    if (saved && saved.manifestHash === this.manifestHash && saved.trackId) {
                        const found = this.tracks.findIndex((t) => t.id === saved.trackId);
                        if (found >= 0) {
                            this.index = found;
                            if (typeof saved.currentTime === 'number' && saved.currentTime > 0) {
                                this._resumeTime = saved.currentTime;
                            }
                        }
                    }
                    if (saved && typeof saved.volume === 'number') {
                        this.volume = clamp(saved.volume, 0, 100);
                    }
                    if (saved && typeof saved.shuffle === 'boolean') {
                        this.shuffle = saved.shuffle;
                    }
                    this.emit();
                    return this.tracks;
                })
                .catch(() => {
                    this.tracks = [];
                    this.emit();
                    return this.tracks;
                });
            return this.catalogPromise;
        },

        persist() {
            const t = this.tracks[this.index];
            writeState({
                manifestHash: this.manifestHash,
                trackId: t ? t.id : null,
                currentTime: this._currentTime(),
                volume: this.volume,
                shuffle: this.shuffle
            });
        },

        setShuffle(on) {
            this.shuffle = !!on;
            this.persist();
            this.emit();
        },

        _updateMediaSessionPosition() {
            if (!navigator.mediaSession || !navigator.mediaSession.setPositionState) return;
            try {
                const duration = this._duration();
                const position = this._currentTime();
                if (!duration || !isFinite(duration)) return;
                navigator.mediaSession.setPositionState({
                    duration: duration,
                    playbackRate: 1,
                    position: clamp(position, 0, duration)
                });
            } catch (e) { /* ignore */ }
        },

        _artworkFor(track) {
            if (!track || !track.videoId) return [];
            const id = track.videoId;
            const items = [];
            if (track.thumb) {
                const local = String(track.thumb).indexOf('/music/covers/') === 0;
                items.push({
                    src: track.thumb,
                    sizes: local ? '640x640' : '480x360',
                    type: 'image/jpeg'
                });
            }
            items.push(
                { src: 'https://i.ytimg.com/vi/' + id + '/maxresdefault.jpg', sizes: '1280x720', type: 'image/jpeg' },
                { src: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg', sizes: '480x360', type: 'image/jpeg' }
            );
            return items;
        },

        setVolume(v) {
            this.volume = clamp(Number(v) || 0, 0, 100);
            if (this.player && this.ready) {
                try {
                    this.player.setVolume(this.volume);
                    if (this.volume <= 0) this.player.mute();
                    else this.player.unMute();
                } catch (e) { /* ignore */ }
            }
            this.persist();
            this.emit();
        },

        ensurePlayer(videoId) {
            const mount = document.getElementById('mu-ambient-yt-mount');
            if (!mount) return Promise.reject(new Error('missing ambient mount'));

            return loadYouTubeAPI().then((YT) => {
                if (this.player && this.ready) return this.player;
                if (this.player && !this.ready) {
                    return new Promise((resolve, reject) => {
                        const deadline = Date.now() + 10000;
                        const wait = setInterval(() => {
                            if (this.ready) {
                                clearInterval(wait);
                                resolve(this.player);
                            } else if (Date.now() > deadline) {
                                clearInterval(wait);
                                reject(new Error('player ready timeout'));
                            }
                        }, 50);
                    });
                }

                return new Promise((resolve, reject) => {
                    const readyTimeout = setTimeout(() => {
                        reject(new Error('player ready timeout'));
                    }, 10000);
                    this.player = new YT.Player(mount, {
                        width: '100%',
                        height: '100%',
                        videoId: videoId || '',
                        playerVars: {
                            autoplay: 0,
                            controls: 0,
                            disablekb: 1,
                            modestbranding: 1,
                            rel: 0,
                            playsinline: 1,
                            fs: 0,
                            iv_load_policy: 3
                        },
                        events: {
                            onReady: () => {
                                clearTimeout(readyTimeout);
                                this.ready = true;
                                this.setVolume(this.volume);
                                this._bindMediaSession();
                                resolve(this.player);
                            },
                            onStateChange: (ev) => this._onStateChange(ev),
                            onError: () => {
                                if (this.index < this.tracks.length - 1) {
                                    this.select(this.index + 1, true);
                                } else {
                                    this.playing = false;
                                    this.emit();
                                }
                            }
                        }
                    });
                });
            });
        },

        _bindMediaSession() {
            if (!navigator.mediaSession) return;
            try {
                navigator.mediaSession.setActionHandler('play', () => this.play());
                navigator.mediaSession.setActionHandler('pause', () => this.pause());
                navigator.mediaSession.setActionHandler('previoustrack', () => this.prev());
                navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
                navigator.mediaSession.setActionHandler('seekto', (details) => {
                    if (!details || details.seekTime == null) return;
                    this.seek(details.seekTime);
                });
            } catch (e) { /* ignore */ }
        },

        _onStateChange(ev) {
            const YT = window.YT;
            if (!YT) return;
            const state = ev.data;
            if (state === YT.PlayerState.PLAYING) {
                this.playing = true;
                if (!this.ambientSuppressed) showMenubarMusic(true);
                this.persist();
                this._updateMediaSessionPosition();
                this.emit();
            } else if (state === YT.PlayerState.PAUSED) {
                this.playing = false;
                this.persist();
                this.emit();
            } else if (state === YT.PlayerState.ENDED) {
                this.playing = false;
                this.next();
            }
        },

        select(i, play, seekTo) {
            if (!this.tracks.length) return Promise.resolve();
            const nextIndex = clamp(i, 0, this.tracks.length - 1);
            const sameTrack = nextIndex === this.index;
            let start = seekTo || 0;
            if (!this._resumeApplied && this._resumeTime > 0 && sameTrack && !seekTo) {
                start = this._resumeTime;
            }
            this._resumeApplied = true;
            if (!sameTrack) {
                this._resumeTime = 0;
                this._clearSeekGuard();
            }
            this.index = nextIndex;
            const track = this.tracks[this.index];

            try {
                if (navigator.mediaSession && track) {
                    navigator.mediaSession.metadata = new MediaMetadata({
                        title: track.title || 'Unknown',
                        artist: track.artist || '',
                        artwork: this._artworkFor(track)
                    });
                }
            } catch (e) { /* ignore */ }

            if (play) this._allowMenubar();
            else if (!this.ambientSuppressed) showMenubarMusic(true);

            this.emit();

            return this.ensurePlayer(track.videoId).then((p) => {
                if (!p || !track) return;
                try {
                    if (play) {
                        p.loadVideoById({ videoId: track.videoId, startSeconds: start });
                    } else if (this.ready && this.player) {
                        if (p.getVideoData && p.getVideoData().video_id !== track.videoId) {
                            p.cueVideoById({ videoId: track.videoId, startSeconds: start });
                        } else if (start) {
                            p.seekTo(start, true);
                        }
                    }
                } catch (e) {
                    try {
                        if (play) p.loadVideoById(track.videoId);
                        else p.cueVideoById(track.videoId);
                    } catch (e2) { /* ignore */ }
                }
                this.setVolume(this.volume);
                this.persist();
            }).catch(() => { /* API unavailable */ });
        },

        play() {
            if (!this.tracks.length) return;
            this._allowMenubar();
            if (!this.player || !this.ready) {
                this.select(this.index, true);
                return;
            }
            try { this.player.playVideo(); } catch (e) {
                this.select(this.index, true);
            }
        },

        pause() {
            try {
                if (this.player && this.ready) this.player.pauseVideo();
            } catch (e) { /* ignore */ }
            this.playing = false;
            this.emit();
        },

        toggle() {
            if (this.playing) this.pause();
            else this.play();
        },

        prev() {
            if (!this.tracks.length) return;
            const cur = this._currentTime();
            if (cur > PREV_RESTART_SEC) {
                this.seek(0);
                return;
            }
            this.select(Math.max(0, this.index - 1), true);
        },

        next() {
            if (!this.tracks.length) return;
            if (this.shuffle && this.tracks.length > 1) {
                this.playRandom();
                return;
            }
            if (this.index >= this.tracks.length - 1) {
                this.select(0, true);
                return;
            }
            this.select(this.index + 1, true);
        },

        seek(sec) {
            const t = Math.max(0, Number(sec) || 0);
            // Optimistic time until the IFrame API reports the new position
            this._seekTarget = t;
            this._seekGuardUntil = Date.now() + 1200;
            this._resumeTime = t;
            try {
                if (this.player && this.ready) this.player.seekTo(t, true);
            } catch (e) { /* ignore */ }
            this._updateMediaSessionPosition();
            this.emit();
        },

        playRandom(opts) {
            opts = opts || {};
            if (!this.tracks.length) return Promise.resolve();
            let i = Math.floor(Math.random() * this.tracks.length);
            if (this.tracks.length > 1 && i === this.index) {
                i = (i + 1) % this.tracks.length;
            }
            if (typeof opts.volume === 'number') this.volume = clamp(opts.volume, 0, 100);
            // Ambient path uses select(play) which would clear suppression —
            // gate ambient so dismissed users stay dismissed.
            if (opts.ambient) {
                if (this.ambientSuppressed) return Promise.resolve();
                // Avoid select(play) so we do not clear ambientSuppressed
                this.index = i;
                this._resumeApplied = true;
                this._resumeTime = 0;
                const track = this.tracks[this.index];
                try {
                    if (navigator.mediaSession && track) {
                        navigator.mediaSession.metadata = new MediaMetadata({
                            title: track.title || 'Unknown',
                            artist: track.artist || '',
                            artwork: this._artworkFor(track)
                        });
                    }
                } catch (e) { /* ignore */ }
                if (!this.ambientSuppressed) showMenubarMusic(true);
                this.emit();
                return this.ensurePlayer(track.videoId).then((p) => {
                    if (this.ambientSuppressed || this.playing || !p || !track) return;
                    try {
                        p.loadVideoById({ videoId: track.videoId, startSeconds: 0 });
                    } catch (e) { /* ignore */ }
                    this.setVolume(this.volume);
                    this.persist();
                }).catch(() => {});
            }
            return this.select(i, true, 0);
        },

        armAmbientAutoplay() {
            let armed = false;
            const arm = () => {
                if (armed || this.ambientSuppressed) return;
                armed = true;
                document.removeEventListener('click', arm);
                document.removeEventListener('keydown', arm);
                document.removeEventListener('touchstart', arm);

                const delay = AMBIENT_DELAY_MIN_MS + Math.random() * AMBIENT_DELAY_SPAN_MS;
                setTimeout(() => {
                    if (this.ambientSuppressed || this.ambientStarted || this.playing) return;
                    this.loadCatalog().then((tracks) => {
                        if (this.ambientSuppressed || this.ambientStarted || this.playing) return;
                        if (!tracks.length) return;
                        this.ambientStarted = true;
                        this.volume = AMBIENT_VOLUME;
                        this.playRandom({ volume: AMBIENT_VOLUME, ambient: true });
                    });
                }, delay);
            };

            document.addEventListener('click', arm);
            document.addEventListener('keydown', arm);
            document.addEventListener('touchstart', arm);
        }
    };

    window.SiteMusic = SiteMusic;

    // ------------------------------------------------------------------
    // Menubar Now Playing (marquee + miniplayer)
    // ------------------------------------------------------------------

    function showMenubarMusic(show) {
        const el = document.getElementById('menubar-music');
        if (!el || SiteMusic.ambientSuppressed) return;
        if (show) {
            el.hidden = false;
            el.classList.add('is-active');
        }
    }

    function closeMusicMenu() {
        const root = document.getElementById('menubar-music');
        const dropdown = document.getElementById('mu-mb-dropdown');
        const toggle = document.getElementById('mu-mb-toggle');
        if (root) root.classList.remove('open');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
        if (dropdown) {
            dropdown.hidden = true;
            dropdown.style.top = '';
            dropdown.style.left = '';
        }
    }

    function positionMusicDropdown() {
        const toggle = document.getElementById('mu-mb-toggle');
        const dropdown = document.getElementById('mu-mb-dropdown');
        if (!toggle || !dropdown || dropdown.hidden) return;

        const rect = toggle.getBoundingClientRect();
        const ddWidth = dropdown.offsetWidth || 268;
        const gap = 4;
        let left = rect.left;
        // Keep fully on-screen
        left = Math.min(left, window.innerWidth - ddWidth - 8);
        left = Math.max(8, left);

        dropdown.style.position = 'fixed';
        dropdown.style.top = Math.round(rect.bottom + gap) + 'px';
        dropdown.style.left = Math.round(left) + 'px';
        dropdown.style.right = 'auto';
    }

    function openMusicMenu() {
        const root = document.getElementById('menubar-music');
        const dropdown = document.getElementById('mu-mb-dropdown');
        const toggle = document.getElementById('mu-mb-toggle');
        if (typeof window.closeDropdowns === 'function') {
            const appleDropdown = document.getElementById('apple-dropdown');
            const finderDropdown = document.getElementById('finder-dropdown');
            if (appleDropdown) appleDropdown.classList.remove('open');
            if (finderDropdown) finderDropdown.classList.remove('open');
        }
        if (root) root.classList.add('open');
        if (dropdown) {
            dropdown.hidden = false;
            // Measure after visible, then pin under the chip
            requestAnimationFrame(positionMusicDropdown);
        }
        if (toggle) toggle.setAttribute('aria-expanded', 'true');
    }

    function toggleMusicMenu(e) {
        if (e) e.stopPropagation();
        const root = document.getElementById('menubar-music');
        if (!root || root.hidden) return;
        if (root.classList.contains('open')) closeMusicMenu();
        else openMusicMenu();
    }

    let marqueeTimer = null;
    let marqueePending = null;

    function stripMarqueeIcons(text) {
        // Keep the stationary SVG note outside the marquee; never put note
        // glyphs in the scrolling string (including legacy ♪ prefixes).
        return String(text || '')
            .replace(/[\u266A\u266B\u266C\u266D\uD83C\uDFB5\uD83C\uDFB6]/g, '')
            .replace(/^\s+|\s+$/g, '')
            .replace(/\s{2,}/g, ' ');
    }

    function applyMarqueeText(text, scrolling) {
        const marquee = document.querySelector('.mu-mb-marquee');
        const inner = document.querySelector('.mu-mb-marquee-inner');
        const span = document.querySelector('.mu-mb-text');
        if (!span || !inner || !marquee) return;

        const label = stripMarqueeIcons(text);
        let clone = inner.querySelector('.mu-mb-text-clone');
        if (clone) clone.remove();
        inner.classList.remove('is-scrolling', 'is-static');
        inner.style.display = '';
        inner.style.removeProperty('--mu-mb-shift');

        if (!(scrolling && label)) {
            span.textContent = label || 'Music';
            inner.classList.add('is-static');
            return;
        }

        // Build one scroll unit that is at least as wide as the viewport, so
        // short titles don't leave an empty gap before the duplicate appears.
        const gap = '\u00a0\u00a0\u00a0\u00a0';
        let unit = label + gap;
        span.textContent = unit;
        inner.style.display = 'inline-flex';
        // Force layout against the real marquee width
        void marquee.offsetWidth;
        let guard = 0;
        while (span.offsetWidth < marquee.clientWidth && guard < 12) {
            unit += label + gap;
            span.textContent = unit;
            guard += 1;
        }

        clone = document.createElement('span');
        clone.className = 'mu-mb-text mu-mb-text-clone';
        clone.setAttribute('aria-hidden', 'true');
        clone.textContent = unit;
        inner.appendChild(clone);

        const shift = span.offsetWidth;
        inner.style.setProperty('--mu-mb-shift', Math.max(1, shift) + 'px');
        inner.classList.add('is-scrolling');
    }

    function setMarqueeText(text, scrolling) {
        marqueePending = { text: text, scrolling: !!scrolling };
        if (marqueeTimer) return;
        marqueeTimer = setTimeout(() => {
            marqueeTimer = null;
            const p = marqueePending;
            marqueePending = null;
            if (p) applyMarqueeText(p.text, p.scrolling);
        }, MARQUEE_DEBOUNCE_MS);
    }

    function initMenubarMusic() {
        const root = document.getElementById('menubar-music');
        if (!root || root.dataset.init) return;
        root.dataset.init = '1';

        const els = {
            toggle: root.querySelector('#mu-mb-toggle'),
            dropdown: root.querySelector('#mu-mb-dropdown'),
            art: root.querySelector('.mu-mb-art'),
            title: root.querySelector('.mu-mb-title'),
            artist: root.querySelector('.mu-mb-artist'),
            play: root.querySelector('.mu-mb-play'),
            iconPlay: root.querySelector('.mu-mb-icon-play'),
            iconPause: root.querySelector('.mu-mb-icon-pause'),
            prev: root.querySelector('.mu-mb-prev'),
            next: root.querySelector('.mu-mb-next'),
            volume: root.querySelector('.mu-mb-volume'),
            seek: root.querySelector('.mu-mb-seek'),
            timeCur: root.querySelector('.mu-mb-time-cur'),
            timeDur: root.querySelector('.mu-mb-time-dur'),
            open: root.querySelector('.mu-mb-open'),
            stop: root.querySelector('.mu-mb-stop')
        };

        let mbSeeking = false;
        let lastMarqueeKey = '';

        function setMenubarPlayIcon(playing) {
            if (els.play) {
                els.play.classList.toggle('is-playing', !!playing);
                els.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
            }
            if (els.iconPlay) {
                els.iconPlay.hidden = !!playing;
                els.iconPlay.removeAttribute('style');
            }
            if (els.iconPause) {
                els.iconPause.hidden = !playing;
                els.iconPause.removeAttribute('style');
            }
        }

        function setRangeFill(el, cssVar, value, max) {
            if (!el) return;
            const pct = max > 0 ? clamp((value / max) * 100, 0, 100) : 0;
            el.style.setProperty(cssVar, pct + '%');
        }

        function sync(snap) {
            const t = snap.track;
            root.classList.toggle('is-playing', !!snap.playing);

            if (!t) {
                if (lastMarqueeKey !== 'empty') {
                    lastMarqueeKey = 'empty';
                    setMarqueeText('Music', false);
                }
                els.title.textContent = 'Music';
                els.artist.textContent = 'Waiting for a mix…';
                if (els.art) {
                    els.art.hidden = true;
                    els.art.removeAttribute('src');
                }
                if (els.seek && !mbSeeking) {
                    els.seek.max = '0';
                    els.seek.value = '0';
                    els.timeCur.textContent = '0:00';
                    els.timeDur.textContent = '-0:00';
                    setRangeFill(els.seek, '--mu-mb-seek-pct', 0, 0);
                }
                setRangeFill(els.volume, '--mu-mb-vol-pct', snap.volume, 100);
                setMenubarPlayIcon(false);
                return;
            }

            const artistLine = t.artist || snap.mixTitle || '';
            const line = (t.title || 'Unknown') + (artistLine ? '  ·  ' + artistLine : '');
            const marqueeKey = 'scroll|' + line;
            if (marqueeKey !== lastMarqueeKey) {
                lastMarqueeKey = marqueeKey;
                // Always duplicate + scroll (even when paused / short titles)
                setMarqueeText(line, true);
            }
            els.title.textContent = t.title || 'Unknown';
            els.artist.textContent = artistLine || 'Unknown artist';
            if (els.art) {
                if (t.thumb) {
                    els.art.src = t.thumb;
                    els.art.hidden = false;
                    els.art.onerror = () => { els.art.hidden = true; };
                } else {
                    els.art.hidden = true;
                }
            }
            setMenubarPlayIcon(!!snap.playing);
            if (els.volume) {
                els.volume.value = String(snap.volume);
                setRangeFill(els.volume, '--mu-mb-vol-pct', snap.volume, 100);
            }
            if (els.seek && !mbSeeking) {
                const dur = snap.duration || Number(t.durationSec) || 0;
                const cur = snap.currentTime || 0;
                els.seek.max = String(Math.floor(dur));
                els.seek.value = String(Math.floor(cur));
                els.timeCur.textContent = formatTime(cur);
                els.timeDur.textContent = formatRemaining(cur, dur);
                setRangeFill(els.seek, '--mu-mb-seek-pct', cur, dur);
            }
            if (els.toggle) {
                els.toggle.setAttribute(
                    'aria-label',
                    snap.playing ? ('Now playing: ' + line) : ('Music: ' + line)
                );
            }
        }

        SiteMusic.on(sync);
        sync(SiteMusic.snapshot());

        els.toggle.addEventListener('click', toggleMusicMenu);
        els.play.addEventListener('click', (e) => {
            e.stopPropagation();
            SiteMusic.toggle();
        });
        els.prev.addEventListener('click', (e) => {
            e.stopPropagation();
            SiteMusic.prev();
        });
        els.next.addEventListener('click', (e) => {
            e.stopPropagation();
            SiteMusic.next();
        });
        if (els.volume) {
            els.volume.addEventListener('input', (e) => {
                e.stopPropagation();
                const v = Number(els.volume.value) || 0;
                els.volume.style.setProperty('--mu-mb-vol-pct', v + '%');
                SiteMusic.setVolume(v);
            });
            els.volume.addEventListener('click', (e) => e.stopPropagation());
        }
        if (els.seek) {
            bindSeekScrubber(els.seek, {
                setSeeking: (on) => { mbSeeking = on; },
                onInput: () => {
                    const cur = Number(els.seek.value) || 0;
                    const dur = Number(els.seek.max) || 0;
                    els.timeCur.textContent = formatTime(cur);
                    els.timeDur.textContent = formatRemaining(cur, dur);
                    els.seek.style.setProperty(
                        '--mu-mb-seek-pct',
                        (dur > 0 ? clamp((cur / dur) * 100, 0, 100) : 0) + '%'
                    );
                }
            });
            els.seek.addEventListener('click', (e) => e.stopPropagation());
        }

        function openMusicWindow(e) {
            if (e) e.stopPropagation();
            closeMusicMenu();
            if (typeof window.openWindow === 'function') {
                window.openWindow('music', 'Music', { width: 920, height: 640 });
            } else if (typeof window.openContentWindow === 'function') {
                window.openContentWindow('music', 'Music');
            }
        }

        function stopAndHide(e) {
            if (e) e.stopPropagation();
            SiteMusic.ambientSuppressed = true;
            SiteMusic.pause();
            closeMusicMenu();
            root.hidden = true;
            root.classList.remove('is-active', 'is-playing', 'open');
        }

        function activateOnKey(handler) {
            return (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    handler(e);
                }
            };
        }

        els.open.addEventListener('click', openMusicWindow);
        els.open.addEventListener('keydown', activateOnKey(openMusicWindow));
        els.stop.addEventListener('click', stopAndHide);
        els.stop.addEventListener('keydown', activateOnKey(stopAndHide));

        document.addEventListener('click', (e) => {
            if (!root.contains(e.target)) closeMusicMenu();
        });
        window.addEventListener('resize', positionMusicDropdown);
        // Capture scroll from any scrollable ancestor
        window.addEventListener('scroll', positionMusicDropdown, true);
    }

    window.closeMusicMenu = closeMusicMenu;

    // ------------------------------------------------------------------
    // Music window UI (iTunes-style; controls SiteMusic; no second YT player)
    // ------------------------------------------------------------------

    function initMusicPlayer(win) {
        const root = win.querySelector('.mu-app');
        if (!root || root.dataset.init) return;
        root.dataset.init = '1';

        const els = {
            lcdArt: root.querySelector('.mu-lcd-art'),
            lcdArtPh: root.querySelector('.mu-lcd-art-ph'),
            lcdTitle: root.querySelector('.mu-lcd-title'),
            lcdSub: root.querySelector('.mu-lcd-sub'),
            lcdTimeCur: root.querySelector('.mu-lcd-time-cur'),
            lcdTimeRem: root.querySelector('.mu-lcd-time-rem'),
            seek: root.querySelector('.mu-seek'),
            play: root.querySelector('.mu-play'),
            prev: root.querySelector('.mu-prev'),
            next: root.querySelector('.mu-next'),
            shuffle: root.querySelector('.mu-shuffle'),
            volume: root.querySelector('.mu-volume'),
            iconPlay: root.querySelector('.mu-icon-play'),
            iconPause: root.querySelector('.mu-icon-pause'),
            filter: root.querySelector('.mu-filter'),
            mixTitle: root.querySelector('.mu-playlist-title'),
            coverflow: root.querySelector('.mu-coverflow'),
            stage: root.querySelector('.mu-coverflow-stage'),
            cfTitle: root.querySelector('.mu-coverflow-title'),
            cfArtist: root.querySelector('.mu-coverflow-artist'),
            tableBody: root.querySelector('.mu-table-body'),
            table: root.querySelector('.mu-table'),
            empty: root.querySelector('.mu-empty'),
            status: root.querySelector('.mu-status-text'),
            sortHeaders: root.querySelectorAll('th[data-sort]')
        };

        let seeking = false;
        let unsub = null;
        let browseIndex = 0;
        let filterQuery = '';
        let sortKey = 'title';
        let sortDir = 1;
        let coverBrowseActive = false;
        let lastTableKey = '';
        let lastFlowKey = '';
        let captionTimer = null;
        const reduced = prefersReducedMotion();
        if (reduced && els.coverflow) els.coverflow.classList.add('is-reduced');

        function catalogIndexById(id) {
            return SiteMusic.tracks.findIndex((t) => t.id === id);
        }

        function visibleTracks() {
            const q = filterQuery.trim().toLowerCase();
            if (!q) return SiteMusic.tracks.slice();
            return SiteMusic.tracks.filter((t) => {
                const hay = ((t.title || '') + ' ' + (t.artist || '')).toLowerCase();
                return hay.indexOf(q) !== -1;
            });
        }

        function sortedVisible() {
            const list = visibleTracks();
            list.sort((a, b) => {
                let av;
                let bv;
                if (sortKey === 'duration') {
                    av = Number(a.durationSec) || 0;
                    bv = Number(b.durationSec) || 0;
                    return (av - bv) * sortDir;
                }
                if (sortKey === 'artist') {
                    av = (a.artist || '').toLowerCase();
                    bv = (b.artist || '').toLowerCase();
                } else {
                    av = (a.title || '').toLowerCase();
                    bv = (b.title || '').toLowerCase();
                }
                if (av < bv) return -1 * sortDir;
                if (av > bv) return 1 * sortDir;
                return 0;
            });
            return list;
        }

        function flowTracks() {
            // Cover Flow follows catalog order, filtered — not table sort order
            return visibleTracks();
        }

        function setPlayingUI(playing) {
            root.classList.toggle('is-playing', !!playing);
            if (els.play) {
                els.play.classList.toggle('is-playing', !!playing);
                els.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
            }
            if (els.iconPlay) {
                els.iconPlay.hidden = !!playing;
                els.iconPlay.removeAttribute('style');
            }
            if (els.iconPause) {
                els.iconPause.hidden = !playing;
                els.iconPause.removeAttribute('style');
            }
        }

        function setTransportEnabled(on) {
            [els.play, els.prev, els.next, els.seek, els.volume, els.shuffle].forEach((el) => {
                if (el) el.disabled = !on;
            });
        }

        function setShuffleUI(on) {
            if (!els.shuffle) return;
            els.shuffle.classList.toggle('is-on', !!on);
            els.shuffle.setAttribute('aria-pressed', on ? 'true' : 'false');
            els.shuffle.setAttribute('aria-label', on ? 'Shuffle on' : 'Shuffle off');
        }

        function setLcdArt(track) {
            if (!els.lcdArt || !els.lcdArtPh) return;
            els.lcdArtPh.textContent = monogram(track && track.title);
            if (track && track.thumb) {
                els.lcdArt.hidden = false;
                els.lcdArt.src = track.thumb;
                els.lcdArt.onerror = () => {
                    els.lcdArt.hidden = true;
                };
            } else {
                els.lcdArt.hidden = true;
                els.lcdArt.removeAttribute('src');
            }
        }

        function setAppRangeFill(el, value, max) {
            if (!el) return;
            const pct = max > 0 ? clamp((Number(value) / Number(max)) * 100, 0, 100) : 0;
            el.style.setProperty('--mu-fill', pct + '%');
        }

        function updateStatus(list) {
            if (!els.status) return;
            if (filterQuery.trim() && list.length === 0) {
                els.status.textContent = 'No matches';
                return;
            }
            const n = list.length;
            let total = 0;
            list.forEach((t) => { total += Number(t.durationSec) || 0; });
            const h = Math.floor(total / 3600);
            const m = Math.floor((total % 3600) / 60);
            const timePart = h > 0 ? (h + ':' + String(m).padStart(2, '0')) : (m + ' min');
            els.status.textContent = n + (n === 1 ? ' song, ' : ' songs, ') + timePart;
        }

        function renderTable(snap) {
            const list = sortedVisible();
            const playingId = snap.track ? snap.track.id : null;
            const browseTrack = SiteMusic.tracks[browseIndex];
            const browseId = browseTrack ? browseTrack.id : null;
            const key = [
                snap.manifestHash,
                filterQuery,
                sortKey,
                sortDir,
                playingId,
                browseId,
                snap.playing ? '1' : '0',
                list.map((t) => t.id).join(',')
            ].join('|');
            if (key === lastTableKey) return;
            lastTableKey = key;

            els.tableBody.textContent = '';
            const empty = list.length === 0;
            if (els.empty) els.empty.classList.toggle('is-visible', empty);
            if (els.table) els.table.hidden = empty;

            list.forEach((t) => {
                const tr = document.createElement('tr');
                tr.dataset.trackId = t.id;
                if (playingId && t.id === playingId) tr.classList.add('is-playing');
                else if (browseId && t.id === browseId) tr.classList.add('is-browse');

                const tdStatus = document.createElement('td');
                tdStatus.className = 'mu-cell-status';
                tdStatus.textContent = (playingId && t.id === playingId && snap.playing) ? '▶' : '';

                const tdName = document.createElement('td');
                tdName.textContent = t.title || 'Unknown';

                const tdTime = document.createElement('td');
                tdTime.className = 'mu-cell-time';
                tdTime.textContent = formatTime(t.durationSec);

                const tdArtist = document.createElement('td');
                tdArtist.textContent = t.artist || '';

                tr.appendChild(tdStatus);
                tr.appendChild(tdName);
                tr.appendChild(tdTime);
                tr.appendChild(tdArtist);

                tr.addEventListener('click', () => {
                    const idx = catalogIndexById(t.id);
                    if (idx >= 0) {
                        followPlayingCover();
                        browseIndex = idx;
                        SiteMusic.select(idx, true);
                    }
                });
                els.tableBody.appendChild(tr);
            });

            updateStatus(list);

            // Scroll playing or browse row into view
            const active = els.tableBody.querySelector('tr.is-playing, tr.is-browse');
            if (active && typeof active.scrollIntoView === 'function') {
                const wrap = els.tableBody.closest('.mu-table-wrap');
                if (wrap) {
                    const aTop = active.offsetTop;
                    const aBot = aTop + active.offsetHeight;
                    if (aTop < wrap.scrollTop) wrap.scrollTop = aTop;
                    else if (aBot > wrap.scrollTop + wrap.clientHeight) {
                        wrap.scrollTop = aBot - wrap.clientHeight;
                    }
                }
            }
        }

        function cfCoverSize() {
            // Use layout width (offsetWidth), never getBoundingClientRect —
            // rotated side covers report a thin projected width and made
            // spacing jump depending on which cover was queried first.
            const center = els.stage && els.stage.querySelector('.mu-cf-cover.is-center');
            const probe = center || (els.stage && els.stage.querySelector('.mu-cf-cover'));
            if (probe) {
                const w = probe.offsetWidth;
                if (w > 8) return w;
            }
            if (els.coverflow) {
                const raw = getComputedStyle(els.coverflow).getPropertyValue('--mu-cf-size').trim();
                const fromVar = parseFloat(raw);
                if (fromVar > 8) return fromVar;
            }
            return window.matchMedia('(max-width: 720px)').matches ? CF_SIZE_NARROW : CF_SIZE;
        }

        function appendCoverArt(parent, track) {
            if (track.thumb) {
                const img = document.createElement('img');
                img.alt = '';
                img.draggable = false;
                img.src = track.thumb;
                img.onerror = () => {
                    img.remove();
                    const ph = document.createElement('div');
                    ph.className = 'mu-cf-ph';
                    ph.textContent = monogram(track.title);
                    parent.appendChild(ph);
                };
                parent.appendChild(img);
            } else {
                const ph = document.createElement('div');
                ph.className = 'mu-cf-ph';
                ph.textContent = monogram(track.title);
                parent.appendChild(ph);
            }
        }

        function createCoverEl(track) {
            const cover = document.createElement('div');
            cover.className = 'mu-cf-cover';
            cover.dataset.trackId = track.id;
            cover.setAttribute('role', 'option');
            cover.tabIndex = -1;

            // Square face only — reflections are painted via CSS box-reflect so
            // rotateY never stretches a tall face+mirror card into a strip.
            const face = document.createElement('div');
            face.className = 'mu-cf-face';
            appendCoverArt(face, track);
            cover.appendChild(face);

            return cover;
        }

        function focusCoverflow() {
            if (els.coverflow && !els.coverflow.hidden) {
                try {
                    els.coverflow.focus({ preventScroll: true });
                } catch (err) {
                    els.coverflow.focus();
                }
            }
        }

        function beginCoverBrowse() {
            coverBrowseActive = true;
            focusCoverflow();
        }

        function followPlayingCover() {
            coverBrowseActive = false;
        }

        function browseToTrackId(trackId, play) {
            const idx = catalogIndexById(trackId);
            if (idx < 0) return;
            if (play) {
                followPlayingCover();
                browseIndex = idx;
                SiteMusic.select(idx, true);
                return;
            }
            beginCoverBrowse();
            browseIndex = idx;
            lastTableKey = '';
            sync(SiteMusic.snapshot());
        }

        function coverFromEvent(e) {
            if (!els.stage) return null;
            if (typeof document.elementsFromPoint === 'function') {
                const stack = document.elementsFromPoint(e.clientX, e.clientY) || [];
                for (let i = 0; i < stack.length; i++) {
                    const el = stack[i];
                    if (!el || !el.closest) continue;
                    const cover = el.closest('.mu-cf-cover');
                    if (cover && els.stage.contains(cover)) return cover;
                }
            }
            // Fallback: nearest cover center (helps when 3D hit-testing misses)
            const covers = els.stage.querySelectorAll('.mu-cf-cover');
            let best = null;
            let bestDist = Infinity;
            for (let i = 0; i < covers.length; i++) {
                const r = covers[i].getBoundingClientRect();
                if (r.width < 2 || r.height < 2) continue;
                const cx = r.left + r.width / 2;
                const cy = r.top + r.height / 2;
                const dist = Math.abs(e.clientX - cx) + Math.abs(e.clientY - cy);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = covers[i];
                }
            }
            return best;
        }

        function onCoverPointer(e) {
            const cover = coverFromEvent(e);
            if (!cover) {
                focusCoverflow();
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            const id = cover.dataset.trackId;
            if (!id) return;

            if (e.type === 'dblclick') {
                browseToTrackId(id, true);
                return;
            }

            if (cover.classList.contains('is-center')) {
                beginCoverBrowse();
                return;
            }
            browseToTrackId(id, false);
        }

        function poseCover(cover, offset) {
            const abs = Math.abs(offset);
            const size = cfCoverSize();
            let transform;
            let origin;

            if (reduced || offset === 0) {
                // Flat center — reflect is CSS-only on .is-center
                origin = '50% 50%';
                transform = offset === 0 && !reduced
                    ? 'translate3d(-50%, -50%, ' + CF_CENTER_Z + 'px) rotateY(0deg)'
                    : 'translate3d(-50%, -50%, 0px) rotateY(0deg)';
            } else if (offset < 0) {
                // Classic Cover Flow: pivot on the near (right) edge
                origin = '100% 50%';
                const x = -(size * 0.5 + CF_GAP) - (abs - 1) * CF_SPACING;
                transform =
                    'translate3d(-50%, -50%, 0) translateX(' + x + 'px) translateZ(' +
                    (-abs * CF_DEPTH) + 'px) rotateY(' + CF_ANGLE + 'deg)';
            } else {
                // Pivot on the near (left) edge
                origin = '0% 50%';
                const x = (size * 0.5 + CF_GAP) + (abs - 1) * CF_SPACING;
                transform =
                    'translate3d(-50%, -50%, 0) translateX(' + x + 'px) translateZ(' +
                    (-abs * CF_DEPTH) + 'px) rotateY(' + (-CF_ANGLE) + 'deg)';
            }

            cover.dataset.offset = String(offset);
            cover.classList.toggle('is-center', offset === 0);
            cover.setAttribute('aria-selected', offset === 0 ? 'true' : 'false');
            cover.style.transformOrigin = origin;
            cover.style.transform = transform;
            cover.style.opacity = '1';
            cover.style.zIndex = String(200 - abs * 2);
        }

        function setCoverCaption(title, artist) {
            if (!els.cfTitle || !els.cfArtist) return;
            const nextTitle = title || 'Unknown';
            const nextArtist = artist || '';
            if (els.cfTitle.textContent === nextTitle && els.cfArtist.textContent === nextArtist) {
                return;
            }

            const cap = els.coverflow && els.coverflow.querySelector('.mu-coverflow-caption');
            if (!cap || reduced) {
                els.cfTitle.textContent = nextTitle;
                els.cfArtist.textContent = nextArtist;
                return;
            }

            if (captionTimer) clearTimeout(captionTimer);
            cap.classList.add('is-swap');
            captionTimer = setTimeout(() => {
                captionTimer = null;
                els.cfTitle.textContent = nextTitle;
                els.cfArtist.textContent = nextArtist;
                cap.classList.remove('is-swap');
            }, 140);
        }

        function renderCoverFlow(snap) {
            if (!els.stage || !els.coverflow) return;
            const list = flowTracks();
            if (!list.length) {
                els.coverflow.hidden = true;
                els.stage.textContent = '';
                lastFlowKey = '';
                return;
            }
            els.coverflow.hidden = false;
            els.coverflow.style.setProperty('--mu-cf-ms', CF_MS + 'ms');

            let centerInFlow = list.findIndex((t) => {
                return SiteMusic.tracks[browseIndex] && t.id === SiteMusic.tracks[browseIndex].id;
            });
            if (centerInFlow < 0) centerInFlow = 0;

            const centerTrack = list[centerInFlow];
            setCoverCaption(centerTrack.title, centerTrack.artist || snap.mixTitle || '');

            const start = reduced ? centerInFlow : Math.max(0, centerInFlow - CF_WINDOW);
            const end = reduced ? centerInFlow + 1 : Math.min(list.length, centerInFlow + CF_WINDOW + 1);
            const listKey = filterQuery + '|' + list.length + '|' + (reduced ? 'r' : '3');
            const snapPose = listKey !== lastFlowKey || !els.stage.children.length;
            lastFlowKey = listKey;

            if (snapPose) els.coverflow.classList.add('is-snap');

            const wanted = new Set();
            for (let i = start; i < end; i++) wanted.add(list[i].id);

            Array.from(els.stage.children).forEach((el) => {
                if (!wanted.has(el.dataset.trackId)) el.remove();
            });

            const byId = new Map();
            Array.from(els.stage.children).forEach((el) => byId.set(el.dataset.trackId, el));

            for (let i = start; i < end; i++) {
                const t = list[i];
                let cover = byId.get(t.id);
                const fresh = !cover;
                if (!cover) {
                    cover = createCoverEl(t);
                    cover.style.transition = 'none';
                    els.stage.appendChild(cover);
                }
                poseCover(cover, i - centerInFlow);
                if (fresh) {
                    void cover.offsetWidth;
                    cover.style.transition = '';
                }
            }

            if (snapPose) {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        if (els.coverflow) els.coverflow.classList.remove('is-snap');
                    });
                });
            }
        }

        function moveBrowse(delta) {
            const list = flowTracks();
            if (!list.length) return;
            let pos = list.findIndex((t) => SiteMusic.tracks[browseIndex] && t.id === SiteMusic.tracks[browseIndex].id);
            if (pos < 0) pos = 0;
            pos = clamp(pos + delta, 0, list.length - 1);
            const idx = catalogIndexById(list[pos].id);
            if (idx < 0) return;
            beginCoverBrowse();
            browseIndex = idx;
            lastTableKey = '';
            sync(SiteMusic.snapshot());
        }

        function sync(snap) {
            if (els.mixTitle) els.mixTitle.textContent = snap.mixTitle || 'Mix';
            setTransportEnabled(snap.tracks.length > 0);
            setShuffleUI(!!snap.shuffle);

            // Stay on the browsed cover while exploring; only follow playback when not browsing
            if (!coverBrowseActive && snap.tracks.length) {
                browseIndex = snap.index;
            }
            browseIndex = clamp(browseIndex, 0, Math.max(0, snap.tracks.length - 1));

            const t = snap.track;
            if (!t) {
                els.lcdTitle.textContent = 'No songs';
                els.lcdSub.textContent = 'Add a mix to start listening';
                setLcdArt(null);
                if (els.seek) {
                    els.seek.max = '0';
                    els.seek.value = '0';
                    setAppRangeFill(els.seek, 0, 0);
                }
                if (els.lcdTimeCur) els.lcdTimeCur.textContent = '0:00';
                if (els.lcdTimeRem) els.lcdTimeRem.textContent = '-0:00';
                if (els.volume) {
                    els.volume.value = String(snap.volume);
                    setAppRangeFill(els.volume, snap.volume, 100);
                }
                setPlayingUI(false);
                renderTable(snap);
                renderCoverFlow(snap);
                return;
            }

            els.lcdTitle.textContent = t.title || 'Unknown';
            els.lcdSub.textContent = t.artist
                ? (t.artist + (snap.mixTitle ? ' — ' + snap.mixTitle : ''))
                : (snap.mixTitle || '');
            setLcdArt(t);

            const dur = snap.duration || Number(t.durationSec) || 0;
            const cur = snap.currentTime || 0;
            if (!seeking && els.seek) {
                els.seek.max = String(Math.max(0, Math.floor(dur)));
                els.seek.value = String(Math.floor(cur));
                if (els.lcdTimeCur) els.lcdTimeCur.textContent = formatTime(cur);
                if (els.lcdTimeRem) els.lcdTimeRem.textContent = formatRemaining(cur, dur);
                setAppRangeFill(els.seek, cur, dur);
            }
            if (els.volume) {
                els.volume.value = String(snap.volume);
                setAppRangeFill(els.volume, snap.volume, 100);
            }
            setPlayingUI(!!snap.playing);
            renderTable(snap);
            renderCoverFlow(snap);
        }

        function onKey(e) {
            const tag = (e.target && e.target.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;

            const flowFocused = els.coverflow && document.activeElement === els.coverflow;

            if (flowFocused && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                e.preventDefault();
                moveBrowse(e.key === 'ArrowLeft' ? -1 : 1);
                return;
            }
            if (flowFocused && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                followPlayingCover();
                SiteMusic.select(browseIndex, true);
                return;
            }

            if (e.key === ' ' || e.code === 'Space') {
                e.preventDefault();
                SiteMusic.toggle();
            } else if (e.key === 'ArrowLeft' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                SiteMusic.prev();
            } else if (e.key === 'ArrowRight' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                SiteMusic.next();
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                SiteMusic.seek(Math.max(0, SiteMusic._currentTime() - 5));
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                const dur = SiteMusic._duration();
                SiteMusic.seek(Math.min(dur, SiteMusic._currentTime() + 5));
            }
        }

        function onWheel(e) {
            if (!els.coverflow || els.coverflow.hidden) return;
            if (!els.coverflow.contains(e.target) && e.target !== els.coverflow) return;
            e.preventDefault();
            const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
            if (Math.abs(delta) < 2) return;
            moveBrowse(delta > 0 ? 1 : -1);
        }

        els.play.addEventListener('click', () => SiteMusic.toggle());
        els.prev.addEventListener('click', () => {
            followPlayingCover();
            SiteMusic.prev();
        });
        els.next.addEventListener('click', () => {
            followPlayingCover();
            SiteMusic.next();
        });
        if (els.shuffle) {
            els.shuffle.addEventListener('click', () => {
                SiteMusic.setShuffle(!SiteMusic.shuffle);
            });
        }
        if (els.volume) {
            els.volume.addEventListener('input', () => {
                const v = Number(els.volume.value) || 0;
                setAppRangeFill(els.volume, v, 100);
                SiteMusic.setVolume(v);
            });
        }
        if (els.seek) {
            bindSeekScrubber(els.seek, {
                setSeeking: (on) => { seeking = on; },
                onInput: () => {
                    const v = Number(els.seek.value) || 0;
                    const max = Number(els.seek.max) || 0;
                    if (els.lcdTimeCur) els.lcdTimeCur.textContent = formatTime(v);
                    if (els.lcdTimeRem) els.lcdTimeRem.textContent = formatRemaining(v, max);
                    setAppRangeFill(els.seek, v, max);
                }
            });
        }
        if (els.filter) {
            els.filter.addEventListener('input', () => {
                filterQuery = els.filter.value || '';
                lastTableKey = '';
                lastFlowKey = '';
                const list = flowTracks();
                if (list.length) {
                    const playing = SiteMusic.tracks[SiteMusic.index];
                    const still = playing && list.some((t) => t.id === playing.id);
                    if (still && !coverBrowseActive) browseIndex = SiteMusic.index;
                    else if (!list.some((t) => SiteMusic.tracks[browseIndex] && t.id === SiteMusic.tracks[browseIndex].id)) {
                        browseIndex = catalogIndexById(list[0].id);
                    }
                }
                sync(SiteMusic.snapshot());
            });
        }

        els.sortHeaders.forEach((th) => {
            const activate = () => {
                const key = th.getAttribute('data-sort');
                if (!key) return;
                if (sortKey === key) sortDir = -sortDir;
                else {
                    sortKey = key;
                    sortDir = 1;
                }
                els.sortHeaders.forEach((h) => {
                    h.classList.toggle('is-sorted', h === th);
                    h.setAttribute('aria-sort', h === th
                        ? (sortDir > 0 ? 'ascending' : 'descending')
                        : 'none');
                });
                lastTableKey = '';
                sync(SiteMusic.snapshot());
            };
            th.addEventListener('click', activate);
            th.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    activate();
                }
            });
        });

        if (els.coverflow) {
            els.coverflow.addEventListener('wheel', onWheel, { passive: false });
            els.coverflow.addEventListener('click', onCoverPointer);
            els.coverflow.addEventListener('dblclick', onCoverPointer);
            // Click empty stage area to focus for keyboard browsing
            els.coverflow.addEventListener('mousedown', (e) => {
                if (e.target === els.coverflow || e.target === els.stage ||
                    (e.target && e.target.classList && e.target.classList.contains('mu-coverflow-floor'))) {
                    focusCoverflow();
                }
            });
        }
        win.addEventListener('keydown', onKey);

        const cfMq = window.matchMedia('(max-width: 720px)');
        const onCfViewport = () => {
            if (!els.coverflow || els.coverflow.hidden) return;
            lastFlowKey = '';
            sync(SiteMusic.snapshot());
        };
        if (cfMq.addEventListener) cfMq.addEventListener('change', onCfViewport);
        else if (cfMq.addListener) cfMq.addListener(onCfViewport);

        let cfResizeTimer = null;
        let cfRo = null;
        if (els.coverflow && typeof ResizeObserver === 'function') {
            cfRo = new ResizeObserver(() => {
                if (!els.coverflow || els.coverflow.hidden) return;
                if (cfResizeTimer) clearTimeout(cfResizeTimer);
                cfResizeTimer = setTimeout(() => {
                    cfResizeTimer = null;
                    // Re-pose with measured cover size after CSS cqh/container rules settle
                    lastFlowKey = '';
                    if (els.coverflow) els.coverflow.classList.add('is-snap');
                    renderCoverFlow(SiteMusic.snapshot());
                    requestAnimationFrame(() => {
                        if (els.coverflow) els.coverflow.classList.remove('is-snap');
                    });
                }, 60);
            });
            cfRo.observe(els.coverflow);
        }

        unsub = SiteMusic.on(sync);
        SiteMusic.loadCatalog().then(() => {
            browseIndex = SiteMusic.index;
            sync(SiteMusic.snapshot());
        });

        win.musicCleanup = function () {
            win.removeEventListener('keydown', onKey);
            if (els.coverflow) {
                els.coverflow.removeEventListener('wheel', onWheel);
                els.coverflow.removeEventListener('click', onCoverPointer);
                els.coverflow.removeEventListener('dblclick', onCoverPointer);
            }
            if (cfRo) cfRo.disconnect();
            if (cfResizeTimer) clearTimeout(cfResizeTimer);
            if (cfMq.removeEventListener) cfMq.removeEventListener('change', onCfViewport);
            else if (cfMq.removeListener) cfMq.removeListener(onCfViewport);
            if (captionTimer) clearTimeout(captionTimer);
            if (unsub) unsub();
        };
    }

    window.initMusicPlayer = initMusicPlayer;

    function boot() {
        initMenubarMusic();
        SiteMusic.loadCatalog();
        SiteMusic.armAmbientAutoplay();

        let lastPositionSync = 0;
        setInterval(() => {
            if (!SiteMusic.playing) return;
            SiteMusic.emit();
            const now = Date.now();
            if (now - lastPositionSync >= 1000) {
                lastPositionSync = now;
                SiteMusic._updateMediaSessionPosition();
            }
        }, 250);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
