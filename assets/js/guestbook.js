/**
 * Guestbook - a bound visitors' book you leaf through and sign.
 *
 * Entries are keyed by visitor id rather than timestamp. That is what lets a
 * person come back and revise their entry, and it also means one visitor
 * cannot fill the book with duplicates.
 *
 * Every name is rendered as a procedurally generated signature (signature.js)
 * seeded by the visitor id plus a variant they can cycle, so a mark is stable
 * for that person forever but distinct from everyone else's.
 */
(function () {
    'use strict';

    const MAX_NAME = 24;
    const MAX_FROM = 24;
    const MAX_BLURB = 100;
    // An entry occupies whole ruled lines: 2 for the signature (with the
    // place/date stacked beside it), 1 for the note and contact icons, 1
    // blank between entries.
    const LINES_PER_ENTRY = 4;
    const FALLBACK_LINE_PX = 34;     // must match --gb-line in the stylesheet
    const SAVE_COOLDOWN_MS = 4000;
    const FLIP_MS = 780;             // must match --gb-flip-ms in the stylesheet
    const SAVE_ACK_TIMEOUT_MS = 6000;
    const FOLLOW_LATEST_MS = 3000;   // keep opening on the newest page while entries stream in
    const EMPTY_BOOK_GRACE_MS = 3000; // a connected relay that sends nothing for this long has no entries
    const MAX_ENTRIES = 3000;        // ceiling on what one book will hold in memory
    const MAX_ID_LEN = 64;
    const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
    const VARIANTS = 12;
    // A privately shared email: "v1.<sender key>.<iv>.<ciphertext>", base64url.
    // scripts/guestbook.mjs reads the same format.
    const ENC_RE = /^v1\.[A-Za-z0-9_-]{87}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,160}$/;
    const ENC_INFO = 'ankush.one guestbook email v1';
    const ENC_PAD = 64;              // every email encrypts to the same length
    const PRIVATE_EMAIL_STORE = 'guestbook-private-email';

    // Storage can be blocked outright; signing must still work.
    const store = {
        get(key) {
            try {
                const s = window.SiteGun && window.SiteGun.store;
                return s ? s.get(key) : localStorage.getItem(key);
            } catch (e) { return null; }
        },
        set(key, value) {
            try {
                const s = window.SiteGun && window.SiteGun.store;
                if (s) s.set(key, value); else localStorage.setItem(key, value);
            } catch (e) { /* ignore */ }
        },
        remove(key) {
            try {
                const s = window.SiteGun && window.SiteGun.store;
                if (s) s.remove(key); else localStorage.removeItem(key);
            } catch (e) { /* ignore */ }
        }
    };

    function visitorId() {
        if (window.SiteGun && window.SiteGun.visitorId) return window.SiteGun.visitorId();
        const id = store.get('multiplayer-cursor-id') || window.__siteVisitorId ||
            Math.random().toString(36).slice(2, 11);
        store.set('multiplayer-cursor-id', id);
        window.__siteVisitorId = id;
        return id;
    }

    // ---- Field normalisation -------------------------------------------

    function text(value, max) {
        return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
    }

    /**
     * Deliberately stricter than the RFC. A permissive "anything@anything.tld"
     * test lets values like "<script>@x.com" through - harmless here, since
     * links are built with DOM properties rather than markup, but it is junk
     * in the book and junk in the graph.
     */
    function normEmail(v) {
        const s = text(v, 60).toLowerCase();
        return /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(s) ? s : '';
    }

    /** Accepts a bare handle, an @handle, or a full profile URL. */
    function normHandle(v, max, allowed) {
        let s = text(v, 120);
        s = s.replace(/^https?:\/\/(www\.)?(twitter\.com|x\.com|instagram\.com)\//i, '');
        s = s.replace(/[/?#].*$/, '');
        s = s.replace(/^@+/, '');
        if (!s) return '';
        return allowed.test(s) && s.length <= max ? s : '';
    }

    const X_RE = /^[A-Za-z0-9_]+$/;
    const IG_RE = /^[A-Za-z0-9._]+$/;

    // ---- Private email ----------------------------------------------------

    function b64u(bytes) {
        let s = '';
        new Uint8Array(bytes).forEach((b) => { s += String.fromCharCode(b); });
        return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function unb64u(str) {
        const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    function canEncrypt() {
        return !!(window.crypto && window.crypto.subtle && window.TextEncoder);
    }

    /**
     * Seal an email so that only the holder of the site owner's private key
     * can read it. The book itself is public and anyone can copy all of it,
     * so "private" has to mean unreadable, not hidden: a one-off key pair is
     * made for this message, combined with the owner's public key (ECDH),
     * and the result keys AES-GCM. The one-off private half is then dropped,
     * which means not even this browser can open what it just wrote.
     */
    function encryptEmail(email, ownerKey) {
        const subtle = window.crypto.subtle;
        const curve = { name: 'ECDH', namedCurve: 'P-256' };
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        let senderKey = null;

        return Promise.all([
            subtle.importKey('raw', unb64u(ownerKey), curve, false, []),
            subtle.generateKey(curve, true, ['deriveBits'])
        ]).then(([owner, pair]) => Promise.all([
            subtle.deriveBits({ name: 'ECDH', public: owner }, pair.privateKey, 256),
            subtle.exportKey('raw', pair.publicKey)
        ])).then(([shared, pub]) => {
            senderKey = new Uint8Array(pub);
            return subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
        }).then((hk) => subtle.deriveKey(
            { name: 'HKDF', hash: 'SHA-256', salt: senderKey, info: new TextEncoder().encode(ENC_INFO) },
            hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
        )).then((key) => subtle.encrypt(
            { name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(email.padEnd(ENC_PAD, ' '))
        )).then((ct) => {
            const out = 'v1.' + b64u(senderKey) + '.' + b64u(iv) + '.' + b64u(ct);
            if (!ENC_RE.test(out)) throw new Error('unexpected ciphertext shape');
            return out;
        });
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

    // Authored constants, not user data - safe to inject as markup.
    const ICONS = {
        email: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4.5" width="20" height="15" rx="2.5"/><path d="m2.6 7 9.4 5.8L21.4 7"/></svg>',
        x: '<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
        ig: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><rect x="2.5" y="2.5" width="19" height="19" rx="5.5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.6" cy="6.4" r="1.3" fill="currentColor" stroke="none"/></svg>'
    };

    function dateStamp(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    function initGuestbook(win) {
        const root = win.querySelector('.gb-desk');
        if (!root || root.dataset.init) return;
        root.dataset.init = '1';

        const els = {
            count: root.querySelector('.gb-count'),
            status: root.querySelector('.gb-status'),
            signBtn: root.querySelector('.gb-sign-btn'),
            book: root.querySelector('.gb-book'),
            pageL: root.querySelector('.gb-page-left'),
            pageR: root.querySelector('.gb-page-right'),
            flip: root.querySelector('.gb-flip'),
            flipFront: root.querySelector('.gb-flip-front'),
            flipBack: root.querySelector('.gb-flip-back'),
            prev: root.querySelector('.gb-prev'),
            next: root.querySelector('.gb-next'),
            pageno: root.querySelector('.gb-pageno'),
            sheet: root.querySelector('.gb-sheet'),
            form: root.querySelector('.gb-card'),
            close: root.querySelector('.gb-card-close'),
            cancel: root.querySelector('.gb-cancel'),
            save: root.querySelector('.gb-save'),
            vary: root.querySelector('.gb-vary'),
            previewInk: root.querySelector('.gb-preview-ink'),
            counter: root.querySelector('.gb-counter'),
            error: root.querySelector('.gb-error'),
            fName: root.querySelector('.gb-f-name'),
            fFrom: root.querySelector('.gb-f-from'),
            fBlurb: root.querySelector('.gb-f-blurb'),
            fEmail: root.querySelector('.gb-f-email'),
            fPrivate: root.querySelector('.gb-f-private'),
            fX: root.querySelector('.gb-f-x'),
            fIg: root.querySelector('.gb-f-ig')
        };

        // Same identity the cursors use, so a person is one person site-wide
        const myId = visitorId();

        // Moderation list baked in at build time (data/guestbook-hidden.yaml).
        const hiddenIds = new Set();
        try {
            JSON.parse(root.dataset.hidden || '[]').forEach((id) => hiddenIds.add(String(id)));
        } catch (e) { /* malformed list: hide nothing */ }

        // The private-email option needs the owner's key and a browser that
        // can encrypt (crypto.subtle is missing on plain-http origins).
        const emailKey = root.dataset.emailKey || '';
        const privateOk = !!(els.fPrivate && /^[A-Za-z0-9_-]{87}$/.test(emailKey) && canEncrypt());
        if (privateOk) els.fPrivate.closest('.gb-private').hidden = false;

        // The field's accessible name and description say "shown publicly";
        // with the private box ticked that is no longer true of the email.
        const emailNoteId = els.fEmail.getAttribute('aria-describedby');
        function labelEmail() {
            const priv = privateOk && els.fPrivate.checked;
            els.fEmail.setAttribute('aria-label', priv ? 'Email (kept private)' : 'Email (shown publicly)');
            if (priv) els.fEmail.removeAttribute('aria-describedby');
            else if (emailNoteId) els.fEmail.setAttribute('aria-describedby', emailNoteId);
        }
        if (privateOk) els.fPrivate.addEventListener('change', labelEmail);

        const entries = new Map();
        const snapshot = new Map();  // id -> the daily snapshot's copy, kept as a fallback
        // False until a relay has answered (or been connected long enough to
        // have done so). Until then no entries means "not loaded", not "empty".
        let bookKnown = false;
        let relayDown = false;
        let knownTimer = null;
        let ordered = [];
        let spread = 0;
        let flipping = false;
        let isConnected = false;
        let userTurned = false;      // the reader chose a page; stop auto-placing
        let firstDataAt = 0;
        let revealMine = false;      // jump to our own entry on the next paint
        let variant = 0;
        let lastSaveAt = 0;
        let ref = null;
        let offConnection = null;
        let resizeObserver = null;
        const timers = new Set();
        const subscriptions = new Set();

        // ---- Signature ------------------------------------------------

        function signatureSVG(name, id, vary, colour) {
            if (!window.Signature) return '';
            return window.Signature.toSVG(name, id + '#' + (vary || 0), { colour: colour || '#1c2a4a' });
        }

        /** Falls back to the plain name when a name has no drawable glyphs. */
        function renderSignatureInto(el, name, id, vary) {
            const svg = signatureSVG(name, id, vary);
            if (svg) {
                el.innerHTML = svg;
                el.classList.remove('is-fallback');
            } else {
                el.textContent = name;
                el.classList.add('is-fallback');
            }
        }

        // ---- Page rendering -------------------------------------------

        function contactLinks(data) {
            const links = [];
            const add = (href, label, icon) => {
                const a = document.createElement('a');
                a.className = 'gb-entry-link';
                a.href = href;
                a.target = '_blank';
                // User-generated destinations: never pass along referrer or
                // any ranking signal, and never give the opener window access.
                a.rel = 'nofollow ugc noopener noreferrer';
                a.title = label;
                a.setAttribute('aria-label', label);
                a.innerHTML = icon;
                links.push(a);
            };
            if (data.email) add('mailto:' + data.email, data.email, ICONS.email);
            if (data.x) add('https://x.com/' + data.x, '@' + data.x + ' on X', ICONS.x);
            if (data.ig) add('https://instagram.com/' + data.ig, '@' + data.ig + ' on Instagram', ICONS.ig);
            return links;
        }

        /**
         * Two columns on the page's baseline grid.
         *
         *   ┌──────────────────────────┬──────────────┐
         *   │  signature (2 lines)     │ name         │
         *   │                          │ from …       │
         *   │                          │ on <date>    │
         *   ├──────────────────────────┼──────────────┤
         *   │  note (1 line)           │  ✉ 𝕏 ◉       │
         *   └──────────────────────────┴──────────────┘
         *
         * The signature gets the full width it needs while the metadata fills
         * what used to be dead space beside it, so an entry is four ruled
         * lines instead of five.
         */
        function buildEntry(id, data) {
            const row = document.createElement('article');
            row.className = 'gb-entry' + (id === myId ? ' is-me' : '');

            const sig = document.createElement('div');
            sig.className = 'gb-entry-sig';
            // The signature carries the name visually, so it is not printed
            // again - but it is drawn as paths, so the name has to reach
            // assistive tech some other way.
            sig.setAttribute('role', 'img');
            sig.setAttribute('aria-label', data.name);
            renderSignatureInto(sig, data.name, id, data.variant);
            row.appendChild(sig);

            // Right column: two lines that sit on the same two rules the
            // signature spans, so both columns share the page's rhythm.
            const aside = document.createElement('div');
            aside.className = 'gb-entry-aside';

            // First band: where from and when, together on one ruled line.
            const lineOne = document.createElement('div');
            lineOne.className = 'gb-entry-asideline gb-entry-origin';

            if (data.from) {
                const from = document.createElement('span');
                from.className = 'gb-entry-from';
                from.textContent = 'from ' + data.from;
                lineOne.appendChild(from);

                const dot = document.createElement('span');
                dot.className = 'gb-entry-dot';
                dot.setAttribute('aria-hidden', 'true');
                dot.textContent = '·';
                lineOne.appendChild(dot);
            }

            const when = document.createElement('time');
            when.className = 'gb-entry-date';
            when.title = relativeTime(data.ts);
            when.textContent = dateStamp(data.ts);
            lineOne.appendChild(when);
            aside.appendChild(lineOne);

            // Second band: the "you" badge and contact icons.
            const lineTwo = document.createElement('div');
            lineTwo.className = 'gb-entry-asideline gb-entry-links';

            if (id === myId) {
                const badge = document.createElement('span');
                badge.className = 'gb-entry-you';
                badge.textContent = 'you';
                lineTwo.appendChild(badge);
            }
            contactLinks(data).forEach((a) => lineTwo.appendChild(a));
            aside.appendChild(lineTwo);

            row.appendChild(aside);

            // Third band: the note, spanning the full width of the entry.
            // Always present so the grid keeps its shape when someone left
            // no message.
            const blurb = document.createElement('p');
            blurb.className = 'gb-entry-blurb';
            blurb.textContent = data.blurb || '';
            row.appendChild(blurb);

            return row;
        }

        /**
         * How many entries fit on a page, measured rather than assumed. A
         * fixed count overflowed the page at the default window size and the
         * last entry was silently clipped by the page's overflow:hidden.
         */
        function perPage() {
            const page = els.pageR;
            if (!page || !page.clientHeight) return 2;

            const styles = getComputedStyle(page);
            const line = parseFloat(styles.getPropertyValue('--gb-line')) || FALLBACK_LINE_PX;
            const usable = page.clientHeight - parseFloat(styles.paddingBottom || 0);
            return Math.max(1, Math.floor(usable / (line * LINES_PER_ENTRY)));
        }

        /** Pages that actually hold signatures. */
        function filledPages() {
            return Math.max(1, Math.ceil(ordered.length / perPage()));
        }

        /**
         * Total pages, rounded up to whole spreads with one blank spread kept
         * at the end. A real book always has a next page to turn to, and
         * without the spare there is nothing to flip when the book is new -
         * the controls sat disabled and the turn animation never ran.
         */
        function pageCount() {
            const per = pagesPerView();
            const spreads = Math.ceil(filledPages() / per);
            return (spreads + 1) * per;
        }

        /**
         * A narrow window shows one leaf at a time. This has to drive the JS,
         * not just CSS: hiding the left page visually while still paging by
         * twos would skip every odd page.
         */
        function pagesPerView() {
            return root.clientWidth < 720 ? 1 : 2;
        }

        function spreadCount() {
            return Math.max(1, Math.ceil(pageCount() / pagesPerView()));
        }

        /** Fill a page element with the entries for a 0-based page index. */
        function paintPage(el, pageIndex) {
            el.innerHTML = '';

            const per = perPage();
            const slice = ordered.slice(pageIndex * per, pageIndex * per + per);

            if (!slice.length) {
                // Pages past the last signature stay genuinely blank - only
                // an empty book gets an invitation.
                // Said once, on the first page in view, and only once the book
                // is known to be empty rather than merely not loaded.
                if (!ordered.length && pageIndex === spread * pagesPerView()) {
                    const blank = document.createElement('div');
                    blank.className = 'gb-page-blank';
                    blank.textContent = bookKnown
                        ? 'The book is empty. Be the first to sign it.'
                        : (relayDown ? "Can't reach the guestbook right now." : 'Loading signatures…');
                    el.appendChild(blank);
                }
            } else {
                slice.forEach(([id, data]) => el.appendChild(buildEntry(id, data)));
            }

            const folio = document.createElement('span');
            folio.className = 'gb-folio';
            folio.textContent = String(pageIndex + 1);
            el.appendChild(folio);
        }

        /**
         * Counter and nav state only. Split out from paintSpread so the end of
         * a turn can update the chrome WITHOUT rebuilding the pages: by then
         * both already hold the right content, and re-rendering them tore down
         * and re-created every signature SVG, which flashed on the last frame.
         */
        function updateChrome() {
            const per = pagesPerView();
            const first = spread * per;

            if (!ordered.length) {
                // "1–2 of 4" says nothing useful about a book with no entries
                els.pageno.textContent = '';
            } else if (per === 1) {
                els.pageno.textContent = `${first + 1} of ${pageCount()}`;
            } else {
                const last = Math.min(first + 2, pageCount());
                // Avoid "1-1 of 1" when the spread only has one real page
                els.pageno.textContent = last > first + 1
                    ? `${first + 1}–${last} of ${pageCount()}`
                    : `${first + 1} of ${pageCount()}`;
            }

            els.prev.disabled = spread === 0;
            els.next.disabled = spread >= spreadCount() - 1;
        }

        function paintSpread() {
            const per = pagesPerView();
            const first = spread * per;

            if (per === 1) {
                // Single leaf lives in the right page slot; the left is hidden
                paintPage(els.pageR, first);
                els.pageL.innerHTML = '';
            } else {
                paintPage(els.pageL, first);
                paintPage(els.pageR, first + 1);
            }

            updateChrome();
        }

        /**
         * Turn a leaf. The moving page carries the outgoing face on its front
         * and the incoming face on its back, so the reveal happens mid-rotation
         * exactly as it would with paper.
         */
        function turn(dir) {
            if (flipping) return;
            const target = spread + dir;
            if (target < 0 || target > spreadCount() - 1) return;
            userTurned = true;

            const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            // Single-leaf mode has no facing page to swing against, so the
            // turn animation is skipped there too.
            if (reduced || pagesPerView() === 1) {
                spread = target;
                paintSpread();
                return;
            }

            flipping = true;
            const forward = dir > 0;
            const from = spread;

            // The leaf carries the outgoing page on its front and the incoming
            // one on its back, so the reveal happens mid-rotation.
            paintPage(els.flipFront, forward ? from * 2 + 1 : from * 2);
            paintPage(els.flipBack, forward ? target * 2 : target * 2 + 1);

            // Only the page the leaf UNCOVERS is repainted now. The page it
            // will come to rest on keeps its old content until the leaf's back
            // face is over it - repainting both up front made the far page pop
            // to new content the instant you clicked, which no book does.
            if (forward) {
                paintPage(els.pageR, target * 2 + 1);
            } else {
                paintPage(els.pageL, target * 2);
            }

            spread = target;

            els.flip.hidden = false;
            els.flip.classList.toggle('is-forward', forward);
            // Restart the animation cleanly if a previous one left the class on
            els.flip.classList.remove('is-turning');
            els.book.classList.remove('is-turning');

            requestAnimationFrame(() => {
                els.flip.classList.add('is-turning');
                els.book.classList.toggle('is-turning-forward', forward);
                els.book.classList.add('is-turning');
            });

            // Swap the resting page once the leaf is past vertical and its back
            // face is covering it. Doing this here rather than at the end means
            // the leaf's small settle overshoot - which briefly tips its edge up
            // off the page - exposes the NEW page underneath, not the old one.
            const swap = setTimeout(() => {
                timers.delete(swap);
                if (forward) {
                    paintPage(els.pageL, target * 2);
                } else {
                    paintPage(els.pageR, target * 2 + 1);
                }
            }, Math.round(FLIP_MS * 0.58));
            timers.add(swap);

            const done = setTimeout(() => {
                timers.delete(done);
                els.flip.hidden = true;
                els.flip.classList.remove('is-turning', 'is-forward');
                els.book.classList.remove('is-turning', 'is-turning-forward');
                flipping = false;
                // Both pages already hold the destination content; only the
                // counter and nav state need updating.
                updateChrome();
            }, FLIP_MS);
            timers.add(done);
        }

        /** The spread holding the newest signatures. */
        function lastFilledSpread() {
            return Math.floor((filledPages() - 1) / pagesPerView());
        }

        /**
         * Open the book at this visitor's own entry and flash it, so signing
         * visibly did something. Returns false if the entry is not in yet.
         */
        function showMyEntry() {
            if (flipping) return false;
            const index = ordered.findIndex(([id]) => id === myId);
            if (index < 0) return false;

            userTurned = true;
            spread = Math.min(
                Math.floor(Math.floor(index / perPage()) / pagesPerView()),
                spreadCount() - 1
            );
            paintSpread();

            const row = els.book.querySelector('.gb-page .gb-entry.is-me');
            if (row) {
                row.classList.add('is-revealed');
                const t = setTimeout(() => {
                    timers.delete(t);
                    row.classList.remove('is-revealed');
                }, 2400);
                timers.add(t);
            }
            return true;
        }

        els.prev.addEventListener('click', () => turn(-1));
        els.next.addEventListener('click', () => turn(1));

        els.book.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') { e.preventDefault(); turn(-1); }
            if (e.key === 'ArrowRight') { e.preventDefault(); turn(1); }
        });
        root.setAttribute('tabindex', '-1');
        root.addEventListener('keydown', (e) => {
            if (!els.sheet.hidden) return;
            if (e.key === 'ArrowLeft') { e.preventDefault(); turn(-1); }
            if (e.key === 'ArrowRight') { e.preventDefault(); turn(1); }
        });

        // ---- Signing card ---------------------------------------------

        let previewTimer = null;
        let saving = false;

        function updatePreview() {
            const name = text(els.fName.value, MAX_NAME);
            if (!name) {
                els.previewInk.innerHTML = '';
                els.previewInk.classList.add('is-empty');
                return;
            }
            els.previewInk.classList.remove('is-empty');
            renderSignatureInto(els.previewInk, name, myId, variant);
        }

        function schedulePreview() {
            clearTimeout(previewTimer);
            previewTimer = setTimeout(updatePreview, 110);
        }

        function openCard() {
            const mine = entries.get(myId);
            if (mine) {
                els.fName.value = mine.name || '';
                els.fFrom.value = mine.from || '';
                els.fBlurb.value = mine.blurb || '';
                // A private email cannot be read back out of the book, even
                // by its author, and is deliberately not remembered in this
                // browser either: the field stays empty and the sealed copy
                // is carried over on save unless a new address is typed.
                els.fEmail.value = mine.email || '';
                els.fEmail.placeholder = mine.emailEnc ? 'saved privately' : 'you@example.com';
                if (els.fPrivate) els.fPrivate.checked = privateOk && !!mine.emailEnc;
                els.fX.value = mine.x || '';
                els.fIg.value = mine.ig || '';
                variant = mine.variant || 0;
                els.save.textContent = 'Update my entry';
            } else {
                variant = 0;
                els.fEmail.placeholder = 'you@example.com';
                if (els.fPrivate) els.fPrivate.checked = false;
                els.save.textContent = 'Sign it';
            }
            labelEmail();
            els.error.hidden = true;
            updateCounter();
            updatePreview();
            els.sheet.hidden = false;
            setTimeout(() => els.fName.focus(), 40);
        }

        function closeCard() {
            els.sheet.hidden = true;
        }

        function updateCounter() {
            els.counter.textContent = `${els.fBlurb.value.length}/${MAX_BLURB}`;
        }

        function fail(msg, field) {
            els.error.textContent = msg;
            els.error.hidden = false;
            if (field) {
                field.classList.add('is-invalid');
                field.focus();
                setTimeout(() => field.classList.remove('is-invalid'), 900);
            }
        }

        /**
         * Read our entry back from the relays to see whether a write landed.
         *
         * The page's own Gun instance cannot answer this - it already holds
         * the value we just put, so it would say yes no matter what. A second
         * instance starts with an empty graph, so anything it returns came
         * over the wire. Only used when a save was never acknowledged.
         */
        function confirmStored(updatedTs, done) {
            let probe = null;
            let finished = false;
            let giveUp = null;
            const finish = (ok) => {
                if (finished) return;
                finished = true;
                clearTimeout(giveUp);
                timers.delete(giveUp);
                try {
                    // Forget each peer before closing its socket, otherwise
                    // Gun treats the close as a drop and reconnects.
                    const peers = probe.back('opt.peers') || {};
                    Object.keys(peers).forEach((k) => {
                        const wire = peers[k] && peers[k].wire;
                        delete peers[k];
                        if (wire && wire.close) wire.close();
                    });
                } catch (e) { /* ignore */ }
                done(ok);
            };

            try {
                const main = window.SiteGun.getGun();
                probe = window.Gun({
                    peers: Object.keys(main.back('opt.peers') || {}),
                    localStorage: false
                });
                window.SiteGun.paths.apps.guestbook(probe)
                    .get(myId).get('updatedTs').on((v) => { if (v === updatedTs) finish(true); });
            } catch (e) {
                return finish(false);
            }
            giveUp = setTimeout(() => finish(false), SAVE_ACK_TIMEOUT_MS);
            timers.add(giveUp);
        }

        function submit(e) {
            e.preventDefault();

            const name = text(els.fName.value, MAX_NAME);
            if (!name) return fail('A name is needed to sign the book.', els.fName);

            // Reject values that were typed but could not be understood, rather
            // than silently dropping them.
            const rawEmail = text(els.fEmail.value, 60);
            const email = normEmail(rawEmail);
            if (rawEmail && !email) return fail("That email doesn't look right.", els.fEmail);

            const rawX = text(els.fX.value, 120);
            const x = normHandle(rawX, 15, X_RE);
            if (rawX && !x) return fail('X handles are letters, numbers and underscores.', els.fX);

            const rawIg = text(els.fIg.value, 120);
            const ig = normHandle(rawIg, 30, IG_RE);
            if (rawIg && !ig) return fail('Instagram handles are letters, numbers, dots and underscores.', els.fIg);

            if (saving) return;

            // Without a relay the entry would only ever exist in this tab.
            if (!ref || !isConnected) {
                return fail("Can't reach the guestbook right now, so nothing was saved. Try again in a moment.");
            }

            const now = Date.now();
            if (now - lastSaveAt < SAVE_COOLDOWN_MS) return fail('Give it a moment…');
            lastSaveAt = now;

            const existing = entries.get(myId);
            const wantPrivate = privateOk && els.fPrivate.checked && !!email;
            // An already-private email is carried over untouched unless it is
            // being replaced (a new address typed) or dropped (box unticked).
            let keptEnc = '';
            if (existing && existing.emailEnc && !email &&
                (!privateOk || els.fPrivate.checked)) {
                keptEnc = existing.emailEnc;
            }
            const payload = {
                name: name,
                from: text(els.fFrom.value, MAX_FROM),
                blurb: text(els.fBlurb.value, MAX_BLURB),
                // A private email never reaches the book in the clear.
                email: wantPrivate ? '' : email,
                emailEnc: keptEnc,
                x: x,
                ig: ig,
                variant: variant,
                ts: (existing && existing.ts) || now,   // keep first-signed date
                updatedTs: now
            };

            // Success is only reported once a relay has acknowledged the
            // write. Several relays may answer, and one refusing does not
            // matter if another accepted, so an error waits out the timeout
            // for a better answer instead of failing straight away.
            saving = true;
            els.save.disabled = true;
            els.error.hidden = true;
            setStatus('Saving…');

            let sawError = false;
            let timer = null;
            const settle = (ok) => {
                if (!saving) return;
                saving = false;
                clearTimeout(timer);
                timers.delete(timer);
                els.save.disabled = false;

                if (!ok) {
                    lastSaveAt = 0;   // let them retry at once
                    setStatus(isConnected ? 'Live' : 'Offline — reconnecting…', !isConnected);
                    fail(sawError
                        ? "The guestbook wouldn't take that entry. Try again in a moment."
                        : "The guestbook didn't confirm your entry, so it may not be saved. Try again in a moment.");
                    return;
                }

                // Stops the visit toast on future loads
                store.set('guestbook-signed', myId);
                if (window.track) window.track('guestbook_signed', { edit: !!existing });
                // A private address is never kept in this browser in the
                // clear; this only clears a copy an older build left behind.
                store.remove(PRIVATE_EMAIL_STORE);
                closeCard();
                setStatus(existing ? 'Entry updated' : 'Signed — welcome');
                // Turn to the page it landed on; the local echo may still be
                // a paint away, in which case the next paint does it.
                revealMine = !showMyEntry();
            };

            const send = () => {
                if (!saving) return;
                timer = setTimeout(() => {
                    if (!saving || sawError || !isConnected) return settle(false);
                    // No relay answered either way. Rather than guess, ask one:
                    // a write that really landed can be read back.
                    confirmStored(now, settle);
                }, SAVE_ACK_TIMEOUT_MS);
                timers.add(timer);

                ref.get(myId).put(payload, (ack) => {
                    if (ack && ack.err) sawError = true;
                    else settle(true);
                });
            };

            if (!wantPrivate) return send();

            // Nothing is written unless the email could be sealed: falling
            // back to a public email here would break the promise just made.
            encryptEmail(email, emailKey).then((sealed) => {
                payload.emailEnc = sealed;
                send();
            }, () => {
                if (!saving) return;
                saving = false;
                lastSaveAt = 0;
                els.save.disabled = false;
                setStatus(isConnected ? 'Live' : 'Offline — reconnecting…', !isConnected);
                fail("Couldn't encrypt your email in this browser, so nothing was saved. " +
                    'Untick the private option or leave the email out.', els.fEmail);
            });
        }

        els.signBtn.addEventListener('click', () => {
            if (els.sheet.hidden) openCard(); else closeCard();
        });
        els.close.addEventListener('click', closeCard);
        els.cancel.addEventListener('click', closeCard);
        els.form.addEventListener('submit', submit);
        els.fName.addEventListener('input', schedulePreview);
        els.fBlurb.addEventListener('input', updateCounter);
        els.vary.addEventListener('click', () => {
            variant = (variant + 1) % 12;
            updatePreview();
        });

        els.sheet.addEventListener('mousedown', (e) => {
            if (e.target === els.sheet) closeCard();
        });

        // Keep the window manager's shortcuts out of the form
        root.querySelectorAll('input').forEach((input) => {
            input.addEventListener('keydown', (ev) => ev.stopPropagation());
            input.addEventListener('mousedown', (ev) => ev.stopPropagation());
        });
        root.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !els.sheet.hidden) {
                e.stopPropagation();
                closeCard();
            }
        });

        // ---- Data ------------------------------------------------------

        function reorder() {
            ordered = [...entries.entries()].sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
            // No count until there is something to count or a relay has
            // answered: "0 signatures" while offline is a guess.
            els.count.textContent = !entries.size && !bookKnown
                ? ''
                : (entries.size === 1 ? '1 signature' : entries.size + ' signatures');
            els.signBtn.textContent = entries.has(myId) ? 'Edit my entry' : 'Sign the book';
        }

        function setStatus(msg, offline) {
            els.status.textContent = msg;
            els.status.classList.toggle('is-offline', !!offline);
        }

        let repaint = null;
        function schedulePaint() {
            clearTimeout(repaint);
            timers.delete(repaint);
            repaint = setTimeout(() => {
                timers.delete(repaint);
                reorder();
                if (flipping) return;

                if (revealMine && showMyEntry()) {
                    revealMine = false;
                    return;
                }
                // The book is oldest-first, so the newest signatures are
                // at the back. Open there - a returning visitor should
                // not have to page past everything they have seen - but
                // only until the reader picks a page, and only while the
                // first load is still streaming in.
                if (!userTurned && firstDataAt && Date.now() - firstDataAt < FOLLOW_LATEST_MS) {
                    spread = lastFilledSpread();
                }
                // Keep the reader on a valid spread if entries vanish
                spread = Math.min(spread, spreadCount() - 1);
                paintSpread();
            }, 60);
            timers.add(repaint);
        }

        /**
         * Everything in this node was written by a stranger's browser.
         * Nothing is shown unless it survives the same normalisation the
         * form applies, and anything that does not is dropped whole.
         */
        function readEntry(data) {
            if (!data || typeof data.name !== 'string') return null;
            const name = text(data.name, MAX_NAME);
            if (!name) return null;

            const now = Date.now();
            // A date in the future would pin an entry to the last page.
            const stamp = (v) => {
                const n = Number(v) || 0;
                return n > 0 && n <= now + MAX_CLOCK_SKEW_MS ? n : 0;
            };
            const variant = Math.floor(Number(data.variant)) || 0;

            return {
                name: name,
                from: text(data.from, MAX_FROM),
                blurb: text(data.blurb, MAX_BLURB),
                email: normEmail(data.email),
                // Opaque to everyone but the site owner; only its shape is checked.
                emailEnc: typeof data.emailEnc === 'string' && ENC_RE.test(data.emailEnc) ? data.emailEnc : '',
                x: normHandle(data.x, 15, X_RE),
                ig: normHandle(data.ig, 30, IG_RE),
                variant: variant >= 0 && variant < VARIANTS ? variant : 0,
                ts: stamp(data.ts),
                updatedTs: stamp(data.updatedTs)
            };
        }

        /**
         * Fill the book from the daily snapshot published with the site, so
         * there is something to read before the relay answers - and at all,
         * should the relay ever lose the book. Whatever the relay does say
         * about an entry replaces the snapshot's copy.
         */
        function loadSnapshot() {
            const url = root.dataset.snapshot;
            if (!url || !window.fetch) return;
            fetch(url).then((res) => (res.ok ? res.json() : null)).then((data) => {
                if (!root.isConnected || !data || !Array.isArray(data.entries)) return;
                let added = false;
                data.entries.slice(-MAX_ENTRIES).forEach((raw) => {
                    const id = raw && raw.id;
                    if (typeof id !== 'string' || !id || id.length > MAX_ID_LEN) return;
                    if (hiddenIds.has(id)) return;
                    const entry = readEntry(raw);
                    if (!entry) return;
                    snapshot.set(id, entry);
                    // Whatever the relay has already said about it wins.
                    if (entries.has(id)) return;
                    entries.set(id, entry);
                    added = true;
                });
                if (!added) return;
                if (!firstDataAt) firstDataAt = Date.now();
                schedulePaint();
            }).catch(() => { /* the relay is still the source of truth */ });
        }

        function connect() {
            ref = window.SiteGun.paths.apps.guestbook();

            ref.map().on(function (data, id, _msg, ev) {
                if (ev && typeof ev.off === 'function') subscriptions.add(ev);
                markKnown();
                if (hiddenIds.has(id)) return;

                const entry = typeof id === 'string' && id.length <= MAX_ID_LEN
                    ? readEntry(data)
                    : null;

                if (!entry) {
                    // The page never blanks an entry, so a null or malformed
                    // one is data loss or vandalism: fall back to the
                    // snapshot's copy instead of letting it erase the entry.
                    const backup = snapshot.get(id);
                    if (backup) entries.set(id, backup);
                    else if (!entries.delete(id)) return;
                    schedulePaint();
                    return;
                }
                // Bounded, so a flood of junk ids cannot grow this forever.
                // Our own entry always gets in.
                if (!entries.has(id) && entries.size >= MAX_ENTRIES && id !== myId) return;

                if (!firstDataAt) firstDataAt = Date.now();
                entries.set(id, entry);
                // Cover visitors who signed before the toast existed. Not while
                // a save is in flight: that is only our own unconfirmed echo.
                if (id === myId && !saving) store.set('guestbook-signed', myId);
                schedulePaint();
            });

            if (window.SiteGun.getConnection) {
                offConnection = window.SiteGun.getConnection().onChange((connected) => {
                    isConnected = connected;
                    relayDown = !connected;
                    // A relay that stays connected and silent has no book.
                    clearTimeout(knownTimer);
                    timers.delete(knownTimer);
                    if (!bookKnown) {
                        if (connected) {
                            knownTimer = setTimeout(markKnown, EMPTY_BOOK_GRACE_MS);
                            timers.add(knownTimer);
                        }
                        schedulePaint();
                    }
                    if (!saving) setStatus(connected ? 'Live' : 'Offline — reconnecting…', !connected);
                    els.signBtn.disabled = !connected;
                });
            } else {
                isConnected = true;
                setStatus('Live');
                markKnown();
            }
        }

        function markKnown() {
            if (bookKnown) return;
            bookKnown = true;
            schedulePaint();
        }

        function waitFor(test, label) {
            return new Promise((resolve, reject) => {
                let attempts = 0;
                (function wait() {
                    if (test()) return resolve();
                    if (++attempts > 120) return reject(new Error(label + ' unavailable'));
                    setTimeout(wait, 50);
                })();
            });
        }

        reorder();
        paintSpread();
        loadSnapshot();

        // Resizing the window can switch between one and two pages per view.
        // Keep the reader on the same underlying page across that change.
        // Resizing changes both how many pages are shown side by side (width)
        // and how many entries fit on a page (height). Track both, and keep
        // the reader looking at roughly the same entry across the change.
        let lastCols = pagesPerView();
        let lastPer = perPage();
        if ('ResizeObserver' in window) {
            const ro = new ResizeObserver(() => {
                const cols = pagesPerView();
                const per = perPage();
                if (cols === lastCols && per === lastPer) return;

                const firstEntry = spread * lastCols * lastPer;
                lastCols = cols;
                lastPer = per;
                spread = Math.min(
                    Math.floor(firstEntry / (cols * per)),
                    spreadCount() - 1
                );
                paintSpread();
            });
            ro.observe(root);
            resizeObserver = ro;
        }

        waitFor(() => window.SiteGun && window.Signature, 'Guestbook')
            .then(connect)
            .catch(() => {
                setStatus('Offline', true);
                relayDown = true;
                schedulePaint();
                els.signBtn.disabled = true;
            });

        win.guestbookCleanup = function () {
            timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
            timers.clear();
            subscriptions.forEach((ev) => {
                try { ev.off(); } catch (e) { /* ignore */ }
            });
            subscriptions.clear();
            try { if (ref) ref.map().off(); } catch (e) { /* ignore */ }
            if (resizeObserver) {
                resizeObserver.disconnect();
                resizeObserver = null;
            }
            if (offConnection) {
                offConnection();
                offConnection = null;
            }
        };
    }

    window.initGuestbook = initGuestbook;
})();
