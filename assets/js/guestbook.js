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
            fX: root.querySelector('.gb-f-x'),
            fIg: root.querySelector('.gb-f-ig')
        };

        // Same identity the cursors use, so a person is one person site-wide
        let myId = localStorage.getItem('multiplayer-cursor-id');
        if (!myId) {
            myId = Math.random().toString(36).slice(2, 11);
            localStorage.setItem('multiplayer-cursor-id', myId);
        }

        const entries = new Map();
        let ordered = [];
        let spread = 0;
        let flipping = false;
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
                if (!ordered.length) {
                    const blank = document.createElement('div');
                    blank.className = 'gb-page-blank';
                    blank.textContent = 'The book is empty. Be the first to sign it.';
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

            if (per === 1) {
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
                els.fEmail.value = mine.email || '';
                els.fX.value = mine.x || '';
                els.fIg.value = mine.ig || '';
                variant = mine.variant || 0;
                els.save.textContent = 'Update my entry';
            } else {
                variant = 0;
                els.save.textContent = 'Sign it';
            }
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

            const now = Date.now();
            if (now - lastSaveAt < SAVE_COOLDOWN_MS) return fail('Give it a moment…');
            lastSaveAt = now;

            const existing = entries.get(myId);
            if (ref) {
                ref.get(myId).put({
                    name: name,
                    from: text(els.fFrom.value, MAX_FROM),
                    blurb: text(els.fBlurb.value, MAX_BLURB),
                    email: email,
                    x: x,
                    ig: ig,
                    variant: variant,
                    ts: (existing && existing.ts) || now,   // keep first-signed date
                    updatedTs: now
                });
            }

            // Stops the visit toast on future loads without waiting for Gun
            localStorage.setItem('guestbook-signed', myId);

            closeCard();
            setStatus(existing ? 'Entry updated' : 'Signed — welcome');
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
            els.count.textContent = entries.size === 1
                ? '1 signature'
                : entries.size + ' signatures';
            els.signBtn.textContent = entries.has(myId) ? 'Edit my entry' : 'Sign the book';
        }

        function setStatus(msg, offline) {
            els.status.textContent = msg;
            els.status.classList.toggle('is-offline', !!offline);
        }

        function connect() {
            ref = window.SiteGun.paths.apps.guestbook();

            let repaint = null;
            const schedulePaint = () => {
                clearTimeout(repaint);
                repaint = setTimeout(() => {
                    reorder();
                    if (!flipping) {
                        // Keep the reader on a valid spread if entries vanish
                        spread = Math.min(spread, spreadCount() - 1);
                        paintSpread();
                    }
                }, 60);
                timers.add(repaint);
            };

            ref.map().on(function (data, id, _msg, ev) {
                if (ev && typeof ev.off === 'function') subscriptions.add(ev);

                if (!data || !data.name) {
                    if (entries.delete(id)) schedulePaint();
                    return;
                }

                entries.set(id, {
                    name: text(data.name, MAX_NAME),
                    from: text(data.from, MAX_FROM),
                    blurb: text(data.blurb, MAX_BLURB),
                    email: normEmail(data.email),
                    x: normHandle(data.x, 15, X_RE),
                    ig: normHandle(data.ig, 30, IG_RE),
                    variant: Number(data.variant) || 0,
                    ts: Number(data.ts) || 0,
                    updatedTs: Number(data.updatedTs) || 0
                });
                // Cover visitors who signed before the toast existed
                if (id === myId) {
                    localStorage.setItem('guestbook-signed', myId);
                }
                schedulePaint();
            });

            if (window.SiteGun.getConnection) {
                offConnection = window.SiteGun.getConnection().onChange((connected) => {
                    setStatus(connected ? 'Live' : 'Offline — reconnecting…', !connected);
                    els.signBtn.disabled = !connected;
                });
            } else {
                setStatus('Live');
            }
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
