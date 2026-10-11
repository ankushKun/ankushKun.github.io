/**
 * Document layout behaviour (blog posts, projects, timeline entries).
 * Markup: layouts/partials/apps/doc/, styles: assets/css/apps/doc*.css.
 *
 * - Quick Look image viewer: figure images (and the cover) open full size on
 *   click, Enter or Space; Esc, a click or the close button dismiss it. Focus
 *   stays inside while it is open and returns to the image after.
 * - Contents: marks the section being read in the table of contents.
 * - Reading progress: browsers without scroll-driven animations get the
 *   hairline from here (--doc-progress on the article).
 * - Code: a block with more to scroll to on the right gets
 *   .doc-code-overflow (a fade on its edge) until it is scrolled to the end.
 *   Wide tables get the same fade (.doc-table-overflow on their frame).
 * - X (Twitter) embeds follow the light/dark appearance.
 *
 * Desktop windows receive their page by innerHTML, so articles are found by
 * [data-doc] on load and again whenever a window's content changes.
 */
(function () {
    'use strict';

    if (window.SiteDoc) return;

    // The system setting, or the site's own Preferences > Reduce motion
    // (html[data-motion="reduce"])
    const reducedMotion = () => document.documentElement.dataset.motion === 'reduce'
        || !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const timelineSupported = !!(window.CSS && CSS.supports && CSS.supports('animation-timeline: scroll()'));

    // The element that scrolls an article: the window body on the desktop and
    // on a standalone page, the document as a last resort.
    function scrollerOf(el) {
        const pane = el.closest('.window-content');
        if (pane && pane.scrollHeight > pane.clientHeight + 1) return pane;
        let node = el.parentElement;
        while (node && node !== document.body) {
            const oy = getComputedStyle(node).overflowY;
            if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight + 1) return node;
            node = node.parentElement;
        }
        return pane || document.scrollingElement || document.documentElement;
    }

    function onScroll(scroller, fn) {
        let queued = false;
        const target = scroller === document.scrollingElement || scroller === document.documentElement ? window : scroller;
        const run = () => { queued = false; fn(); };
        const handler = () => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(run);
        };
        target.addEventListener('scroll', handler, { passive: true });
        return handler;
    }

    // ---- Code blocks --------------------------------------------------------

    function watchCode(article) {
        const blocks = article.querySelectorAll('.doc-body .highlight, .doc-body > pre');
        if (!blocks.length) return;
        const check = (block) => {
            const pre = block.matches('pre') ? block : block.querySelector('pre');
            if (!pre) return;
            const more = pre.scrollWidth - pre.clientWidth - pre.scrollLeft > 2;
            block.classList.toggle('doc-code-overflow', more);
        };
        blocks.forEach((block) => {
            const pre = block.matches('pre') ? block : block.querySelector('pre');
            if (!pre) return;
            pre.addEventListener('scroll', () => check(block), { passive: true });
            check(block);
        });
        if (window.ResizeObserver) {
            const ro = new ResizeObserver(() => {
                if (!article.isConnected) { ro.disconnect(); return; }
                blocks.forEach(check);
            });
            ro.observe(article);
        }
    }

    // ---- Tables -------------------------------------------------------------

    // Same idea as code: a table wider than the column gets a fade on its
    // right edge (on the frame, which does not scroll) until it is scrolled
    // to the end
    function watchTables(article) {
        const tables = article.querySelectorAll('.doc-table-frame > .doc-table');
        if (!tables.length) return;
        const check = (scroller) => {
            const more = scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft > 2;
            scroller.parentElement.classList.toggle('doc-table-overflow', more);
        };
        tables.forEach((scroller) => {
            scroller.addEventListener('scroll', () => check(scroller), { passive: true });
            check(scroller);
        });
        if (window.ResizeObserver) {
            const ro = new ResizeObserver(() => {
                if (!article.isConnected) { ro.disconnect(); return; }
                tables.forEach(check);
            });
            ro.observe(article);
        }
    }

    // ---- X (Twitter) embeds -------------------------------------------------

    // widgets.js draws a light card unless told otherwise, a white slab in a
    // dark document. The page default (meta twitter:widgets:theme) and each
    // blockquote's data-theme follow the resolved appearance before it
    // renders. A card that was already drawn (widgets.js can win the race,
    // and the appearance can change later) has the theme in its iframe
    // address, which is switched in place.
    const tweetTheme = () => (document.documentElement.dataset.appearance === 'dark' ? 'dark' : 'light');

    function themeTweets(scope) {
        const theme = tweetTheme();
        let meta = document.querySelector('meta[name="twitter:widgets:theme"]');
        if (!meta) {
            meta = document.createElement('meta');
            meta.name = 'twitter:widgets:theme';
            document.head.appendChild(meta);
        }
        if (meta.content !== theme) meta.content = theme;
        const root = scope || document;
        root.querySelectorAll('[data-doc] blockquote.twitter-tweet').forEach((bq) => {
            if (bq.getAttribute('data-theme') !== theme) bq.setAttribute('data-theme', theme);
        });
        root.querySelectorAll('[data-doc] .twitter-tweet iframe[src*="theme="]').forEach((frame) => {
            const src = frame.getAttribute('src');
            const next = src.replace(/([?&]theme=)(light|dark)\b/, '$1' + theme);
            if (next !== src) frame.setAttribute('src', next);
        });
    }

    function watchTweets(article) {
        const body = article.querySelector('.doc-body');
        if (!body || !body.querySelector('.twitter-tweet')) return;
        themeTweets(article);
        if (!window.MutationObserver) return;
        // widgets.js swaps the blockquote for its iframe whenever it loads
        let timer = null;
        const mo = new MutationObserver(() => {
            if (!article.isConnected) { mo.disconnect(); return; }
            clearTimeout(timer);
            timer = setTimeout(() => themeTweets(article), 60);
        });
        mo.observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    }

    // ---- Contents and progress ---------------------------------------------

    function watchReading(article) {
        const links = Array.from(article.querySelectorAll('.doc-toc-nav a[href^="#"]'));
        const bar = article.querySelector('.doc-progress');
        if (!links.length && (!bar || timelineSupported)) return;

        const scroller = scrollerOf(article);
        const ids = [];
        links.forEach((a) => {
            const id = decodeURIComponent(a.getAttribute('href').slice(1));
            if (id && ids.indexOf(id) === -1) ids.push(id);
        });
        const headings = ids.map((id) => article.querySelector('#' + CSS.escape(id))).filter(Boolean);
        const side = article.querySelector('.doc-toc--side');
        let current = null;

        // The sticky contents column is sized from the window body that
        // scrolls, not the viewport (a window is shorter than the screen)
        function measure() {
            if (!side) return;
            const isDoc = scroller === document.scrollingElement || scroller === document.documentElement;
            const h = isDoc ? window.innerHeight : scroller.clientHeight;
            if (h > 0) article.style.setProperty('--doc-scroll-h', h + 'px');
        }

        // Keep the highlighted entry visible inside the column (never scroll
        // the page itself to do it)
        function revealCurrent() {
            if (!side || side.offsetParent === null) return;
            const a = side.querySelector('a[aria-current="true"]');
            if (!a) { side.scrollTop = 0; return; }
            const box = side.getBoundingClientRect();
            const r = a.getBoundingClientRect();
            const pad = 24;
            if (r.top < box.top + pad) side.scrollTop -= box.top + pad - r.top;
            else if (r.bottom > box.bottom - pad) side.scrollTop += r.bottom - (box.bottom - pad);
        }

        function update() {
            if (!article.isConnected) return;
            const isDoc = scroller === document.scrollingElement || scroller === document.documentElement;
            const top = isDoc ? 0 : scroller.getBoundingClientRect().top;

            if (headings.length) {
                // A section becomes current once its heading passes about
                // 38% of the way down the pane, where the eye is reading
                // (a line near the top lagged a heading behind)
                const line = top + scroller.clientHeight * 0.38;
                let found = null;
                for (const h of headings) {
                    if (h.getBoundingClientRect().top <= line) found = h; else break;
                }
                // At the very bottom the last section counts as read
                const scrollable = scroller.scrollHeight > scroller.clientHeight + 4;
                if (scrollable && scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) {
                    found = headings[headings.length - 1];
                }
                const id = found ? found.id : null;
                if (id !== current) {
                    current = id;
                    links.forEach((a) => {
                        const on = id !== null && decodeURIComponent(a.getAttribute('href').slice(1)) === id;
                        if (on) a.setAttribute('aria-current', 'true');
                        else a.removeAttribute('aria-current');
                    });
                    revealCurrent();
                }
            }

            if (bar && !timelineSupported) {
                const rect = article.getBoundingClientRect();
                const view = scroller.clientHeight;
                const total = Math.max(1, rect.height - view);
                const done = Math.min(1, Math.max(0, (top - rect.top) / total));
                article.style.setProperty('--doc-progress', done.toFixed(4));
            }
        }

        onScroll(scroller, update);
        const onResize = () => {
            if (!article.isConnected) { window.removeEventListener('resize', onResize); return; }
            measure();
            update();
        };
        window.addEventListener('resize', onResize, { passive: true });
        if (side && window.ResizeObserver && scroller.nodeType === 1 && scroller !== document.documentElement) {
            const ro = new ResizeObserver(() => {
                if (!article.isConnected) { ro.disconnect(); return; }
                measure();
                revealCurrent();
            });
            ro.observe(scroller);
        }
        measure();
        update();
    }

    // ---- Image viewer -------------------------------------------------------

    function markZoomable(article) {
        article.querySelectorAll('.doc-body .doc-figure img, .doc-cover img').forEach((img) => {
            if (img.closest('a')) return;
            img.setAttribute('data-zoomable', '');
            img.setAttribute('tabindex', '0');
            img.setAttribute('aria-haspopup', 'dialog');
        });
    }

    let viewer = null;

    function openViewer(img) {
        if (viewer) return;
        const figure = img.closest('figure');
        const capEl = figure && figure.querySelector('figcaption');
        const caption = (capEl && capEl.textContent.trim()) || img.getAttribute('alt') || '';

        const overlay = document.createElement('div');
        overlay.className = 'doc-viewer';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', caption ? 'Image: ' + caption : 'Image');

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'doc-viewer-close';
        close.setAttribute('aria-label', 'Close');
        close.textContent = '✕';

        const big = document.createElement('img');
        big.className = 'doc-viewer-img';
        big.src = img.currentSrc || img.src;
        big.alt = img.getAttribute('alt') || '';

        overlay.appendChild(close);
        overlay.appendChild(big);
        if (caption) {
            const p = document.createElement('p');
            p.className = 'doc-viewer-caption';
            p.textContent = caption;
            overlay.appendChild(p);
        }

        function onKey(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                dismiss();
            } else if (e.key === 'Tab') {
                // The close button is the only stop inside the viewer
                e.preventDefault();
                close.focus();
            }
        }

        function dismiss() {
            if (!viewer) return;
            viewer = null;
            window.removeEventListener('keydown', onKey, true);
            overlay.classList.remove('is-open');
            const done = () => overlay.remove();
            if (reducedMotion()) done(); else setTimeout(done, 200);
            if (img.isConnected) img.focus({ preventScroll: true });
        }

        overlay.addEventListener('click', dismiss);
        window.addEventListener('keydown', onKey, true);
        document.body.appendChild(overlay);
        viewer = { dismiss };
        requestAnimationFrame(() => overlay.classList.add('is-open'));
        close.focus({ preventScroll: true });
    }

    document.addEventListener('click', (e) => {
        const img = e.target.closest ? e.target.closest('img[data-zoomable]') : null;
        if (!img || !img.closest('[data-doc]')) return;
        if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        openViewer(img);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const img = e.target;
        if (!img || !img.matches || !img.matches('img[data-zoomable]')) return;
        e.preventDefault();
        openViewer(img);
    });

    // ---- Wiring -------------------------------------------------------------

    function init(root) {
        const scope = root && root.querySelectorAll ? root : document;
        const articles = scope.matches && scope.matches('[data-doc]') ? [scope] : scope.querySelectorAll('[data-doc]');
        articles.forEach((article) => {
            if (article.hasAttribute('data-doc-ready')) return;
            article.setAttribute('data-doc-ready', '');
            markZoomable(article);
            watchCode(article);
            watchTables(article);
            watchTweets(article);
            // After layout, so the scroller and heading positions are real
            requestAnimationFrame(() => watchReading(article));
        });
    }

    function start() {
        themeTweets(document);
        init(document);
        // Light/Dark in System Preferences, or the system switching under auto
        if (window.MutationObserver) {
            new MutationObserver(() => themeTweets(document))
                .observe(document.documentElement, { attributes: true, attributeFilter: ['data-appearance'] });
        }
        const container = document.getElementById('windows-container');
        if (container && window.MutationObserver) {
            let timer = null;
            new MutationObserver(() => {
                clearTimeout(timer);
                timer = setTimeout(() => init(container), 120);
            }).observe(container, { childList: true, subtree: true });
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();

    window.SiteDoc = { init: init };
})();
