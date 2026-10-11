/**
 * Reactions and "reading now" for a post or project.
 *
 * The bar (layouts/partials/apps/blog/social.html) ships hidden and is only
 * shown once the relay has answered, so there is never a row of dead buttons.
 * Fetched by retention.js the first time a bar is on the page; works the
 * same on an article page and inside a desktop window, because everything is
 * keyed by the page's own path rather than the address bar.
 *
 * On the relay: apps/reactions/<page>/<reaction>/<visitor id> = true, one key
 * per visitor per reaction, removed again when the reaction is taken back.
 * Readers are the page's presence room (the one cursors.js already uses).
 */
(function () {
    'use strict';

    if (window.PostSocial) return;

    const REACTIONS = ['heart', 'fire', 'laugh', 'party', 'mind'];
    const MAX_IDS = 5000;             // per reaction; ids are self-declared
    const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
    const WRITE_GAP_MS = 500;         // per button
    const WRITES_PER_MINUTE = 12;     // per bar
    const BEAT_MS = 5000;
    const READER_TTL_MS = 15000;
    const GUN_WAIT_MS = 12000;
    const IS_DESKTOP = !!document.getElementById('window-contents');

    function whenGun() {
        return new Promise((resolve, reject) => {
            const started = Date.now();
            (function poll() {
                const g = window.SiteGun;
                if (g && g.paths && g.paths.apps && g.paths.apps.postReactions) return resolve(g);
                if (Date.now() - started > GUN_WAIT_MS) return reject(new Error('realtime unavailable'));
                setTimeout(poll, 250);
            })();
        });
    }

    function mount(bar) {
        if (!bar || bar.getAttribute('data-ps') === 'mounted') return;
        const path = bar.getAttribute('data-post-key') || '';
        if (!path) return;
        bar.setAttribute('data-ps', 'mounted');

        whenGun().then((SiteGun) => {
            if (bar.isConnected) start(bar, path, SiteGun);
        }).catch(() => { /* the bar stays hidden */ });
    }

    function start(bar, path, SiteGun) {
        const room = SiteGun.roomKey(path);
        const myId = SiteGun.visitorId();
        const ref = SiteGun.paths.apps.postReactions(room);
        const status = bar.querySelector('.ps-status');
        const subscriptions = [];
        const buttons = {};
        const sets = {};              // reaction -> Set of visitor ids
        const lastWrite = {};
        let recentWrites = [];
        let connected = false;
        let stopped = false;

        function paint(name) {
            const btn = buttons[name];
            if (!btn) return;
            const n = sets[name].size;
            const mine = sets[name].has(myId);
            btn.classList.toggle('is-mine', mine);
            btn.setAttribute('aria-pressed', mine ? 'true' : 'false');
            btn.querySelector('.ps-count').textContent = n ? String(n) : '';
            btn.setAttribute('aria-label',
                btn.getAttribute('data-label') + ', ' + (n === 1 ? '1 reaction' : n + ' reactions'));
        }

        function setStatus(text) {
            if (status) status.textContent = text;
        }

        bar.querySelectorAll('.ps-react[data-reaction]').forEach((btn) => {
            const name = btn.getAttribute('data-reaction');
            if (REACTIONS.indexOf(name) === -1) return;
            buttons[name] = btn;
            sets[name] = new Set();
            paint(name);

            ref.get(name).map().on(function (value, id, _msg, ev) {
                if (ev && typeof ev.off === 'function' && subscriptions.indexOf(ev) === -1) subscriptions.push(ev);
                if (stopped || typeof id !== 'string' || !ID_RE.test(id)) return;
                const set = sets[name];
                if (value === true) {
                    if (set.size >= MAX_IDS && !set.has(id) && id !== myId) return;
                    set.add(id);
                } else {
                    set.delete(id);
                }
                paint(name);
            });

            btn.addEventListener('click', () => {
                if (!connected) return;
                const now = Date.now();
                if (now - (lastWrite[name] || 0) < WRITE_GAP_MS) return;
                recentWrites = recentWrites.filter((t) => now - t < 60000);
                if (recentWrites.length >= WRITES_PER_MINUTE) {
                    setStatus('Easy there. Try again in a minute.');
                    return;
                }
                lastWrite[name] = now;
                recentWrites.push(now);

                const adding = !sets[name].has(myId);
                // Shown at once; the relay's echo confirms it
                if (adding) sets[name].add(myId);
                else sets[name].delete(myId);
                paint(name);
                ref.get(name).get(myId).put(adding ? true : null);

                if (adding) {
                    btn.classList.remove('is-popping');
                    void btn.offsetWidth;
                    btn.classList.add('is-popping');
                    if (window.track) window.track('post_reaction', { reaction: name, path: path });
                }
            });
        });

        // ---- Reading now -------------------------------------------------

        const readers = new Map();    // id -> { ts, at } (at = when a NEW beat arrived here)
        const presence = SiteGun.paths.live.presence(room);
        const readersEl = document.createElement('span');
        readersEl.className = 'ps-readers';
        readersEl.hidden = true;
        // On the document's meta line (kind, date, reading time)
        const scope = bar.closest('article') || document;
        const meta = scope.querySelector('.post-meta-bar');
        if (meta) meta.appendChild(readersEl);

        function paintReaders() {
            const now = Date.now();
            let n = 1;                // this reader
            readers.forEach((r, id) => {
                if (now - r.at > READER_TTL_MS) readers.delete(id);
                else n++;
            });
            readersEl.hidden = n < 2 || !connected;
            readersEl.textContent = n + ' reading now';
        }

        presence.map().on(function (data, id, _msg, ev) {
            if (ev && typeof ev.off === 'function' && subscriptions.indexOf(ev) === -1) subscriptions.push(ev);
            if (stopped || id === myId || typeof id !== 'string' || !ID_RE.test(id)) return;
            const ts = data && Number(data.ts);
            if (!ts) {
                readers.delete(id);
            } else {
                // Liveness is "did the beat change since we last looked",
                // never the sender's clock
                const known = readers.get(id);
                if (known && known.ts === ts) return;
                if (!known && readers.size >= 500) return;
                readers.set(id, { ts: ts, at: Date.now() });
            }
            paintReaders();
        });

        // On an article page cursors.js already announces this reader in this
        // room. In a desktop window the address bar belongs to the desktop,
        // so the window announces it - only while the tab is being looked at.
        let beating = false;
        function beat() {
            if (!IS_DESKTOP) return;
            if (document.hidden) {
                if (beating) presence.get(myId).put(null);
                beating = false;
                return;
            }
            presence.get(myId).put({ ts: Date.now() });
            beating = true;
        }

        function stop() {
            if (stopped) return;
            stopped = true;
            clearInterval(timer);
            document.removeEventListener('visibilitychange', beat);
            window.removeEventListener('pagehide', leave);
            subscriptions.forEach((ev) => { try { ev.off(); } catch (e) { /* ignore */ } });
            if (offConnection) offConnection();
            leave();
            readersEl.remove();
        }

        function leave() {
            if (beating) presence.get(myId).put(null);
            beating = false;
        }

        const timer = setInterval(() => {
            // The window was closed or paged to another post
            if (!bar.isConnected) return stop();
            beat();
            paintReaders();
        }, BEAT_MS);
        document.addEventListener('visibilitychange', beat);
        window.addEventListener('pagehide', leave);

        // ---- Connection ----------------------------------------------------

        let everConnected = false;
        const offConnection = SiteGun.getConnection().onChange((isConnected) => {
            if (stopped) return;
            connected = isConnected;
            if (isConnected && !everConnected) {
                everConnected = true;
                bar.hidden = false;
                beat();
            }
            bar.classList.toggle('is-offline', !isConnected);
            Object.keys(buttons).forEach((name) => {
                buttons[name].setAttribute('aria-disabled', isConnected ? 'false' : 'true');
            });
            setStatus(isConnected ? '' : 'Offline. Reactions are paused.');
            paintReaders();
        });
    }

    window.PostSocial = { mount: mount };
})();
