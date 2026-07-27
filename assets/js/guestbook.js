/**
 * Guestbook - a persistent plaza of everyone who has passed through.
 *
 * Modelled on StreetPass rather than a comment thread: you appear once, as
 * yourself, and you can come back and update your entry. Keying the Gun node
 * by visitor id (not by timestamp) is what makes that work - it also means one
 * person cannot flood the plaza with duplicate cards.
 */
(function () {
    'use strict';

    const MAX_NAME = 20;
    const MAX_FROM = 24;
    const MAX_BLURB = 100;
    const MAX_RENDERED = 300;   // newest N kept in the DOM
    const SAVE_COOLDOWN_MS = 5000;

    const AVATARS = ['🙂', '😎', '🤓', '🐱', '🦊', '🐧', '🦄', '👾', '🤖', '🌵', '🍄', '👻'];

    function escapeText(value, max) {
        return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
    }

    /** Stable colour per visitor, same hashing idea as IRC nick colours. */
    function idToColor(id) {
        let hash = 0;
        const s = String(id || '');
        for (let i = 0; i < s.length; i++) {
            hash = s.charCodeAt(i) + ((hash << 5) - hash);
        }
        const hue = Math.abs(hash % 360);
        return `hsl(${hue}, 62%, 88%)`;
    }

    function relativeTime(ts) {
        if (!ts) return '';
        const ago = Math.max(0, Date.now() - ts);
        const mins = Math.floor(ago / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return mins + 'm ago';
        const hours = Math.floor(mins / 60);
        if (hours < 24) return hours + 'h ago';
        const days = Math.floor(hours / 24);
        if (days < 30) return days + 'd ago';
        const months = Math.floor(days / 30);
        if (months < 12) return months + 'mo ago';
        return Math.floor(months / 12) + 'y ago';
    }

    function initGuestbook(win) {
        const root = win.querySelector('.gb-window');
        if (!root || root.dataset.init) return;
        root.dataset.init = '1';

        const els = {
            count: root.querySelector('.gb-count'),
            status: root.querySelector('.gb-status'),
            signBtn: root.querySelector('.gb-sign-btn'),
            form: root.querySelector('.gb-form'),
            avatarPicker: root.querySelector('.gb-avatar-picker'),
            name: root.querySelector('.gb-name'),
            from: root.querySelector('.gb-from'),
            blurb: root.querySelector('.gb-blurb'),
            counter: root.querySelector('.gb-counter'),
            cancel: root.querySelector('.gb-cancel'),
            save: root.querySelector('.gb-save'),
            plaza: root.querySelector('.gb-plaza'),
            empty: root.querySelector('.gb-empty')
        };

        // Same visitor identity the cursors use, so a person is one person
        // across the whole site rather than one per app.
        let myId = localStorage.getItem('multiplayer-cursor-id');
        if (!myId) {
            myId = Math.random().toString(36).slice(2, 11);
            localStorage.setItem('multiplayer-cursor-id', myId);
        }

        const entries = new Map(); // id -> data
        const cards = new Map();   // id -> element
        let ref = null;
        let chosenAvatar = AVATARS[0];
        let lastSaveAt = 0;
        let offConnection = null;
        const timers = new Set();
        const subscriptions = new Set();

        // ---- Avatar picker ------------------------------------------------
        AVATARS.forEach((emoji, i) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'gb-avatar-option' + (i === 0 ? ' is-selected' : '');
            btn.textContent = emoji;
            btn.setAttribute('role', 'radio');
            btn.setAttribute('aria-checked', i === 0 ? 'true' : 'false');
            btn.addEventListener('click', () => selectAvatar(emoji));
            els.avatarPicker.appendChild(btn);
        });

        function selectAvatar(emoji) {
            chosenAvatar = emoji;
            els.avatarPicker.querySelectorAll('.gb-avatar-option').forEach((b) => {
                const on = b.textContent === emoji;
                b.classList.toggle('is-selected', on);
                b.setAttribute('aria-checked', on ? 'true' : 'false');
            });
        }

        // ---- Form ---------------------------------------------------------
        function openForm() {
            const mine = entries.get(myId);
            if (mine) {
                els.name.value = mine.name || '';
                els.from.value = mine.from || '';
                els.blurb.value = mine.blurb || '';
                selectAvatar(mine.avatar || AVATARS[0]);
                els.save.textContent = 'Update my entry';
            } else {
                els.save.textContent = 'Add me';
            }
            updateCounter();
            els.form.hidden = false;
            els.signBtn.setAttribute('aria-expanded', 'true');
            setTimeout(() => els.name.focus(), 40);
        }

        function closeForm() {
            els.form.hidden = true;
            els.signBtn.setAttribute('aria-expanded', 'false');
        }

        function updateCounter() {
            els.counter.textContent = `${els.blurb.value.length}/${MAX_BLURB}`;
        }

        function save(e) {
            e.preventDefault();

            const name = escapeText(els.name.value, MAX_NAME);
            if (!name) {
                els.name.focus();
                els.name.classList.add('is-invalid');
                setTimeout(() => els.name.classList.remove('is-invalid'), 900);
                return;
            }

            // Light throttle - the real guard is that entries are keyed by
            // visitor, so repeat saves overwrite rather than accumulate.
            const now = Date.now();
            if (now - lastSaveAt < SAVE_COOLDOWN_MS) {
                setStatus('Give it a second…');
                return;
            }
            lastSaveAt = now;

            const existing = entries.get(myId);
            const payload = {
                name: name,
                from: escapeText(els.from.value, MAX_FROM),
                blurb: escapeText(els.blurb.value, MAX_BLURB),
                avatar: AVATARS.indexOf(chosenAvatar) >= 0 ? chosenAvatar : AVATARS[0],
                // Preserve the original arrival time across edits
                ts: (existing && existing.ts) || now,
                updatedTs: now
            };

            if (ref) ref.get(myId).put(payload);
            closeForm();
            setStatus(existing ? 'Updated' : 'Signed — welcome');
        }

        els.signBtn.addEventListener('click', () => {
            if (els.form.hidden) openForm(); else closeForm();
        });
        els.cancel.addEventListener('click', closeForm);
        els.form.addEventListener('submit', save);
        els.blurb.addEventListener('input', updateCounter);

        // Keep window-manager shortcuts from eating what is being typed
        [els.name, els.from, els.blurb].forEach((input) => {
            input.addEventListener('keydown', (ev) => ev.stopPropagation());
            input.addEventListener('mousedown', (ev) => ev.stopPropagation());
        });

        // ---- Rendering ----------------------------------------------------
        function buildCard(id, data) {
            const card = document.createElement('article');
            card.className = 'gb-card' + (id === myId ? ' is-me' : '');
            card.setAttribute('role', 'listitem');
            card.style.setProperty('--card-tint', idToColor(id));

            const avatar = document.createElement('div');
            avatar.className = 'gb-card-avatar';
            avatar.textContent = data.avatar || '🙂';

            const body = document.createElement('div');
            body.className = 'gb-card-body';

            const nameRow = document.createElement('div');
            nameRow.className = 'gb-card-namerow';

            const name = document.createElement('span');
            name.className = 'gb-card-name';
            name.textContent = data.name || 'anonymous';
            nameRow.appendChild(name);

            if (id === myId) {
                const you = document.createElement('span');
                you.className = 'gb-card-you';
                you.textContent = 'you';
                nameRow.appendChild(you);
            }

            if (data.from) {
                const from = document.createElement('span');
                from.className = 'gb-card-from';
                from.textContent = data.from;
                nameRow.appendChild(from);
            }

            body.appendChild(nameRow);

            if (data.blurb) {
                const blurb = document.createElement('p');
                blurb.className = 'gb-card-blurb';
                blurb.textContent = data.blurb;
                body.appendChild(blurb);
            }

            const meta = document.createElement('time');
            meta.className = 'gb-card-time';
            meta.dataset.ts = data.ts || '';
            meta.textContent = relativeTime(data.ts);
            body.appendChild(meta);

            card.appendChild(avatar);
            card.appendChild(body);
            return card;
        }

        function render() {
            const sorted = [...entries.entries()]
                .sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0))
                .slice(0, MAX_RENDERED);

            els.empty.hidden = sorted.length > 0;

            // Rebuild in order. The list is small and only changes when someone
            // signs, so a full rebuild is simpler than diffing and stays smooth.
            const frag = document.createDocumentFragment();
            sorted.forEach(([id, data]) => {
                let card = cards.get(id);
                const signature = JSON.stringify([data.name, data.from, data.blurb, data.avatar]);
                if (!card || card.dataset.signature !== signature) {
                    card = buildCard(id, data);
                    card.dataset.signature = signature;
                    cards.set(id, card);
                }
                frag.appendChild(card);
            });

            els.plaza.innerHTML = '';
            els.plaza.appendChild(els.empty);
            els.plaza.appendChild(frag);

            els.count.textContent = entries.size === 1
                ? '1 visitor'
                : entries.size + ' visitors';

            els.signBtn.textContent = entries.has(myId) ? 'Edit my entry' : 'Sign the guestbook';
        }

        function refreshTimes() {
            els.plaza.querySelectorAll('.gb-card-time').forEach((el) => {
                const ts = parseInt(el.dataset.ts, 10);
                if (ts) el.textContent = relativeTime(ts);
            });
        }

        function setStatus(msg) {
            els.status.textContent = msg;
        }

        // ---- Gun ----------------------------------------------------------
        function connect() {
            ref = window.SiteGun.paths.apps.guestbook();

            ref.map().on(function (data, id, _msg, ev) {
                if (ev && typeof ev.off === 'function') subscriptions.add(ev);

                if (!data || !data.name) {
                    if (entries.delete(id)) render();
                    return;
                }

                entries.set(id, {
                    name: escapeText(data.name, MAX_NAME),
                    from: escapeText(data.from, MAX_FROM),
                    blurb: escapeText(data.blurb, MAX_BLURB),
                    avatar: typeof data.avatar === 'string' ? data.avatar.slice(0, 4) : '🙂',
                    ts: data.ts || 0,
                    updatedTs: data.updatedTs || 0
                });
                render();
            });

            if (window.SiteGun.getConnection) {
                offConnection = window.SiteGun.getConnection().onChange((connected) => {
                    setStatus(connected ? 'Live' : 'Offline — reconnecting…');
                    els.status.classList.toggle('is-offline', !connected);
                    els.signBtn.disabled = !connected;
                });
            } else {
                setStatus('Live');
            }

            const t = setInterval(refreshTimes, 60000);
            timers.add(t);
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
            setStatus('Offline');
            els.signBtn.disabled = true;
        });

        // Release everything when the window closes
        win.guestbookCleanup = function () {
            timers.forEach(clearInterval);
            timers.clear();
            subscriptions.forEach((ev) => {
                try { ev.off(); } catch (e) { /* ignore */ }
            });
            subscriptions.clear();
            try { if (ref) ref.map().off(); } catch (e) { /* ignore */ }
            if (offConnection) {
                offConnection();
                offConnection = null;
            }
        };
    }

    window.initGuestbook = initGuestbook;
})();
