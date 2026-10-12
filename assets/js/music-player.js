/**
 * Music - shared YouTube engine, menubar miniplayer, and iTunes-style Music window.
 *
 * Playback is official IFrame API only (no hosted audio). The player iframe
 * lives in a 1x1 offscreen mount - the video surface is never shown.
 */
(function () {
    'use strict';

    // The first-gesture stub in baseof and the lazy Music app loader can both
    // inject this bundle; only the first copy may boot.
    if (window.__musicLoaded) return;
    window.__musicLoaded = true;

    const STATE_KEY = 'music-player-v1';
    const CATALOG_URL = '/music/music.json';
    const DEFAULT_VOLUME = 80;
    // Background music: quiet, a random track, from the top, every visit.
    // Nothing about playback is remembered (track, position or volume).
    const AMBIENT_VOLUME = 20;
    const PREV_RESTART_SEC = 3;
    const AMBIENT_DELAY_MIN_MS = 600;
    const AMBIENT_DELAY_SPAN_MS = 900;
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
    const TICK_MS = 250;
    const HISTORY_MAX = 50;
    const REPEAT_MODES = ['off', 'all', 'one'];
    const CF_SWIPE_STEP = 40; // px of horizontal drag per cover
    const CATALOG_ERROR = 'Could not load the mix';
    const YT_ERROR = 'Could not reach YouTube';
    const TRACK_ERROR = 'Track unavailable, skipping';
    const TRACK_STOPPED_ERROR = 'Track unavailable';
    const ALL_TRACKS_ERROR ='None of these tracks could be played';
    // Listen along (opt-in shared now-playing)
    const LIVE_HEARTBEAT_MS = 8000;
    const LIVE_TTL_MS = 25000;         // judged by local receipt time
    const LIVE_MIN_WRITE_MS = 1500;
    const LIVE_PAUSE_GRACE_MS = 3000;  // the gap between two tracks is not a pause
    const LIVE_MAX_PEERS = 30;
    const LIVE_MAX_SEEN = 200;
    const LIVE_MAX_ROWS = 3;
    const LIVE_PRUNE_MS = 5000;
    const LIVE_DRIFT_SEC = 2.5;
    const LIVE_LOAD_LEAD_SEC = 1;      // a freshly loaded video takes about this long to start
    const LIVE_END_HOLD_MS = 6000;
    const LIVE_FOLLOW_TRACK_MS = 3000;
    const LIVE_FOLLOW_SEEK_MS = 5000;
    const LIVE_NOTICE_MS = 7000;
    const LIVE_GUN_POLL_MS = 500;
    const LIVE_GUN_POLL_TRIES = 60;
    const LOAD_STALE_MS = 8000;

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
                tag.onerror = () => {
                    // Drop the cached promise and the dead tag so a retry re-inserts it
                    ytApiPromise = null;
                    tag.remove();
                    reject(new Error('YouTube IFrame API failed to load'));
                };
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

    function isHomePage() {
        const p = window.location.pathname;
        return p === '/' || p === '/index.html';
    }

    /** Data-saver or a slow connection: never start ambient playback. */
    function isConstrainedConnection() {
        const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (!c) return false;
        if (c.saveData) return true;
        return /(^|-)(2g|3g)$/.test(String(c.effectiveType || ''));
    }

    function shuffled(list) {
        const a = list.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = a[i];
            a[i] = a[j];
            a[j] = tmp;
        }
        return a;
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
    const timeListeners = new Set();

    const SiteMusic = {
        tracks: [],
        mixTitle: "Ankush's Mix",
        manifestHash: 'empty',
        index: 0,
        volume: DEFAULT_VOLUME,
        shuffle: false,
        repeat: 'all',
        error: null,
        player: null,
        ready: false,
        playing: false,
        ambientStarted: false,
        ambientSuppressed: false,
        userPaused: false,
        catalogPromise: null,
        _userStarted: false,
        _ambientHold: false,
        _ambientPlayback: false,
        _ambientHeld: false,
        _ambientDeferred: false,
        _errorStreak: 0,
        _shuffleQueue: null,
        _history: [],
        _tick: null,
        _lastPositionSync: 0,
        _resumeTime: 0,
        _resumeApplied: false,
        _seekTarget: null,
        _seekGuardUntil: 0,
        _loadingSince: 0,
        _loadingAt: 0,
        _loadSeq: 0,

        on(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },

        /** Lightweight progress-only subscription (fires on the playback tick). */
        onTime(fn) {
            timeListeners.add(fn);
            return () => timeListeners.delete(fn);
        },

        emit() {
            this._syncTick();
            Live.onState();
            const snap = this.snapshot();
            listeners.forEach((fn) => {
                try { fn(snap); } catch (e) { /* ignore */ }
            });
        },

        emitTime() {
            const time = { currentTime: this._currentTime(), duration: this._duration() };
            timeListeners.forEach((fn) => {
                try { fn(time); } catch (e) { /* ignore */ }
            });
        },

        /** The progress tick only runs while something is playing. */
        _syncTick() {
            if (this.playing && !this._tick) {
                this._tick = setInterval(() => this._onTick(), TICK_MS);
            } else if (!this.playing && this._tick) {
                clearInterval(this._tick);
                this._tick = null;
            }
        },

        _onTick() {
            if (!this.playing) return;
            this.emitTime();
            const now = Date.now();
            if (now - this._lastPositionSync >= 1000) {
                this._lastPositionSync = now;
                this._updateMediaSessionPosition();
            }
            Live.heartbeat(now);
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
                repeat: this.repeat,
                error: this.error,
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
            // The player still reports the previous video until the new one starts
            if (this._isLoading()) return this._loadingAt;

            try {
                if (this.player && this.ready) return this.player.getCurrentTime() || 0;
            } catch (e) { /* ignore */ }
            return this._resumeTime || 0;
        },

        /**
         * A track was asked to play and YouTube has not reported back yet.
         * Until it does, the player still holds the previous video's time,
         * so listen-along neither publishes nor corrects drift. A load that
         * never reports back stops counting after LOAD_STALE_MS.
         */
        _isLoading() {
            return this._loadingSince > 0 && Date.now() - this._loadingSince < LOAD_STALE_MS;
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
            const changed = this.ambientSuppressed || this.userPaused;
            this.ambientSuppressed = false;
            this.userPaused = false;
            this._ambientPlayback = false;
            this._ambientHeld = false;
            // From here on the visitor is driving. A pending ambient start
            // would otherwise fire a few seconds after a failed Play, swap
            // the track and volume, and wipe the error and Retry button.
            this._userStarted = true;
            this._ambientDeferred = false;
            if (changed) writeState({ suppressed: false, userPaused: false });
            showMenubarMusic(true);
        },

        loadCatalog() {
            if (this.catalogPromise) return this.catalogPromise;
            const pending = fetch(CATALOG_URL)
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

                    // Only the listening preferences come back; the track,
                    // position and volume start fresh on every visit
                    const saved = readState();
                    if (saved && typeof saved.shuffle === 'boolean') {
                        this.shuffle = saved.shuffle;
                    }
                    if (saved && REPEAT_MODES.indexOf(saved.repeat) !== -1) {
                        this.repeat = saved.repeat;
                    }
                    if (this.error === CATALOG_ERROR) this.error = null;
                    this.emit();
                    return this.tracks;
                })
                .catch(() => {
                    this.tracks = [];
                    this.error = CATALOG_ERROR;
                    // Not cached: the next loadCatalog() (or Retry) fetches again
                    if (this.catalogPromise === pending) this.catalogPromise = null;
                    this.emit();
                    return this.tracks;
                });
            this.catalogPromise = pending;
            return pending;
        },

        /** Shuffle and repeat only: what plays, where and how loud is never saved. */
        persist() {
            writeState({ shuffle: this.shuffle, repeat: this.repeat });
        },

        setShuffle(on) {
            this.shuffle = !!on;
            this._shuffleQueue = null;
            this._history = [];
            this.persist();
            this.emit();
        },

        /** 'off' stops after the last track, 'all' wraps, 'one' loops the track. */
        setRepeat(mode) {
            this.repeat = REPEAT_MODES.indexOf(mode) !== -1 ? mode : 'off';
            this.persist();
            this.emit();
        },

        cycleRepeat() {
            const i = REPEAT_MODES.indexOf(this.repeat);
            this.setRepeat(REPEAT_MODES[(i + 1) % REPEAT_MODES.length]);
        },

        /** Next index from the shuffled queue, or -1 when a full pass is done. */
        _nextShuffled(refill) {
            if (!this._shuffleQueue || (refill && !this._shuffleQueue.length)) {
                const rest = [];
                for (let i = 0; i < this.tracks.length; i++) {
                    if (i !== this.index) rest.push(i);
                }
                this._shuffleQueue = shuffled(rest);
            }
            if (!this._shuffleQueue.length) return -1;
            return this._shuffleQueue.shift();
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
                            onError: () => this._onPlayerError()
                        }
                    });
                });
            });
        },

        /** A video that will not play: skip it, but give up after a full pass. */
        _onPlayerError() {
            this._loadingSince = 0;
            // Otherwise the listener being followed pulls us straight back
            Live.leave();
            this._errorStreak += 1;
            if (this._errorStreak >= this.tracks.length) {
                this._errorStreak = 0;
                this.playing = false;
                this.error = ALL_TRACKS_ERROR;
                this.emit();
                return;
            }
            // _advance goes through select(), which clears the previous error
            const moved = this._advance(true);
            this.error = moved ? TRACK_ERROR : TRACK_STOPPED_ERROR;
            this.emit();
        },

        /** Clear the last failure and try again (catalog first, then playback). */
        retry() {
            this.error = null;
            this._errorStreak = 0;
            if (!this.tracks.length) {
                this.emit();
                return this.loadCatalog();
            }
            return this.select(this.index, true);
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
            if (state === YT.PlayerState.PLAYING || state === YT.PlayerState.PAUSED ||
                state === YT.PlayerState.ENDED) {
                this._loadingSince = 0;
            }
            if (state === YT.PlayerState.PLAYING) {
                this.playing = true;
                this.error = null;
                this._errorStreak = 0;
                if (!this._trackedPlay) {
                    this._trackedPlay = true;
                    if (window.track) window.track('music_play', { ambient: !!this._ambientPlayback });
                }
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
                // Listening along: give the other side a moment to move on
                // first, so we go to their next track and not our own.
                if (Live.holdEnd()) {
                    this.emit();
                    return;
                }
                this._advance(false);
            }
        },

        /**
         * opts.auto - not a user gesture (ambient start, auto-advance): keeps
         *             the Stop/pause choice and the ambient flag untouched.
         * opts.back - history navigation from prev(): not recorded again.
         * opts.follow - made by listen-along itself; any other non-auto
         *             select is the visitor choosing a track, which ends it.
         */
        select(i, play, seekTo, opts) {
            opts = opts || {};
            if (!this.tracks.length) return Promise.resolve();
            if (!opts.auto && !opts.follow) Live.leave();
            const nextIndex = clamp(i, 0, this.tracks.length - 1);
            const sameTrack = nextIndex === this.index;
            if (this.shuffle) {
                // Only tracks that were actually loaded count as history
                if (!sameTrack && !opts.back && this.player) {
                    this._history.push(this.index);
                    if (this._history.length > HISTORY_MAX) this._history.shift();
                }
                if (this._shuffleQueue) {
                    this._shuffleQueue = this._shuffleQueue.filter((q) => q !== nextIndex);
                }
            }
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

            if (play) this.error = null;
            if (play && !opts.auto) this._allowMenubar();
            else if (!this.ambientSuppressed) showMenubarMusic(true);
            if (play) {
                this._loadingSince = Date.now();
                this._loadingAt = start;
                this._loadSeq += 1;
            }

            this.emit();

            return this.ensurePlayer(track.videoId).then((p) => {
                if (!p || !track) return;
                // A newer select() took over while the player was loading
                if (this.tracks[this.index] !== track) return;
                // Ambient start that was stopped, paused or held in the meantime
                if (play && opts.auto && this._ambientPlayback) {
                    if (this.ambientSuppressed || this.userPaused || this._ambientHold) {
                        this._loadingSince = 0;
                    }
                    if (this.ambientSuppressed || this.userPaused) return;
                    if (this._ambientHold) {
                        this.ambientStarted = false;
                        this._ambientDeferred = true;
                        return;
                    }
                }
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
            }).catch(() => {
                if (this.tracks[this.index] === track) this._loadingSince = 0;
                // Blocked, offline or timed out. Ambient starts fail quietly.
                if (!play || opts.auto) return;
                this.playing = false;
                this.error = YT_ERROR;
                this.emit();
            });
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

        /** User pause: remembered, so ambient autoplay stays off on later visits. */
        pause() {
            Live.leave();
            this._ambientHeld = false;
            if (!this.userPaused) {
                this.userPaused = true;
                writeState({ userPaused: true });
            }
            this._pause();
        },

        _pause() {
            this._loadingSince = 0;
            try {
                if (this.player && this.ready) this.player.pauseVideo();
            } catch (e) { /* ignore */ }
            this.persist();
            this.playing = false;
            this.emit();
        },

        /** Stop and hide: also remembered across page loads. */
        stopAndHide() {
            this.ambientSuppressed = true;
            writeState({ suppressed: true });
            this.pause();
        },

        /**
         * Shell hook (not persisted): while on, ambient music will not start,
         * and ambient playback that is already running is paused until released.
         * Music the visitor started themselves is left alone.
         */
        suppressAmbient(on) {
            this._ambientHold = !!on;
            if (this._ambientHold) {
                if (this.playing && this._ambientPlayback) {
                    this._ambientHeld = true;
                    this._pause();
                }
                return;
            }
            if (this.ambientSuppressed || this.userPaused) return;
            if (this._ambientHeld) {
                this._ambientHeld = false;
                try {
                    if (this.player && this.ready) this.player.playVideo();
                } catch (e) { /* ignore */ }
            } else if (this._ambientDeferred) {
                this._ambientDeferred = false;
                this._startAmbient();
            }
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
            if (this.shuffle) {
                // Back through what was actually played, not catalog order
                if (!this._history.length) {
                    this.seek(0);
                    return;
                }
                const back = this._history.pop();
                if (this._shuffleQueue) this._shuffleQueue.unshift(this.index);
                this.select(back, true, 0, { back: true });
                return;
            }
            this.select(Math.max(0, this.index - 1), true);
        },

        next() {
            if (!this.tracks.length) return;
            if (this.shuffle && this.tracks.length > 1) {
                this.select(this._nextShuffled(true), true, 0);
                return;
            }
            if (this.index >= this.tracks.length - 1) {
                this.select(0, true);
                return;
            }
            this.select(this.index + 1, true);
        },

        /**
         * Automatic advance (track ended, or skipping one that failed).
         * Honours repeat; returns false when playback stops instead.
         */
        _advance(afterError) {
            if (!this.tracks.length) return false;
            const auto = { auto: true };
            if (this.repeat === 'one' && !afterError) {
                this.select(this.index, true, 0, auto);
                return true;
            }
            let target;
            if (this.shuffle && this.tracks.length > 1) {
                target = this._nextShuffled(this.repeat !== 'off');
                if (target < 0) this._shuffleQueue = null;
            } else if (this.index < this.tracks.length - 1) {
                target = this.index + 1;
            } else {
                target = this.repeat === 'off' ? -1 : 0;
            }
            if (target < 0) {
                this.playing = false;
                this._resumeTime = 0;
                this.persist();
                this.emit();
                return false;
            }
            this.select(target, true, 0, auto);
            return true;
        },

        seek(sec, opts) {
            // A seek by the visitor ends listening along; its own are marked
            if (!(opts && opts.follow)) Live.leave();
            const t = Math.max(0, Number(sec) || 0);
            // Optimistic time until the IFrame API reports the new position
            this._seekTarget = t;
            this._seekGuardUntil = Date.now() + 1200;
            this._resumeTime = t;
            if (this._isLoading()) this._loadingAt = t;
            try {
                if (this.player && this.ready) this.player.seekTo(t, true);
            } catch (e) { /* ignore */ }
            this._updateMediaSessionPosition();
            this.emit();
            Live.onSeek();
        },

        playRandom(opts) {
            opts = opts || {};
            if (!this.tracks.length) return Promise.resolve();
            let i = Math.floor(Math.random() * this.tracks.length);
            if (this.tracks.length > 1 && i === this.index) {
                i = (i + 1) % this.tracks.length;
            }
            if (typeof opts.volume === 'number') this.volume = clamp(opts.volume, 0, 100);
            return this.select(i, true, 0);
        },

        /**
         * Ambient start: a random track from the top, at background volume.
         * Goes through select(auto) so a Stop/pause choice is never cleared.
         */
        _startAmbient() {
            if (!this.tracks.length || this.ambientStarted || this.playing) return;
            if (this.ambientSuppressed || this.userPaused || this._userStarted) return;
            if (this._ambientHold) {
                this._ambientDeferred = true;
                return;
            }
            this.ambientStarted = true;
            this._ambientPlayback = true;
            this.volume = AMBIENT_VOLUME;
            this._resumeTime = 0;
            this.select(Math.floor(Math.random() * this.tracks.length), true, 0, { auto: true });
        },

        /**
         * Home page only, never on data-saver or 2g/3g, and never once the
         * visitor has pressed pause or Stop and hide. Keyboard input does not
         * arm it, so keyboard and screen-reader users are not surprised by audio.
         */
        armAmbientAutoplay() {
            if (!isHomePage() || isConstrainedConnection()) return;
            if (this.ambientSuppressed || this.userPaused) return;

            let armed = false;
            const arm = (e) => {
                // Enter/Space on a focused control fires a click with
                // detail 0; only a real pointer or touch gesture arms it.
                if (e && e.type === 'click' && e.detail === 0) return;
                document.removeEventListener('click', arm);
                document.removeEventListener('touchstart', arm);
                if (armed || this.ambientSuppressed || this.userPaused) return;
                armed = true;

                const delay = AMBIENT_DELAY_MIN_MS + Math.random() * AMBIENT_DELAY_SPAN_MS;
                setTimeout(() => {
                    if (this.ambientStarted || this.playing || this._userStarted) return;
                    this.loadCatalog().then(() => this._startAmbient());
                }, delay);
            };

            // The first-gesture loader stub in baseof stamps this when its
            // click/tap pulls the bundle in; that gesture has already happened.
            if (window.__musicGestureAt) {
                arm();
                return;
            }
            document.addEventListener('click', arm);
            document.addEventListener('touchstart', arm);
        }
    };

    window.SiteMusic = SiteMusic;

    // ------------------------------------------------------------------
    // Listen along - opt-in shared now-playing over the realtime relay
    //
    // A visitor who ticks "Share what I'm playing" publishes one small
    // record ({ t: track id, pos: seconds, p: playing, f: who they are
    // listening along with, ts }) under their anonymous visitor id. Everyone
    // with the Music window open sees "N listening to <track>" and can tune
    // in: that loads the same track at the same position and then keeps
    // following that listener until either side does something else.
    // Nothing here ever starts playback without a click on Tune In.
    // ------------------------------------------------------------------

    const liveListeners = new Set();

    function utcDay() {
        return new Date().toISOString().slice(0, 10);
    }

    const Live = {
        sharing: false,
        connected: false,
        following: null,     // visitor id being listened along with
        notice: '',
        peers: new Map(),    // id -> { t, pos, f, at } - live, playing, in this mix
        _seen: new Map(),    // id -> last `ts`, to tell a heartbeat from a replay
        _days: new Set(),
        _myId: null,
        _gunReady: false,
        _gunWaiters: null,
        _watchers: 0,
        _subscribed: false,
        _pruneTimer: null,
        _writeTimer: null,
        _lastWrite: 0,
        _lastSig: '',
        _online: false,      // our last published record said "playing"
        _endHold: null,
        _lastFollowTrack: 0,
        _lastFollowSeek: 0,
        _changeTimer: null,
        _noticeTimer: null,
        _syncRetry: null,

        on(fn) {
            liveListeners.add(fn);
            return () => liveListeners.delete(fn);
        },

        _changed() {
            if (this._changeTimer) return;
            this._changeTimer = setTimeout(() => {
                this._changeTimer = null;
                liveListeners.forEach((fn) => {
                    try { fn(); } catch (e) { /* ignore */ }
                });
            }, 120);
        },

        _setNotice(text) {
            this.notice = text;
            if (this._noticeTimer) clearTimeout(this._noticeTimer);
            this._noticeTimer = setTimeout(() => {
                this._noticeTimer = null;
                this.notice = '';
                this._changed();
            }, LIVE_NOTICE_MS);
        },

        /** The realtime bundle loads at idle, possibly after this one. */
        _whenGun(fn) {
            if (this._gunReady) {
                fn();
                return;
            }
            if (this._gunWaiters) {
                this._gunWaiters.push(fn);
                return;
            }
            this._gunWaiters = [fn];
            let tries = 0;
            const check = () => {
                const sg = window.SiteGun;
                if (sg && typeof sg.getGun === 'function' && typeof sg.visitorId === 'function' &&
                    typeof window.Gun === 'function') {
                    try {
                        this._myId = String(sg.visitorId());
                        sg.getGun();
                        if (typeof sg.getConnection === 'function') {
                            sg.getConnection().onChange((up) => {
                                this.connected = !!up;
                                // Say so straight away rather than at the next heartbeat
                                if (up && this._online) this._schedule(0);
                                this._changed();
                            });
                        }
                    } catch (e) {
                        this._gunWaiters = null;
                        return;
                    }
                    this._gunReady = true;
                    const waiting = this._gunWaiters;
                    this._gunWaiters = null;
                    waiting.forEach((w) => {
                        try { w(); } catch (e) { /* ignore */ }
                    });
                    return;
                }
                tries += 1;
                // Realtime never arrived (blocked or offline): stay quiet
                if (tries >= LIVE_GUN_POLL_TRIES) {
                    this._gunWaiters = null;
                    return;
                }
                setTimeout(check, LIVE_GUN_POLL_MS);
            };
            check();
        },

        _ref(day) {
            const sg = window.SiteGun;
            if (sg.paths && sg.paths.live && typeof sg.paths.live.music === 'function') {
                return sg.paths.live.music(day);
            }
            return sg.getGun().get(sg.ROOT).get('live').get('music').get(day);
        },

        // ---- publishing (only while sharing is on) ----

        init(saved) {
            this.sharing = !!(saved && saved.share);
            if (this.sharing) this._whenGun(() => this.onState());
            window.addEventListener('pagehide', () => {
                if (!this._online) return;
                if (this._writeTimer) clearTimeout(this._writeTimer);
                this._writeTimer = null;
                this._lastSig = '';
                this._put({ t: '', pos: 0, p: false, f: '', ts: Date.now() });
                this._online = false;
            });
        },

        setSharing(on) {
            on = !!on;
            if (on === this.sharing) return;
            this.sharing = on;
            writeState({ share: on });
            if (window.track) window.track('music_share_toggle', { on: on });
            if (on) {
                this._whenGun(() => this.onState());
            } else if (this._gunReady) {
                this._lastSig = '';
                this._schedule(0);
            }
            this._changed();
        },

        _record() {
            const t = SiteMusic.tracks[SiteMusic.index];
            const on = !!(this.sharing && t && SiteMusic.playing);
            return {
                t: on ? t.id : '',
                pos: on ? Math.round(SiteMusic._currentTime() * 10) / 10 : 0,
                p: on,
                f: (on && this.following) || '',
                // Sorts last on the wire, so a reader that waits for `ts` to
                // change always sees the other fields already updated
                ts: Date.now()
            };
        },

        _put(rec) {
            try {
                this._ref(utcDay()).get(this._myId).put(rec);
            } catch (e) { /* relay unavailable */ }
        },

        _publish() {
            if (!this._gunReady) return;
            const rec = this._record();
            // Nothing to take back if we never said we were playing
            if (!rec.p && !this._online) return;
            // Mid-load: onState() writes once the new track is under way
            if (rec.p && SiteMusic._isLoading()) return;
            const was = this._online;
            this._online = rec.p;
            this._lastWrite = Date.now();
            this._put(rec);
            if (was !== this._online) this._changed();
        },

        _schedule(delay) {
            if (this._writeTimer) clearTimeout(this._writeTimer);
            const wait = Math.max(delay, this._lastWrite + LIVE_MIN_WRITE_MS - Date.now(), 0);
            this._writeTimer = setTimeout(() => {
                this._writeTimer = null;
                this._publish();
            }, wait);
        },

        /** Called on every engine state change; writes only when ours changed. */
        onState() {
            if (!this._gunReady || (!this.sharing && !this._online)) return;
            // Wait for the new track to actually start: the time it starts at
            // is what everyone listening along lines up with
            if (SiteMusic.playing && SiteMusic._isLoading()) return;
            const t = SiteMusic.tracks[SiteMusic.index];
            // The load counter makes a replay of the same track (repeat one,
            // picking it again) a change too, so followers hear of it at once
            const sig = (this.sharing && t && SiteMusic.playing)
                ? t.id + '|' + (this.following || '') + '|' + SiteMusic._loadSeq
                : '';
            if (sig === this._lastSig) return;
            this._lastSig = sig;
            this._schedule(sig ? 0 : LIVE_PAUSE_GRACE_MS);
        },

        onSeek() {
            if (this._online && !this._writeTimer) this._schedule(0);
        },

        heartbeat(now) {
            // Catches a load that finished without a state change reaching us
            this.onState();
            if (this._online && !this._writeTimer && now - this._lastWrite >= LIVE_HEARTBEAT_MS) {
                this._publish();
            }
        },

        // ---- watching (while a Music window is open, or while following) ----

        watch() {
            this._watchers += 1;
            this._whenGun(() => {
                this._subscribe();
                this._syncPrune();
            });
        },

        unwatch() {
            this._watchers = Math.max(0, this._watchers - 1);
            this._syncPrune();
        },

        _subscribe() {
            const day = utcDay();
            if (this._days.has(day)) return;
            this._days.add(day);
            try {
                this._ref(day).map().on((data, id) => this._onPeer(data, id));
            } catch (e) { /* relay unavailable */ }
        },

        _syncPrune() {
            const want = this._gunReady && (this._watchers > 0 || !!this.following);
            if (want && !this._pruneTimer) {
                this._pruneTimer = setInterval(() => this._prune(), LIVE_PRUNE_MS);
            } else if (!want && this._pruneTimer) {
                clearInterval(this._pruneTimer);
                this._pruneTimer = null;
            }
        },

        /** Peer records are untrusted: every field is checked and clamped. */
        _onPeer(data, id) {
            if (typeof id !== 'string' || !id || id.length > 64 || id === this._myId) return;
            if (!data || typeof data !== 'object') {
                this._drop(id);
                return;
            }
            const ts = Number(data.ts);
            if (!isFinite(ts)) return;

            // Only a changed `ts` is a sign of life. On first sight the
            // sender's clock is trusted just far enough to tell a record
            // from this minute from one left behind hours ago.
            const now = Date.now();
            let age = 0;
            const last = this._seen.get(id);
            if (last === undefined) {
                if (this._seen.size >= LIVE_MAX_SEEN) this._seen.delete(this._seen.keys().next().value);
                this._seen.set(id, ts);
                if (Math.abs(now - ts) > LIVE_TTL_MS) return;
                age = clamp(now - ts, 0, LIVE_HEARTBEAT_MS + LIVE_MIN_WRITE_MS);
            } else {
                if (last === ts) return;
                this._seen.set(id, ts);
            }

            const trackId = typeof data.t === 'string' ? data.t : '';
            const track = trackId && trackId.length <= 40
                ? SiteMusic.tracks.find((t) => t.id === trackId)
                : null;
            if (data.p !== true || !track) {
                this._drop(id);
                return;
            }
            if (!this.peers.has(id) && this.peers.size >= LIVE_MAX_PEERS) return;

            let pos = Number(data.pos);
            if (!isFinite(pos)) pos = 0;
            this.peers.set(id, {
                t: trackId,
                pos: clamp(pos, 0, Number(track.durationSec) || 36000),
                f: typeof data.f === 'string' && data.f.length <= 64 ? data.f : '',
                at: now - age
            });
            if (id === this.following) this._syncToLeader();
            this._changed();
        },

        _drop(id) {
            if (!this.peers.delete(id)) return;
            if (id === this.following) this._leaderLost();
            this._changed();
        },

        _prune() {
            const now = Date.now();
            const gone = [];
            this.peers.forEach((peer, id) => {
                if (now - peer.at > LIVE_TTL_MS) gone.push(id);
            });
            gone.forEach((id) => this._drop(id));
            // A new UTC day is a new node
            this._subscribe();
        },

        _posOf(peer) {
            return peer.pos + (Date.now() - peer.at) / 1000;
        },

        /**
         * Who a listener is really following: 'me', a visitor id, or null
         * when the chain cannot be resolved.
         */
        _rootOf(id) {
            let cur = id;
            for (let hop = 0; hop < 4; hop++) {
                const peer = this.peers.get(cur);
                if (!peer) return null;
                if (!peer.f) return cur;
                if (peer.f === this._myId) return 'me';
                cur = peer.f;
            }
            return null;
        },

        /** Other listeners grouped by track, busiest first. */
        groups() {
            const byTrack = new Map();
            this.peers.forEach((peer, id) => {
                const ids = byTrack.get(peer.t);
                if (ids) ids.push(id);
                else byTrack.set(peer.t, [id]);
            });
            const out = [];
            byTrack.forEach((ids, trackId) => {
                const index = SiteMusic.tracks.findIndex((t) => t.id === trackId);
                if (index < 0) return;
                ids.sort();
                let leader = null;
                let withYou = true;
                ids.forEach((id) => {
                    const root = this._rootOf(id);
                    if (root === 'me') return;
                    withYou = false;
                    // An unresolved chain: that listener is as good a guide as any
                    if (!leader) leader = root || id;
                });
                out.push({
                    trackId: trackId,
                    index: index,
                    track: SiteMusic.tracks[index],
                    count: ids.length,
                    leader: leader,
                    withYou: withYou,
                    joined: !!this.following &&
                        (leader === this.following || ids.indexOf(this.following) !== -1)
                });
            });
            out.sort((a, b) => {
                return (Number(b.joined) - Number(a.joined)) || (b.count - a.count) || (a.index - b.index);
            });
            return out;
        },

        snapshot() {
            return {
                sharing: this.sharing,
                connected: this.connected,
                broadcasting: this._online,
                following: this.following,
                others: this.peers.size,
                groups: this.groups(),
                notice: this.notice
            };
        },

        // ---- listening along ----

        /** Always the result of a click: this is the one place playback starts. */
        tuneIn(trackId) {
            const group = this.groups().find((g) => g.trackId === trackId);
            const leader = group && group.leader;
            const peer = leader && this.peers.get(leader);
            if (!peer) return false;
            const index = SiteMusic.tracks.findIndex((t) => t.id === peer.t);
            if (index < 0) return false;
            this._clearEndHold();
            this._clearRetry();
            this.following = leader;
            this._lastFollowTrack = Date.now();
            this._lastFollowSeek = Date.now();
            if (this.notice) this.notice = '';
            SiteMusic.select(index, true, this._startFor(peer, index), { follow: true });
            if (window.track) window.track('music_tune_in', { listeners: group.count });
            this._syncPrune();
            this.onState();
            this._changed();
            return true;
        },

        _startFor(peer, index) {
            const dur = Number(SiteMusic.tracks[index].durationSec) || 0;
            const at = this._posOf(peer) + LIVE_LOAD_LEAD_SEC;
            // Never 0: select() reads that as "no position given"
            return clamp(at, 0.1, dur > 2 ? dur - 1 : at);
        },

        /** Stop following; playback itself is left exactly as it is. */
        leave() {
            if (!this.following) return;
            this.following = null;
            this._clearEndHold();
            this._clearRetry();
            this._syncPrune();
            this.onState();
            this._changed();
        },

        _leaderLost() {
            if (!this.following) return;
            this.following = null;
            this._setNotice('They stopped listening');
            const held = !!this._endHold;
            this._clearEndHold();
            this._clearRetry();
            this._syncPrune();
            // We were waiting on them at the end of a track: carry on alone
            if (held) SiteMusic._advance(false);
            this.onState();
            this._changed();
        },

        _clearEndHold() {
            if (this._endHold) clearTimeout(this._endHold);
            this._endHold = null;
        },

        /** Our track ended while following. @returns {boolean} true to wait. */
        holdEnd() {
            if (!this.following || !this.peers.has(this.following)) return false;
            this._clearEndHold();
            this._endHold = setTimeout(() => {
                this._endHold = null;
                // No word from them: carry on with our own queue. If they
                // do move on later, the next heartbeat brings us back.
                if (!SiteMusic.playing) SiteMusic._advance(false);
            }, LIVE_END_HOLD_MS);
            return true;
        },

        /** Runs on each heartbeat from the listener being followed. */
        _syncToLeader() {
            const peer = this.peers.get(this.following);
            if (!peer) return;
            const index = SiteMusic.tracks.findIndex((t) => t.id === peer.t);
            if (index < 0) return;
            const now = Date.now();
            const want = this._posOf(peer);
            const dur = Number(SiteMusic.tracks[index].durationSec) || 0;
            // While we wait at the end of a track, the same track only counts
            // once they have started it over (repeat one). The player knows
            // the real length; the catalog's is only a fallback.
            const restarted = !!this._endHold && index === SiteMusic.index &&
                want < (SiteMusic._duration() || dur) - 5;

            if (index !== SiteMusic.index || restarted) {
                // A hostile "leader" cannot make us thrash through the mix,
                // but a real change that comes in too soon is caught up on
                // as soon as the limit allows, not at their next heartbeat.
                const wait = this._lastFollowTrack + LIVE_FOLLOW_TRACK_MS - now;
                if (wait > 0) {
                    this._retrySync(wait);
                    return;
                }
                this._lastFollowTrack = now;
                this._lastFollowSeek = now;
                this._clearEndHold();
                SiteMusic.select(index, true, this._startFor(peer, index), { auto: true, follow: true });
                return;
            }
            if (!SiteMusic.playing || this._endHold) return;
            // Our own track is still loading; look again once it plays
            if (SiteMusic._isLoading()) {
                this._retrySync(1000);
                return;
            }
            if (Math.abs(SiteMusic._currentTime() - want) <= LIVE_DRIFT_SEC) return;
            const wait = this._lastFollowSeek + LIVE_FOLLOW_SEEK_MS - now;
            if (wait > 0) {
                this._retrySync(wait);
                return;
            }
            this._lastFollowSeek = now;
            SiteMusic.seek(clamp(want, 0, dur > 2 ? dur - 1 : want), { follow: true });
        },

        _retrySync(wait) {
            if (this._syncRetry) return;
            this._syncRetry = setTimeout(() => {
                this._syncRetry = null;
                if (this.following) this._syncToLeader();
            }, Math.max(50, wait));
        },

        _clearRetry() {
            if (this._syncRetry) clearTimeout(this._syncRetry);
            this._syncRetry = null;
        }
    };

    SiteMusic.live = Live;

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
        let lastArtSrc = null;
        let retryBtn = null;

        // Assign src only when it changes: re-setting it on every sync re-ran
        // the image load and flickered the art when a thumbnail was broken.
        function setArt(src) {
            if (!els.art || src === lastArtSrc) return;
            lastArtSrc = src;
            if (src) {
                els.art.onerror = () => { els.art.hidden = true; };
                els.art.hidden = false;
                els.art.src = src;
            } else {
                els.art.hidden = true;
                els.art.removeAttribute('src');
            }
        }

        function setError(message) {
            if (!message) {
                if (retryBtn) retryBtn.hidden = true;
                return;
            }
            els.artist.textContent = message;
            if (!retryBtn && els.artist.parentNode) {
                retryBtn = document.createElement('button');
                retryBtn.type = 'button';
                retryBtn.className = 'mu-retry mu-mb-retry';
                retryBtn.textContent = 'Retry';
                retryBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    SiteMusic.retry();
                });
                els.artist.parentNode.appendChild(retryBtn);
            }
            if (retryBtn) retryBtn.hidden = false;
        }

        function syncTime(cur, dur) {
            if (!els.seek || mbSeeking) return;
            els.seek.max = String(Math.floor(dur));
            els.seek.value = String(Math.floor(cur));
            els.timeCur.textContent = formatTime(cur);
            els.timeDur.textContent = formatRemaining(cur, dur);
            setRangeFill(els.seek, '--mu-mb-seek-pct', cur, dur);
        }

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
                setArt(null);
                setError(snap.error);
                syncTime(0, 0);
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
            setArt(t.thumb || null);
            setError(snap.error);
            setMenubarPlayIcon(!!snap.playing);
            if (els.volume) {
                els.volume.value = String(snap.volume);
                setRangeFill(els.volume, '--mu-mb-vol-pct', snap.volume, 100);
            }
            syncTime(snap.currentTime || 0, snap.duration || Number(t.durationSec) || 0);
            if (els.toggle) {
                els.toggle.setAttribute(
                    'aria-label',
                    snap.playing ? ('Now playing: ' + line) : ('Music: ' + line)
                );
            }
        }

        SiteMusic.on(sync);
        SiteMusic.onTime((time) => syncTime(time.currentTime, time.duration));
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
            SiteMusic.stopAndHide();
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
            // The repeat button reuses the .mu-shuffle look
            shuffle: root.querySelector('.mu-shuffle:not(.mu-repeat)'),
            repeat: root.querySelector('.mu-repeat'),
            repeatOne: root.querySelector('.mu-repeat-one'),
            retry: root.querySelector('.mu-lcd-retry'),
            emptyTitle: root.querySelector('.mu-empty p'),
            emptyHint: root.querySelector('.mu-empty-hint'),
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
            sortHeaders: root.querySelectorAll('th[data-sort]'),
            live: root.querySelector('.mu-live'),
            share: root.querySelector('.mu-share-toggle'),
            liveCount: root.querySelector('.mu-live-count')
        };

        let seeking = false;
        let unsub = null;
        let unsubTime = null;
        let browseIndex = 0;
        let filterQuery = '';
        let sortKey = 'index'; // mix order; matches the '#' header's aria-sort
        let sortDir = 1;
        let coverBrowseActive = false;
        let lastTableKey = '';
        let lastFlowKey = '';
        let lastPoseKey = '';
        let lastLcdArtSrc = null;
        let statusText = '';
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
            if (sortKey === 'index') {
                // Catalog (mix) order
                if (sortDir < 0) list.reverse();
                return list;
            }
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
            [els.play, els.prev, els.next, els.seek, els.volume, els.shuffle, els.repeat].forEach((el) => {
                if (el) el.disabled = !on;
            });
        }

        function setRepeatUI(mode) {
            if (!els.repeat) return;
            els.repeat.classList.toggle('is-on', mode !== 'off');
            els.repeat.classList.toggle('is-one', mode === 'one');
            if (els.repeatOne) els.repeatOne.hidden = mode !== 'one';
            els.repeat.setAttribute('aria-label',
                mode === 'one' ? 'Repeat one' : (mode === 'all' ? 'Repeat all' : 'Repeat off'));
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
            // Only touch src when the art changes (see the menubar's setArt)
            const src = (track && track.thumb) || null;
            if (src === lastLcdArtSrc) return;
            lastLcdArtSrc = src;
            if (src) {
                els.lcdArt.onerror = () => {
                    els.lcdArt.hidden = true;
                };
                els.lcdArt.hidden = false;
                els.lcdArt.src = src;
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
            if (filterQuery.trim() && list.length === 0) {
                statusText = 'No matches';
            } else {
                const n = list.length;
                let total = 0;
                list.forEach((t) => { total += Number(t.durationSec) || 0; });
                const h = Math.floor(total / 3600);
                const m = Math.floor((total % 3600) / 60);
                const timePart = h > 0 ? (h + ':' + String(m).padStart(2, '0')) : (m + ' min');
                statusText = n + (n === 1 ? ' song, ' : ' songs, ') + timePart;
            }
            paintStatus();
        }

        // The status bar is the window's polite live region, so a playback
        // error is announced there as well as shown in the LCD.
        function paintStatus() {
            if (!els.status) return;
            const text = SiteMusic.error || statusText;
            if (els.status.textContent !== text) els.status.textContent = text;
        }

        // ---- Listen along: share toggle, "N listening" count, Tune In rows ----

        let lastLiveKey = null;

        function liveCountText(s) {
            if (s.notice) return s.notice;
            if (s.sharing && !s.connected) return 'Not connected';
            const n = s.others;
            if (s.broadcasting) {
                if (!n) return 'Sharing: only you are listening';
                return 'You and ' + n + (n === 1 ? ' other' : ' others') + ' listening';
            }
            return n ? n + ' listening now' : '';
        }

        function buildLiveRow(g) {
            const title = g.track.title || 'Unknown';
            const row = document.createElement('div');
            row.className = 'mu-live-row' + (g.joined ? ' is-joined' : '');
            row.dataset.trackId = g.trackId;

            const dot = document.createElement('span');
            dot.className = 'mu-live-dot';
            dot.setAttribute('aria-hidden', 'true');

            const text = document.createElement('span');
            text.className = 'mu-live-text';
            const lead = document.createElement('span');
            lead.className = 'mu-live-lead';
            if (g.joined) lead.textContent = 'Listening along to ';
            else if (g.withYou) lead.textContent = g.count + ' listening along with you to ';
            else lead.textContent = g.count + ' listening to ';
            const name = document.createElement('strong');
            name.className = 'mu-live-title';
            name.textContent = title;
            text.appendChild(lead);
            text.appendChild(name);
            if (g.track.artist) {
                const artist = document.createElement('span');
                artist.className = 'mu-live-artist';
                artist.textContent = ' · ' + g.track.artist;
                text.appendChild(artist);
            }

            row.appendChild(dot);
            row.appendChild(text);

            if (g.joined) {
                const leave = document.createElement('button');
                leave.type = 'button';
                leave.className = 'mac-btn small mu-live-btn';
                leave.textContent = 'Leave';
                leave.setAttribute('aria-label', 'Stop listening along');
                leave.addEventListener('click', () => Live.leave());
                row.appendChild(leave);
            } else if (!g.withYou && g.leader) {
                const tune = document.createElement('button');
                tune.type = 'button';
                tune.className = 'mac-btn small primary mu-live-btn';
                tune.textContent = 'Tune In';
                tune.setAttribute('aria-label', 'Tune in to ' + title);
                tune.addEventListener('click', () => {
                    followPlayingCover();
                    Live.tuneIn(g.trackId);
                });
                row.appendChild(tune);
            }
            return row;
        }

        function renderLive() {
            const s = Live.snapshot();
            if (els.share && els.share.checked !== s.sharing) els.share.checked = s.sharing;
            if (els.liveCount) {
                const text = liveCountText(s);
                if (els.liveCount.textContent !== text) els.liveCount.textContent = text;
                // Narrow windows show this in place of the song count (CSS)
                els.liveCount.parentNode.classList.toggle('has-live', !!text);
            }
            if (!els.live) return;

            const groups = s.groups.slice(0, LIVE_MAX_ROWS);
            const key = groups.map((g) => {
                return [g.trackId, g.count, g.joined ? 1 : 0, g.withYou ? 1 : 0, g.leader ? 1 : 0].join(':');
            }).join('|');
            if (key === lastLiveKey) return;
            lastLiveKey = key;

            // Rebuilding drops focus: hand it back to the same row's button
            const active = document.activeElement;
            const focusedRow = active && els.live.contains(active) ? active.closest('.mu-live-row') : null;
            const refocusId = focusedRow ? focusedRow.dataset.trackId : null;

            els.live.textContent = '';
            els.live.hidden = groups.length === 0;
            groups.forEach((g) => {
                const row = buildLiveRow(g);
                els.live.appendChild(row);
                if (refocusId && g.trackId === refocusId) {
                    const btn = row.querySelector('button');
                    if (btn) btn.focus({ preventScroll: true });
                }
            });
        }

        function focusRowEl(row) {
            Array.prototype.forEach.call(els.tableBody.children, (r) => {
                r.tabIndex = r === row ? 0 : -1;
            });
            try {
                row.focus({ preventScroll: true });
            } catch (err) {
                row.focus();
            }
            if (typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
        }

        /** Enter/Space plays the row, arrows/Home/End move between rows. */
        function onRowKey(e, tr, playRow) {
            // Keys on the row's YouTube link belong to the link (Left goes back)
            if (e.target !== tr) {
                if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    e.stopPropagation();
                    focusRowEl(tr);
                }
                return;
            }
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            let to = null;
            if (e.key === 'Enter' || e.key === ' ') {
                playRow();
            } else if (e.key === 'ArrowDown') {
                to = tr.nextElementSibling;
            } else if (e.key === 'ArrowUp') {
                to = tr.previousElementSibling;
            } else if (e.key === 'Home') {
                to = els.tableBody.firstElementChild;
            } else if (e.key === 'End') {
                to = els.tableBody.lastElementChild;
            } else if (e.key === 'ArrowRight') {
                const link = tr.querySelector('.mu-yt-link');
                if (link) link.focus();
            } else if (e.key === 'ArrowLeft') {
                // Swallowed: the window shortcut would seek the track
            } else {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            if (to) focusRowEl(to);
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

            // The rebuild below drops focus; put it back on the same row after
            const focused = document.activeElement;
            const focusRow = focused && focused.closest && els.tableBody.contains(focused)
                ? focused.closest('tr')
                : null;
            const refocusId = focusRow ? focusRow.dataset.trackId : null;

            els.tableBody.textContent = '';
            const empty = list.length === 0;
            if (els.empty) els.empty.classList.toggle('is-visible', empty);
            if (els.table) els.table.hidden = empty;

            // Roving tabindex: one Tab stop for the list, arrows move inside it
            let tabStopId = refocusId;
            if (!tabStopId || !list.some((t) => t.id === tabStopId)) {
                const stop = list.find((t) => t.id === playingId) ||
                    list.find((t) => t.id === browseId) || list[0];
                tabStopId = stop ? stop.id : null;
            }

            list.forEach((t) => {
                const tr = document.createElement('tr');
                tr.dataset.trackId = t.id;
                tr.tabIndex = t.id === tabStopId ? 0 : -1;
                if (playingId && t.id === playingId) {
                    tr.classList.add('is-playing');
                    tr.setAttribute('aria-current', 'true');
                } else if (browseId && t.id === browseId) tr.classList.add('is-browse');

                const tdStatus = document.createElement('td');
                tdStatus.className = 'mu-cell-status';
                tdStatus.textContent = (playingId && t.id === playingId && snap.playing) ? '▶' : '';

                const tdIndex = document.createElement('td');
                tdIndex.className = 'mu-cell-index';
                tdIndex.textContent = String(catalogIndexById(t.id) + 1);

                const tdName = document.createElement('td');
                tdName.textContent = t.title || 'Unknown';

                const tdTime = document.createElement('td');
                tdTime.className = 'mu-cell-time';
                tdTime.textContent = formatTime(t.durationSec);

                const tdArtist = document.createElement('td');
                tdArtist.textContent = t.artist || '';

                // Per-track link to the source video; always a new tab
                const tdLink = document.createElement('td');
                tdLink.className = 'mu-cell-link';
                const link = document.createElement('a');
                link.className = 'mu-yt-link';
                link.href = 'https://www.youtube.com/watch?v=' + encodeURIComponent(t.videoId);
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.dataset.open = 'tab';
                link.tabIndex = -1;
                link.textContent = '↗';
                link.setAttribute('aria-label', 'Open ' + (t.title || 'track') + ' on YouTube');
                link.title = 'Open on YouTube';
                link.addEventListener('click', (e) => e.stopPropagation());
                tdLink.appendChild(link);

                tr.appendChild(tdStatus);
                tr.appendChild(tdIndex);
                tr.appendChild(tdName);
                tr.appendChild(tdTime);
                tr.appendChild(tdArtist);
                tr.appendChild(tdLink);

                const playRow = () => {
                    const idx = catalogIndexById(t.id);
                    if (idx >= 0) {
                        followPlayingCover();
                        browseIndex = idx;
                        SiteMusic.select(idx, true);
                    }
                };
                tr.addEventListener('click', playRow);
                tr.addEventListener('keydown', (e) => onRowKey(e, tr, playRow));
                els.tableBody.appendChild(tr);
            });

            if (refocusId) {
                const again = Array.prototype.find.call(els.tableBody.children, (row) => {
                    return row.dataset.trackId === refocusId;
                });
                if (again) focusRowEl(again);
            }

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

        function poseCover(cover, offset, size) {
            const abs = Math.abs(offset);
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
                lastPoseKey = '';
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
            // Nothing moved since the last render: skip the re-pose. Anything
            // that changes cover size or the list resets lastFlowKey first.
            const poseKey = listKey + '|' + centerTrack.id;
            if (!snapPose && poseKey === lastPoseKey) return;
            lastPoseKey = poseKey;
            lastFlowKey = listKey;

            if (snapPose) els.coverflow.classList.add('is-snap');

            const wanted = new Set();
            for (let i = start; i < end; i++) wanted.add(list[i].id);

            Array.from(els.stage.children).forEach((el) => {
                if (!wanted.has(el.dataset.trackId)) el.remove();
            });

            const byId = new Map();
            Array.from(els.stage.children).forEach((el) => byId.set(el.dataset.trackId, el));

            // Measured once per render (it reads layout), not once per cover
            let size = els.stage.children.length ? cfCoverSize() : 0;

            for (let i = start; i < end; i++) {
                const t = list[i];
                let cover = byId.get(t.id);
                const fresh = !cover;
                if (!cover) {
                    cover = createCoverEl(t);
                    cover.style.transition = 'none';
                    els.stage.appendChild(cover);
                }
                if (!size) size = cfCoverSize();
                poseCover(cover, i - centerInFlow, size);
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

        /** Progress only: runs on the playback tick, everything else on state changes. */
        function syncTime(cur, dur) {
            if (seeking || !els.seek) return;
            els.seek.max = String(Math.max(0, Math.floor(dur)));
            els.seek.value = String(Math.floor(cur));
            if (els.lcdTimeCur) els.lcdTimeCur.textContent = formatTime(cur);
            if (els.lcdTimeRem) els.lcdTimeRem.textContent = formatRemaining(cur, dur);
            setAppRangeFill(els.seek, cur, dur);
        }

        function sync(snap) {
            if (els.mixTitle) els.mixTitle.textContent = snap.mixTitle || 'Mix';
            setTransportEnabled(snap.tracks.length > 0);
            setShuffleUI(!!snap.shuffle);
            setRepeatUI(snap.repeat);
            root.classList.toggle('has-error', !!snap.error);
            if (els.retry) els.retry.hidden = !snap.error;
            paintStatus();
            // A failed catalog fetch is not an empty mix
            const noCatalog = !snap.tracks.length && !!snap.error;
            if (els.emptyTitle) els.emptyTitle.textContent = noCatalog ? 'Music unavailable' : 'No songs';
            if (els.emptyHint) {
                els.emptyHint.textContent = noCatalog
                    ? snap.error + '. Check your connection and retry.'
                    : 'Add a mix to start listening';
            }

            // Stay on the browsed cover while exploring; only follow playback when not browsing
            if (!coverBrowseActive && snap.tracks.length) {
                browseIndex = snap.index;
            }
            browseIndex = clamp(browseIndex, 0, Math.max(0, snap.tracks.length - 1));

            const t = snap.track;
            if (!t) {
                els.lcdTitle.textContent = noCatalog ? 'Music unavailable' : 'No songs';
                els.lcdSub.textContent = snap.error || 'Add a mix to start listening';
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
            els.lcdSub.textContent = snap.error || (t.artist
                ? (t.artist + (snap.mixTitle ? ' — ' + snap.mixTitle : ''))
                : (snap.mixTitle || ''));
            setLcdArt(t);

            syncTime(snap.currentTime || 0, snap.duration || Number(t.durationSec) || 0);
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
            // Focused controls keep their own Space/Enter/arrow behaviour
            if (e.target && e.target.closest &&
                e.target.closest('button, [role="button"], a[href], select, th[tabindex], [contenteditable="true"]')) {
                return;
            }

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
        if (els.repeat) els.repeat.addEventListener('click', () => SiteMusic.cycleRepeat());
        if (els.retry) els.retry.addEventListener('click', () => SiteMusic.retry());
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

        // Drag / swipe Cover Flow horizontally: one cover per CF_SWIPE_STEP px.
        // CSS sets touch-action: pan-y so vertical page scrolling still works.
        let swipe = null;
        let swipedAt = 0;

        function onSwipeDown(e) {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            swipe = { id: e.pointerId, x: e.clientX, moved: false };
        }

        function onSwipeMove(e) {
            if (!swipe || e.pointerId !== swipe.id) return;
            const dx = e.clientX - swipe.x;
            if (Math.abs(dx) < CF_SWIPE_STEP) return;
            const steps = Math.trunc(dx / CF_SWIPE_STEP);
            swipe.x += steps * CF_SWIPE_STEP;
            if (!swipe.moved) {
                swipe.moved = true;
                try { els.coverflow.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
            }
            // Dragging left brings the next cover in
            moveBrowse(-steps);
        }

        function onSwipeEnd(e) {
            if (!swipe || e.pointerId !== swipe.id) return;
            if (swipe.moved) swipedAt = Date.now();
            swipe = null;
        }

        function onCoverClick(e) {
            // The click that ends a swipe must not also pick a cover
            if (Date.now() - swipedAt < 350) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            onCoverPointer(e);
        }

        if (els.coverflow) {
            els.coverflow.addEventListener('wheel', onWheel, { passive: false });
            els.coverflow.addEventListener('pointerdown', onSwipeDown);
            els.coverflow.addEventListener('pointermove', onSwipeMove);
            els.coverflow.addEventListener('pointerup', onSwipeEnd);
            els.coverflow.addEventListener('pointercancel', onSwipeEnd);
            els.coverflow.addEventListener('click', onCoverClick);
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

        if (els.share) {
            els.share.addEventListener('change', () => Live.setSharing(els.share.checked));
        }
        const unsubLive = Live.on(renderLive);
        let liveWatching = false;
        let closed = false;

        unsub = SiteMusic.on(sync);
        unsubTime = SiteMusic.onTime((time) => syncTime(time.currentTime, time.duration));
        SiteMusic.loadCatalog().then(() => {
            browseIndex = SiteMusic.index;
            sync(SiteMusic.snapshot());
            // Other listeners are matched against the mix, so it comes first
            if (!closed && SiteMusic.tracks.length) {
                liveWatching = true;
                Live.watch();
            }
            renderLive();
        });
        renderLive();

        win.musicCleanup = function () {
            win.removeEventListener('keydown', onKey);
            if (els.coverflow) {
                els.coverflow.removeEventListener('wheel', onWheel);
                els.coverflow.removeEventListener('click', onCoverClick);
                els.coverflow.removeEventListener('pointerdown', onSwipeDown);
                els.coverflow.removeEventListener('pointermove', onSwipeMove);
                els.coverflow.removeEventListener('pointerup', onSwipeEnd);
                els.coverflow.removeEventListener('pointercancel', onSwipeEnd);
                els.coverflow.removeEventListener('dblclick', onCoverPointer);
            }
            if (cfRo) cfRo.disconnect();
            if (cfResizeTimer) clearTimeout(cfResizeTimer);
            if (cfMq.removeEventListener) cfMq.removeEventListener('change', onCfViewport);
            else if (cfMq.removeListener) cfMq.removeListener(onCfViewport);
            if (captionTimer) clearTimeout(captionTimer);
            if (unsub) unsub();
            if (unsubTime) unsubTime();
            closed = true;
            unsubLive();
            if (liveWatching) Live.unwatch();
        };
    }

    window.initMusicPlayer = initMusicPlayer;

    function boot() {
        // Stop/pause choices apply before the catalog (or anything else) loads
        const saved = readState();
        if (saved) {
            SiteMusic.ambientSuppressed = !!saved.suppressed;
            SiteMusic.userPaused = !!saved.userPaused;
        }
        // The shell may ask for a hold before this bundle has loaded
        if (window.__musicAmbientHold) SiteMusic._ambientHold = true;
        // Sharing is a saved opt-in; listening along never survives a reload
        Live.init(saved);

        initMenubarMusic();
        SiteMusic.loadCatalog();
        SiteMusic.armAmbientAutoplay();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
