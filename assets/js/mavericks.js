/**
 * macOS X 10.9 Mavericks Window Manager
 */

(function () {
    'use strict';

    // Configuration
    // URL reflects the focused window, so a window can be linked and bookmarked
    // and the browser Back button steps back through them.
    const ENABLE_DEEP_LINKING = true;

    // The desktop (home) is the only page that carries the app templates.
    // Article and section pages render a single static window instead.
    const IS_DESKTOP = !!document.getElementById('window-contents');

    // Must match the compact-mode media query in the stylesheets
    const COMPACT_QUERY = '(max-width: 768px), (pointer: coarse) and (max-height: 500px)';

    // Tab title as rendered by Hugo; restored whenever no window owns the URL
    const ORIGINAL_TITLE = document.title;
    // Site name for "<window> | <site>" titles, read from the page so it
    // follows hugo.toml (home is "<site> - ...", other pages "... | <site>")
    const SITE_NAME = (document.querySelector('meta[property="og:site_name"]') || {}).content
        || (IS_DESKTOP ? ORIGINAL_TITLE.split(' - ')[0] : ORIGINAL_TITLE.split(' | ').pop());
    // URL shown when no window owns it: the desktop on home, otherwise the
    // article or section page the visitor actually loaded.
    // On the desktop, ?open= and ?q= are instructions that have been carried
    // out by then; anything else (utm_*, ref...) is the visitor's and stays,
    // so the deferred analytics pageview still sees how they got here.
    const BASE_URL = IS_DESKTOP ? '/' + desktopQuery() : window.location.pathname + window.location.search;

    function desktopQuery() {
        try {
            const params = new URLSearchParams(window.location.search);
            params.delete('open');
            params.delete('q');
            const rest = params.toString();
            return rest ? '?' + rest : '';
        } catch (e) {
            return '';
        }
    }

    /**
     * localStorage that never throws. Safari with cookies blocked, some in-app
     * webviews and sandboxed frames throw on any storage access; fall back to
     * an in-memory map so the features that use it keep working for the visit.
     * Other scripts may load before or after this one - they must not assume
     * window.SiteStore exists.
     */
    const SiteStore = window.SiteStore || (function () {
        const mem = Object.create(null);
        return {
            get(key) {
                try {
                    const value = localStorage.getItem(key);
                    if (value !== null) return value;
                } catch (e) { /* storage blocked */ }
                return key in mem ? mem[key] : null;
            },
            set(key, value) {
                try {
                    localStorage.setItem(key, value);
                } catch (e) {
                    mem[key] = String(value);
                }
            },
            remove(key) {
                delete mem[key];
                try { localStorage.removeItem(key); } catch (e) { /* storage blocked */ }
            }
        };
    })();
    window.SiteStore = SiteStore;

    // External-link proxy (workers/site-worker). Empty or missing means the
    // feature is off: only hosts known to embed open in a window, everything
    // else opens a new tab.
    const LINK_PROXY = ((document.querySelector('meta[name="link-proxy"]') || {}).content || '')
        .trim().replace(/\/+$/, '');
    // Hosts that are known to allow framing; they load directly, never proxied
    const EMBEDDABLE_HOSTS = [
        'cal.com',
        'thelongestyard.link',
        'ankush.one'
    ];
    // Sites that always open in a new tab instead of going through the proxy.
    // Construct (and every subdomain: app., os., status.) refuses to be
    // framed, and Google sign-in plus the .construct.computer attribution
    // cookie only work in a real tab. Everything else gets a window first;
    // the worker shows its "opens in a new tab" page for sites that refuse.
    const NEVER_PROXY_HOSTS = [
        'construct.computer'
    ];
    const NEVER_PROXY_PATTERN = /$^/;
    // Same permissions the server-rendered embeds get (no allow-top-navigation)
    const DIRECT_IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-pointer-lock allow-modals allow-presentation allow-downloads';
    const PROXIED_IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-downloads';

    const SOUND_KEY = 'site-sound';                 // 'off' when sound effects are muted
    // Open windows and their positions are not remembered between visits
    // (every visit starts on About, as it always did). Earlier builds stored
    // them under these keys; they are cleared once at boot. The guestbook
    // nudge and the welcome tour are gone too: the front page says it all.
    const RETIRED_KEYS = ['desktop-session', 'window-geometry', 'guestbook-nudge-dismissed', 'site-welcome-v1'];

    /**
     * Analytics event. A no-op unless PostHog is on the page (it is skipped on
     * dev builds and for Global Privacy Control visitors).
     * Other scripts may call window.track?.('name', {...}).
     */
    function track(name, props) {
        try {
            if (window.posthog && typeof window.posthog.capture === 'function') {
                window.posthog.capture(name, props || {});
            }
        } catch (e) { /* analytics must never break the page */ }
        // The site event bus: features that react to what the visitor does
        // listen for `site:track` on document. It fires whether or not
        // analytics is on the page, and a listener that throws stays there.
        try {
            document.dispatchEvent(new CustomEvent('site:track', {
                detail: { name: String(name), props: props || {} }
            }));
        } catch (e) { /* CustomEvent unavailable */ }
    }
    window.track = track;

    function trackError(err, context) {
        try {
            if (window.posthog && typeof window.posthog.captureException === 'function') {
                window.posthog.captureException(err, { context });
            }
        } catch (e) { /* see track() */ }
    }

    // State
    let windowZIndex = 100;
    let activeWindow = null;
    const openWindows = new Map();
    const windowHistory = [];
    let globalSearchIndex = [];
    const appMetadata = new Map();
    // Short names accepted in /?open=<alias>; the registry may add more
    const appAliases = new Map([['irc', 'irc-chat']]);

    function init() {
        setupClock();
        setupDesktopIcons();
        updateTimelineDesktopIconDate();
        scheduleTimelineDesktopIconMidnightRefresh();
        setupDesktopClick();
        setupAppleMenuClose();
        setupMenubarControls();
        setupCompactMode();
        setupVisualViewport();
        setupIframeFocusTracking();
        setupExternalLinks();
        setupKeyboardShortcuts();
        preloadHighResWallpaper();
        lazyLoadImages();
        loadAppRegistry();
        setupDock();
        setupContextMenus();
        setupIrcUnreadDot();
        setupStaticWindows();
        setupViewportClamp();
        updateSpotlightTip();
        setupSoundToggle();
        setupOnlineInMenubar();
        // Article and section pages: code blocks in the server-rendered window
        document.querySelectorAll('.static-window').forEach(decorateContent);

        // Everything below needs the app templates, which only the desktop has.
        // On article and section pages the search index loads when Spotlight
        // is first opened instead.
        if (!IS_DESKTOP) {
            // Reloading on a window's URL lands on that page with the
            // desktop's history state still attached to the entry. It
            // describes windows this page never had: start clean.
            if (ENABLE_DEEP_LINKING && history.state && (history.state.windowId || history.state.depth)) {
                try {
                    history.replaceState(null, '', window.location.href);
                } catch (e) { /* history unavailable: popstate copes without */ }
            }
            return;
        }

        scheduleSearchIndexLoad();
        setupStartupChime();

        // Check for deep link or auto-open About Me
        const urlParams = new URLSearchParams(window.location.search);
        const openApp = urlParams.get('open');

        const query = (urlParams.get('q') || '').trim();
        const app = openApp ? resolveApp(openApp) : null;

        // The boot About rewrites the address to "/" before a page deep link
        // has loaded (and /?q= is never put back), so anything that wants to
        // know how the visitor arrived (the welcome tour) reads it here
        window.SiteShell.bootDeepLinked = !!(openApp || query);

        // Every visit starts on About, phones included. A deep link opens its
        // window on top of it rather than instead of it.
        openBootAbout();

        if (app) {
            // /?open=<id or alias>: the link stays in the address bar so it
            // can be copied, and the window takes over the entry the visitor
            // arrived on (an alias, or an app with a page of its own, has a
            // different canonical URL: replace, do not push a second entry).
            pushOnOpen = false;
            openWindowFrom('deeplink', app.id, app.title, app.size, app.permalink);
            pushOnOpen = true;
            placeBesideBootAbout(app.id);
        } else if (openApp && pathForOpenToken(openApp)) {
            // /?open=blogs/some-post: a page, opened as a window once the
            // search index (its id and title) is in
            const openPage = () => {
                const target = resolveOpenTarget(openApp, true);
                if (!target) {
                    resetUrlToDesktop();
                    return;
                }
                pushOnOpen = false;
                openWindowFrom('deeplink', target.id, target.title, target.size, target.permalink);
                pushOnOpen = true;
                placeBesideBootAbout(target.id);
            };
            loadSearchIndex().then(openPage, openPage);
        } else if (query) {
            // /?q=<terms> is the SearchAction advertised in the WebSite JSON-LD
            openSpotlightWithQuery(query);
        }
        // An ?open= id that matches nothing must not linger in the address bar
        if (openApp && !app && !pathForOpenToken(openApp)) resetUrlToDesktop();

        RETIRED_KEYS.forEach(key => SiteStore.remove(key));
    }

    /**
     * The About window that greets a visitor is not something they asked for,
     * so it must not claim the address bar or the tab title: home stays "/".
     * It starts doing so once the visitor opens About themselves.
     */
    function openBootAbout() {
        const about = resolveApp('about') || { id: 'about', title: 'About Me', size: { width: 1000, height: 700 }, permalink: null };
        openWindowFrom('boot', about.id, about.title, about.size, about.permalink);
    }

    /**
     * Look up an app by id or alias (/?open=irc means irc-chat).
     * Returns { id, title, size, permalink } or null when there is no such app.
     */
    function resolveApp(idOrAlias) {
        const key = String(idOrAlias || '').trim().toLowerCase();
        if (!key) return null;
        const id = appAliases.get(key) || key;

        const meta = appMetadata.get(id);
        if (meta && appIds.has(id)) {
            return {
                id,
                title: meta.title || id,
                size: { width: meta.width || 1000, height: meta.height || 700 },
                permalink: meta.permalink || null
            };
        }

        // No registry on the page: fall back to what the DOM knows
        const icon = document.querySelector(`.desktop-icon[data-window="${CSS.escape(id)}"]`);
        if (icon && icon.dataset.title) {
            return {
                id,
                title: icon.dataset.title,
                size: {
                    width: parseInt(icon.dataset.width, 10) || 1000,
                    height: parseInt(icon.dataset.height, 10) || 700
                },
                permalink: icon.dataset.permalink || null
            };
        }
        if (hasLocalWindowContent(id)) {
            return {
                id,
                title: id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' '),
                size: { width: 1000, height: 700 },
                permalink: null
            };
        }
        return null;
    }

    // Preload high-resolution wallpaper
    function preloadHighResWallpaper() {
        const highResImage = new Image();
        highResImage.onload = function () {
            // High-res image loaded, add class to trigger CSS transition
            document.body.classList.add('wallpaper-loaded');
        };
        // The visitor's chosen wallpaper (System Preferences > Desktop); a
        // solid colour has no image to wait for
        const chosen = window.SitePrefs && window.SitePrefs.resolved ? window.SitePrefs.resolved().wallpaper : null;
        if (chosen && !chosen.src) {
            document.body.classList.add('wallpaper-loaded');
            return;
        }
        highResImage.src = chosen ? chosen.src : '/wallpapers/wallpaper.webp';
    }

    // Lazy load images with data-src attribute
    function lazyLoadImages() {
        const lazyImages = document.querySelectorAll('img.lazy-image[data-src]');
        lazyImages.forEach(img => {
            const fullSrc = img.dataset.src;
            if (!fullSrc) return;

            const highResImage = new Image();
            highResImage.onload = function () {
                img.src = fullSrc;
                img.classList.add('loaded');
            };
            highResImage.src = fullSrc;
        });
    }

    // Activate Twitter Embeds
    function activateTwitterEmbeds(container) {
        // Check if we have twitter blockquotes
        if (!container.querySelector('.twitter-tweet')) return;

        // If the twitter object is available, re-scan the container
        if (window.twttr && window.twttr.widgets) {
            window.twttr.widgets.load(container);
        } else {
            // Load the script if not present
            if (!document.getElementById('twitter-wjs')) {
                const script = document.createElement('script');
                script.id = 'twitter-wjs';
                script.src = "https://platform.twitter.com/widgets.js";
                script.async = true;
                script.charset = "utf-8";
                document.head.appendChild(script);
            }
        }
    }

    // Activate lazy-loaded iframes (iframes with data-src instead of src)
    // This is called when a window containing iframes is opened
    function activateLazyIframes(container) {
        const lazyIframes = container.querySelectorAll('iframe[data-src]');
        lazyIframes.forEach(iframe => {
            const src = iframe.dataset.src;
            if (src && !iframe.src) {
                iframe.src = src;
                // Remove data-src to prevent re-loading
                iframe.removeAttribute('data-src');
            }
        });
    }

    // Keyboard Shortcuts
    // Option/Ctrl+Tab has cycled windows and the modifier is still down
    let tabCycleHeld = false;

    function setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Escape: Close Spotlight, then any open dropdown
            if (e.key === 'Escape') {
                // Close Spotlight if open
                if (document.getElementById('spotlight-overlay')) {
                    closeSpotlight();
                    return;
                }
                if (closeContextMenu(true)) return;

                // Close any open dropdowns, handing focus back to the trigger
                const hadMenu = MENU_IDS.some(isMenuOpen) || !!document.querySelector('#menubar-music.open');
                window.closeDropdowns({ restoreFocus: true });
                if (hadMenu) return;

                // Small utility windows dismiss like the panels they imitate
                const activeId = activeWindow && activeWindow.dataset.windowId;
                if ((activeId === 'about-this-mac' || activeId === 'shortcuts' || activeId === 'get-info') &&
                    !e.defaultPrevented && !document.fullscreenElement) {
                    closeWindow(activeWindow, activeId);
                }
                return;
            }

            // Everything else stays out of the way while the visitor is typing.
            // The terminal in particular needs Ctrl+W/H/M/K for the shell, and
            // closing its window tears the VM down. Spotlight's own field is
            // the one exception, so the chord that opened it can close it.
            const inSpotlight = !!(e.target && e.target.closest && e.target.closest('#spotlight-overlay'));
            if (isTypingContext(e.target) && !inSpotlight) return;

            const modKey = e.metaKey || e.ctrlKey;

            // Cmd/Ctrl + K, Ctrl + Space, or a bare "/": Spotlight search.
            // (Cmd+Space never reaches the page - macOS keeps it.)
            const isSearchChord =
                (modKey && !e.altKey && !e.shiftKey && e.code === 'KeyK') ||
                (e.ctrlKey && !e.metaKey && !e.altKey && e.code === 'Space') ||
                (!modKey && !e.altKey && e.key === '/' && !inSpotlight);
            if (isSearchChord) {
                e.preventDefault();
                toggleSpotlight();
                return;
            }

            // Window chords take Ctrl or Alt/Option, interchangeably. Cmd is
            // left alone: Cmd+W/H/M belong to the browser and macOS. Matched on
            // e.code because Option rewrites e.key on macOS (Option+W is "∑").
            // (On Windows/Linux the browser keeps Ctrl+W for closing the tab.)
            if (!(e.altKey || e.ctrlKey) || e.metaKey || inSpotlight) return;

            // Alt + W: Close active window
            if (e.code === 'KeyW') {
                e.preventDefault();
                if (activeWindow) {
                    const id = activeWindow.dataset.windowId;
                    closeWindow(activeWindow, id);
                }
            }

            // Alt + M: Minimize active window
            if (e.code === 'KeyM') {
                e.preventDefault();
                if (activeWindow) {
                    const minimizeBtn = activeWindow.querySelector('.traffic-light.minimize');
                    if (minimizeBtn) minimizeBtn.click();
                }
            }

            // Alt + H: Hide all windows (show desktop).
            // Minimizes into the tray rather than hiding outright, otherwise
            // every open window becomes unreachable.
            if (e.code === 'KeyH') {
                e.preventDefault();
                showDesktop();
            }

            // Alt + ` or Alt + Tab (Ctrl works too): cycle through windows,
            // backwards with Shift. Where the OS or browser keeps the chord
            // for itself (Alt+Tab on Windows, Ctrl+Tab in most browsers) it
            // never reaches the page, and ` still does the job.
            // Option+Tab is also how Safari (and Chrome with "Tab highlights
            // links" off) steps through links: once focus is on a link or
            // control inside a window, the Tab chord is left to the browser,
            // unless it is a further Tab of a cycle the modifier is still
            // held down for (focus may have landed inside the new window).
            const inWindowBody = e.key === 'Tab' && e.target && e.target.closest &&
                !!e.target.closest('.window-content');
            if (e.code === 'Backquote' || (e.key === 'Tab' && (!inWindowBody || tabCycleHeld))) {
                e.preventDefault();
                cycleWindows(e.shiftKey);
                if (e.key === 'Tab') tabCycleHeld = true;
            }
        });

        // Letting go of Option/Ctrl ends a Tab cycle
        const endTabCycle = () => { tabCycleHeld = false; };
        document.addEventListener('keyup', (e) => {
            if (e.key === 'Alt' || e.key === 'Control' || !(e.altKey || e.ctrlKey)) endTabCycle();
        });
        window.addEventListener('blur', endTabCycle);
    }

    /** True when keystrokes belong to a text field, an editor or a terminal. */
    function isTypingContext(target) {
        if (target && target.closest &&
            target.closest('.v86-xterm, .xterm, input, textarea, select, [contenteditable]:not([contenteditable="false"])')) {
            return true;
        }
        // The emulators read the keyboard at document level, so an active
        // terminal owns it even when focus sits on the page body.
        const activeId = activeWindow && activeWindow.dataset.windowId;
        return activeId === 'terminal' || activeId === 'portal';
    }

    /** Menubar and tab title for "nothing focused", plus the desktop URL. */
    function showFinderState() {
        const activeAppName = document.getElementById('active-app-name');
        if (activeAppName) activeAppName.textContent = 'Finder';
        document.title = ORIGINAL_TITLE;
        resetUrlToDesktop();
    }

    /** The menubar tooltip is static markup; make it name the chord for this platform. */
    function updateSpotlightTip() {
        const btn = document.querySelector('.menubar [data-tip^="Search ("]');
        if (btn) btn.dataset.tip = `Search (${isMacPlatform() ? '⌘K' : 'Ctrl+K'})`;
    }

    function isMacPlatform() {
        return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    }

    // Cycle through open windows
    function cycleWindows(backwards) {
        const windows = Array.from(openWindows.values()).filter(w => w.style.display !== 'none');
        if (windows.length === 0) return;

        let next = windows[backwards ? windows.length - 1 : 0];
        if (activeWindow && windows.includes(activeWindow)) {
            const step = backwards ? windows.length - 1 : 1;
            next = windows[(windows.indexOf(activeWindow) + step) % windows.length];
        }
        bringToFront(next);
        // A keyboard gesture: the keyboard follows the window
        focusWindow(next);
    }

    // Expose Spotlight toggle for menubar click
    window.toggleSpotlightFromMenu = function () {
        toggleSpotlight();
    };

    // What had focus when Spotlight opened; it gets it back on close
    let spotlightReturnFocus = null;

    /**
     * The one way Spotlight goes away.
     * @param {boolean} [restoreFocus=true] hand focus back to where it was
     */
    function closeSpotlight(restoreFocus) {
        const spotlight = document.getElementById('spotlight-overlay');
        if (!spotlight) return false;
        spotlight.remove();

        const target = spotlightReturnFocus;
        spotlightReturnFocus = null;
        if (restoreFocus !== false && target && target.isConnected && typeof target.focus === 'function') {
            try { target.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        }
        return true;
    }

    // Spotlight Search
    function toggleSpotlight() {
        let spotlight = document.getElementById('spotlight-overlay');

        if (spotlight) {
            closeSpotlight();
            return;
        }

        const active = document.activeElement;
        spotlightReturnFocus = active && active !== document.body ? active : null;

        // Create spotlight overlay
        spotlight = document.createElement('div');
        spotlight.id = 'spotlight-overlay';
        spotlight.setAttribute('role', 'dialog');
        spotlight.setAttribute('aria-modal', 'true');
        spotlight.setAttribute('aria-label', 'Search');
        spotlight.innerHTML = `
            <div class="spotlight-container">
                <div class="spotlight-search">
                    <svg class="spotlight-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
                        <circle cx="11" cy="11" r="8"></circle>
                        <path d="m21 21-4.3-4.3"></path>
                    </svg>
                    <input type="text" id="spotlight-input" placeholder="Search..." autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go"
                        role="combobox" aria-label="Search site" aria-autocomplete="list" aria-controls="spotlight-listbox" aria-expanded="false">
                </div>
                <div class="spotlight-results" id="spotlight-results"></div>
            </div>
        `;
        document.body.appendChild(spotlight);

        // Styles live in assets/css/apps/spotlight.css

        // Focus input
        const input = document.getElementById('spotlight-input');
        input.focus();

        // Modal: Tab stays inside (the field, plus Retry when it is showing)
        spotlight.addEventListener('keydown', (e) => {
            if (e.key !== 'Tab') return;
            const stops = [...spotlight.querySelectorAll('input, button')];
            const index = stops.indexOf(document.activeElement);
            e.preventDefault();
            const next = stops[(index + (e.shiftKey ? -1 : 1) + stops.length) % stops.length] || input;
            next.focus();
        });

        // Persistent hint footer (the .spotlight-hint rule existed but nothing
        // ever rendered it)
        const hint = document.createElement('div');
        hint.className = 'spotlight-hint';
        hint.setAttribute('aria-hidden', 'true');
        hint.textContent = '↑↓ to navigate · ↵ to open · esc to close';
        spotlight.querySelector('.spotlight-container').appendChild(hint);

        const getIconHtml = (item) => {
            const known = getSearchItemIconHtml(item);
            if (known) return known;
            if (item.icon && (item.icon.startsWith('/') || item.icon.startsWith('http'))) {
                return `<span class="app-icon app-icon-spotlight app-icon-type-image app-icon-fit-contain"><img src="${escapeHtml(item.icon)}" alt="" draggable="false"></span>`;
            }

            const kind = getIconForType(item.type);
            return `<span class="app-icon app-icon-spotlight app-icon-type-fallback app-icon-fit-contain"><span class="spotlight-generic-icon ${kind}"></span></span>`;
        };

        const decorate = (item) => ({
            ...item,
            iconHtml: getIconHtml(item),
            windowId: item.openWindow || ('content-' + item.permalink.replace(/[^a-z0-9]/gi, '-'))
        });

        /**
         * Opening Spotlight to a blank panel forces you to already know what
         * you want. Seed it with the apps plus the newest writing so it works
         * as a browsing surface too.
         */
        function defaultSuggestions() {
            const items = searchItems();
            const apps = items.filter(i => i.openWindow && i.type === 'app').slice(0, 4);
            const rest = items
                .filter(i => i.permalink && (i.type === 'blogs' || i.type === 'projects'))
                .slice(0, 4);
            return apps.concat(rest).slice(0, 8).map(decorate);
        }

        // Handle search
        let selectedIndex = -1;
        let tokens = [];
        // 'loading' until the lazily fetched index is in, 'failed' if it is not coming
        let indexState = searchIndexLoaded ? 'ready' : 'loading';
        let noResultsTimer = null;

        function runSearch() {
            const query = input.value.toLowerCase().trim();
            tokens = query ? query.split(/\s+/).slice(0, 6) : [];

            // Best match first: title beats tags beats description beats body
            // text, so a stray word in an early page no longer outranks the
            // page that is actually called that.
            const results = query
                ? searchItems()
                    .map((item, order) => ({ item, order, score: scoreSearchItem(item, tokens, query) }))
                    .filter(r => r.score > 0)
                    .sort((a, b) => b.score - a.score || a.order - b.order)
                    .slice(0, 8)
                    .map(r => decorate(r.item))
                : defaultSuggestions();

            renderResults(results, !query);
            selectedIndex = results.length > 0 ? 0 : -1;
            updateSelection();

            clearTimeout(noResultsTimer);
            if (query && results.length === 0 && indexState === 'ready') {
                noResultsTimer = setTimeout(() => track('spotlight_no_results', { query_length: query.length }), 1200);
            }
        }

        input.addEventListener('input', runSearch);

        // Keyboard navigation
        input.addEventListener('keydown', (e) => {
            const results = document.querySelectorAll('.spotlight-result');

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                selectedIndex = Math.min(selectedIndex + 1, results.length - 1);
                updateSelection();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                selectedIndex = Math.max(selectedIndex - 1, 0);
                updateSelection();
            } else if (e.key === 'Enter' && selectedIndex >= 0) {
                e.preventDefault();
                results[selectedIndex].click();
            }
        });

        function updateSelection() {
            const options = document.querySelectorAll('.spotlight-result');
            let activeId = '';
            options.forEach((el, i) => {
                const selected = i === selectedIndex;
                el.classList.toggle('selected', selected);
                el.setAttribute('aria-selected', selected ? 'true' : 'false');
                if (!selected) return;
                activeId = el.id;
                el.scrollIntoView({ block: 'nearest' });
                // Warm the article the visitor is about to open
                schedulePrefetch(el.dataset.window, el.dataset.permalink);
            });
            // Focus stays in the field; this is what a screen reader follows
            input.setAttribute('aria-expanded', options.length > 0 ? 'true' : 'false');
            if (activeId) input.setAttribute('aria-activedescendant', activeId);
            else input.removeAttribute('aria-activedescendant');
        }

        function renderResults(results, isDefault) {
            const container = document.getElementById('spotlight-results');

            // Content pages come from the lazily fetched index: say when they
            // are still on their way, and offer a retry when they are not.
            let status = '';
            if (indexState === 'loading') {
                status = '<div class="spotlight-status" role="status">Loading pages…</div>';
            } else if (indexState === 'failed') {
                status = '<div class="spotlight-status" role="status">Blog posts and projects could not be loaded. ' +
                    '<button type="button" class="spotlight-retry">Retry</button></div>';
            }

            if (results.length === 0) {
                container.innerHTML = status || (input.value.trim()
                    ? '<div class="spotlight-no-results" role="status">No results found</div>'
                    : '');
                bindRetry(container);
                return;
            }
            const heading = isDefault
                ? '<div class="spotlight-section" aria-hidden="true">Suggestions</div>'
                : '';
            // Options are reached with the arrow keys from the field
            // (aria-activedescendant), so they are not tab stops themselves.
            container.innerHTML = heading +
                `<div class="spotlight-listbox" id="spotlight-listbox" role="listbox" aria-label="${isDefault ? 'Suggestions' : 'Search results'}">` +
                results.map((item, i) => {
                const label = getSearchTypeLabel(item);
                const snippet = getSearchSnippet(item, tokens);
                return `
                <div class="spotlight-result" role="option" id="spot-opt-${i}" aria-selected="false" data-window="${escapeHtml(item.windowId)}" data-title="${escapeHtml(item.title)}" data-permalink="${escapeHtml(item.permalink || '')}" data-width="${item.width || 900}" data-height="${item.height || 650}">
                    <span class="spotlight-result-icon" aria-hidden="true">${item.iconHtml}</span>
                    <div class="spotlight-result-content">
                        <div class="spotlight-result-title">${highlightMatches(item.title, tokens)}</div>
                        <div class="spotlight-result-type">${escapeHtml(label)}${snippet ? ' · ' + highlightMatches(snippet, tokens) : ''}</div>
                    </div>
                </div>
            `}).join('') + '</div>' + status;

            // Add click handlers
            container.querySelectorAll('.spotlight-result').forEach((el, position) => {
                el.addEventListener('click', () => {
                    const windowId = el.dataset.window;
                    const title = el.dataset.title;
                    const permalink = el.dataset.permalink;
                    const width = parseInt(el.dataset.width, 10) || 900;
                    const height = parseInt(el.dataset.height, 10) || 650;
                    clearTimeout(noResultsTimer);
                    track('spotlight_result', { query_length: input.value.trim().length, position, id: windowId });
                    // Focus returns to where it was, then moves into the window
                    closeSpotlight();
                    openWindowFrom('spotlight', windowId, title, { width, height }, permalink || null);
                });
            });
            bindRetry(container);
        }

        function bindRetry(container) {
            const retry = container.querySelector('.spotlight-retry');
            if (retry) retry.addEventListener('click', loadIndexForSpotlight);
        }

        function loadIndexForSpotlight() {
            indexState = 'loading';
            runSearch();
            loadSearchIndex().then((ok) => {
                indexState = ok ? 'ready' : 'failed';
                if (spotlight.isConnected) runSearch();
            });
        }

        // Click outside to close
        spotlight.addEventListener('click', (e) => {
            if (e.target === spotlight) {
                closeSpotlight();
            }
        });

        // Show suggestions immediately rather than an empty panel. The index
        // is fetched lazily; the search re-runs once it lands so content pages
        // join the apps that the inline registry already provides.
        if (searchIndexLoaded) runSearch();
        else loadIndexForSpotlight();
    }

    /** /?q=<terms>: open Spotlight with the query already typed. */
    function openSpotlightWithQuery(query) {
        if (!document.getElementById('spotlight-overlay')) toggleSpotlight();
        const input = document.getElementById('spotlight-input');
        if (!input) return;
        input.value = query;
        input.dispatchEvent(new Event('input'));
    }

    const SEARCH_TYPE_LABELS = {
        app: 'Application',
        game: 'Game',
        blogs: 'Blog post',
        projects: 'Project',
        timeline: 'Timeline',
        page: 'Page'
    };

    function getSearchTypeLabel(item) {
        const type = (item.type || '').toLowerCase();
        return SEARCH_TYPE_LABELS[type] || (type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Item');
    }

    /**
     * Relevance of one index item for a query; 0 means no match. Every word
     * of the query has to appear somewhere, and where it appears sets the
     * weight: title, then tags, then description, then type, then body text.
     */
    function scoreSearchItem(item, tokens, query) {
        const title = (item.title || '').toLowerCase();
        const tags = Array.isArray(item.tags) ? item.tags.join(' ').toLowerCase() : '';
        const description = (item.description || '').toLowerCase();
        const type = `${item.type || ''} ${item.type || ''}s ${getSearchTypeLabel(item)}`.toLowerCase();
        const content = (item.content || '').toLowerCase();

        let score = 0;
        for (const token of tokens) {
            let s = 0;
            if (title === token) s = 100;
            else if (title.startsWith(token)) s = 80;
            else if (title.includes(' ' + token)) s = 65;
            else if (title.includes(token)) s = 50;
            else if (tags.includes(token)) s = 30;
            else if (description.includes(token)) s = 20;
            else if (type.includes(token)) s = 12;
            else if (content.includes(token)) s = 8;
            if (!s) return 0;
            score += s;
        }

        // The words in order, as typed, beat the same words scattered about
        if (tokens.length > 1 && title.includes(query)) score += 25;
        // Apps are what most searches are after
        if (item.kind === 'app' || item.type === 'app' || item.type === 'game') score += 5;
        return score;
    }

    /** Text escaped for HTML, with every occurrence of the query words wrapped in <mark>. */
    function highlightMatches(text, tokens) {
        const value = String(text ?? '');
        if (!tokens || !tokens.length) return escapeHtml(value);
        const pattern = new RegExp(
            '(' + tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
        // split() with one capture group puts the matches at odd indexes
        return value.split(pattern)
            .map((part, i) => (i % 2 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)))
            .join('');
    }

    /** One line of context under a result: where the match is, else the description. */
    function getSearchSnippet(item, tokens) {
        const max = 90;
        const clip = (text) => (text.length > max ? text.slice(0, max).trimEnd() + '…' : text);
        const description = (item.description || '').trim();
        if (!tokens || !tokens.length) return clip(description);

        const title = (item.title || '').toLowerCase();
        const missing = tokens.filter(t => !title.includes(t));
        // The title already shows why this matched
        if (!missing.length) return clip(description);

        if (description && missing.some(t => description.toLowerCase().includes(t))) return clip(description);

        const tagged = (Array.isArray(item.tags) ? item.tags : []).filter(
            tag => missing.some(t => String(tag).toLowerCase().includes(t)));
        if (tagged.length) return tagged.map(tag => '#' + tag).join(' ');

        const content = item.content || '';
        const lower = content.toLowerCase();
        let at = -1;
        missing.forEach(t => {
            const i = lower.indexOf(t);
            if (i > -1 && (at === -1 || i < at)) at = i;
        });
        if (at === -1) return clip(description);

        // Start a few words before the match, on a word boundary
        let start = Math.max(0, at - 30);
        if (start > 0) {
            const space = content.indexOf(' ', start);
            start = space > -1 && space < at ? space + 1 : start;
        }
        const piece = content.slice(start, start + max).trim();
        return (start > 0 ? '…' : '') + piece + (start + max < content.length ? '…' : '');
    }

    // ================================================
    // App registry and search index
    // The registry is a small inline JSON block (one record per app) that is
    // available synchronously on every page. The search index adds the content
    // pages and is only fetched when idle on the desktop, or when Spotlight is
    // first opened elsewhere.
    // ================================================

    const contentIcons = {};        // icon key (document|folder|calendar) -> markup
    const metaByPath = new Map();   // content pathname -> index item
    const appIds = new Set();       // ids of registered apps (as opposed to content pages)
    const dockAppIds = [];          // apps kept in the Dock, in registry order
    let searchIndexLoaded = false;
    let searchIndexPromise = null;

    function loadAppRegistry() {
        const el = document.getElementById('app-registry');
        if (!el) return;

        let apps;
        try {
            apps = JSON.parse(el.textContent);
        } catch (e) {
            console.error('Invalid app registry', e);
            return;
        }
        if (!Array.isArray(apps)) return;

        apps.forEach(app => {
            if (!app || !app.id || appMetadata.has(app.id)) return;
            appIds.add(app.id);
            const item = {
                title: app.title,
                type: app.type || 'app',
                openWindow: app.id,
                description: app.description || '',
                searchable: app.searchable !== false,
                iconHtml: app.iconHtml || ''
            };
            if (app.label) item.label = app.label;
            if (app.dock) dockAppIds.push(app.id);
            if (app.contentPermalink) item.permalink = app.contentPermalink;
            if (app.width) item.width = app.width;
            if (app.height) item.height = app.height;
            appMetadata.set(app.id, item);
            if (Array.isArray(app.aliases)) {
                app.aliases.forEach(alias => {
                    if (alias) appAliases.set(String(alias).toLowerCase(), app.id);
                });
            }
        });
    }

    function loadSearchIndex() {
        if (searchIndexPromise) return searchIndexPromise;

        searchIndexPromise = fetch('/index.json')
            .then(r => {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(data => {
                // Apps and content pages are all in index.json
                globalSearchIndex = data;
                data.forEach(item => {
                    // Content pages name their icon by key; the markup rides
                    // along once per key instead of once per page.
                    if (item.icon && item.iconHtml && !contentIcons[item.icon]) {
                        contentIcons[item.icon] = item.iconHtml;
                    }
                    if (!item.openWindow) return;
                    // Keep what the registry supplied (icon markup) for apps
                    appMetadata.set(item.openWindow, Object.assign({}, appMetadata.get(item.openWindow), item));
                    if (item.kind === 'app') {
                        appIds.add(item.openWindow);
                    } else if (item.permalink) {
                        metaByPath.set(pathOf(item.permalink), item);
                    }
                });
                searchIndexLoaded = true;
                refreshWindowIcons();
                return true;
            })
            .catch(e => {
                console.error('Failed to load search index', e);
                // Allow a later Spotlight open (or its Retry row) to try again
                searchIndexPromise = null;
                return false;
            });

        return searchIndexPromise;
    }

    function scheduleSearchIndexLoad() {
        if ('requestIdleCallback' in window) {
            requestIdleCallback(() => loadSearchIndex(), { timeout: 4000 });
        } else {
            setTimeout(loadSearchIndex, 1500);
        }
    }

    /** What Spotlight searches: the full index once loaded, the registry's apps before that. */
    function searchItems() {
        if (searchIndexLoaded) return globalSearchIndex;
        return [...appMetadata.values()].filter(item => item.searchable !== false);
    }

    /** Pathname of a permalink, so absolute and relative forms compare equal. */
    function pathOf(permalink) {
        try {
            return new URL(permalink, window.location.origin).pathname;
        } catch (e) {
            return permalink;
        }
    }

    /** Fallback when neither registry nor index knows an app: reuse its desktop icon. */
    function getDesktopIconHtml(id, context) {
        const iconEl = document.querySelector(`.desktop-icon[data-window="${CSS.escape(id)}"] .app-icon`);
        return iconEl ? iconEl.outerHTML.replace('app-icon-desktop', 'app-icon-' + context) : '';
    }

    /** Spotlight-sized icon markup for a search item, or '' when unknown. */
    function getSearchItemIconHtml(item) {
        if (!item) return '';
        if (item.iconHtml) return item.iconHtml;
        const meta = item.openWindow ? appMetadata.get(item.openWindow) : null;
        if (meta && meta.iconHtml) return meta.iconHtml;
        if (item.icon && contentIcons[item.icon]) return contentIcons[item.icon];
        if (item.type === 'app' && item.openWindow) return getDesktopIconHtml(item.openWindow, 'spotlight');
        return '';
    }

    /** Titlebar/tray icon. The chrome variant is the spotlight markup with its context class swapped. */
    function getWindowIconHtml(id, path) {
        // The same page can be opened under more than one window id (a blog
        // post launched from Timeline), so fall back to matching by path.
        const meta = appMetadata.get(id) || (path ? metaByPath.get(pathOf(path)) : null);
        if (meta && meta.iconHtmlChrome) return uniqueSvgIds(meta.iconHtmlChrome);
        const html = getSearchItemIconHtml(meta);
        if (html) return uniqueSvgIds(html.replace('app-icon-spotlight', 'app-icon-chrome'));
        return uniqueSvgIds(getDesktopIconHtml(id, 'chrome'));
    }

    /**
     * Icon SVGs name their gradients and filters (id="projBody"), and every
     * copy the shell makes (titlebar, Dock, menubar chip) would repeat them.
     * url(#id) resolves to the first element with that id in the document,
     * so one hidden copy (a minimised window's chip) blanked them all.
     * Each copy gets ids of its own.
     */
    let svgIdSerial = 0;
    function uniqueSvgIds(html) {
        if (!html || html.indexOf('id="') === -1) return html;
        const ids = new Set();
        html.replace(/\sid="([^"]+)"/g, (match, id) => { ids.add(id); return match; });
        if (ids.size === 0) return html;
        const suffix = '-c' + (++svgIdSerial);
        return html
            .replace(/(\sid=")([^"]+)(")/g, (match, pre, id, post) => (ids.has(id) ? pre + id + suffix + post : match))
            .replace(/(url\(\s*['"]?#)([^'")\s]+)/g, (match, pre, id) => (ids.has(id) ? pre + id + suffix : match))
            .replace(/((?:xlink:)?href="#)([^"]+)/g, (match, pre, id) => (ids.has(id) ? pre + id + suffix : match));
    }

    /** Fill in titlebar icons for windows opened before the index arrived. */
    function refreshWindowIcons() {
        openWindows.forEach((win, id) => {
            const titleEl = win.querySelector('.window-title');
            if (titleEl && !titleEl.querySelector('.app-icon')) {
                const html = getWindowIconHtml(id, win.dataset.path);
                if (html) titleEl.insertAdjacentHTML('afterbegin', html);
            }
        });
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[char]));
    }

    /** Cmd/Ctrl/Shift/Alt or a non-primary button: the browser's own "open elsewhere" gestures. */
    function isModifiedClick(e) {
        return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || (typeof e.button === 'number' && e.button !== 0);
    }

    function getIconForType(type) {
        const t = (type || '').toLowerCase();
        if (t.includes('project') || t.includes('game') || t.includes('app')) return 'folder';
        return 'document';
    }

    /** Sync Timeline desktop calendar icon month/day to the visitor's local date (static Hugo build uses build-time defaults). */
    function updateTimelineDesktopIconDate() {
        // Every copy of the calendar icon on the page (desktop icon, toolbar).
        const d = new Date();
        const month = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
        const day = String(d.getDate());
        document.querySelectorAll('svg [data-cal-part="month"]').forEach(el => { el.textContent = month; });
        document.querySelectorAll('svg [data-cal-part="day"]').forEach(el => { el.textContent = day; });
    }

    function scheduleTimelineDesktopIconMidnightRefresh() {
        const now = new Date();
        const next = new Date(now);
        next.setDate(next.getDate() + 1);
        next.setHours(0, 0, 0, 0);
        const ms = next.getTime() - now.getTime();
        setTimeout(function tick() {
            updateTimelineDesktopIconDate();
            setInterval(updateTimelineDesktopIconDate, 86400000);
        }, ms);
    }

    // Clock
    function setupClock() {
        const clock = document.getElementById('clock');
        if (!clock) return;

        // Date and time apart: a phone's menubar drops the date while
        // minimised-window chips need the room (apps/shell-menubar.css)
        const datePart = document.createElement('span');
        datePart.className = 'clock-date';
        const timePart = document.createElement('span');
        timePart.className = 'clock-time';
        clock.replaceChildren(datePart, timePart);

        function updateClock() {
            const now = new Date();
            const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ', ';
            let timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

            // Blink the colon on odd seconds
            if (now.getSeconds() % 2 === 1) {
                // Replace the time colon (between hour and minute) with a space
                timeStr = timeStr.replace(/(\d+):(\d{2})/, '$1 $2');
            }

            if (datePart.textContent !== dateStr) datePart.textContent = dateStr;
            timePart.textContent = timeStr;
            // <time>: machine-readable to the minute (no per-second churn)
            if (clock.tagName === 'TIME') {
                const stamp = new Date(now);
                stamp.setSeconds(0, 0);
                const iso = stamp.toISOString();
                if (clock.getAttribute('datetime') !== iso) clock.setAttribute('datetime', iso);
            }
        }

        // Tick only while the tab is visible; catch up the moment it returns
        let timer = null;
        const start = () => {
            if (timer) return;
            updateClock();
            timer = setInterval(updateClock, 1000);
        };
        const stop = () => {
            clearInterval(timer);
            timer = null;
        };

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) stop();
            else start();
        });

        if (document.hidden) updateClock();
        else start();
    }

    // Desktop Icons - SINGLE CLICK to open
    function setupDesktopIcons() {
        const icons = document.querySelectorAll('.desktop-icon');
        icons.forEach(icon => {
            icon.addEventListener('click', (e) => {
                // If it has a window to open, open it
                const windowId = icon.dataset.window;
                const title = icon.dataset.title;
                if (windowId && title) {
                    // Icons may be real links for crawlers and no-JS visitors
                    if (isModifiedClick(e)) return;
                    e.preventDefault();
                    const width = parseInt(icon.dataset.width, 10) || 1000;
                    const height = parseInt(icon.dataset.height, 10) || 700;
                    const permalink = icon.dataset.permalink || null;
                    openWindow(windowId, title, { width, height }, permalink, icon);
                }
                // Else it might have an onclick handler (like Schedule Call)
            });

            icon.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    icon.click();
                }
            });
        });
    }

    function setupDesktopClick() {
        const desktop = document.getElementById('desktop');
        if (!desktop) return;

        desktop.addEventListener('click', (e) => {
            if (e.target === desktop || e.target.classList.contains('desktop-icons')) {
                deactivateAllWindows();
                // Nothing is focused any more: shortcuts, the iframe focus
                // tracker and the saved session all go by activeWindow
                activeWindow = null;
                // Reset menubar, tab title and URL to Finder
                showFinderState();
            }
        });
    }

    // External Links - Open in iframe windows
    function setupExternalLinks() {
        document.addEventListener('click', (e) => {
            const link = e.target.closest('a[href]');
            if (!link) return;

            // Skip the "open in new tab" button in external windows and titlebar links
            if (link.classList.contains('open-external') || link.classList.contains('titlebar-link')) return;

            // Leave the browser's own gestures alone (Cmd/Ctrl/Shift-click),
            // along with downloads and the YouTube facade's fallback link.
            if (isModifiedClick(e) || link.hasAttribute('download') || link.classList.contains('yt-lite')) return;

            const href = link.getAttribute('href');

            // data-open="tab" opts a link out of windowing: always a new tab
            if (link.dataset.open === 'tab') {
                if (href && link.target !== '_blank') {
                    e.preventDefault();
                    window.open(link.href, '_blank', 'noopener');
                }
                return;
            }

            // Handle Deep Linking (?open=app)
            // Only this desktop's own address counts: another site's ?open=
            // is an ordinary external link (handled further down).
            if (href && href.includes('?open=')) {
                let tempUrl = null;
                try {
                    tempUrl = new URL(href, window.location.href);
                } catch (err) { /* malformed: left to the checks below */ }
                const isDesktopAddress = !!tempUrl && tempUrl.origin === window.location.origin &&
                    (tempUrl.pathname === '/' || tempUrl.pathname === '/index.html');
                const openApp = isDesktopAddress ? (tempUrl.searchParams.get('open') || '').trim() : '';

                if (openApp) {
                    // Off the desktop the link navigates there, which opens it
                    if (!IS_DESKTOP) return;
                    e.preventDefault();
                    e.stopPropagation();

                    // An app (registered title and size; aliases accepted)
                    const app = resolveApp(openApp);
                    if (app) {
                        openWindowFrom('link', app.id, app.title, app.size, app.permalink);
                        return;
                    }
                    // A page (/?open=blogs/some-post), the same window a link
                    // to /blogs/some-post/ opens, by the rule a reload of that
                    // address follows. Anything else names nothing: reloading
                    // the desktop for it would only close every window.
                    if (!pathForOpenToken(openApp)) return;
                    const openPage = () => {
                        const target = resolveOpenTarget(openApp, true);
                        if (target) openWindowFrom('link', target.id, target.title, target.size, target.permalink);
                    };
                    if (searchIndexLoaded) openPage();
                    else loadSearchIndex().then(openPage, openPage);
                    return;
                }
            }

            // A fragment link inside a desktop window (heading anchors,
            // footnotes) points into that window. Left to the browser it
            // becomes a history entry on the desktop document that stands
            // for no window, which breaks Back and the close bookkeeping.
            if (IS_DESKTOP && href && href.startsWith('#')) {
                const ownWindow = link.closest('#windows-container .window');
                if (ownWindow) {
                    if (!e.defaultPrevented) scrollToFragment(ownWindow, href);
                    e.preventDefault();
                    return;
                }
            }

            // Skip in-page anchors, mailto, tel, and javascript
            if (!href ||
                href.startsWith('#') ||
                href.startsWith('mailto:') ||
                href.startsWith('tel:') ||
                href.startsWith('javascript:')) {
                return;
            }

            let url;
            try {
                url = new URL(href, window.location.href);
            } catch (err) {
                return;
            }
            if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

            // Same-origin links: inside a desktop window they open as windows
            // instead of replacing the whole desktop with a standalone page.
            if (url.origin === window.location.origin) {
                handleInternalLink(e, link, url);
                return;
            }

            // Most of the web sends X-Frame-Options/frame-ancestors, and we
            // cannot detect that from script (a cross-origin probe always
            // throws). A block-list was effectively "list the whole web",
            // and anything missed became a permanently blank window.
            // So: hosts we know embed load directly; everything else goes
            // through the link proxy when one is configured, and to a new
            // tab when it is not.

            // Take over the click first, so we never both window.open() and
            // let the browser navigate the current page.
            e.preventDefault();
            e.stopPropagation();

            const host = url.hostname.replace(/^www\./, '');
            const embeddable = EMBEDDABLE_HOSTS.some(
                (allowed) => host === allowed || host.endsWith('.' + allowed)
            );

            const proxyable = !!LINK_PROXY && !NEVER_PROXY_PATTERN.test(host) && !NEVER_PROXY_HOSTS.some(
                (blocked) => host === blocked || host.endsWith('.' + blocked)
            );

            if (!embeddable && !proxyable) {
                track('external_link', { host, mode: 'tab' });
                window.open(href, '_blank', 'noopener');
                return;
            }

            track('external_link', { host, mode: embeddable ? 'embed' : 'proxy' });
            openExternalWindow(url.href, host, { proxied: !embeddable });
        });
    }

    /** Scroll a window to the element a "#fragment" names; false when it has none. */
    function scrollToFragment(win, hash) {
        let target = null;
        try {
            const name = decodeURIComponent(String(hash).replace(/^#/, ''));
            if (name) {
                target = win.querySelector('#' + CSS.escape(name)) ||
                    win.querySelector('a[name="' + CSS.escape(name) + '"]');
            }
        } catch (err) { /* malformed fragment */ }
        if (!target) return false;
        target.scrollIntoView({ block: 'start' });
        return true;
    }

    /**
     * A same-origin link clicked inside a desktop window. A full page load
     * would throw away every open window, the music and the chat connection,
     * so the target opens as a window (or focuses the one already showing it).
     */
    function handleInternalLink(e, link, url) {
        // Rows and cards that open windows have already dealt with the click
        if (e.defaultPrevented || !IS_DESKTOP) return;
        if (link.target === '_blank' || !link.closest('.window')) return;

        const path = url.pathname;
        const linkText = (link.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);

        // A link to a heading of the page this window is already showing
        const ownWindow = link.closest('.window');
        if (url.hash.length > 1 && ownWindow.dataset.path === path && scrollToFragment(ownWindow, url.hash)) {
            e.preventDefault();
            return;
        }

        const openTarget = () => {
            // Files (PDFs, feeds, images) are not pages with a window body
            if (/\.(?!html?$)[a-z0-9]{2,5}$/i.test(path)) {
                window.open(url.href, '_blank', 'noopener');
                return;
            }
            const target = windowTargetForPath(path, linkText);
            openWindowFrom('link', target.id, target.title, target.size, target.permalink);
        };

        e.preventDefault();
        // Ids and titles for content pages come from the lazily fetched index
        if (searchIndexLoaded) openTarget();
        else loadSearchIndex().then(openTarget);
    }

    /**
     * The window for a same-site page: the app that lives at that URL
     * (Projects, Blogs, Resume...), its search-index entry, or failing both
     * (tag and section pages) a plain window that fetches the page. Content
     * pages need the search index to be loaded for their ids and titles.
     */
    function windowTargetForPath(path, title) {
        let app = null;
        appIds.forEach(id => {
            const meta = appMetadata.get(id);
            if (!app && meta && meta.permalink && pathOf(meta.permalink) === path) app = resolveApp(id);
        });
        if (!app && (path === '/' || path === '/index.html')) app = resolveApp('about');
        if (app) return app;

        const meta = metaByPath.get(path);
        if (meta) {
            return {
                id: meta.openWindow,
                title: meta.title,
                size: { width: meta.width || 900, height: meta.height || 650 },
                permalink: meta.permalink
            };
        }
        return { id: 'content-' + path.replace(/[^a-z0-9]/gi, '-'), title: title || path, size: { width: 900, height: 650 }, permalink: path };
    }

    // The desktop never changes route: a window's address is the desktop plus
    // ?open=<token>, so a reload (or a copied address bar) comes back to the
    // desktop with that window open, never to a bare article page. The token
    // is an app id (music, blogs) or a page path without its outer slashes
    // (blogs/doom-style-renderer).

    /** "blogs/some-post" from "/blogs/some-post/". */
    function openTokenForPath(path) {
        return String(path || '').replace(/^\/+|\/+$/g, '');
    }

    /** "/blogs/some-post/" from an ?open= token that is not an app, or null if it cannot be a page. */
    function pathForOpenToken(token) {
        const clean = openTokenForPath(token);
        if (!clean || !/^[\w.~-]+(\/[\w.~-]+)*$/.test(clean) || clean.split('/').includes('..')) return null;
        return '/' + clean + '/';
    }

    /**
     * What an ?open= value names: an app (or alias), else a page on this
     * site. `strict` (an address someone typed or was sent) accepts only
     * pages in the search index, plus tag and category listings, so a
     * mistyped address shows the desktop instead of an empty window.
     */
    function resolveOpenTarget(token, strict) {
        const app = resolveApp(token);
        if (app) return app;
        const path = pathForOpenToken(token);
        if (!path) return null;
        if (strict && !metaByPath.has(path) && !/^\/(tags|categories)\/[^/]+\/$/.test(path)) return null;
        return windowTargetForPath(path);
    }

    /** Traffic lights markup (shared by dynamically created windows). */
    function getTrafficLightsMarkup() {
        return `
                <div class="traffic-lights">
                    <div class="traffic-light close" role="button" tabindex="0" aria-label="Close window"><span class="traffic-light-face"><span class="traffic-light-symbol" aria-hidden="true"><svg viewBox="0 0 12 12" focusable="false"><path d="M4 4 L8 8 M8 4 L4 8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></span></span></div>
                    <div class="traffic-light minimize" role="button" tabindex="0" aria-label="Minimize window"><span class="traffic-light-face"><span class="traffic-light-symbol" aria-hidden="true"><svg viewBox="0 0 12 12" focusable="false"><path d="M3.5 6 H8.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></span></span></div>
                    <div class="traffic-light maximize" role="button" tabindex="0" aria-label="Zoom window"><span class="traffic-light-face"><span class="traffic-light-symbol" aria-hidden="true"><svg viewBox="0 0 12 12" focusable="false"><path d="M6 3.5 V8.5 M3.5 6 H8.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></span></span></div>
                </div>`;
    }

    // Open external URL in iframe window
    // `opts.proxied`: load through the link proxy instead of straight from the
    // site. The toolbar and every "new tab" control always carry the real URL.
    function openExternalWindow(url, title, opts) {
        const proxied = !!(opts && opts.proxied && LINK_PROXY);

        // The same link clicked twice focuses the window it already has
        const existing = [...openWindows.values()].find(
            w => w.dataset.externalUrl === url && !w.classList.contains('closing'));
        if (existing) {
            activateWindow(existing);
            return;
        }

        const windowId = 'external-' + Date.now();

        const win = document.createElement('div');
        win.className = 'window external-window';
        win.dataset.windowId = windowId;
        win.dataset.cursorAnchor = 'win:' + windowId;
        win.dataset.externalUrl = url;
        // escapeHtml on every interpolation - a bare quote in a URL would
        // otherwise break out of the attribute and mangle the window.
        const safeUrl = escapeHtml(url);
        const frameSrc = proxied ? `${LINK_PROXY}/?url=${encodeURIComponent(url)}` : url;
        const archiveUrl = escapeHtml('https://web.archive.org/web/2/' + url);
        win.innerHTML = `
            <div class="window-titlebar">
                ${getTrafficLightsMarkup()}
                <div class="window-title"><span class="window-title-text">${escapeHtml(title)}</span></div>
            </div>
            <div class="window-toolbar">
                <button type="button" class="toolbar-btn external-reload" aria-label="Reload" data-tip="Reload"><span aria-hidden="true">↻</span></button>
                <div class="url-bar">
                    <span class="url-icon" aria-hidden="true">${url.startsWith('https://') ? '🔒' : '🌐'}</span>
                    <span class="url-text">${safeUrl}</span>
                </div>
                <a href="${safeUrl}" target="_blank" rel="noopener" class="open-external" aria-label="Open in new tab" data-tip="Open in new tab">↗</a>
            </div>
            <div class="window-iframe-container">
                <div class="window-loader" role="status" aria-label="Loading">
                    <div class="mac-spinner spinner"></div>
                </div>
                <iframe src="${escapeHtml(frameSrc)}" title="${escapeHtml(title)}" frameborder="0" allowfullscreen
                    allow="fullscreen"
                    sandbox="${proxied ? PROXIED_IFRAME_SANDBOX : DIRECT_IFRAME_SANDBOX}"
                    referrerpolicy="strict-origin-when-cross-origin"></iframe>
                <div class="iframe-blocked-fallback" role="alert" style="display: none;">
                    <h3>This site cannot be displayed in a window</h3>
                    <p>It did not load here. Open it in a tab, or look for an archived copy.</p>
                    <div class="fallback-actions">
                        <a href="${safeUrl}" target="_blank" rel="noopener" class="fallback-btn open-external">Open in New Tab ↗</a>
                        <a href="${archiveUrl}" target="_blank" rel="noopener" class="mac-btn open-external">View Archived Snapshot</a>
                    </div>
                </div>
            </div>
            <div class="window-resize"></div>
        `;

        prepareWindowElement(win);
        placeWindow(win, { width: 1000, height: 700 });

        document.getElementById('windows-container').appendChild(win);
        openWindows.set(windowId, win);

        const iframe = win.querySelector('iframe');
        const fallback = win.querySelector('.iframe-blocked-fallback');
        const loader = win.querySelector('.window-loader');
        const reload = win.querySelector('.external-reload');

        let settled = false;
        let slowTimer = null;
        const settle = (blocked) => {
            if (settled) return;
            settled = true;
            clearTimeout(slowTimer);
            loader.style.display = 'none';
            reload.classList.remove('is-loading');
            if (blocked) {
                iframe.style.display = 'none';
                fallback.style.display = 'flex';
            }
        };
        const begin = () => {
            settled = false;
            loader.style.display = '';
            iframe.style.display = '';
            fallback.style.display = 'none';
            reload.classList.add('is-loading');
            // A frame that is refused by the site does not report it (a
            // cross-origin probe always throws), and the proxy answers dead or
            // blocked sites with a page of its own, so a timeout here means
            // "slow", not "blocked" - just retire the spinner.
            clearTimeout(slowTimer);
            slowTimer = setTimeout(() => settle(false), 8000);
        };

        iframe.addEventListener('load', () => settle(false));
        iframe.addEventListener('error', () => settle(true));

        // A proxied page reports the real URL it is showing each time it
        // loads ({ source: 'link-proxy', url }), so the toolbar and the "new
        // tab" controls follow the visitor as they click around inside it.
        if (proxied) {
            let proxyOrigin = '';
            try { proxyOrigin = new URL(LINK_PROXY, window.location.href).origin; } catch (err) { /* bad config */ }
            // The pages this window has shown, in order, so the proxy's Back
            // button can return to the previous one, or close the window when
            // there is none. A frame's own history cannot tell those apart.
            const shownStack = [];
            const onProxyMessage = (e) => {
                if (!win.isConnected) {
                    window.removeEventListener('message', onProxyMessage);
                    return;
                }
                if (e.source !== iframe.contentWindow || e.origin !== proxyOrigin) return;
                const data = e.data;
                if (!data || data.source !== 'link-proxy') return;
                if (data.action === 'back') {
                    shownStack.pop(); // the page asking to go back
                    const previous = shownStack.pop();
                    if (previous) {
                        begin();
                        iframe.src = `${LINK_PROXY}/?url=${encodeURIComponent(previous)}`;
                    } else {
                        closeWindow(win, win.dataset.windowId);
                    }
                    return;
                }
                if (typeof data.url !== 'string') return;
                let shown;
                try { shown = new URL(data.url); } catch (err) { return; }
                if (shown.protocol !== 'http:' && shown.protocol !== 'https:') return;
                if (shownStack[shownStack.length - 1] !== shown.href) shownStack.push(shown.href);

                win.querySelector('.url-text').textContent = shown.href;
                win.querySelector('.url-icon').textContent = shown.protocol === 'https:' ? '🔒' : '🌐';
                win.querySelectorAll('a.open-external').forEach((a) => {
                    a.href = a.classList.contains('mac-btn')
                        ? 'https://web.archive.org/web/2/' + shown.href
                        : shown.href;
                });
            };
            if (proxyOrigin) window.addEventListener('message', onProxyMessage);
        }
        reload.addEventListener('click', () => {
            begin();
            // Back to the page the window was opened for, wherever the
            // visitor has clicked through to since
            iframe.src = frameSrc;
        });
        begin();

        win.classList.add('opening');
        setTimeout(() => win.classList.remove('opening'), 200);

        setupWindowDrag(win);
        setupWindowResize(win);
        setupWindowControls(win, windowId);
        bringToFront(win);
        focusWindow(win);
    }

    // Apple Menu Functions
    // Each menu is a <button aria-controls="<dropdown id>"> next to its
    // [role=menu] dropdown; the trigger's aria-expanded mirrors the .open class.
    // In menubar order. The ones after the app name come from
    // layouts/partials/os/menubar-menus.html; a page without them just has fewer.
    const MENU_IDS = ['apple-dropdown', 'finder-dropdown', 'menu-file', 'menu-edit', 'menu-view', 'menu-go',
        'menu-window', 'menu-help'];

    function menuTrigger(dropdownId) {
        return document.querySelector(`.menubar [aria-controls="${dropdownId}"]`);
    }

    function isMenuOpen(dropdownId) {
        const dropdown = document.getElementById(dropdownId);
        return !!dropdown && dropdown.classList.contains('open');
    }

    /** The items arrow keys move between (not dividers, labels or disabled rows). */
    function menuItems(dropdown) {
        return [...dropdown.querySelectorAll('[role^="menuitem"]')].filter(
            item => !item.hidden && item.getAttribute('aria-disabled') !== 'true');
    }

    /**
     * @param {string} dropdownId
     * @param {boolean} open
     * @param {Object} [opts]
     * @param {boolean} [opts.restoreFocus]  closing: put focus back on the trigger
     * @param {'first'|'last'} [opts.focus]  opening: move focus onto an item
     */
    function setMenuOpen(dropdownId, open, opts) {
        const dropdown = document.getElementById(dropdownId);
        if (!dropdown) return;
        const options = opts || {};
        const trigger = menuTrigger(dropdownId);

        if (!open) {
            if (!dropdown.classList.contains('open')) return;
            // Focus inside a menu that is about to be hidden would be lost
            const hadFocus = dropdown.contains(document.activeElement);
            dropdown.classList.remove('open');
            if (trigger) {
                trigger.setAttribute('aria-expanded', 'false');
                if (hadFocus || options.restoreFocus) trigger.focus({ preventScroll: true });
            }
            return;
        }

        MENU_IDS.forEach(id => { if (id !== dropdownId) setMenuOpen(id, false); });
        if (typeof window.closeMusicMenu === 'function') window.closeMusicMenu();
        closeContextMenu(false);

        updateFinderWindowsList();
        updateMenuState(dropdown);
        // Tiling does nothing on a compact layout, where every window is fullscreen
        const tile = dropdown.querySelector('[data-menu-action="tile"]');
        if (tile) tile.hidden = isCompactViewport();

        dropdown.classList.add('open');
        if (trigger) trigger.setAttribute('aria-expanded', 'true');

        if (options.focus) {
            const items = menuItems(dropdown);
            const target = options.focus === 'last' ? items[items.length - 1] : items[0];
            if (target) target.focus({ preventScroll: true });
        }
    }

    function toggleMenu(dropdownId, opts) {
        setMenuOpen(dropdownId, !isMenuOpen(dropdownId), opts);
    }

    /** The window menu commands act on: focused and on screen. */
    function commandWindow() {
        return activeWindow && isWindowShown(activeWindow) ? activeWindow : null;
    }

    /** Absolute URL of the focused window, or of this page when it is an article. */
    function commandLink() {
        const win = commandWindow();
        if (win) {
            const path = win.dataset.path;
            return path && path !== '/' ? new URL(path, window.location.origin).href : null;
        }
        return IS_DESKTOP ? null : window.location.origin + window.location.pathname;
    }

    function copyLinkWithNotice(url) {
        copyText(url).then(() => {
            showNotification({ title: 'Link Copied', message: url, duration: 2500, sound: false });
        }, () => {
            showNotification({ title: 'Could not copy the link', message: url, duration: 6000, sound: false });
        });
    }

    /** The personal-desktop module (assets/js/desktop-personal.js), when it is on the page. */
    function personalDesktop() {
        return window.DesktopPersonal || null;
    }

    /**
     * Open the Preferences app, optionally on one pane. Returns false when
     * no such app is registered (the menu items that need it are hidden then).
     */
    function openPreferences(pane) {
        const app = resolveApp('preferences');
        if (!app) return false;
        openWindowFrom('menu', app.id, app.title, app.size, app.permalink);
        if (!pane) return true;

        // The pane API belongs to the app and may arrive with its bundle
        let tries = 0;
        const show = () => {
            const prefs = window.SitePrefs;
            if (prefs && typeof prefs.openPane === 'function') prefs.openPane(pane);
            else if (++tries < 40 && openWindows.has(app.id)) setTimeout(show, 100);
        };
        show();
        return true;
    }

    function sharedSticky() {
        const note = document.getElementById('desktop-sticky-note');
        const toggle = document.getElementById('menubar-sticky-toggle');
        if (!note) return null;
        const shown = !note.hidden && !note.classList.contains('is-collapsed');
        // Minimised, it is reachable through its menubar icon; neither means
        // the realtime bundle has not brought it up (yet)
        const available = shown || (!!toggle && !toggle.hidden);
        return { note, toggle, shown, available };
    }

    function toggleSharedSticky() {
        const sticky = sharedSticky();
        if (!sticky || !sticky.available) return;
        if (sticky.shown) {
            const close = sticky.note.querySelector('.sticky-close');
            if (close) close.click();
        } else if (sticky.toggle) {
            sticky.toggle.click();
        }
    }

    function togglePageFullscreen() {
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => { /* already leaving */ });
        } else if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().then(() => {
                track('fullscreen', { id: 'desktop' });
            }).catch(() => { /* refused: stay as we are */ });
        }
    }

    function bringAllToFront() {
        const windows = [...openWindows.values()].filter(win => !win.classList.contains('closing'));
        if (windows.length === 0) return;
        const front = activeWindow && windows.includes(activeWindow) ? activeWindow : windows[windows.length - 1];
        windows.forEach(win => restoreWindow(win));
        activateWindow(front);
    }

    // ---- Edit menu ----

    /** A text field or editor the Edit commands can act on (never the terminal's hidden textarea). */
    function isEditableTarget(el) {
        if (!el || !el.matches || el.closest('.xterm, .v86-xterm')) return false;
        if (el.matches('textarea, input')) {
            if (el.disabled || el.readOnly) return false;
            return el.tagName === 'TEXTAREA' ||
                /^(text|search|url|email|tel|password|number|)$/.test(el.getAttribute('type') || '');
        }
        return !!el.isContentEditable;
    }

    function hasTextSelection(el) {
        if (el && el.matches && el.matches('textarea, input')) {
            try {
                return typeof el.selectionStart === 'number' && el.selectionStart !== el.selectionEnd;
            } catch (e) {
                return false; // input types without a selection API
            }
        }
        const selection = window.getSelection && window.getSelection();
        return !!selection && !selection.isCollapsed && selection.toString().length > 0;
    }

    /** What "Select All" would select when no field has focus: the window being read. */
    function selectAllScope() {
        const win = commandWindow();
        if (win) return win.querySelector('.window-content');
        return document.querySelector('.static-window .window-content');
    }

    /**
     * @param {string} command  undo | redo | cut | copy | paste | select-all
     * @param {Element} target  what had focus when the menu was used
     */
    function runEditCommand(command, target) {
        const editable = isEditableTarget(target) ? target : null;
        if (editable && document.activeElement !== editable) editable.focus({ preventScroll: true });
        const exec = (name, value) => {
            try {
                return document.execCommand(name, false, value);
            } catch (e) {
                return false;
            }
        };

        if (command === 'select-all') {
            if (editable && typeof editable.select === 'function') {
                editable.select();
            } else if (editable) {
                exec('selectAll');
            } else {
                const scope = selectAllScope();
                if (!scope) return;
                const range = document.createRange();
                range.selectNodeContents(scope);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
            }
            return;
        }

        if (command === 'paste') {
            if (!editable || !navigator.clipboard || !navigator.clipboard.readText) return;
            navigator.clipboard.readText().then((text) => {
                if (!text || !editable.isConnected) return;
                editable.focus({ preventScroll: true });
                if (!exec('insertText', text) && typeof editable.setRangeText === 'function') {
                    editable.setRangeText(text, editable.selectionStart, editable.selectionEnd, 'end');
                    editable.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }).catch(() => {
                showNotification({
                    title: 'Paste',
                    message: `Your browser kept the clipboard to itself. Press ${formatShortcut('mod+V')} instead.`,
                    duration: 5000,
                    sound: false
                });
            });
            return;
        }

        exec(command);
    }

    /** "alt+W" as this platform writes it: ⌥W on a Mac, Alt+W elsewhere. */
    function formatShortcut(chord) {
        const mac = isMacPlatform();
        const parts = String(chord).split('+');
        const key = parts.pop();
        const has = (name) => parts.includes(name);
        if (mac) {
            return (has('alt') ? '⌥' : '') + (has('shift') ? '⇧' : '') + (has('mod') ? '⌘' : '') + key;
        }
        return (has('mod') ? 'Ctrl+' : '') + (has('alt') ? 'Alt+' : '') + (has('shift') ? 'Shift+' : '') + key;
    }

    /** Whether the thing a menu item needs is there right now (data-menu-needs). */
    const MENU_NEEDS = {
        // [available at all on this page/layout, usable right now]
        'window': () => [IS_DESKTOP, !!commandWindow()],
        'window-zoom': () => [IS_DESKTOP, !!commandWindow() && !isCompactViewport() &&
            !!commandWindow().querySelector('.traffic-light.maximize')],
        'window-app': () => [IS_DESKTOP, !!commandWindow() && !!infoSubjectFor(commandWindow().dataset.windowId, commandWindow())],
        'windows': () => [IS_DESKTOP, openWindows.size > 0],
        // Hidden, not just disabled, while nothing is open (the app name's window list)
        'any-window': () => [IS_DESKTOP && openWindows.size > 0, true],
        'link': () => [true, !!commandLink()],
        'personal': () => [IS_DESKTOP && !!personalDesktop() && !isCompactViewport(), true],
        'arranged': () => [IS_DESKTOP && !!personalDesktop() && !isCompactViewport(),
            !!personalDesktop() && personalDesktop().hasArrangement()],
        'shared-sticky': () => [!!sharedSticky(), !!sharedSticky() && sharedSticky().available],
        'sound': () => [true, true],
        'prefs': () => [IS_DESKTOP && !!resolveApp('preferences'), true],
        'fullscreen': () => [!!document.documentElement.requestFullscreen && document.fullscreenEnabled !== false, true],
        'editable': () => [true, isEditableTarget(document.activeElement)],
        'selection': () => [true, hasTextSelection(document.activeElement)],
        'editable-selection': () => [true, isEditableTarget(document.activeElement) && hasTextSelection(document.activeElement)],
        'paste': () => [!!(navigator.clipboard && navigator.clipboard.readText), isEditableTarget(document.activeElement)]
    };

    /**
     * Called each time a menu opens: items whose subject cannot exist here are
     * hidden, items that only lack it at the moment are greyed out.
     */
    function updateMenuState(dropdown) {
        dropdown.querySelectorAll('[data-menu-needs]').forEach(item => {
            const check = MENU_NEEDS[item.dataset.menuNeeds];
            const [available, usable] = check ? check() : [true, true];
            item.hidden = !available;
            if (item.getAttribute('role') === 'separator') return;
            if (usable) item.removeAttribute('aria-disabled');
            else item.setAttribute('aria-disabled', 'true');
            if (item.tagName === 'BUTTON') item.disabled = !usable;
        });

        dropdown.querySelectorAll('[data-shortcut]').forEach(item => {
            if (item.querySelector('.menu-shortcut')) return;
            const hint = document.createElement('span');
            hint.className = 'menu-shortcut';
            hint.setAttribute('aria-hidden', 'true');
            hint.textContent = formatShortcut(item.dataset.shortcut);
            item.appendChild(hint);
        });

        const sound = dropdown.querySelector('[data-menu-action="toggle-sound"]');
        if (sound) sound.setAttribute('aria-checked', String(!isMuted()));
        const sticky = dropdown.querySelector('[data-menu-action="toggle-shared-sticky"]');
        if (sticky) sticky.setAttribute('aria-checked', String(!!sharedSticky() && sharedSticky().shown));
        const full = dropdown.querySelector('[data-menu-action="page-fullscreen"]');
        if (full) full.textContent = document.fullscreenElement ? 'Exit Full Screen' : 'Enter Full Screen';

        // A divider with nothing on one side of it would be a stray line
        const rows = [...dropdown.children].filter(row => !row.hidden || row.getAttribute('role') === 'separator');
        let previousWasItem = false;
        rows.forEach((row, i) => {
            if (row.getAttribute('role') !== 'separator') {
                previousWasItem = true;
                return;
            }
            if (row.dataset.menuNeeds && !(MENU_NEEDS[row.dataset.menuNeeds] || (() => [true]))()[0]) {
                row.hidden = true;
                return;
            }
            const hasNext = rows.slice(i + 1).some(next => next.getAttribute('role') !== 'separator');
            row.hidden = !previousWasItem || !hasNext;
            previousWasItem = false;
        });
    }

    const MENU_ACTIONS = {
        'about-site': () => window.openAboutThisMac(),
        'close-all': () => window.closeAllWindows(),
        'tile': () => window.tileWindows(),
        'shortcuts': () => window.openShortcuts(),
        'reload': () => window.location.reload(),
        'search': () => toggleSpotlight(),
        'print': () => window.print(),
        'close-window': () => {
            const win = commandWindow();
            if (win) closeWindow(win, win.dataset.windowId);
        },
        'minimize-window': () => {
            const win = commandWindow();
            if (win) minimizeWindow(win, win.dataset.windowId);
        },
        'zoom-window': () => {
            const win = commandWindow();
            if (win) toggleZoom(win);
        },
        'cycle-windows': () => cycleWindows(),
        'show-desktop': () => showDesktop(),
        'bring-all': () => bringAllToFront(),
        'get-info': () => {
            const win = commandWindow();
            if (win) openInfoWindow(win.dataset.windowId, win);
        },
        'copy-link': () => {
            const url = commandLink();
            if (url) copyLinkWithNotice(url);
        },
        'open-tab': () => {
            const url = commandLink();
            if (url) window.open(url, '_blank', 'noopener');
        },
        'toggle-sound': () => setMuted(!isMuted()),
        'toggle-shared-sticky': () => toggleSharedSticky(),
        'page-fullscreen': () => togglePageFullscreen(),
        'desktop-background': () => openPreferences('desktop'),
        'new-sticky': () => { if (personalDesktop()) personalDesktop().newSticky(); },
        'clean-up': () => { if (personalDesktop()) personalDesktop().cleanUp(); },
        'sort-icons': () => { if (personalDesktop()) personalDesktop().sortByName(); },
        'reset-icons': () => { if (personalDesktop()) personalDesktop().resetArrangement(); }
    };

    function runMenuAction(item, e) {
        const action = item.dataset.menuAction;

        if (item.getAttribute('aria-disabled') === 'true') {
            e.preventDefault();
            return;
        }

        if (action === 'open-app') {
            // A real link: modified clicks, and pages without the desktop
            // shell, simply follow it
            if (isModifiedClick(e) || !IS_DESKTOP) return;
            const app = resolveApp(item.dataset.app);
            if (!app) return;
            e.preventDefault();
            window.closeDropdowns({ restoreFocus: true });
            openWindowFrom('menu', app.id, app.title, app.size, app.permalink);
            return;
        }

        if (action === 'go-desktop') {
            // On the desktop this clears the view; elsewhere the link leads home
            if (isModifiedClick(e) || !IS_DESKTOP) return;
            e.preventDefault();
            window.closeDropdowns({ restoreFocus: true });
            showDesktop();
            return;
        }

        if (action === 'follow-link') {
            // An ordinary link (new tab); it only needs the menu out of the way
            setTimeout(() => window.closeDropdowns(), 0);
            return;
        }

        if (action.startsWith('edit-')) {
            // Focus stays where the visitor was typing or selecting (the
            // menubar never takes it on mousedown), so act on that
            const target = document.activeElement;
            window.closeDropdowns();
            runEditCommand(action.slice(5), target);
            return;
        }

        // Close first: focus returns to the trigger, and whatever the action
        // opens then takes it from there (and hands it back when it closes)
        window.closeDropdowns({ restoreFocus: true });
        if (MENU_ACTIONS[action]) MENU_ACTIONS[action]();
    }

    /** Left/Right in an open menu: the next menu along the bar that is on screen. */
    function openAdjacentMenu(dropdownId, step) {
        const usable = MENU_IDS.filter(id => {
            const trigger = menuTrigger(id);
            if (!trigger || !document.getElementById(id) || trigger.getClientRects().length === 0) return false;
            return !(id === 'finder-dropdown' && isCompactViewport());
        });
        const index = usable.indexOf(dropdownId);
        if (index === -1 || usable.length < 2) return;
        const next = usable[(index + step + usable.length) % usable.length];
        setMenuOpen(next, true, { focus: 'first' });
        // A menu with nothing to focus (no windows open) keeps the keyboard on its trigger
        const dropdown = document.getElementById(next);
        if (dropdown && !dropdown.contains(document.activeElement)) menuTrigger(next).focus({ preventScroll: true });
    }

    // Apple Menu Functions
    function setupAppleMenuClose() {
        MENU_IDS.forEach((dropdownId) => {
            const dropdown = document.getElementById(dropdownId);
            const trigger = menuTrigger(dropdownId);
            if (!dropdown || !trigger) return;

            trigger.addEventListener('click', (e) => {
                // e.detail is 0 for a click made with Enter or Space
                toggleMenu(dropdownId, e.detail === 0 ? { focus: 'first' } : null);
            });

            // With one menu open, the others open as the pointer crosses them
            trigger.addEventListener('pointerenter', (e) => {
                if (e.pointerType !== 'mouse' || isMenuOpen(dropdownId) || !MENU_IDS.some(isMenuOpen)) return;
                if (dropdownId === 'finder-dropdown' && isCompactViewport()) return;
                setMenuOpen(dropdownId, true);
            });

            // Pressing a menu must not take focus from the field or selection
            // the Edit commands are about to act on
            const wrapper = trigger.parentElement;
            if (wrapper && wrapper.classList.contains('menubar-menu')) {
                wrapper.addEventListener('mousedown', (e) => e.preventDefault());
            }

            trigger.addEventListener('keydown', (e) => {
                // Tabbing away from an open menu closes it
                if (e.key === 'Tab') setMenuOpen(dropdownId, false);
                if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && isMenuOpen(dropdownId)) {
                    e.preventDefault();
                    openAdjacentMenu(dropdownId, e.key === 'ArrowRight' ? 1 : -1);
                    return;
                }
                if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                if (dropdownId === 'finder-dropdown' && isCompactViewport()) return;
                e.preventDefault();
                setMenuOpen(dropdownId, true, { focus: e.key === 'ArrowUp' ? 'last' : 'first' });
            });

            // Roving focus inside the open menu
            dropdown.addEventListener('keydown', (e) => {
                const items = menuItems(dropdown);
                const index = items.indexOf(document.activeElement);
                let target = null;

                if (e.key === 'ArrowDown') target = items[(index + 1) % items.length];
                else if (e.key === 'ArrowUp') target = items[(index - 1 + items.length) % items.length];
                else if (e.key === 'Home') target = items[0];
                else if (e.key === 'End') target = items[items.length - 1];
                else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    // Along the menubar, as on a Mac
                    e.preventDefault();
                    openAdjacentMenu(dropdownId, e.key === 'ArrowRight' ? 1 : -1);
                    return;
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setMenuOpen(dropdownId, false, { restoreFocus: true });
                    return;
                } else if (e.key === 'Tab') {
                    // Leaving the menu closes it; Tab then moves on from the trigger
                    setMenuOpen(dropdownId, false, { restoreFocus: true });
                    return;
                } else if (e.key === ' ' && index > -1 && items[index].tagName === 'A') {
                    // Links only answer Enter natively
                    e.preventDefault();
                    items[index].click();
                    return;
                } else {
                    return;
                }

                e.preventDefault();
                if (target) target.focus({ preventScroll: true });
            });
        });

        // A menu opened with the pointer leaves focus where it was (so the
        // Edit commands can act on it); the arrow keys still drive the menu
        document.addEventListener('keydown', (e) => {
            if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
            const openId = MENU_IDS.find(isMenuOpen);
            if (!openId) return;
            const dropdown = document.getElementById(openId);
            const trigger = menuTrigger(openId);
            if (dropdown.contains(e.target) || (trigger && trigger.contains(e.target))) return;
            e.preventDefault();
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                openAdjacentMenu(openId, e.key === 'ArrowRight' ? 1 : -1);
                return;
            }
            const items = menuItems(dropdown);
            const target = e.key === 'ArrowUp' ? items[items.length - 1] : items[0];
            if (target) target.focus({ preventScroll: true });
        }, true);

        document.addEventListener('click', (e) => {
            const item = e.target.closest('[data-menu-action]');
            if (item) {
                runMenuAction(item, e);
                return;
            }
            // Close a menu when clicking outside it
            MENU_IDS.forEach((dropdownId) => {
                const trigger = menuTrigger(dropdownId);
                const dropdown = document.getElementById(dropdownId);
                if (!dropdown || dropdown.contains(e.target) || (trigger && trigger.contains(e.target))) return;
                setMenuOpen(dropdownId, false);
            });
        });
    }

    // Skip link and the menubar search button
    function setupMenubarControls() {
        const skip = document.querySelector('.skip-link');
        if (skip) {
            // "Content" is the focused window when there is one, else the page
            skip.addEventListener('click', (e) => {
                e.preventDefault();
                const visible = activeWindow && activeWindow.isConnected && activeWindow.style.display !== 'none';
                if (visible) {
                    focusWindow(activeWindow);
                    return;
                }
                const main = document.getElementById('desktop');
                if (main) main.focus({ preventScroll: true });
            });
        }

        const search = document.getElementById('menubar-spotlight');
        if (search) search.addEventListener('click', () => toggleSpotlight());
    }

    // Still global: older markup and other scripts may call these
    window.toggleAppleMenu = function (e) {
        if (e && e.stopPropagation) e.stopPropagation();
        toggleMenu('apple-dropdown');
    };

    // Finder Menu - Show open windows
    window.toggleFinderMenu = function (e) {
        if (e && e.stopPropagation) e.stopPropagation();
        toggleMenu('finder-dropdown');
    };

    /** The window list appears twice: under the app name and in the Window menu. */
    function updateFinderWindowsList() {
        document.querySelectorAll('#finder-windows-list, .menu-windows-list').forEach(fillWindowsList);
    }

    function fillWindowsList(list) {
        const menuId = (list.closest('[role="menu"]') || {}).id || 'finder-dropdown';

        if (openWindows.size === 0) {
            list.innerHTML = '<div class="dropdown-item empty" role="menuitem" aria-disabled="true">No windows open</div>';
            return;
        }

        let html = '';
        openWindows.forEach((win, id) => {
            const title = win.querySelector('.window-title-text')?.textContent || win.querySelector('.window-title')?.textContent || id;
            const isActive = win === activeWindow;
            const isMinimized = win.classList.contains('minimized') || win.style.display === 'none';
            html += `<button type="button" class="dropdown-item window-item ${isActive ? 'active-window' : ''} ${isMinimized ? 'minimized-window' : ''}" role="menuitemradio" aria-checked="${isActive ? 'true' : 'false'}" tabindex="-1" data-window-id="${escapeHtml(id)}">
                <span class="window-item-check" aria-hidden="true">${isActive ? '✓' : ''}</span>
                <span class="window-item-title">${escapeHtml(title)}</span>
                ${isMinimized ? '<span class="window-item-state">Minimized</span>' : ''}
            </button>`;
        });
        list.innerHTML = html;

        // Add click handlers
        list.querySelectorAll('.window-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const windowId = item.dataset.windowId;
                const win = openWindows.get(windowId);
                setMenuOpen(menuId, false);
                if (win) activateWindow(win);
            });
        });
    }

    /** Un-minimise, raise and move keyboard focus into a window the visitor picked by name. */
    function activateWindow(win) {
        restoreWindow(win);
        bringToFront(win);
        focusWindow(win);
    }

    // Global function to close all dropdowns
    window.closeDropdowns = function (opts) {
        MENU_IDS.forEach(id => setMenuOpen(id, false, opts));
        if (typeof window.closeMusicMenu === 'function') window.closeMusicMenu();
    };

    window.closeAllWindows = function () {
        setMenuOpen('apple-dropdown', false);

        // Same teardown as closing each window by hand, so emulators stop,
        // app subscriptions are released and no ghost stays in focus history.
        [...openWindows].forEach(([id, win]) => teardownWindow(win, id));
        openWindows.clear();
        windowHistory.length = 0;
        activeWindow = null;

        // Every entry this page pushed stood for a window that is now gone:
        // step back off all of them, or Back would reopen them one by one
        stepBackInHistory(historyDepth());

        // Reset menubar, tab title and URL
        showFinderState();
    };

    window.tileWindows = function () {
        setMenuOpen('apple-dropdown', false);
        // Compact layouts are fullscreen: there is nothing to tile
        if (isCompactViewport()) return;

        const windows = Array.from(openWindows.values());
        if (windows.length === 0) return;

        const bounds = getDesktopBounds();
        const cols = Math.ceil(Math.sqrt(windows.length));
        const rows = Math.ceil(windows.length / cols);
        const winWidth = Math.floor(bounds.width / cols);
        const winHeight = Math.floor(bounds.height / rows);

        windows.forEach((win, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);

            restoreWindow(win);
            win.style.left = `${col * winWidth}px`;
            win.style.top = `${row * winHeight}px`;
            win.style.width = `${winWidth}px`;
            win.style.height = `${winHeight}px`;
            win.dataset.maximized = 'false';
        });
    };

    // About This Mac - global function for Apple menu
    window.openAboutThisMac = function () {
        setMenuOpen('apple-dropdown', false);

        // Get Git info from meta tags
        const commitHash = document.querySelector('meta[name="git-commit-hash"]')?.content;
        const commitShort = document.querySelector('meta[name="git-commit-short"]')?.content;
        const commitDate = document.querySelector('meta[name="git-commit-date"]')?.content;

        // Build commit link
        let commitHtml = '';
        if (commitHash && commitShort) {
            commitHtml = `
                <div class="about-row">
                    <span class="about-label">Last Commit</span>
                    <a href="https://github.com/ankushKun/ankushKun.github.io/commit/${commitHash}" target="_blank" rel="noopener" class="about-commit-link">
                        <code>${commitShort}</code>
                    </a>
                </div>
            `;
            if (commitDate) {
                commitHtml += `
                    <div class="about-row">
                        <span class="about-label">Updated</span>
                        <span class="about-value">${commitDate}</span>
                    </div>
                `;
            }
        }

        const aboutContent = `
            <div class="about-this-mac">
                <div class="about-icon">
                    <svg viewBox="0 0 120 120" width="64" height="64">
                        <defs>
                            <linearGradient id="aboutScreenGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                                <stop offset="0%" style="stop-color:#4fc3f7"/>
                                <stop offset="100%" style="stop-color:#0288d1"/>
                            </linearGradient>
                            <linearGradient id="aboutBodyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                                <stop offset="0%" style="stop-color:#f5f5f5"/>
                                <stop offset="100%" style="stop-color:#e0e0e0"/>
                            </linearGradient>
                        </defs>
                        <rect x="15" y="15" width="90" height="70" rx="8" fill="url(#aboutBodyGrad)" stroke="#bdbdbd" stroke-width="2"/>
                        <rect x="22" y="22" width="76" height="50" rx="4" fill="url(#aboutScreenGrad)"/>
                        <rect x="22" y="22" width="76" height="15" rx="4" fill="rgba(255,255,255,0.2)"/>
                        <path d="M45 85 L75 85 L78 100 L42 100 Z" fill="#bdbdbd"/>
                        <rect x="30" y="100" width="60" height="8" rx="3" fill="#9e9e9e"/>
                        <text x="60" y="55" text-anchor="middle" font-size="24" fill="rgba(255,255,255,0.9)">:)</text>
                    </svg>
                </div>
                <h1>ankush.one</h1>
                <p class="about-tagline">A personal website built with ❤️</p>
                
                <div class="about-info">
                    <div class="about-row">
                        <span class="about-label">Developer</span>
                        <span class="about-value">Ankush Singh</span>
                    </div>
                    <div class="about-row">
                        <span class="about-label">Built with</span>
                        <span class="about-value">
                            <a href="https://gohugo.io" target="_blank" rel="noopener">Hugo</a> + 
                            <a href="https://developer.mozilla.org/en-US/docs/Web/JavaScript" target="_blank" rel="noopener">JavaScript</a>
                        </span>
                    </div>
                    <div class="about-row">
                        <span class="about-label">Extras</span>
                        <span class="about-value">
                            <a href="https://copy.sh/v86/" target="_blank" rel="noopener">v86</a>, 
                            <a href="https://ruffle.rs" target="_blank" rel="noopener">Ruffle</a>,
                            <a href="https://thelongestyard.link" target="_blank" rel="noopener">thelongestyard</a>
                        </span>
                    </div>
                    ${commitHtml}
                </div>

                <div class="about-links">
                    <a href="https://github.com/ankushKun/ankushKun.github.io" target="_blank" rel="noopener" class="about-btn github">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                        </svg>
                        View Source
                    </a>
                    <a href="/index.xml" target="_blank" rel="noopener" class="about-btn rss">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M6.18 15.64a2.18 2.18 0 0 1 2.18 2.18C8.36 19 7.38 20 6.18 20C5 20 4 19 4 17.82a2.18 2.18 0 0 1 2.18-2.18M4 4.44A15.56 15.56 0 0 1 19.56 20h-2.83A12.73 12.73 0 0 0 4 7.27V4.44m0 5.66a9.9 9.9 0 0 1 9.9 9.9h-2.83A7.07 7.07 0 0 0 4 12.93V10.1Z"/>
                        </svg>
                        RSS Feed
                    </a>
                </div>
                
                <p class="about-footer">© ${new Date().getFullYear()} Ankush Singh</p>
            </div>
        `;

        // Create a special About window
        if (openWindows.has('about-this-mac')) {
            activateWindow(openWindows.get('about-this-mac'));
            return;
        }

        const win = document.createElement('div');
        win.className = 'window about-window';
        win.dataset.windowId = 'about-this-mac';
        win.innerHTML = `
            <div class="window-titlebar">
                ${getTrafficLightsMarkup()}
                <div class="window-title"><span class="window-title-text">About This Site</span></div>
            </div>
            <div class="window-content">
                ${aboutContent}
            </div>
        `;

        win.style.minHeight = '360px';
        prepareWindowElement(win);

        document.getElementById('windows-container').appendChild(win);
        openWindows.set('about-this-mac', win);

        // Centred in pixels, measured after insertion. A translate(-50%, -50%)
        // was wiped by restoreWindow() and left the window off-centre.
        placeWindow(win, { width: 380 }, { center: true });

        win.classList.add('opening');
        setTimeout(() => win.classList.remove('opening'), 200);

        setupWindowDrag(win);
        setupWindowControls(win, 'about-this-mac');
        bringToFront(win);
        focusWindow(win);
    };

    // Keyboard shortcuts reference. Every shortcut below already worked; none
    // of them were discoverable anywhere in the UI.
    window.openShortcuts = function () {
        if (openWindows.has('shortcuts')) {
            activateWindow(openWindows.get('shortcuts'));
            return;
        }

        // Window chords take Ctrl or Alt/Option; the Cmd forms are taken by
        // the browser and macOS. Off the Mac the browser keeps Ctrl+W (close
        // tab) to itself, so that one is only listed with Alt.
        const isMac = isMacPlatform();
        const mod = isMac ? '⌘' : 'Ctrl';
        const alt = isMac ? '⌥' : 'Alt';
        const either = isMac ? '⌃ / ⌥' : 'Ctrl / Alt';

        const groups = [
            {
                name: 'Windows',
                items: [
                    [(isMac ? either : alt) + ' W', 'Close the active window'],
                    [either + ' M', 'Minimize to the Dock'],
                    [either + ' H', 'Minimize everything'],
                    [either + ' `  or  ' + (isMac ? '⌥' : 'Alt') + ' Tab', 'Cycle between windows (⇧ for backwards)'],
                    ['Double-click titlebar', 'Zoom the window']
                ]
            },
            {
                name: 'Navigation',
                items: [
                    [mod + ' K  or  /', 'Open search'],
                    ['↑ ↓', 'Move through results'],
                    ['↵', 'Open the selected result'],
                    ['Esc', 'Close search or dismiss a dialog']
                ]
            },
            {
                name: 'Reactions',
                items: [
                    ['1 – 8', 'Burst an emoji at your cursor for everyone here'],
                    ['❤️ 🔥 😂 🎉', 'Keys 1 2 3 4'],
                    ['👀 🤯 👍 💀', 'Keys 5 6 7 8']
                ]
            }
        ];

        const body = `
            <div class="shortcuts-pane">
                ${groups.map(g => `
                    <section class="shortcuts-group">
                        <h3>${escapeHtml(g.name)}</h3>
                        <dl>
                            ${g.items.map(([keys, desc]) => `
                                <div class="shortcuts-row">
                                    <dt><kbd>${escapeHtml(keys)}</kbd></dt>
                                    <dd>${escapeHtml(desc)}</dd>
                                </div>
                            `).join('')}
                        </dl>
                    </section>
                `).join('')}
            </div>
        `;

        const win = document.createElement('div');
        win.className = 'window shortcuts-window';
        win.dataset.windowId = 'shortcuts';
        win.dataset.cursorAnchor = 'win:shortcuts';
        win.innerHTML = `
            <div class="window-titlebar">
                ${getTrafficLightsMarkup()}
                <div class="window-title"><span class="window-title-text">Keyboard Shortcuts</span></div>
            </div>
            <div class="window-content">${body}</div>
        `;
        prepareWindowElement(win);

        document.getElementById('windows-container').appendChild(win);
        openWindows.set('shortcuts', win);

        placeWindow(win, { width: 380 }, { center: true, top: 90 });

        win.classList.add('opening');
        setTimeout(() => win.classList.remove('opening'), 200);

        setupWindowDrag(win);
        setupWindowControls(win, 'shortcuts');
        bringToFront(win);
        focusWindow(win);
    };

    // Flash Game Initialization
    let ruffleLoaded = false;
    let ruffleLoadPromise = null;

    function loadRuffle() {
        if (ruffleLoaded) return Promise.resolve();
        if (ruffleLoadPromise) return ruffleLoadPromise;

        ruffleLoadPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = '/ruffle/ruffle.js';
            script.onload = () => {
                ruffleLoaded = true;
                resolve();
            };
            script.onerror = () => {
                // Do not cache the failure - Retry has to request it again
                ruffleLoadPromise = null;
                script.remove();
                reject(new Error('Could not load Ruffle'));
            };
            document.body.appendChild(script);
        });

        return ruffleLoadPromise;
    }

    function initFlashGame(id, win) {
        // Search within the window element to avoid duplicate ID issues
        // (the original content div is hidden in DOM, so getElementById would find that instead)
        const container = win.querySelector(`#flash-player-${id}`) || win.querySelector('.flash-game-player');
        if (!container) {
            console.error('Flash player container not found:', id);
            return;
        }

        const swfUrl = container.dataset.swf;
        if (!swfUrl) {
            console.error('No SWF URL specified for Flash game:', id);
            return;
        }

        // Show loading state
        container.innerHTML = `
            <div class="flash-loading">
                <div class="mac-spinner spinner"></div>
                <div style="color: #ccc; margin-top: 12px;">Loading Flash game...</div>
            </div>
        `;

        const showError = (title, err, fallback) => {
            if (!win.isConnected) return;
            win._rufflePlayer = null;
            win._ruffleSuspended = false;
            showWindowError(container, (err && err.message) || fallback, {
                title,
                retry: () => initFlashGame(id, win)
            });
        };

        loadRuffle().then(() => {
            // The window may have been closed while Ruffle was in flight
            if (!win.isConnected || win.classList.contains('closing')) return;

            const ruffle = window.RufflePlayer.newest();
            const player = ruffle.createPlayer();

            // Style the player to fill the container
            player.style.width = '100%';
            player.style.height = '100%';

            // Clear loading and add player
            container.innerHTML = '';
            container.appendChild(player);

            // Load the SWF file
            player.ruffle().load({
                url: swfUrl,
                autoplay: 'on',
                letterbox: 'on',
                quality: 'high',
                splashScreen: true,
                contextMenu: 'on',
                warnOnUnsupportedContent: true
            }).then(() => {
                // Kept on the window so minimizing can pause this player
                win._rufflePlayer = player;
                // Minimized while the game was still loading: it would
                // otherwise start playing inside a hidden window
                if (win._suspended) {
                    pauseWindowApp(win, id);
                    // Autoplay may not have begun yet; it should on restore
                    win._ruffleWasPlaying = true;
                }
            }).catch(err => {
                console.error('Failed to load Flash game:', err);
                showError('Failed to load game', err, 'Unknown error');
            });
        }).catch(err => {
            console.error('Failed to load Ruffle:', err);
            showError('Failed to load Flash player', err, 'Could not load Ruffle');
        });
    }

    // ================================================
    // Lazy-loaded apps
    // Each of these ships as its own bundle and is only fetched the first time
    // its window is opened, so the desktop stays light for visitors who never
    // touch chat, the guestbook or paint.
    // ================================================

    const LAZY_APPS = {
        'irc-chat': { urlKey: 'IRC_CHAT_URL', init: 'initIRCChat', cleanup: 'ircCleanup' },
        'guestbook': {
            urlKey: 'GUESTBOOK_URL', init: 'initGuestbook', cleanup: 'guestbookCleanup',
            // The signature engine must be present before the book paints
            deps: ['SIGNATURE_URL']
        },
        'paint': { urlKey: 'PAINT_URL', init: 'initPaint', cleanup: 'paintCleanup' },
        'passport': { urlKey: 'PASSPORT_URL', init: 'initPassport', cleanup: 'passportCleanup' },
        'activity': { urlKey: 'ACTIVITY_URL', init: 'initActivityMonitor', cleanup: 'activityCleanup' },
        'daily-puzzle': { urlKey: 'DAILY_PUZZLE_URL', init: 'initDailyPuzzle', cleanup: 'dailyPuzzleCleanup' },
        'software-update': { urlKey: 'SOFTWARE_UPDATE_URL', init: 'initSoftwareUpdate', cleanup: 'softwareUpdateCleanup' },
        'music': { urlKey: 'MUSIC_URL', init: 'initMusicPlayer', cleanup: 'musicCleanup' },
        'preferences': { urlKey: 'PREFERENCES_URL', init: 'initPreferences', cleanup: 'preferencesCleanup' }
    };

    const lazyScriptLoads = new Map(); // urlKey -> Promise

    function loadScriptOnce(urlKey) {
        if (lazyScriptLoads.has(urlKey)) return lazyScriptLoads.get(urlKey);

        const src = window[urlKey];
        if (!src) return Promise.reject(new Error('Missing URL for ' + urlKey));

        const p = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = () => {
                lazyScriptLoads.delete(urlKey);
                reject(new Error('Failed to load ' + src));
            };
            document.head.appendChild(script);
        });

        lazyScriptLoads.set(urlKey, p);
        return p;
    }

    function loadLazyApp(app) {
        const deps = (app.deps || []).map(loadScriptOnce);
        return Promise.all(deps).then(() => {
            if (window[app.init]) return;
            return loadScriptOnce(app.urlKey);
        });
    }

    function initLazyApp(app, win) {
        // Script and stylesheet download side by side; the app starts once
        // both are in, so it never lays itself out against missing CSS
        Promise.all([loadLazyApp(app), windowStylesReady(win)]).then(() => {
            // The window may have been closed while the bundle was in flight
            if (!win.isConnected || win.classList.contains('closing')) return;
            if (typeof window[app.init] === 'function') window[app.init](win);
        }).catch((err) => {
            console.error(err);
            trackError(err, 'lazy-app');
            showAppLoadError(win, () => initLazyApp(app, win));
        });
    }

    // ================================================
    // Per-app stylesheets
    // The render-blocking bundle only carries the shell, the desktop and the
    // document layout. Each app's own CSS (window.APP_STYLES, app id -> URL,
    // from layouts/partials/os/app-styles.html) is fetched the first time
    // its window opens, and the window is held back until it is in (see
    // holdUntilStyled), so an app never paints unstyled.
    // ================================================

    const APP_STYLES = window.APP_STYLES || {};
    const styleLoads = new Map(); // absolute URL -> Promise
    const stylesIn = new Set();   // absolute URLs whose rules apply

    function styleUrl(href) {
        return new URL(href, window.location.href).href;
    }

    /** True when a stylesheet is already applied, e.g. linked in <head>. */
    function hasStyle(url) {
        if (stylesIn.has(url)) return true;
        const link = [...document.querySelectorAll('link[rel="stylesheet"]')].find(l => l.href === url);
        if (!link || !link.sheet) return false;
        stylesIn.add(url);
        return true;
    }

    function loadStyleOnce(href) {
        const url = styleUrl(href);
        if (hasStyle(url)) return Promise.resolve();
        if (styleLoads.has(url)) return styleLoads.get(url);

        const p = new Promise((resolve, reject) => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = url;
            link.onload = () => {
                stylesIn.add(url);
                resolve();
            };
            link.onerror = () => {
                styleLoads.delete(url);
                link.remove();
                reject(new Error('Failed to load ' + url));
            };
            document.head.appendChild(link);
        });

        styleLoads.set(url, p);
        return p;
    }

    /** A promise for an app's stylesheet, or null when there is nothing to wait for. */
    function appStylesPending(id) {
        const href = id && Object.prototype.hasOwnProperty.call(APP_STYLES, id) ? APP_STYLES[id] : null;
        if (!href || hasStyle(styleUrl(href))) return null;
        return loadStyleOnce(href);
    }

    /**
     * The window's app stylesheet, as a promise. A window already on screen
     * (Retry after a failed load) shows a spinner over its contents meanwhile.
     */
    function windowStylesReady(win) {
        const pending = appStylesPending(win.dataset.windowId);
        if (!pending) return Promise.resolve();
        if (!win.classList.contains('is-styling')) holdUntilStyled(win, pending, null);
        return pending;
    }

    /** For an app with a stylesheet and no script to report a failed load. */
    function reportStylesFailure(win, pending) {
        pending.catch((err) => {
            console.error(err);
            trackError(err, 'app-styles');
            if (!win.isConnected || win.classList.contains('closing')) return;
            showAppLoadError(win, () => {
                const again = appStylesPending(win.dataset.windowId);
                if (again) {
                    holdUntilStyled(win, again, null);
                    reportStylesFailure(win, again);
                }
            });
        });
    }

    /** Start fetching an app's stylesheet when the visitor points at it. */
    function warmAppStyles(idOrAlias) {
        const app = resolveApp(idOrAlias);
        const pending = app && !openWindows.has(app.id) && appStylesPending(app.id);
        if (pending) pending.catch(() => { /* reported when the window opens */ });
    }

    if (IS_DESKTOP && Object.keys(APP_STYLES).length) {
        // Desktop icons, Dock items, Spotlight rows, menu items and links that
        // name an app: by the time of the click the stylesheet is usually in
        const warm = (e) => {
            const el = e.target && e.target.closest
                ? e.target.closest('[data-window], [data-dock-key], [data-app]')
                : null;
            if (el) warmAppStyles(el.dataset.window || el.dataset.dockKey || el.dataset.app);
        };
        document.addEventListener('pointerover', warm, { passive: true });
        document.addEventListener('focusin', warm);
    }

    // Shown frameless for this long while the stylesheet loads; after that the
    // window frame appears with a spinner in place of its contents
    const STYLE_HOLD_MS = 150;
    const WINDOW_STYLE_LOADER_HTML = '<div class="window-loader window-style-loader" role="status" aria-label="Loading"><div class="mac-spinner spinner"></div></div>';

    /**
     * Keep a new window invisible until `pending` settles, then call `open`
     * (the opening animation). On a slow connection the frame shows after
     * STYLE_HOLD_MS with a spinner over its hidden contents; without `open`
     * (a window already on screen) it does so at once. A failed stylesheet
     * reveals the window too: whoever awaits the same promise (the app's
     * init, or reportStylesFailure) puts up the error state.
     */
    function holdUntilStyled(win, pending, open) {
        let framed = false;
        const frame = () => {
            if (framed || !win.classList.contains('is-styling')) return;
            framed = true;
            win.classList.add('is-styling-slow');
            win.insertAdjacentHTML('beforeend', WINDOW_STYLE_LOADER_HTML);
            if (open) open();
        };
        win.classList.add('is-styling');
        const timer = open ? setTimeout(frame, STYLE_HOLD_MS) : 0;
        if (!open) frame();
        const reveal = () => {
            clearTimeout(timer);
            win.classList.remove('is-styling', 'is-styling-slow');
            win.querySelectorAll(':scope > .window-style-loader').forEach(el => el.remove());
            if (!framed && open && win.isConnected) open();
        };
        pending.then(reveal, reveal);
    }

    /** Terminal and Portal share one lazily loaded emulator bundle. */
    function startV86Terminal(id, win) {
        const ready = Promise.all([
            window.setupV86Terminal ? Promise.resolve() : loadScriptOnce('V86_TERMINAL_URL'),
            windowStylesReady(win)
        ]);
        ready.then(() => {
            if (!win.isConnected || win.classList.contains('closing')) return;
            if (window.setupV86Terminal) window.setupV86Terminal(id);
            // Minimized while the bundle was in flight: boot paused
            if (win._suspended) pauseWindowApp(win, id);
        }).catch((err) => {
            console.error(err);
            showAppLoadError(win, () => startV86Terminal(id, win));
        });
    }

    /**
     * Shared empty/error state for a window body.
     * @param {HTMLElement} container  usually the window's .window-content
     * @param {string} message
     * @param {Object} [opts]
     * @param {string} [opts.title]    heading above the message
     * @param {Function} [opts.retry]  adds a Retry button
     * @param {string} [opts.href]     adds an "Open in New Tab" link
     */
    function showWindowError(container, message, opts) {
        if (!container) return;
        const options = opts || {};

        const box = document.createElement('div');
        box.className = 'window-empty';
        box.setAttribute('role', 'alert');

        const heading = document.createElement('div');
        heading.className = 'window-empty-title';
        heading.textContent = options.title || 'Something went wrong';
        box.appendChild(heading);

        const text = document.createElement('p');
        text.className = 'window-empty-text';
        text.textContent = message;
        box.appendChild(text);

        if (options.retry || options.href) {
            const actions = document.createElement('div');
            actions.className = 'window-empty-actions';

            if (options.retry) {
                const retryBtn = document.createElement('button');
                retryBtn.type = 'button';
                retryBtn.className = 'mac-btn primary';
                retryBtn.textContent = 'Retry';
                retryBtn.addEventListener('click', () => options.retry());
                actions.appendChild(retryBtn);
            }

            if (options.href) {
                const link = document.createElement('a');
                link.className = 'mac-btn';
                link.href = options.href;
                link.target = '_blank';
                link.rel = 'noopener';
                // Keep the shell's link handler from turning this into a window
                link.dataset.open = 'tab';
                link.textContent = 'Open in New Tab';
                actions.appendChild(link);
            }

            box.appendChild(actions);
        }

        container.innerHTML = '';
        container.appendChild(box);
    }

    /** An app's bundle failed to load: say so, and put the markup back on Retry. */
    function showAppLoadError(win, retry) {
        const content = win.querySelector('.window-content');
        if (!content) return;
        const original = content.innerHTML;
        showWindowError(content, 'Check your connection and try again.', {
            title: 'This app failed to load',
            retry: () => {
                content.innerHTML = original;
                retry();
            }
        });
    }

    // ================================================
    // Window semantics and keyboard focus
    // A window is a non-modal dialog named by its title. Focus moves into it
    // when the visitor opens or picks it, and goes back to the next window or
    // to whatever opened it when it closes. Merely raising a window
    // (bringToFront) never moves focus, so a click cannot steal it from a field.
    // ================================================

    let windowLabelSeq = 0;

    // Tray chip / switcher icon for windows that have none of their own
    // (About This Site, Keyboard Shortcuts, external pages)
    const GENERIC_WINDOW_ICON = '<svg class="generic-window-icon" viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true" focusable="false"><rect x="1" y="1.5" width="10" height="9" rx="1.5"/><path d="M1 4h10"/></svg>';

    /**
     * Role, accessible name, opener and the phone "Back" control. Call once
     * for every new window, before it takes focus.
     */
    function prepareWindowElement(win) {
        win.setAttribute('role', 'dialog');
        const titleText = win.querySelector('.window-title-text');
        if (titleText) {
            if (!titleText.id) titleText.id = 'window-title-' + (++windowLabelSeq);
            win.setAttribute('aria-labelledby', titleText.id);
        }

        const opener = document.activeElement;
        win._opener = opener && opener !== document.body ? opener : null;

        // The window is only focusable while it holds focus itself (see
        // focusWindow). Left focusable, every click on its text would land
        // focus on the frame, and Space / arrow keys would stop scrolling
        // the content that was just clicked.
        const release = () => win.removeAttribute('tabindex');
        win.addEventListener('blur', release);
        win.addEventListener('mousedown', () => {
            if (document.activeElement === win) release();
        }, true);

        // Compact layouts: an obvious way back (hidden by the stylesheet elsewhere)
        const titlebar = win.querySelector('.window-titlebar');
        if (titlebar && !titlebar.querySelector('.titlebar-back')) {
            const back = document.createElement('button');
            back.type = 'button';
            back.className = 'titlebar-back';
            back.setAttribute('aria-label', 'Close window');
            // A Finder-style back capsule (os/window/static.html carries the same markup)
            back.innerHTML = '<span class="titlebar-back-icon" aria-hidden="true"><svg viewBox="0 0 12 12" focusable="false"><path d="M7.5 2.5 L4 6 L7.5 9.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>Back';
            back.addEventListener('click', () => closeWindow(win, win.dataset.windowId));
            titlebar.insertBefore(back, titlebar.firstChild);
        }
    }

    /**
     * Move keyboard focus to a window, unless something inside it already has
     * it. Like a Mac window's first responder, the control that last had focus
     * in it (Terminal's prompt, a form field) gets it back; else the frame.
     */
    function focusWindow(win) {
        if (!win || !win.isConnected || win.style.display === 'none') return;
        const active = document.activeElement;
        if (active && active !== win && win.contains(active)) return;
        const last = win._lastFocus;
        // (Not a text field on a phone: that would throw up the keyboard)
        const raisesKeyboard = () => isCompactViewport() &&
            !!last.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
        if (last && last !== win && last.isConnected && win.contains(last) &&
            !last.closest('[inert]') && last.getClientRects().length && !raisesKeyboard()) {
            try { last.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
            if (document.activeElement === last) return;
        }
        win.setAttribute('tabindex', '-1');
        try { win.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }

    // What focusWindow() hands focus back to
    document.addEventListener('focusin', (e) => {
        const el = e.target;
        const win = el && el.closest ? el.closest('#windows-container .window') : null;
        if (win && el !== win) win._lastFocus = el;
    });

    function isWindowShown(win) {
        return win.isConnected && win.style.display !== 'none' &&
            !win.classList.contains('minimized') && !win.classList.contains('closing');
    }

    /** After `win` went away: the window that took over, else what opened it. */
    function restoreFocusAfter(win) {
        if (activeWindow && activeWindow !== win && isWindowShown(activeWindow)) {
            focusWindow(activeWindow);
            return;
        }
        const opener = win._opener;
        if (opener && opener.isConnected && !opener.closest('[inert]') && opener.getClientRects().length) {
            try { opener.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        }
    }

    /**
     * On a compact layout a window covers the desktop, so the icons behind
     * it leave the tab order and the accessibility tree until it is gone.
     */
    function updateDesktopInert() {
        const desktop = document.getElementById('desktop');
        if (!desktop) return;
        const covered = isCompactViewport() && [...openWindows.values()].some(isWindowShown);
        if (!!desktop.inert !== covered) desktop.inert = covered;
    }

    /** Minimise everything into the tray (Alt+H, "Show Desktop"). */
    function showDesktop() {
        openWindows.forEach((win, id) => {
            if (win.style.display !== 'none') minimizeWindow(win, id);
        });
        deactivateAllWindows();
        activeWindow = null;
        showFinderState();
    }

    /**
     * A click inside an embedded page never reaches this document, so a
     * background window with an iframe stayed greyed out behind the others.
     * The frame taking focus is the one signal there is: raise its window.
     */
    function setupIframeFocusTracking() {
        let poll = null;
        let lastFrame = null;

        const check = (force) => {
            const el = document.activeElement;
            if (!el || el.tagName !== 'IFRAME') {
                lastFrame = null;
                return;
            }
            if (el === lastFrame && !force) return;
            lastFrame = el;
            const win = el.closest('.window');
            if (!win || win === activeWindow || !isWindowShown(win) || !win.dataset.windowId) return;
            bringToFront(win);
        };

        window.addEventListener('blur', () => {
            setTimeout(() => check(true), 0);
            // Moving from one frame straight to another fires no second blur
            clearInterval(poll);
            poll = setInterval(() => {
                if (!document.hidden) check(false);
            }, 400);
        });
        window.addEventListener('focus', () => {
            clearInterval(poll);
            poll = null;
            lastFrame = null;
        });
    }

    // ================================================
    // Compact mode (phones, landscape phones)
    // One media query, shared with the stylesheet (COMPACT_QUERY). Windows are
    // fullscreen there, the desktop is the launcher, and open windows are
    // switched from a sheet instead of the menubar dropdown.
    // ================================================

    function setupCompactMode() {
        const mq = window.matchMedia(COMPACT_QUERY);

        const onChange = () => {
            const compact = mq.matches;
            if (compact) {
                window.closeDropdowns();
            } else {
                // Windows opened while compact carry the fullscreen geometry
                // inline; give them a real size and place now there is room
                let step = 0;
                openWindows.forEach((win) => {
                    if (!/^calc\(/.test(win.style.width)) return;
                    const session = win._session;
                    if (session || win.classList.contains('external-window')) {
                        placeWindow(win, {
                            width: (session && session.width) || 1000,
                            height: (session && session.height) || 700
                        });
                        win.style.left = `${100 + (step % 6) * 30}px`;
                        win.style.top = `${50 + (step % 6) * 30}px`;
                        step++;
                    } else {
                        placeWindow(win, { width: 380 }, { center: true });
                    }
                    clampWindowToViewport(win);
                });
            }
            updateDesktopInert();
        };

        if (mq.addEventListener) mq.addEventListener('change', onChange);
        else if (mq.addListener) mq.addListener(onChange);
        onChange();
    }

    /**
     * On-screen keyboard. Android resizes the layout viewport itself
     * (interactive-widget=resizes-content); iOS only shrinks the visual
     * viewport, so the fullscreen compact window would keep its height and
     * the field being typed in would slide under the keyboard. --vvh is the
     * height the stylesheet sizes those windows from while the keyboard is up.
     * Apps that pin a log to the bottom can listen for `site-viewport-change`
     * on document: detail = { height, keyboardOpen }.
     */
    function setupVisualViewport() {
        const vv = window.visualViewport;
        if (!vv) return;

        const root = document.documentElement;
        let frame = 0;
        let lastHeight = -1;
        let lastOpen = false;

        const update = () => {
            frame = 0;
            // Pinch zoom also shrinks the visual viewport; scale undoes that
            const height = Math.round(vv.height * (vv.scale || 1));
            const keyboardOpen = window.innerHeight - height > 120;
            if (height === lastHeight && keyboardOpen === lastOpen) return;
            lastHeight = height;
            lastOpen = keyboardOpen;

            if (keyboardOpen) root.style.setProperty('--vvh', `${height}px`);
            else root.style.removeProperty('--vvh');

            document.dispatchEvent(new CustomEvent('site-viewport-change', {
                detail: { height, keyboardOpen }
            }));
        };

        vv.addEventListener('resize', () => {
            if (!frame) frame = requestAnimationFrame(update);
        });
    }

    // ================================================
    // Window placement
    // ================================================

    function isCompactViewport() {
        return window.matchMedia(COMPACT_QUERY).matches;
    }

    function getMenubarHeight() {
        return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--menubar-height'), 10) || 24;
    }

    /** Size of the area windows live in (the viewport minus menubar and safe areas). */
    function getDesktopBounds() {
        const container = document.getElementById('windows-container');
        if (container && container.clientWidth && container.clientHeight) {
            return { width: container.clientWidth, height: container.clientHeight };
        }
        return { width: window.innerWidth, height: window.innerHeight - getMenubarHeight() };
    }

    /**
     * Size and position a new window inside the desktop.
     * Call after the window is in the DOM when size.height is omitted (auto
     * height), since centring then needs the rendered height.
     * @param {HTMLElement} win
     * @param {{width: number, height?: number}} size
     * @param {Object} [opts]
     * @param {boolean} [opts.center]  centre instead of cascading
     * @param {number} [opts.top]      fixed top offset (with center: horizontal only)
     */
    function placeWindow(win, size, opts) {
        const options = opts || {};

        if (isCompactViewport()) {
            // Compact layouts are fullscreen; the stylesheet enforces the rest
            win.style.left = '8px';
            win.style.top = '8px';
            win.style.width = 'calc(100vw - 16px)';
            win.style.height = size.height ? 'calc(100vh - var(--menubar-height) - 16px)' : 'auto';
            return;
        }

        const bounds = getDesktopBounds();
        const width = Math.min(size.width, bounds.width - 100);
        win.style.width = `${width}px`;

        let height;
        if (size.height) {
            height = Math.min(size.height, bounds.height - 76);
            win.style.height = `${height}px`;
        } else {
            win.style.height = 'auto';
            height = win.offsetHeight;
            if (height > bounds.height - 40) {
                height = bounds.height - 40;
                win.style.height = `${height}px`;
            }
        }

        if (options.center) {
            const top = typeof options.top === 'number'
                ? options.top
                : Math.max(20, (bounds.height - height) / 2 - 10);
            win.style.left = `${Math.max(0, (bounds.width - width) / 2)}px`;
            win.style.top = `${top}px`;
        } else {
            // Cascade, wrapping every 6 windows. The offset used to grow
            // without bound, so the 8th window opened mostly off-screen.
            const step = openWindows.size % 6;
            let top = 50 + step * 30;
            // Nothing below the work area (it ends at the Dock's top). A tall
            // window gives up height to keep its step, as on a Mac, as long
            // as it keeps 400px; past that it moves up instead.
            if (top + height > bounds.height) {
                const room = bounds.height - top;
                if (size.height && room >= Math.min(height, 400)) {
                    height = room;
                    win.style.height = `${height}px`;
                } else {
                    top = Math.max(0, bounds.height - height);
                }
            }
            // Nor past the right edge (tablets, wide external windows)
            const left = Math.max(0, Math.min(100 + step * 30, bounds.width - width));
            win.style.left = `${left}px`;
            win.style.top = `${top}px`;
        }
    }

    /**
     * A deep link opens its window on top of the boot About. Centred, the two
     * would cover each other almost completely, so they are laid out as a
     * cascade: the requested window a diagonal step down and right from
     * About, and the pair centred on the desktop as one block. The step
     * leaves most of About in view; when the screen is too small for the
     * step the front window gives up size rather than cover more. Phones are
     * fullscreen anyway.
     */
    function placeBesideBootAbout(frontId) {
        if (isCompactViewport()) return;
        const back = openWindows.get('about');
        const front = openWindows.get(frontId);
        if (!back || !front || back === front) return;

        const bounds = getDesktopBounds();
        const margin = 20;
        const roomW = bounds.width - margin * 2;
        const roomH = bounds.height - margin * 2;
        const minFront = { width: 480, height: 360 };

        const backW = Math.min(back.offsetWidth, roomW);
        const backH = Math.min(back.offsetHeight, roomH);
        let frontW = Math.min(front.offsetWidth, roomW);
        let frontH = Math.min(front.offsetHeight, roomH);

        // The step: 70% of About's width and 40% of its height, so the front
        // window covers About's lower right corner and nothing more
        let dx = Math.round(backW * 0.7);
        let dy = Math.round(backH * 0.4);
        // The step never shrinks below this; the front window shrinks instead
        const minDx = Math.round(backW * 0.5);
        const minDy = Math.round(backH * 0.25);

        // Fit the pair's bounding box: shorten the step to its floor, then
        // give up window size
        if (dx + frontW > roomW) dx = Math.max(minDx, roomW - frontW);
        if (dx + frontW > roomW) frontW = Math.max(minFront.width, roomW - dx);
        if (dy + frontH > roomH) dy = Math.max(minDy, roomH - frontH);
        if (dy + frontH > roomH) frontH = Math.max(minFront.height, roomH - dy);

        const unionW = Math.max(backW, dx + frontW);
        const unionH = Math.max(backH, dy + frontH);
        const x0 = margin + Math.max(0, Math.round((roomW - unionW) / 2));
        const y0 = margin + Math.max(0, Math.round((roomH - unionH) / 2));

        back.style.width = `${backW}px`;
        back.style.height = `${backH}px`;
        back.style.left = `${x0}px`;
        back.style.top = `${y0}px`;
        front.style.width = `${frontW}px`;
        front.style.height = `${frontH}px`;
        front.style.left = `${x0 + dx}px`;
        front.style.top = `${y0 + dy}px`;
        clampWindowToViewport(back);
        clampWindowToViewport(front);
    }

    /** Pull one window back inside the desktop after the viewport changed. */
    function clampWindowToViewport(win) {
        if (isCompactViewport()) return;
        if (win.dataset.maximized === 'true' || win.style.display === 'none') return;
        if (win.classList.contains('closing') || win.classList.contains('minimized')) return;

        const bounds = getDesktopBounds();
        let width = win.offsetWidth;
        let height = win.offsetHeight;

        if (width > bounds.width) {
            width = bounds.width;
            win.style.width = `${width}px`;
            width = win.offsetWidth; // min-width may win
        }
        if (height > bounds.height) {
            height = bounds.height;
            win.style.height = `${height}px`;
        }

        // Same rule as dragging: keep a grip of the titlebar reachable
        const grip = Math.min(80, width);
        const left = Math.min(bounds.width - grip, Math.max(-(width - grip), win.offsetLeft));
        const top = Math.min(Math.max(0, bounds.height - 40), Math.max(0, win.offsetTop));

        if (left !== win.offsetLeft) win.style.left = `${left}px`;
        if (top !== win.offsetTop) win.style.top = `${top}px`;
    }

    function setupViewportClamp() {
        let timer = null;
        const onChange = () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                openWindows.forEach(win => clampWindowToViewport(win));
            }, 150);
        };
        window.addEventListener('resize', onChange);
        window.addEventListener('orientationchange', onChange);
    }

    // ================================================
    // Fetched window content
    // Blog posts, projects and timeline entries are not in the page; their
    // window body is lifted out of the standalone page for that permalink.
    // ================================================

    const WINDOW_LOADER_HTML = '<div class="window-loader" role="status" aria-label="Loading"><div class="mac-spinner spinner"></div></div>';
    const contentCache = new Map(); // absolute URL -> Promise<string>
    let prefetchTimer = null;

    function fetchWindowContent(permalink) {
        let url;
        try {
            url = new URL(permalink, window.location.origin).href;
        } catch (e) {
            return Promise.reject(e);
        }
        if (contentCache.has(url)) return contentCache.get(url);

        const request = fetch(url)
            .then(response => {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.text();
            })
            .then(html => {
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const fetchedContent = doc.querySelector('.window-content');
                if (!fetchedContent) throw new Error('Could not find content in fetched page');
                // A page that is an app's document (/resume/) links that app's
                // stylesheet; the body goes in once it has been applied here
                const styles = [...doc.querySelectorAll('link[rel="stylesheet"][data-app-css]')]
                    .map(link => link.getAttribute('href'))
                    .filter(Boolean);
                return Promise.all(styles.map(loadStyleOnce)).then(() => fetchedContent.innerHTML);
            });

        // A failed request must not poison the cache - Retry has to refetch
        request.catch(() => contentCache.delete(url));

        contentCache.set(url, request);
        return request;
    }

    function loadWindowContent(win, permalink) {
        const winContent = win.querySelector('.window-content');
        if (!winContent) return Promise.resolve();

        // A window can be pointed at another page while this one is in flight
        const token = win._contentToken = (win._contentToken || 0) + 1;

        return fetchWindowContent(permalink).then(html => {
            if (!win.isConnected || win._contentToken !== token) return;
            winContent.innerHTML = html;

            // Re-setup finder items and embeds
            setupFinderItems(win);
            activateLazyIframes(win);
            activateTwitterEmbeds(win);
            decorateContent(win);
        }).catch(err => {
            console.error('Failed to fetch content:', err);
            trackError(err, 'window-content');
            if (!win.isConnected || win._contentToken !== token) return;
            showWindowError(winContent, 'Check your connection and try again.', {
                title: 'Failed to load content',
                retry: () => {
                    winContent.innerHTML = WINDOW_LOADER_HTML;
                    loadWindowContent(win, permalink);
                },
                href: permalink
            });
        });
    }

    /** True when the window body for this id ships in the page itself. */
    function hasLocalWindowContent(id) {
        return !!(document.getElementById('tpl-' + id) || document.getElementById('content-' + id));
    }

    /**
     * Warm the cache for a row the visitor is pointing at. One shared timer:
     * sweeping the pointer down a list only fetches where it comes to rest.
     */
    function schedulePrefetch(id, permalink) {
        clearTimeout(prefetchTimer);
        if (id && IS_DESKTOP) warmAppStyles(id);
        if (!id || !permalink || openWindows.has(id) || hasLocalWindowContent(id)) return;
        if (!IS_DESKTOP && appIds.has(id)) return;
        if (navigator.connection && navigator.connection.saveData) return;

        prefetchTimer = setTimeout(() => {
            fetchWindowContent(permalink).catch(() => { /* reported when opened */ });
        }, 120);
    }

    /**
     * Markup for an app window. Pure app chrome ships as an inert
     * <template id="tpl-<id>">; crawlable sections stay as hidden
     * #content-<id> blocks inside #window-contents.
     */
    function getLocalWindowContent(id) {
        const tpl = document.getElementById('tpl-' + id);
        if (tpl && tpl.content) {
            const holder = tpl.content.getElementById('content-' + id);
            return {
                html: svgIdsOwnedBy((holder || tpl).innerHTML),
                permalink: (holder && holder.getAttribute('data-permalink')) || tpl.getAttribute('data-permalink')
            };
        }

        const contentElement = document.getElementById('content-' + id);
        if (!contentElement) return null;
        return {
            html: svgIdsOwnedBy(contentElement.innerHTML),
            permalink: contentElement.getAttribute('data-permalink')
        };
    }

    /**
     * A window is a copy of markup that also sits, hidden, in the page. Its
     * icon SVGs would point url(#...) at the hidden copy's gradients, which
     * Chrome does not paint from a display:none subtree, so each SVG in the
     * copy gets ids of its own. Only ids inside an <svg> are touched: the
     * window's other ids are looked up by the apps' scripts.
     */
    function svgIdsOwnedBy(html) {
        if (!html || html.indexOf('<svg') === -1) return html;
        return html.replace(/<svg\b[\s\S]*?<\/svg>/g, svg => uniqueSvgIds(svg));
    }

    // Set by openWindowFrom() for the openWindow() call that follows it
    let nextOpenSource = null;
    // False while a /?open= deep link is opened at boot (see init)
    let pushOnOpen = true;

    /**
     * openWindow() with a named source: 'spotlight', 'deeplink', 'link',
     * 'nudge', or 'boot' for a window the visitor did not ask for.
     */
    function openWindowFrom(source, ...args) {
        nextOpenSource = source;
        return openWindow(...args);
    }

    // Window Management
    // `origin` (optional) is the element or rect that was clicked to open the
    // window; the opening animation grows out of it.
    async function openWindow(id, title, size = { width: 1000, height: 700 }, permalink = null, origin = null) {
        // Where the request came from, for analytics (see openWindowFrom)
        const source = nextOpenSource
            || (origin && origin.classList ? (origin.classList.contains('desktop-icon') ? 'icon' : 'list') : 'other');
        nextOpenSource = null;
        const automatic = source === 'boot';

        // Check if window already exists
        if (openWindows.has(id)) {
            const existingWindow = openWindows.get(id);
            // Asked for by name: it may own the address bar from now on
            if (!automatic) existingWindow._urlSilent = false;
            restoreWindow(existingWindow);
            bringToFront(existingWindow);
            if (!automatic) focusWindow(existingWindow);
            return;
        }

        // Handle Special Case: Crysis (The Meme)
        if (id === 'crysis') {
            if (window.playErrorSound) window.playErrorSound();
            if (window.showNotification) {
                window.showNotification({
                    title: 'Crysis',
                    message: 'But can it run Crysis? No. No it cannot.',
                    icon: '/games/crysis.png',
                    duration: 3000,
                    sound: false
                });
            }
            return;
        }

        // 1. Try to get content that ships in the page (e.g. About, Blogs)
        const local = getLocalWindowContent(id);
        let content = '';
        let shouldFetchContent = false;

        if (local) {
            content = local.html;
            if (!permalink) {
                permalink = local.permalink;
            }
        } else if (!IS_DESKTOP && appIds.has(id)) {
            // Apps only exist on the desktop. From an article or section page,
            // hand over to it rather than failing silently.
            window.location.href = '/?open=' + encodeURIComponent(id);
            return;
        } else if (permalink) {
            // 2. If no DOM element but we have a permalink, we need to fetch it
            content = WINDOW_LOADER_HTML;
            shouldFetchContent = true;
        } else {
            console.error(`Content not found for ${id}`);
            return;
        }

        // The same page can be reached under different ids (a blog post is
        // "post-<id>" from Blogs and "timeline-<id>" from Timeline). Focus the
        // window already showing it instead of opening a twin.
        if (permalink) {
            const path = pathOf(permalink);
            const twin = path === '/' ? null : [...openWindows.values()].find(
                w => w.dataset.path === path && !w.classList.contains('closing')
            );
            if (twin) {
                if (!automatic) twin._urlSilent = false;
                restoreWindow(twin);
                bringToFront(twin);
                if (!automatic) focusWindow(twin);
                return;
            }
        }

        // Create window
        const win = createWindowElement(id, title, content, size, permalink);
        // Title, URL and default size, for the Dock, sharing and paging
        win._session = { title, permalink: permalink || null, width: size.width, height: size.height };
        win._openedAt = Date.now();
        // Opened for the visitor rather than by them: leave the URL alone
        if (automatic) win._urlSilent = true;
        track('window_opened', { id, source });

        // Centre the About Me and IRC Chat windows; everything else cascades
        placeWindow(win, size, { center: id === 'about' || id === 'irc-chat' });

        document.getElementById('windows-container').appendChild(win);
        openWindows.set(id, win);
        refreshDock();
        // Games bring their own soundtrack: keep the ambient mix out of it
        setAudioWindow(id, true);

        // Animate, once the app's own stylesheet is in (the first open only).
        // A page fetched into the window shows its spinner meanwhile instead:
        // its body is only put in once the stylesheet has arrived too.
        const styling = appStylesPending(id);
        const playOpening = () => {
            setOpenOrigin(win, origin);
            win.classList.add('opening');
            setTimeout(() => win.classList.remove('opening'), 200);
        };
        if (styling && !shouldFetchContent) {
            holdUntilStyled(win, styling, playOpening);
        } else {
            if (styling) styling.catch(() => { /* reported by loadWindowContent */ });
            playOpening();
        }

        // Setup interactions
        setupWindowDrag(win);
        setupWindowResize(win);
        setupWindowControls(win, id);
        setupFinderItems(win);

        // Activate any lazy-loaded iframes in the window
        activateLazyIframes(win);
        activateTwitterEmbeds(win);
        decorateContent(win);

        // Setup terminal if this is a terminal window or portal window
        if (id === 'terminal' || id === 'portal') {
            // Lazy load v86-terminal.js if not loaded yet
            startV86Terminal(id, win);
        }

        // Setup Flash game if this is a flash game window
        if (id.startsWith('flash-')) {
            initFlashGame(id, win);
        }

        // Lazy-loaded apps: fetch the bundle on first open, then initialise
        // against this window. Each bundle is only ever requested once.
        const lazyApp = LAZY_APPS[id];
        if (lazyApp) {
            initLazyApp(lazyApp, win);
        } else if (styling && !shouldFetchContent && id !== 'terminal' && id !== 'portal') {
            // No script of its own (Quake III's launcher) to report a stylesheet that failed
            reportStylesFailure(win, styling);
        }

        // Newly opened window gets its own history entry; refocusing an
        // existing one (handled in bringToFront) only replaces. Push first:
        // bringToFront() syncs the URL too, and once it has replaced the
        // current entry there is nothing left to push, so Back left the site.
        syncUrlToWindow(win, pushOnOpen);
        bringToFront(win);
        // Keyboard and screen reader land in the window that was asked for.
        // Not for one opened on the visitor's behalf at load.
        if (!automatic) focusWindow(win);

        // If we need to fetch content, do it now
        // (Only the home page has a JSON output, so the page itself is fetched
        // and its window body lifted out; repeat opens come from the cache.)
        if (shouldFetchContent && permalink) {
            await loadWindowContent(win, permalink);
        }
    }

    function createWindowElement(id, title, content, size, permalink = null) {
        const win = document.createElement('div');
        win.className = 'window';
        win.dataset.windowId = id;
        // Multiplayer cursor anchor. Set at runtime, never in the hidden
        // #window-contents template, so anchor lookups can't match an invisible copy.
        win.dataset.cursorAnchor = 'win:' + id;

        // Calculate URL path for deep linking
        let urlPath = '/';
        if (permalink) {
            try {
                // If permalink is a full URL, extract path
                urlPath = new URL(permalink, window.location.origin).pathname;
            } catch (e) { urlPath = permalink; }
        } else {
            // Map IDs to paths
            const map = {
                'projects': '/projects/',
                'blogs': '/blogs/',
                'timeline': '/timeline/'
            };
            if (map[id]) urlPath = map[id];
            // Apps without a page of their own (Music, Guestbook, the games)
            // are linkable as /?open=<id>
            else if (IS_DESKTOP && isAppId(id)) urlPath = '/?open=' + encodeURIComponent(id);
        }
        win.dataset.path = urlPath;

        // Share replaces the bare "open in new tab" arrow (which is one of
        // its items); it keeps .titlebar-link for the titlebar's layout and
        // drag rules.
        let linkHtml = urlPath !== '/'
            ? `<button type="button" class="titlebar-link titlebar-share" aria-label="Share" aria-haspopup="menu" data-tip="Share">${SHARE_ICON}</button>`
            : '';
        if (canGoFullscreen(id)) {
            linkHtml = `<button type="button" class="titlebar-link titlebar-fullscreen" aria-label="Enter full screen" data-tip="Full screen">${FULLSCREEN_ICON}</button>` + linkHtml;
        }
        const iconHtml = getWindowIconHtml(id, urlPath);

        win.innerHTML = `
            <div class="window-titlebar">
                ${getTrafficLightsMarkup()}
                <div class="window-title">${iconHtml}<span class="window-title-text">${escapeHtml(title)}</span></div>
                ${linkHtml}
            </div>
            <div class="window-content">
                ${content}
            </div>
            <div class="window-resize"></div>
        `;
        prepareWindowElement(win);

        return win;
    }

    /**
     * Everything that must happen when a window goes away, shared by the close
     * button and "Close All Windows". Bookkeeping is synchronous - only the
     * DOM removal waits for the closing animation - so a second close or a
     * quick reopen never finds a half-dead window.
     */
    function teardownWindow(win, id) {
        // Cleanup v86 emulator for THIS window only - Terminal and Portal each
        // own a separate emulator instance.
        if ((id === 'terminal' || id === 'portal') && window.destroyV86) {
            window.destroyV86(id);
        }

        // Release any lazy-loaded app's timers and Gun subscriptions
        const lazyApp = LAZY_APPS[id];
        if (lazyApp && typeof win[lazyApp.cleanup] === 'function') {
            win[lazyApp.cleanup]();
        }

        // Let the ambient music back in if this was the last audible game
        win._suspended = false;
        win._rufflePlayer = null;
        setAudioWindow(id, false);

        removeFromTray(id);
        clearTimeout(win._minTimer);
        win._minTimer = null;
        if (win._restoreAnim) win._restoreAnim.cancel();
        // A window closed mid-drag never sees its pointerup
        document.body.classList.remove('is-window-dragging');

        if (openWindows.get(id) === win) openWindows.delete(id);

        // Remove from history
        const histIndex = windowHistory.indexOf(win);
        if (histIndex > -1) {
            windowHistory.splice(histIndex, 1);
        }

        closeSharePopover();
        if (document.fullscreenElement && win.contains(document.fullscreenElement)) {
            document.exitFullscreen().catch(() => { /* already leaving */ });
        }
        if (win._openedAt) {
            track('window_closed', { id, dwell: Math.round((Date.now() - win._openedAt) / 1000) });
        }

        win.classList.add('closing');
        updateDesktopInert();
        refreshDock();
        setTimeout(() => win.remove(), 150);
    }

    function closeWindow(win, id) {
        if (win.classList.contains('closing')) return;

        // Focus that is about to vanish with the window (or was nowhere)
        const focused = document.activeElement;
        const hadFocus = !focused || focused === document.body || win.contains(focused);

        // When the newest history entry is the one opening this window pushed,
        // step back off it instead of rewriting it: otherwise every
        // open-and-close leaves another copy of the desktop for Back to wade
        // through. Whatever takes focus below is written to the entry we land
        // on (see the popstate handler).
        const ownsEntry = ENABLE_DEEP_LINKING && !suppressHistory && history.state
            && history.state.windowId === id && history.state.depth > 0;

        teardownWindow(win, id);

        // The last window: nothing the pushed entries stood for is open any
        // more, so leave none of them behind (as Close All Windows does)
        stepBackInHistory(openWindows.size === 0 ? historyDepth() : (ownsEntry ? 1 : 0));

        if (activeWindow === win) {
            activeWindow = null;

            // Try to activate previous window
            const prevWin = [...windowHistory].reverse().find(
                item => item.style.display !== 'none' && !item.classList.contains('minimized')
            );
            if (prevWin) {
                bringToFront(prevWin);
            } else {
                // Reset to Finder (menubar, tab title, URL) if no windows
                showFinderState();
            }
        }

        if (hadFocus) restoreFocusAfter(win);
    }

    // ================================================
    // Background apps
    // A window in the tray is only display:none, which stops nothing: the
    // emulators and games kept burning CPU and playing audio. Pause what can
    // be paused while minimized, and keep the ambient music mix out from
    // under any window that makes its own sound.
    // ================================================

    /** Windows whose content has its own soundtrack. */
    function hasOwnAudio(id) {
        return id.startsWith('flash-') || id === 'doom' || id === 'portal' ||
            id === 'quake3' || id === 'itch-game';
    }

    const audioWindows = new Set(); // ids that are open and not paused
    let ambientHold = false;
    // A window is in native full screen (see the Full screen section)
    let fullscreenHold = false;

    function setAudioWindow(id, audible) {
        if (!hasOwnAudio(id)) return;
        if (audible) audioWindows.add(id);
        else audioWindows.delete(id);
        updateAmbientHold();
    }

    function updateAmbientHold() {
        const hold = audioWindows.size > 0 || fullscreenHold;
        if (hold === ambientHold) return;
        ambientHold = hold;

        // The music bundle may load later; it reads this flag when it boots
        window.__musicAmbientHold = hold;
        if (window.SiteMusic && typeof window.SiteMusic.suppressAmbient === 'function') {
            window.SiteMusic.suppressAmbient(hold);
        }
    }

    /** Ruffle's v1 API hangs off player.ruffle(); older builds put it on the element. */
    function ruffleApi(player) {
        return typeof player.ruffle === 'function' ? player.ruffle() : player;
    }

    /**
     * Pause whatever runs inside a minimized window. Safe to call again once
     * a late-loading app is ready (win._suspended records the intent).
     * Cross-origin embeds (Quake, itch.io) cannot be paused from here.
     */
    function pauseWindowApp(win, id) {
        win._suspended = true;
        let paused = false;

        try {
            if (id === 'terminal' || id === 'portal') {
                // Covers a boot that is still downloading: it then starts paused
                if (window.pauseV86) {
                    window.pauseV86(id);
                    paused = true;
                }
            } else if (id.startsWith('flash-')) {
                const player = win._rufflePlayer;
                if (player) {
                    if (!win._ruffleSuspended) {
                        const api = ruffleApi(player);
                        // suspend() is a plain pause, so remember whether the
                        // visitor had already paused the game themselves
                        win._ruffleWasPlaying = api.isPlaying !== false;
                        win._ruffleSuspended = true;
                        if (typeof api.suspend === 'function') api.suspend();
                        else if (typeof player.pause === 'function') player.pause();
                    }
                    paused = true;
                }
            } else if (id === 'doom') {
                // Same-origin iframe; static/doom/index.html exposes the hooks
                const frame = win.querySelector('iframe');
                const game = frame && frame.contentWindow;
                if (game && typeof game.pauseGame === 'function') {
                    game.pauseGame();
                    paused = true;
                } else if (frame && !frame._pauseOnLoad) {
                    frame._pauseOnLoad = true;
                    frame.addEventListener('load', () => {
                        frame._pauseOnLoad = false;
                        if (win._suspended) pauseWindowApp(win, id);
                    }, { once: true });
                }
            }
        } catch (e) {
            console.error('Could not pause ' + id, e);
        }

        // A paused game is silent, so the ambient mix may come back
        if (paused) setAudioWindow(id, false);
    }

    function resumeWindowApp(win, id) {
        if (!win._suspended) return;
        win._suspended = false;

        try {
            if (id === 'terminal' || id === 'portal') {
                if (window.resumeV86) window.resumeV86(id);
            } else if (id.startsWith('flash-')) {
                const player = win._rufflePlayer;
                if (player && win._ruffleSuspended && win._ruffleWasPlaying) {
                    const api = ruffleApi(player);
                    if (typeof api.resume === 'function') api.resume();
                    else if (typeof player.play === 'function') player.play();
                }
                win._ruffleSuspended = false;
            } else if (id === 'doom') {
                const frame = win.querySelector('iframe');
                const game = frame && frame.contentWindow;
                if (game && typeof game.resumeGame === 'function') game.resumeGame();
            }
        } catch (e) {
            console.error('Could not resume ' + id, e);
        }

        setAudioWindow(id, true);
    }

    // ================================================
    // Dock
    // The shelf (#dock, layouts/partials/os/dock.html) is filled from the app
    // registry: one launcher per app kept in the Dock, then - after a
    // separator - other apps while they are running and any other window
    // while it is minimised. Styles: assets/css/apps/dock.css. Compact layouts
    // have no Dock (the stylesheet hides it); minimised windows are menubar
    // chips there, so both representations are always kept in step.
    // ================================================

    // Layout constants shared with dock.css (--dock-icon, .dock-item padding,
    // .dock-separator and .dock-shelf padding)
    const DOCK_ICON_MAX = 56;
    const DOCK_ICON_MIN = 28;
    const DOCK_ITEM_PAD = 8;
    const DOCK_SEPARATOR = 17;
    const DOCK_SHELF_PAD = 26;
    // Clear of the bottom corners (where the online pill sits if the shell
    // has not moved it to the menubar), mirrored on the right
    const DOCK_SIDE_MARGIN = 76;
    const DOCK_SIDE_MARGIN_COMPACT = 12;
    const DOCK_MAX_SCALE = 1.6;
    // Reach of the magnification, in resting icon widths either side
    const DOCK_RANGE_ICONS = 3;

    let dockEl = null;
    let dockAppsEl = null;
    let dockExtrasEl = null;
    let dockSeparatorEl = null;
    let dockIconSize = DOCK_ICON_MAX;
    const dockAppSet = new Set();
    const appBadges = new Map();    // app id -> true (see setAppBadge)

    /** False where the stylesheet hides the Dock (print, no element). */
    function isDockVisible() {
        return !!dockEl && dockEl.getClientRects().length > 0;
    }

    function dockItemFor(key) {
        return dockEl ? dockEl.querySelector(`.dock-item[data-dock-key="${CSS.escape(key)}"]`) : null;
    }

    /** Dock key for a window: its app's launcher, or a tile of its own. */
    function dockKeyOf(id) {
        return dockAppSet.has(id) ? id : 'win:' + id;
    }

    function createDockItem(key, label, iconHtml, href) {
        const item = document.createElement('div');
        item.className = 'dock-item';
        item.dataset.dockKey = key;
        item.setAttribute('role', 'none');

        const control = document.createElement(href ? 'a' : 'button');
        control.className = 'dock-icon';
        if (href) {
            control.href = href;
            control.draggable = false;
        } else {
            control.type = 'button';
        }
        control.tabIndex = -1;
        control.innerHTML = uniqueSvgIds(iconHtml) + '<span class="dock-indicator" aria-hidden="true"></span>';

        const tip = document.createElement('span');
        tip.className = 'dock-label';
        tip.setAttribute('aria-hidden', 'true');

        item.append(control, tip);
        setDockItemLabel(item, label);
        return item;
    }

    function setDockItemLabel(item, label) {
        if (item._label === label) return;
        item._label = label;
        item.querySelector('.dock-label').textContent = label;
    }

    function setDockItemState(item, running, minimized) {
        item.classList.toggle('is-running', running);
        item.classList.toggle('is-minimized', minimized);
        item.classList.toggle('has-badge', appBadges.has(item.dataset.dockKey));
        const state = minimized ? ', minimized' : (running ? ', open' : '');
        const note = appBadges.has(item.dataset.dockKey) ? ', new activity' : '';
        item.querySelector('.dock-icon').setAttribute('aria-label', item._label + state + note);
    }

    function setupDock() {
        const el = document.getElementById('dock');
        if (!el) return;

        const apps = dockAppIds
            .map(id => ({ id, meta: appMetadata.get(id) }))
            .filter(app => app.meta && app.meta.iconHtml);
        if (apps.length === 0) {
            // Nothing to launch: give the reserved height back
            el.remove();
            return;
        }

        el.innerHTML =
            '<div class="dock-shelf" role="toolbar" aria-label="Dock" aria-orientation="horizontal">' +
            '<span class="dock-floor" aria-hidden="true"></span>' +
            '<div class="dock-list dock-apps" role="none"></div>' +
            '<span class="dock-separator" role="separator" aria-orientation="vertical" hidden></span>' +
            '<div class="dock-list dock-extras" role="none"></div>' +
            '</div>';
        dockEl = el;
        dockAppsEl = el.querySelector('.dock-apps');
        dockExtrasEl = el.querySelector('.dock-extras');
        dockSeparatorEl = el.querySelector('.dock-separator');

        apps.forEach(({ id, meta }) => {
            dockAppSet.add(id);
            const item = createDockItem(
                id,
                meta.label || meta.title || id,
                meta.iconHtml.replace('app-icon-spotlight', 'app-icon-dock'),
                // A real link, so Cmd-click and "copy link address" work
                meta.permalink || '/?open=' + encodeURIComponent(id)
            );
            item.querySelector('.dock-icon').dataset.cursorAnchor = 'dock:' + id;
            dockAppsEl.appendChild(item);
        });

        el.addEventListener('click', (e) => {
            const control = e.target.closest('.dock-icon');
            if (!control) return;
            if (control.tagName === 'A' && isModifiedClick(e)) return;
            e.preventDefault();
            activateDockItem(control.parentElement);
        });

        // One tab stop; the arrow keys move along the shelf
        el.addEventListener('keydown', (e) => {
            const control = e.target.closest('.dock-icon');
            if (!control) return;
            const controls = [...el.querySelectorAll('.dock-icon')];
            const index = controls.indexOf(control);
            let target = null;

            if (e.key === 'ArrowRight') target = controls[(index + 1) % controls.length];
            else if (e.key === 'ArrowLeft') target = controls[(index - 1 + controls.length) % controls.length];
            else if (e.key === 'Home') target = controls[0];
            else if (e.key === 'End') target = controls[controls.length - 1];
            else if (e.key === 'ArrowUp') {
                // As on a Mac: Up opens the item's menu
                e.preventDefault();
                openContextMenuFor(control, null, true);
                return;
            } else if (e.key === ' ') {
                e.preventDefault();
                control.click();
                return;
            } else {
                return;
            }

            e.preventDefault();
            if (target) target.focus({ preventScroll: true });
        });
        el.addEventListener('focusin', (e) => {
            const control = e.target.closest('.dock-icon');
            if (!control) return;
            el.querySelectorAll('.dock-icon[tabindex="0"]').forEach(other => { other.tabIndex = -1; });
            control.tabIndex = 0;
        });
        el.addEventListener('animationend', (e) => {
            // The bounce runs on the icon inside the item, so clear the item
            const item = e.target.closest && e.target.closest('.dock-item');
            if (item) item.classList.remove('is-launching', 'is-entering');
        });

        setupDockMagnification();
        window.addEventListener('resize', layoutDock);

        el.hidden = false;
        // Hides the menubar chips while the Dock is on screen (apps/dock.css)
        document.documentElement.classList.add('has-dock');
        refreshDock();
        // Icon sizes animate only from here on: the first paint may still
        // show the stylesheet's default size, and must not shrink visibly
        // into the size layoutDock() chose (apps/dock.css, .dock-ready)
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('dock-ready')));
    }

    function activateDockItem(item) {
        if (!item) return;
        const windowId = item.dataset.dockWindow || item.dataset.dockKey;
        const win = openWindows.get(windowId);
        if (win && !win.classList.contains('closing')) {
            // Asked for by name: it may own the address bar from now on
            win._urlSilent = false;
            activateWindow(win);
            return;
        }

        const app = resolveApp(item.dataset.dockKey);
        if (!app) return;
        if (!prefersReducedMotion()) item.classList.add('is-launching');
        openWindowFrom('dock', app.id, app.title, app.size, app.permalink, item.querySelector('.dock-icon'));
    }

    /** Bring the Dock in line with openWindows. Cheap and idempotent: call it after any change. */
    function refreshDock() {
        if (!dockEl) return;

        dockAppsEl.querySelectorAll('.dock-item').forEach(item => {
            const win = openWindows.get(item.dataset.dockKey);
            const live = !!win && !win.classList.contains('closing');
            setDockItemState(item, live, live && !!win._inTray);
        });

        // After the separator: apps that are not kept in the Dock for as long
        // as they are open, and any other window while it is minimised
        const wanted = new Map();
        openWindows.forEach((win, id) => {
            if (win.classList.contains('closing') || dockAppSet.has(id)) return;
            if (appIds.has(id) || win._inTray) wanted.set(id, win);
        });

        dockExtrasEl.querySelectorAll('.dock-item').forEach(item => {
            if (!wanted.has(item.dataset.dockWindow)) item.remove();
        });

        wanted.forEach((win, id) => {
            const isApp = appIds.has(id);
            const label = isApp
                ? ((appMetadata.get(id) || {}).label || windowTitleOf(win).trim())
                : windowTitleOf(win).trim();
            let item = dockItemFor('win:' + id);
            if (!item) {
                let iconHtml;
                if (isApp && appMetadata.get(id) && appMetadata.get(id).iconHtml) {
                    iconHtml = appMetadata.get(id).iconHtml.replace('app-icon-spotlight', 'app-icon-dock');
                } else {
                    // A miniature of the window, wearing its titlebar icon
                    iconHtml = '<span class="dock-thumb" aria-hidden="true"><span class="dock-thumb-bar"></span>' +
                        `<span class="dock-thumb-body">${getWindowIconHtml(id, win.dataset.path) || GENERIC_WINDOW_ICON}</span></span>`;
                }
                item = createDockItem('win:' + id, label, iconHtml, null);
                item.dataset.dockWindow = id;
                if (!prefersReducedMotion()) item.classList.add('is-entering');
                dockExtrasEl.appendChild(item);
            }
            setDockItemLabel(item, label);
            setDockItemState(item, true, !!win._inTray);
        });

        dockSeparatorEl.hidden = !dockExtrasEl.firstElementChild;

        if (!dockEl.querySelector('.dock-icon[tabindex="0"]')) {
            const first = dockEl.querySelector('.dock-icon');
            if (first) first.tabIndex = 0;
        }
        layoutDock();
    }

    /** Icons shrink, as on a Mac, when there are more of them than fit. */
    function layoutDock() {
        if (!dockEl) return;
        const count = dockEl.querySelectorAll('.dock-item').length || 1;
        const fixed = DOCK_SHELF_PAD * 2 + (dockSeparatorEl.hidden ? 0 : DOCK_SEPARATOR);
        // A phone has no room to spare at the sides
        const margin = isCompactViewport() ? DOCK_SIDE_MARGIN_COMPACT : DOCK_SIDE_MARGIN;
        const room = window.innerWidth - margin * 2 - fixed;
        const size = Math.max(DOCK_ICON_MIN, Math.min(DOCK_ICON_MAX, Math.floor(room / count) - DOCK_ITEM_PAD));
        if (size === dockIconSize) return;
        dockIconSize = size;
        // On <html>: the reserved --dock-height (and so where windows and
        // zoom stop) follows the icon size
        const root = document.documentElement;
        if (size === DOCK_ICON_MAX) root.style.removeProperty('--dock-icon');
        else root.style.setProperty('--dock-icon', `${size}px`);
    }

    /** Icons swell under the pointer. Mouse only, and not with reduced motion. */
    function setupDockMagnification() {
        const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
        const shelf = dockEl.querySelector('.dock-shelf');
        let frame = 0;
        let pointerX = null;

        const apply = () => {
            frame = 0;
            const items = [...shelf.querySelectorAll('.dock-item')];
            if (pointerX === null) {
                items.forEach(item => item.style.removeProperty('--s'));
                shelf.classList.remove('is-magnified');
                return;
            }

            // Resting centres come from the layout constants, not from
            // measuring: a magnified Dock is wider, and measuring it would
            // feed its own growth back in and make the icons shiver.
            const box = dockIconSize + DOCK_ITEM_PAD;
            const separator = dockSeparatorEl.hidden ? 0 : DOCK_SEPARATOR;
            const split = dockAppsEl.childElementCount;
            const rect = dockEl.getBoundingClientRect();
            let x = rect.left + rect.width / 2 - (items.length * box + separator) / 2;

            items.forEach((item, i) => {
                if (i === split) x += separator;
                const distance = Math.abs(pointerX - (x + box / 2));
                x += box;
                const t = Math.max(0, 1 - distance / (box * DOCK_RANGE_ICONS));
                const scale = 1 + (DOCK_MAX_SCALE - 1) * t * t * (3 - 2 * t);
                item.style.setProperty('--s', scale.toFixed(3));
            });
            shelf.classList.add('is-magnified');
        };

        shelf.addEventListener('pointermove', (e) => {
            if (e.pointerType !== 'mouse' || !fine.matches || prefersReducedMotion()) return;
            pointerX = e.clientX;
            if (!frame) frame = requestAnimationFrame(apply);
        });
        shelf.addEventListener('pointerleave', () => {
            if (pointerX === null) return;
            pointerX = null;
            if (!frame) frame = requestAnimationFrame(apply);
        });
    }

    /**
     * A dot on an app's Dock and desktop icons ("something new in here").
     * Other scripts reach it through window.SiteShell.setBadge(id, on).
     */
    function setAppBadge(id, on) {
        if (!id || appBadges.has(id) === !!on) return;
        if (on) appBadges.set(id, true);
        else appBadges.delete(id);

        const icon = document.querySelector(`.desktop-icon[data-window="${CSS.escape(id)}"]`);
        if (icon) {
            icon.classList.toggle('has-badge', !!on);
            const label = icon.querySelector('.icon-label');
            const name = label ? label.textContent.trim() : id;
            icon.setAttribute('aria-label', on ? name + ', new activity' : name);
        }
        refreshDock();
    }

    // IRC unread dot: the channel's `latest` timestamp (irc-chat.js writes it
    // with every message) against the newest one this visitor has seen with
    // the IRC window open. localStorage `irc_last_read` holds that value.
    const IRC_LAST_READ_KEY = 'irc_last_read';
    // Older activity is not news, even to someone who never opened the chat
    const IRC_UNREAD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

    function setupIrcUnreadDot() {
        if (!IS_DESKTOP || !appMetadata.has('irc-chat')) return;
        let latest = 0;
        const lastRead = () => parseInt(SiteStore.get(IRC_LAST_READ_KEY), 10) || 0;
        const markRead = () => {
            if (latest > lastRead()) SiteStore.set(IRC_LAST_READ_KEY, String(latest));
            setAppBadge('irc-chat', false);
        };
        const update = () => {
            if (openWindows.has('irc-chat')) {
                markRead();
                return;
            }
            setAppBadge('irc-chat', latest > lastRead() && Date.now() - latest < IRC_UNREAD_MAX_AGE_MS);
        };

        document.addEventListener('site:track', (e) => {
            const detail = e.detail || {};
            if ((detail.name === 'window_opened' || detail.name === 'window_closed') &&
                detail.props && detail.props.id === 'irc-chat') {
                markRead();
            }
        });

        // The realtime bundle arrives once the browser is idle
        let tries = 0;
        const attach = () => {
            const gun = window.SiteGun;
            const path = gun && gun.paths && gun.paths.apps && gun.paths.apps.ircLatest;
            if (!path) {
                if (++tries < 60) setTimeout(attach, 1000);
                return;
            }
            try {
                path('general').on((value) => {
                    // Written by peers: a plausible millisecond time, never ahead of now
                    const ts = Number(value);
                    if (!Number.isFinite(ts) || ts < 1.5e12 || ts > Date.now() + 10 * 60 * 1000 || ts <= latest) return;
                    latest = ts;
                    update();
                });
            } catch (e) { /* relay unavailable: no dot */ }
        };
        attach();
    }

    // ================================================
    // Context menus
    // One floating menu, styled as the menubar dropdowns, for the desktop,
    // its icons, window titlebars, Dock items and tray chips. Everything else
    // (links, text, fields, images) keeps the browser's own menu. Opens on
    // right-click, the Menu key / Shift+F10, and a long press on touch.
    // ================================================

    let contextMenu = null;
    let contextMenuOpenedAt = 0;

    /** @returns {boolean} true when a menu was open */
    function closeContextMenu(restoreFocus) {
        if (!contextMenu) return false;
        const menu = contextMenu;
        contextMenu = null;
        const hadFocus = menu.contains(document.activeElement);
        const target = menu._returnFocus;
        menu.remove();
        if (restoreFocus !== false && (restoreFocus || hadFocus) && target && target.isConnected) {
            try { target.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        }
        return true;
    }

    /**
     * @param {Array} items  '-' for a divider, or { label, action, href, newTab,
     *                       disabled, checked }. Falsy entries are skipped, so
     *                       callers can write `cond && {...}`.
     * @param {Object} opts
     * @param {number} [opts.x]              viewport position (pointer)
     * @param {number} [opts.y]
     * @param {Element} [opts.anchor]        open beside this element instead
     * @param {boolean} [opts.above]         with anchor: above it (Dock items)
     * @param {boolean} [opts.keyboard]      focus the first item
     * @param {string} [opts.label]          accessible name
     * @param {Element} [opts.returnFocus]   gets focus back when the menu closes
     */
    function showContextMenu(items, opts) {
        const options = opts || {};
        closeContextMenu(false);
        window.closeDropdowns();
        closeSharePopover();

        // Conditional items leave doubled or dangling dividers behind
        const rows = [];
        (items || []).forEach(item => {
            if (!item) return;
            if (item === '-') {
                if (rows.length && rows[rows.length - 1] !== '-') rows.push('-');
            } else {
                rows.push(item);
            }
        });
        while (rows[rows.length - 1] === '-') rows.pop();
        if (rows.length === 0) return null;

        const menu = document.createElement('div');
        menu.className = 'apple-dropdown context-menu open';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', options.label || 'Menu');
        menu.tabIndex = -1;

        rows.forEach(item => {
            if (item === '-') {
                const divider = document.createElement('div');
                divider.className = 'dropdown-divider';
                divider.setAttribute('role', 'separator');
                menu.appendChild(divider);
                return;
            }
            const el = document.createElement(item.href ? 'a' : 'button');
            el.className = 'dropdown-item';
            el.tabIndex = -1;
            if (item.href) {
                el.href = item.href;
                if (item.newTab) {
                    el.target = '_blank';
                    el.rel = 'noopener';
                    el.dataset.open = 'tab';
                }
            } else {
                el.type = 'button';
            }
            if (typeof item.checked === 'boolean') {
                el.setAttribute('role', 'menuitemcheckbox');
                el.setAttribute('aria-checked', String(item.checked));
            } else {
                el.setAttribute('role', 'menuitem');
            }
            if (item.disabled) {
                el.setAttribute('aria-disabled', 'true');
                if (!item.href) el.disabled = true;
            }
            el.textContent = item.label;
            el._action = item.action || null;
            menu.appendChild(el);
        });

        menu._returnFocus = options.returnFocus || null;

        menu.addEventListener('click', (e) => {
            const el = e.target.closest('.dropdown-item');
            if (!el) return;
            if (el.getAttribute('aria-disabled') === 'true') {
                e.preventDefault();
                return;
            }
            const action = el._action;
            if (el.tagName === 'A') {
                // Still in the document when the browser follows it
                setTimeout(() => closeContextMenu(false), 0);
            } else {
                // Focus goes back first, so whatever the action opens takes
                // it from there and can hand it back
                closeContextMenu(true);
            }
            if (action) action(e);
        });

        menu.addEventListener('keydown', (e) => {
            const list = menuItems(menu);
            const index = list.indexOf(document.activeElement);
            let target = null;

            if (e.key === 'ArrowDown') target = list[(index + 1) % list.length];
            else if (e.key === 'ArrowUp') target = list[index <= 0 ? list.length - 1 : index - 1];
            else if (e.key === 'Home') target = list[0];
            else if (e.key === 'End') target = list[list.length - 1];
            else if (e.key === 'Escape' || e.key === 'Tab') {
                e.preventDefault();
                e.stopPropagation();
                closeContextMenu(true);
                return;
            } else if (e.key === ' ' && index > -1 && list[index].tagName === 'A') {
                e.preventDefault();
                list[index].click();
                return;
            } else {
                return;
            }

            e.preventDefault();
            if (target) target.focus({ preventScroll: true });
        });
        // Keep the menu's own right-click from opening the browser's menu
        menu.addEventListener('contextmenu', (e) => e.preventDefault());

        document.body.appendChild(menu);
        contextMenu = menu;
        contextMenuOpenedAt = Date.now();

        // On screen, under the menubar, flipping above the pointer when low
        const width = menu.offsetWidth;
        const height = menu.offsetHeight;
        const top = getMenubarHeight() + 4;
        let x = options.x || 0;
        let y = options.y || 0;
        if (options.anchor) {
            const rect = options.anchor.getBoundingClientRect();
            x = rect.left + rect.width / 2 - width / 2;
            y = options.above ? rect.top - height - 10 : rect.bottom + 4;
        } else if (y + height > window.innerHeight - 8) {
            y -= height;
        }
        menu.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - width - 8, x)))}px`;
        menu.style.top = `${Math.round(Math.max(top, Math.min(window.innerHeight - height - 8, y)))}px`;

        const first = options.keyboard ? menuItems(menu)[0] : null;
        (first || menu).focus({ preventScroll: true });
        return menu;
    }

    function appHref(id) {
        const meta = appMetadata.get(id);
        return (meta && meta.permalink) || '/?open=' + encodeURIComponent(id);
    }

    function absoluteUrl(path) {
        try {
            return new URL(path, window.location.origin).href;
        } catch (e) {
            return path;
        }
    }

    /** Minimize / Zoom / Close and the link items for one window. */
    function windowMenuItems(win, id) {
        const shown = isWindowShown(win);
        const path = win.dataset.path;
        const url = path && path !== '/' ? absoluteUrl(path) : null;
        const canZoom = shown && !isCompactViewport() && !!win.querySelector('.traffic-light.maximize');
        return [
            shown
                ? { label: 'Minimize', action: () => minimizeWindow(win, id) }
                : { label: 'Restore', action: () => activateWindow(win) },
            canZoom && {
                label: win.dataset.maximized === 'true' ? 'Restore Size' : 'Zoom',
                action: () => { bringToFront(win); toggleZoom(win); }
            },
            '-',
            infoSubjectFor(id, win) && { label: 'Get Info', action: () => openInfoWindow(id, win) },
            url && { label: 'Copy Link', action: () => copyLinkWithNotice(url) },
            url && { label: 'Open in New Tab', href: url, newTab: true },
            '-',
            { label: 'Close', action: () => closeWindow(win, id) }
        ];
    }

    /** Open / Get Info / link items for an app that is not running. */
    function appMenuItems(id, origin, source) {
        const app = resolveApp(id);
        if (!app) return [];
        const url = absoluteUrl(appHref(id));
        return [
            { label: 'Open', action: () => openWindowFrom(source, app.id, app.title, app.size, app.permalink, origin) },
            '-',
            infoSubjectFor(id, null) && { label: 'Get Info', action: () => openInfoWindow(id, null) },
            { label: 'Copy Link', action: () => copyLinkWithNotice(url) },
            { label: 'Open in New Tab', href: url, newTab: true }
        ];
    }

    function desktopMenuItems() {
        const personal = personalDesktop();
        const arrange = !!personal && !isCompactViewport();
        const sticky = sharedSticky();
        const anyShown = [...openWindows.values()].some(isWindowShown);
        return [
            arrange && { label: 'New Sticky Note', action: (e) => personal.newSticky(e && e._at) },
            '-',
            arrange && { label: 'Clean Up', action: () => personal.cleanUp() },
            arrange && { label: 'Sort Icons by Name', action: () => personal.sortByName() },
            arrange && personal.hasArrangement() &&
                { label: 'Restore Default Arrangement', action: () => personal.resetArrangement() },
            '-',
            anyShown && !isCompactViewport() && openWindows.size > 1 &&
                { label: 'Tile Windows', action: () => window.tileWindows() },
            anyShown && { label: 'Minimize All', action: () => showDesktop() },
            sticky && sticky.available &&
                { label: 'Shared Sticky Note', checked: sticky.shown, action: () => toggleSharedSticky() },
            '-',
            resolveApp('preferences') &&
                { label: 'Change Desktop Background…', action: () => openPreferences('desktop') },
            { label: 'Search…', action: () => toggleSpotlight() },
            { label: 'About This Site', action: () => window.openAboutThisMac() }
        ];
    }

    /** What a right-click on `node` should offer, or null to leave it to the browser. */
    function buildContextMenu(node) {
        if (!node || !node.closest) return null;

        const dockItem = node.closest('.dock-item');
        if (dockItem) {
            const control = dockItem.querySelector('.dock-icon');
            const windowId = dockItem.dataset.dockWindow || dockItem.dataset.dockKey;
            const win = openWindows.get(windowId);
            const live = win && !win.classList.contains('closing');
            let items;
            if (live) {
                items = windowMenuItems(win, windowId);
                // "Show" for a window that is open but behind the others
                if (isWindowShown(win) && win !== activeWindow) {
                    items.unshift({ label: 'Show', action: () => activateWindow(win) });
                }
            } else {
                items = appMenuItems(dockItem.dataset.dockKey, control, 'dock');
            }
            return { items, label: dockItem._label, anchor: control, above: true };
        }

        const icon = node.closest('.desktop-icon');
        if (icon && icon.dataset.window) {
            const id = icon.dataset.window;
            const win = openWindows.get(id);
            const items = win && !win.classList.contains('closing')
                ? [{ label: 'Show', action: () => { win._urlSilent = false; activateWindow(win); } }, '-']
                    .concat(windowMenuItems(win, id).filter(item => item && item.label !== 'Restore'))
                : appMenuItems(id, icon, 'context');
            return items.length ? { items, label: icon.getAttribute('aria-label') || id, anchor: icon } : null;
        }

        const chip = node.closest('.menubar-min-chip');
        if (chip) {
            const id = chip.dataset.trayFor;
            const win = openWindows.get(id);
            if (!win) return null;
            return {
                items: [
                    { label: 'Restore', action: () => activateWindow(win) },
                    { label: 'Close', action: () => closeWindow(win, id) }
                ],
                label: windowTitleOf(win).trim(),
                anchor: chip
            };
        }

        const titlebar = node.closest('.window-titlebar');
        const win = titlebar && titlebar.closest('.window');
        if (win && win.dataset.windowId && !node.closest('input, textarea, select, a[href], [contenteditable]')) {
            return { items: windowMenuItems(win, win.dataset.windowId), label: windowTitleOf(win).trim(), anchor: titlebar };
        }

        // Private stickies and anything else the personal desktop owns
        const personal = personalDesktop();
        if (personal && typeof personal.contextMenu === 'function') {
            const spec = personal.contextMenu(node);
            if (spec) return spec;
        }

        const desktop = document.getElementById('desktop');
        if (IS_DESKTOP && desktop && (node === desktop || node.classList.contains('desktop-icons'))) {
            return { items: desktopMenuItems(), label: 'Desktop', anchor: null };
        }
        return null;
    }

    /**
     * @param {Element} node            what was right-clicked / long-pressed / focused
     * @param {{x:number,y:number}|null} point  pointer position; null opens beside the element
     * @param {boolean} keyboard        opened from the keyboard: focus the first item
     * @returns {boolean} true when a menu was shown
     */
    function openContextMenuFor(node, point, keyboard) {
        const spec = buildContextMenu(node);
        if (!spec || !spec.items || !spec.items.length) return false;

        const active = document.activeElement;
        const options = {
            label: spec.label,
            keyboard: !!keyboard,
            returnFocus: active && active !== document.body ? active : null
        };
        if (point && !spec.above) {
            options.x = point.x;
            options.y = point.y;
            // Lets an action place what it creates where the menu was opened
            spec.items.forEach(item => {
                if (item && item.action) {
                    const run = item.action;
                    item.action = (e) => run(Object.assign(e || {}, { _at: point }));
                }
            });
        } else if (spec.anchor) {
            options.anchor = spec.anchor;
            options.above = !!spec.above;
        } else {
            const rect = node.getBoundingClientRect();
            options.x = rect.left + Math.min(rect.width, 240) / 2;
            options.y = rect.top + Math.min(rect.height, 160) / 2;
        }
        return !!showContextMenu(spec.items, options);
    }

    function setupContextMenus() {
        document.addEventListener('contextmenu', (e) => {
            // Shift + right-click always gets the browser's menu
            if (e.shiftKey && e.button === 2) return;
            // Android fires this for the long press we have just handled
            if (contextMenu && Date.now() - contextMenuOpenedAt < 700) {
                e.preventDefault();
                return;
            }
            // From the keyboard the event carries no useful position
            const keyboard = e.button !== 2 && e.pointerType !== 'touch' && e.pointerType !== 'pen';
            const point = keyboard ? null : { x: e.clientX, y: e.clientY };
            if (openContextMenuFor(e.target, point, keyboard)) e.preventDefault();
        });

        // Anything outside dismisses it (pointerdown: a drag never clicks)
        document.addEventListener('pointerdown', (e) => {
            if (contextMenu && !contextMenu.contains(e.target) && Date.now() - contextMenuOpenedAt > 250) {
                closeContextMenu(false);
            }
        }, true);
        window.addEventListener('resize', () => closeContextMenu(false));
        window.addEventListener('blur', () => closeContextMenu(false));
        document.addEventListener('wheel', (e) => {
            if (contextMenu && !contextMenu.contains(e.target)) closeContextMenu(false);
        }, { passive: true });

        // Long press: iOS never fires contextmenu, and a finger has no other
        // way to ask. Only on the things a touch can otherwise just tap.
        let press = null;
        const cancelPress = () => {
            if (!press) return;
            clearTimeout(press.timer);
            press = null;
        };
        document.addEventListener('pointerdown', (e) => {
            cancelPress();
            if (e.pointerType !== 'touch' || !e.isPrimary) return;
            const desktop = document.getElementById('desktop');
            const target = e.target.closest('.desktop-icon, .dock-item, .menubar-min-chip, .private-sticky-titlebar') ||
                (e.target === desktop || (e.target.classList && e.target.classList.contains('desktop-icons')) ? e.target : null);
            if (!target) return;
            const point = { x: e.clientX, y: e.clientY };
            press = {
                x: e.clientX,
                y: e.clientY,
                timer: setTimeout(() => {
                    press = null;
                    if (!openContextMenuFor(e.target, point, false)) return;
                    // The finger is still down: its release must not count as
                    // a tap on the icon underneath
                    const swallow = (click) => {
                        click.preventDefault();
                        click.stopPropagation();
                    };
                    document.addEventListener('click', swallow, { capture: true, once: true });
                    setTimeout(() => document.removeEventListener('click', swallow, true), 800);
                    if (navigator.vibrate) {
                        try { navigator.vibrate(8); } catch (err) { /* not allowed */ }
                    }
                }, 520)
            };
        }, true);
        document.addEventListener('pointermove', (e) => {
            if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancelPress();
        }, true);
        document.addEventListener('pointerup', cancelPress, true);
        document.addEventListener('pointercancel', cancelPress, true);
    }

    // ================================================
    // Get Info
    // A small inspector for an app or a page, built from what the registry
    // and the search index already say about it.
    // ================================================

    /** What Get Info can say about a window id, or null when it knows nothing. */
    function infoSubjectFor(id, win) {
        const path = win ? win.dataset.path : null;
        const meta = appMetadata.get(id) || (path && path !== '/' ? metaByPath.get(pathOf(path)) : null);
        if (!meta || !meta.title) return null;

        const isApp = appIds.has(id);
        const where = isApp ? appHref(id) : (meta.permalink || path);
        if (!where) return null;
        return {
            key: isApp ? id : pathOf(where),
            title: isApp ? (meta.label || meta.title) : meta.title,
            kind: isApp ? (meta.type === 'game' ? 'Game' : 'Application') : getSearchTypeLabel(meta),
            description: meta.description || '',
            url: absoluteUrl(where),
            date: !isApp && meta.date ? meta.date : '',
            tags: !isApp && Array.isArray(meta.tags) ? meta.tags.slice(0, 8) : [],
            size: isApp && meta.width && meta.height ? `${meta.width} × ${meta.height}` : '',
            iconHtml: uniqueSvgIds((getSearchItemIconHtml(meta) || '').replace('app-icon-spotlight', 'app-icon-grid')),
            open: isApp ? () => {
                const app = resolveApp(id);
                if (app) openWindowFrom('context', app.id, app.title, app.size, app.permalink);
            } : null
        };
    }

    function openInfoWindow(id, sourceWin) {
        const subject = infoSubjectFor(id, sourceWin);
        if (!subject) return;

        // One inspector: asking about something else re-points it
        if (openWindows.has('get-info')) closeWindowNow(openWindows.get('get-info'), 'get-info');

        const rows = [
            ['Kind', subject.kind],
            ['Where', subject.url.replace(/^https?:\/\//, '')],
            subject.size && ['Opens at', subject.size],
            subject.date && ['Published', formatInfoDate(subject.date)],
            subject.tags.length && ['Tags', subject.tags.join(', ')]
        ].filter(Boolean);

        const win = document.createElement('div');
        win.className = 'window info-window';
        win.dataset.windowId = 'get-info';
        win.dataset.cursorAnchor = 'win:get-info';
        win.innerHTML = `
            <div class="window-titlebar">
                ${getTrafficLightsMarkup()}
                <div class="window-title"><span class="window-title-text">${escapeHtml(subject.title)} Info</span></div>
            </div>
            <div class="window-content">
                <div class="gi-pane">
                    <div class="gi-header">
                        <span class="gi-icon" aria-hidden="true">${subject.iconHtml}</span>
                        <div class="gi-heading">
                            <div class="gi-name">${escapeHtml(subject.title)}</div>
                            <div class="gi-kind">${escapeHtml(subject.kind)}</div>
                        </div>
                    </div>
                    ${subject.description ? `<p class="gi-description">${escapeHtml(subject.description)}</p>` : ''}
                    <div class="gi-section">General</div>
                    <dl class="gi-rows">
                        ${rows.map(([label, value]) => `
                            <div class="gi-row"><dt>${escapeHtml(label)}:</dt><dd>${escapeHtml(value)}</dd></div>
                        `).join('')}
                    </dl>
                    <div class="gi-actions">
                        ${subject.open ? '<button type="button" class="mac-btn primary" data-info="open">Open</button>' : ''}
                        <button type="button" class="mac-btn" data-info="copy">Copy Link</button>
                    </div>
                </div>
            </div>
        `;
        prepareWindowElement(win);

        win.querySelector('.gi-actions').addEventListener('click', (e) => {
            const button = e.target.closest('[data-info]');
            if (!button) return;
            if (button.dataset.info === 'copy') copyLinkWithNotice(subject.url);
            else if (subject.open) subject.open();
        });

        document.getElementById('windows-container').appendChild(win);
        openWindows.set('get-info', win);

        placeWindow(win, { width: 300 }, { center: true, top: 70 });
        // Beside the window it describes rather than on top of it
        if (!isCompactViewport()) {
            const bounds = getDesktopBounds();
            win.style.left = `${Math.max(12, bounds.width - 300 - 120)}px`;
        }

        if (!prefersReducedMotion()) {
            win.classList.add('opening');
            setTimeout(() => win.classList.remove('opening'), 200);
        }

        setupWindowDrag(win);
        setupWindowControls(win, 'get-info');
        bringToFront(win);
        focusWindow(win);
        track('get_info', { id: subject.key });
    }

    /** Tear a utility window down without the closing animation (it is being replaced). */
    function closeWindowNow(win, id) {
        teardownWindow(win, id);
        win.remove();
        if (activeWindow === win) activeWindow = null;
    }

    function formatInfoDate(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    }

    // ================================================
    // Minimize / restore
    // A minimised window flies into the Dock: into its app's icon, or into a
    // tile of its own after the separator. Layouts without a Dock get a chip
    // in the menubar instead. Both are created; the stylesheet shows one.
    // ================================================

    function getMinimizedTray() {
        return document.getElementById('menubar-minimized');
    }

    function windowTitleOf(win) {
        return win.querySelector('.window-title-text')?.textContent
            || win.querySelector('.window-title')?.textContent
            || 'Window';
    }

    /** The control a minimised window lives behind: Dock item, else menubar chip. */
    function trayTarget(id) {
        if (isDockVisible()) {
            const item = dockItemFor(dockKeyOf(id));
            if (item) return item.querySelector('.dock-icon');
        }
        const tray = getMinimizedTray();
        return tray ? tray.querySelector(`[data-tray-for="${CSS.escape(id)}"]`) : null;
    }

    function addToTray(win, id) {
        win._inTray = true;
        addTrayChip(win, id);
        refreshDock();
        return trayTarget(id);
    }

    function addTrayChip(win, id) {
        const tray = getMinimizedTray();
        if (!tray || tray.querySelector(`[data-tray-for="${CSS.escape(id)}"]`)) return null;

        const title = windowTitleOf(win).trim();
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'menubar-min-chip';
        chip.dataset.trayFor = id;
        chip.setAttribute('aria-label', `Restore ${title}`);
        chip.dataset.tip = `Restore ${title}`;

        // Phones hide the label, so a chip with no icon would be a blank box
        const icon = getWindowIconHtml(id, win.dataset.path);
        chip.innerHTML =
            `<span class="menubar-min-icon">${icon || GENERIC_WINDOW_ICON}</span>` +
            `<span class="menubar-min-label"></span>`;
        chip.querySelector('.menubar-min-label').textContent = title;

        chip.addEventListener('click', (e) => {
            e.stopPropagation();
            const target = openWindows.get(id);
            // The chip is removed on restore; focus follows the window
            if (target) activateWindow(target);
        });

        tray.appendChild(chip);
        return chip;
    }

    function removeFromTray(id) {
        const win = openWindows.get(id);
        if (win) win._inTray = false;
        const tray = getMinimizedTray();
        const chip = tray && tray.querySelector(`[data-tray-for="${CSS.escape(id)}"]`);
        if (chip) chip.remove();
        refreshDock();
    }

    /** Genie-ish fly toward the tray chip, mirroring the sticky note's animation. */
    function minimizeWindow(win, id) {
        if (win.classList.contains('minimized')) return;

        if (win._restoreAnim) win._restoreAnim.cancel();
        const chip = addToTray(win, id);
        const winRect = win.getBoundingClientRect();
        const targetRect = chip ? chip.getBoundingClientRect() : null;

        // Focus inside a hidden window is lost; park it on the chip, which
        // is where the window went and what brings it back
        if (chip && win.contains(document.activeElement)) chip.focus({ preventScroll: true });

        win.classList.add('minimized');
        updateDesktopInert();

        if (targetRect && !prefersReducedMotion()) {
            const dx = (targetRect.left + targetRect.width / 2) - (winRect.left + winRect.width / 2);
            const dy = (targetRect.top + targetRect.height / 2) - (winRect.top + winRect.height / 2);
            win.style.transformOrigin = 'center center';
            win.style.transition = 'transform 260ms cubic-bezier(0.4, 0, 1, 1), opacity 260ms ease-in';
            win.style.transform = `translate(${dx}px, ${dy}px) scale(0.06)`;
            win.style.opacity = '0';
        } else {
            win.style.opacity = '0';
        }

        // Kept on the element so restoreWindow() can cancel it: restoring
        // mid-flight used to end with the window hidden and no tray chip.
        clearTimeout(win._minTimer);
        win._minTimer = setTimeout(() => {
            win._minTimer = null;
            if (!win.classList.contains('minimized') || win.classList.contains('closing')) return;

            win.style.display = 'none';
            win.style.transition = '';
            win.style.transform = '';
            win.style.opacity = '';
            win.style.transformOrigin = '';

            // Out of sight: stop the emulator or game until it comes back
            pauseWindowApp(win, id);

            if (activeWindow === win) {
                activeWindow = null;
                const previous = [...windowHistory].reverse().find(item => item !== win && item.style.display !== 'none');
                if (previous) {
                    bringToFront(previous);
                } else {
                    deactivateAllWindows();
                    showFinderState();
                }
            }
        }, prefersReducedMotion() ? 0 : 260);
    }

    function prefersReducedMotion() {
        // System setting, or "Reduce motion" in System Preferences > Accessibility
        return document.documentElement.getAttribute('data-motion') === 'reduce'
            || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function restoreWindow(win) {
        const wasMinimized = win.classList.contains('minimized');
        // A minimize caught mid-flight is still on screen
        const wasHidden = win.style.display === 'none';
        // Cancel a minimize that is still animating
        clearTimeout(win._minTimer);
        win._minTimer = null;

        win.style.display = '';
        win.style.transform = '';
        win.style.opacity = '';
        win.classList.remove('minimized');
        updateDesktopInert();

        if (wasMinimized) {
            const id = win.dataset.windowId;
            const chip = trayTarget(id);
            const chipRect = chip ? chip.getBoundingClientRect() : null;

            win.style.transition = '';
            win.style.transformOrigin = '';
            removeFromTray(id);
            // The viewport may have changed while it was in the tray
            clampWindowToViewport(win);

            // Fly back out of the tray chip, mirroring the minimize; a window
            // caught mid-flight just settles where it is
            if (!prefersReducedMotion() && !(wasHidden && flyFromRect(win, chipRect))) {
                win.classList.add('restoring');
                setTimeout(() => win.classList.remove('restoring'), 220);
            }

            resumeWindowApp(win, id);
        }
    }

    /** Animate a window from a source rect (its tray chip) to where it sits. */
    function flyFromRect(win, rect) {
        if (!rect || !rect.width || typeof win.animate !== 'function') return false;
        const winRect = win.getBoundingClientRect();
        if (!winRect.width) return false;

        const dx = (rect.left + rect.width / 2) - (winRect.left + winRect.width / 2);
        const dy = (rect.top + rect.height / 2) - (winRect.top + winRect.height / 2);

        if (win._restoreAnim) win._restoreAnim.cancel();
        const anim = win.animate([
            { transform: `translate(${dx}px, ${dy}px) scale(0.06)`, opacity: 0 },
            { transform: 'none', opacity: 1 }
        ], { duration: 240, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });

        win._restoreAnim = anim;
        const clear = () => {
            if (win._restoreAnim === anim) win._restoreAnim = null;
        };
        anim.onfinish = clear;
        anim.oncancel = clear;
        return true;
    }

    /**
     * Make the opening animation grow out of whatever was clicked.
     * @param {HTMLElement} win
     * @param {Element|DOMRect|null} origin
     */
    function setOpenOrigin(win, origin) {
        if (!origin || prefersReducedMotion()) return;
        const rect = typeof origin.getBoundingClientRect === 'function'
            ? origin.getBoundingClientRect()
            : origin;
        if (!rect || !(rect.width || rect.height)) return;

        const winRect = win.getBoundingClientRect();
        const x = (rect.left + rect.width / 2) - winRect.left;
        const y = (rect.top + rect.height / 2) - winRect.top;
        win.style.transformOrigin = `${x}px ${y}px`;

        setTimeout(() => {
            // minimizeWindow() owns transform-origin while it animates
            if (!win.classList.contains('minimized')) win.style.transformOrigin = '';
        }, 200);
    }

    /** Tab title follows the focused window when that window has its own URL. */
    function syncTitleToWindow(win, title) {
        document.title = windowUrl(win)
            ? `${title} | ${SITE_NAME}`
            : ORIGINAL_TITLE;
    }

    function bringToFront(win) {
        restoreWindow(win);
        windowZIndex++;
        win.style.zIndex = windowZIndex;

        // Mark all windows as inactive
        deactivateAllWindows();

        // Mark this window as active
        win.classList.remove('inactive');
        activeWindow = win;

        // Update menubar title
        const title = win.querySelector('.window-title-text')?.textContent || win.querySelector('.window-title').textContent;
        const activeAppName = document.getElementById('active-app-name');
        if (activeAppName) {
            activeAppName.textContent = title;
        }
        syncTitleToWindow(win, title.trim());

        // Update History
        const index = windowHistory.indexOf(win);
        if (index > -1) {
            windowHistory.splice(index, 1);
        }
        windowHistory.push(win);

        syncUrlToWindow(win);
    }

    // ================================================
    // Deep linking
    // A history entry means "this window is focused". Opening a window pushes;
    // merely refocusing an already-open one replaces, so alt-tabbing between
    // two windows does not bury the Back button under dozens of entries.
    // ================================================

    let suppressHistory = false;

    // Closes that are waiting for their history.back() to land (see closeWindow)
    let pendingCloseBacks = 0;
    let pendingCloseTimer = null;
    // Counts Back/Forward steps, so a reopen that waited for the search
    // index can tell the visitor has moved on (see the popstate handler)
    let popstateSeq = 0;

    function windowUrl(win) {
        const path = win && win.dataset.path;
        if (!path || path === '/') return null;
        // Opened for the visitor (the boot About): it has a URL but does not
        // put it in the address bar until they ask for it
        if (win._urlSilent) return null;
        // An article or section page already is that page's address; the
        // windows opened over it leave the address bar alone
        if (!IS_DESKTOP) return null;

        // The desktop address plus ?open=<token> (see openTokenForPath),
        // keeping the parameters the visitor arrived with (see BASE_URL)
        let token = null;
        if (path.startsWith('/?open=')) {
            token = new URLSearchParams(path.slice(1)).get('open');
        } else {
            appIds.forEach(id => {
                const meta = appMetadata.get(id);
                if (!token && meta && meta.permalink && pathOf(meta.permalink) === path) token = id;
            });
            if (!token) token = openTokenForPath(path);
        }
        if (!token) return null;
        const url = '/?open=' + encodeURIComponent(token).replace(/%2F/gi, '/');
        return BASE_URL.length > 2 ? url + '&' + BASE_URL.slice(2) : url;
    }

    /** True for registered apps (as opposed to content pages and one-off windows). */
    function isAppId(id) {
        if (appIds.has(id)) return true;
        // No registry on the page: the desktop icons are the app list
        return appIds.size === 0 && !!document.querySelector(`.desktop-icon[data-window="${CSS.escape(id)}"]`);
    }

    /** Entries this page pushed on top of the one the visitor arrived on. */
    function historyDepth() {
        return (history.state && history.state.depth) || 0;
    }

    function syncUrlToWindow(win, forcePush) {
        if (!ENABLE_DEEP_LINKING || suppressHistory) return;

        const path = windowUrl(win);
        const target = path || BASE_URL;
        const id = path ? win.dataset.windowId : null;
        const current = location.pathname + location.search;

        if (target === current) {
            // Already there (a /?open= deep link, or a refocus): just make
            // sure the entry knows which window it stands for
            if (((history.state && history.state.windowId) || null) !== id) {
                history.replaceState(id ? { windowId: id, depth: historyDepth() } : stateForDesktop(), '', current);
            }
            return;
        }

        // Only a window with a URL of its own earns an entry: the boot About
        // on /?open=<unknown> must not push a second copy of the desktop
        if (forcePush && id) {
            history.pushState({ windowId: id, depth: historyDepth() + 1 }, '', target);
        } else {
            history.replaceState(id ? { windowId: id, depth: historyDepth() } : stateForDesktop(), '', target);
        }
    }

    /** State for an entry that means "the desktop": no window, same depth. */
    function stateForDesktop() {
        const depth = historyDepth();
        return depth ? { depth } : null;
    }

    function resetUrlToDesktop() {
        if (!ENABLE_DEEP_LINKING || suppressHistory) return;
        const onBase = location.pathname + location.search === BASE_URL;
        if (onBase && !(history.state && history.state.windowId)) return;
        history.replaceState(stateForDesktop(), '', BASE_URL);
    }

    /** Point the current history entry at whatever is focused now. */
    function syncUrlToFocus() {
        if (activeWindow && activeWindow.isConnected && !activeWindow.classList.contains('closing')) {
            syncUrlToWindow(activeWindow);
        } else {
            resetUrlToDesktop();
        }
    }

    /**
     * Step back off `steps` entries this page pushed, after the windows they
     * stood for were closed. The popstate that follows writes whatever is
     * focused by then to the entry we land on.
     */
    function stepBackInHistory(steps) {
        if (!ENABLE_DEEP_LINKING || suppressHistory || !(steps > 0)) return;
        suppressHistory = true;
        pendingCloseBacks = 1;
        // popstate should always follow; never leave history frozen if not
        clearTimeout(pendingCloseTimer);
        pendingCloseTimer = setTimeout(finishPendingCloseBacks, 600);
        history.go(-steps);
    }

    function finishPendingCloseBacks() {
        clearTimeout(pendingCloseTimer);
        pendingCloseBacks = 0;
        suppressHistory = false;
        syncUrlToFocus();
    }

    /**
     * Which window a URL stands for, for entries that carry no state (the
     * one the visitor arrived on). Returns { id, title, size, permalink } or null.
     */
    function windowForLocation() {
        const open = new URLSearchParams(location.search).get('open');
        if (open) return resolveOpenTarget(open);

        const path = location.pathname;
        if (path === '/' || path === '/index.html') return null;

        const meta = metaByPath.get(path);
        if (meta) {
            return {
                id: meta.openWindow,
                title: meta.title,
                size: { width: meta.width || 900, height: meta.height || 650 },
                permalink: meta.permalink
            };
        }
        let app = null;
        appIds.forEach(id => {
            const m = appMetadata.get(id);
            if (!app && m && m.permalink && pathOf(m.permalink) === path) app = resolveApp(id);
        });
        return app;
    }

    /**
     * Back/forward: bring the window for the target URL to the front, opening it
     * if it was closed. An unrecognised entry means "the desktop".
     */
    window.addEventListener('popstate', (e) => {
        if (!ENABLE_DEEP_LINKING) return;

        // Our own history.back() after a window was closed: nothing to open,
        // just make the entry we landed on describe what is focused now.
        if (pendingCloseBacks > 0) {
            finishPendingCloseBacks();
            return;
        }

        const targetId = e.state && e.state.windowId;
        const current = location.pathname + location.search;
        const seq = ++popstateSeq;

        // An in-page anchor on an article page also arrives here: with no
        // window open over the page there is nothing to do
        if (!IS_DESKTOP && current === BASE_URL && openWindows.size === 0) return;

        // An article or section page only knows its own URL and the windows
        // it opened itself. Any other entry reached without a page load was
        // pushed by the desktop before a reload put this page in its place
        // (pushState entries share one document): load what the URL says
        // rather than leaving this page showing under it.
        if (!IS_DESKTOP && current !== BASE_URL && !(targetId && openWindows.has(targetId))) {
            location.reload();
            return;
        }

        // Nothing this handler does may write to history: the entry is
        // already the right one. Held only while it runs synchronously -
        // openWindow pushes before its first await, so it can be let go as
        // soon as the call returns.
        suppressHistory = true;
        const release = () => { suppressHistory = false; };

        const focus = (win) => {
            // The visitor navigated to this window's URL: it owns it now
            win._urlSilent = false;
            restoreWindow(win);
            bringToFront(win);
            release();
        };

        // An entry for no window means "the desktop": nothing is focused,
        // and the windows stay where they are. On a compact layout they are
        // fullscreen and would go on covering the launcher, so there they go
        // to the tray, as "Show Desktop" does.
        const showBareDesktop = () => {
            if (isCompactViewport()) {
                showDesktop();
                updateDesktopInert();
            } else {
                deactivateAllWindows();
                activeWindow = null;
                showFinderState();
            }
            release();
        };

        // On an article or section page every entry at its own URL is the page
        if (current === BASE_URL && (!targetId || !IS_DESKTOP) && !(targetId && openWindows.has(targetId))) {
            showBareDesktop();
            return;
        }

        if (targetId && openWindows.has(targetId)) {
            focus(openWindows.get(targetId));
            return;
        }

        // The window was closed since that entry was created (or the entry is
        // the one the visitor arrived on and carries no state) - reopen it
        // from the registry or search index if we can identify it.
        const reopen = () => {
            const meta = targetId ? appMetadata.get(targetId) : null;
            let target = targetId && meta
                ? {
                    id: targetId,
                    title: meta.title,
                    size: { width: meta.width || 1000, height: meta.height || 700 },
                    permalink: meta.permalink || null
                }
                : windowForLocation();
            // Pages outside the index (tag lists) were opened by path alone
            if (!target && targetId && targetId.startsWith('content-')) {
                target = { id: targetId, title: location.pathname, size: { width: 900, height: 650 }, permalink: location.pathname };
            }

            if (target && openWindows.has(target.id)) {
                focus(openWindows.get(target.id));
                return;
            }
            // Back or Forward across a Previous / Next step: turn the page in
            // the window that was paged rather than opening a second one.
            // Only for a page that window has shown - any other entry
            // belongs to a window of its own.
            if (target && target.permalink && !isAppId(target.id) &&
                activeWindow && activeWindow._pagedPaths &&
                activeWindow._pagedPaths.has(pathOf(target.permalink)) &&
                canNavigateInPlace(activeWindow)) {
                navigateWindow(activeWindow, target.id, target.title, target.permalink);
                release();
                return;
            }
            if (target) {
                Promise.resolve(
                    openWindow(target.id, target.title, target.size, target.permalink)
                ).catch(() => { /* reported by openWindow */ });
                release();
                return;
            }

            const byPath = [...openWindows.values()].find(
                w => w.dataset.path === current || w.dataset.path === location.pathname);
            if (byPath) {
                focus(byPath);
                return;
            }

            // A page this desktop cannot show as a window: load it for real
            // rather than showing the desktop under its URL
            if (location.pathname !== '/' && location.pathname !== '/index.html') {
                release();
                location.reload();
                return;
            }

            // Nothing matches: show the desktop.
            showBareDesktop();
        };

        // Content pages are only known once the lazily fetched index is in.
        // History is not kept frozen for the download: whatever the visitor
        // focuses or closes meanwhile is recorded as usual, and the reopen is
        // dropped if they have moved on by the time the index arrives.
        if (!searchIndexLoaded && !(targetId && appMetadata.has(targetId))) {
            release();
            const resume = () => {
                if (seq !== popstateSeq || pendingCloseBacks > 0 ||
                    location.pathname + location.search !== current) return;
                suppressHistory = true;
                reopen();
            };
            loadSearchIndex().then(resume, resume);
        } else {
            reopen();
        }
    });

    function deactivateAllWindows() {
        document.querySelectorAll('.window').forEach(w => {
            w.classList.add('inactive');
        });
    }

    // Window Dragging
    // Pointer Events with capture: the titlebar keeps receiving moves and the
    // release even when the pointer crosses an embedded iframe. Geometry is
    // measured once at pointerdown, moves are coalesced to one transform write
    // per frame, and left/top are committed when the gesture ends.
    function setupWindowDrag(win) {
        const titlebar = win.querySelector('.window-titlebar');
        if (!titlebar) return;

        let drag = null;
        let frame = 0;

        const render = () => {
            frame = 0;
            if (!drag) return;
            win.style.transform = `translate3d(${drag.left - drag.startLeft}px, ${drag.top - drag.startTop}px, 0)`;
        };

        // Compact layouts: there is nowhere to drag a fullscreen window to, so
        // a touch drag down on the titlebar sends it to the tray instead.
        let swipe = null;

        const endSwipe = (e) => {
            if (!swipe || e.pointerId !== swipe.pointerId) return;
            const dy = swipe.dy;
            swipe = null;
            win.style.transition = '';
            win.style.transform = '';
            win.style.opacity = '';
            if (e.type === 'pointerup' && dy > 90) minimizeWindow(win, win.dataset.windowId);
        };

        titlebar.addEventListener('pointerdown', (e) => {
            if (drag || swipe || (e.pointerType === 'mouse' && e.button !== 0)) return;

            // A control in the titlebar (including ones apps add, like the
            // Terminal's state menu) keeps its click: capturing the pointer
            // would retarget it to the titlebar.
            if (e.target.closest('.traffic-light, .titlebar-link, .titlebar-back, ' +
                'button, a[href], input, select, textarea, label, [role="button"], [role="menu"], .v86-toolbar')) {
                return;
            }

            // Compact layouts are fullscreen. Checked per gesture, so a window
            // opened on a narrow viewport can be dragged once it widens.
            if (isCompactViewport()) {
                if (e.pointerType === 'mouse') return;
                swipe = { pointerId: e.pointerId, startY: e.clientY, dy: 0 };
                try { titlebar.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
                return;
            }

            bringToFront(win);
            win.classList.remove('zooming');

            const bounds = getDesktopBounds();
            const width = win.offsetWidth;
            const visibleGrip = Math.min(80, width);

            drag = {
                pointerId: e.pointerId,
                startX: e.clientX,
                startY: e.clientY,
                startLeft: win.offsetLeft,
                startTop: win.offsetTop,
                left: win.offsetLeft,
                top: win.offsetTop,
                moved: false,
                // Keep window on screen
                minLeft: -(width - visibleGrip),
                maxLeft: bounds.width - visibleGrip,
                maxTop: Math.max(0, bounds.height - 40),
                rightEdge: bounds.width - width,
                centreLeft: Math.round((bounds.width - width) / 2)
            };

            try { titlebar.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
            // Stylesheet hook: makes iframes inert and disables text selection
            document.body.classList.add('is-window-dragging');
        });

        titlebar.addEventListener('pointermove', (e) => {
            if (swipe && e.pointerId === swipe.pointerId) {
                swipe.dy = Math.max(0, e.clientY - swipe.startY);
                // A few pixels of slack so a tap does not twitch the window
                if (swipe.dy > 6) {
                    win.style.transition = 'none';
                    win.style.transform = `translate3d(0, ${swipe.dy}px, 0)`;
                    win.style.opacity = String(Math.max(0.45, 1 - swipe.dy / 400));
                }
                return;
            }
            if (!drag || e.pointerId !== drag.pointerId) return;

            let newLeft = drag.startLeft + (e.clientX - drag.startX);
            let newTop = drag.startTop + (e.clientY - drag.startY);

            newLeft = Math.min(drag.maxLeft, Math.max(drag.minLeft, newLeft));
            newTop = Math.min(drag.maxTop, Math.max(0, newTop));

            // Snap to screen edges and to the horizontal centre when close,
            // unless Alt is held to place freely.
            if (!e.altKey) {
                const SNAP = 12;

                if (Math.abs(newLeft) <= SNAP) newLeft = 0;
                else if (Math.abs(newLeft - drag.rightEdge) <= SNAP) newLeft = drag.rightEdge;
                else if (Math.abs(newLeft - drag.centreLeft) <= SNAP) newLeft = drag.centreLeft;

                if (Math.abs(newTop) <= SNAP) newTop = 0;
            }

            drag.left = newLeft;
            drag.top = newTop;
            drag.moved = true;
            if (!frame) frame = requestAnimationFrame(render);
        });

        const stopDrag = (e) => {
            if (!drag || e.pointerId !== drag.pointerId) return;

            if (frame) {
                cancelAnimationFrame(frame);
                frame = 0;
            }
            if (drag.moved) {
                win.style.transform = '';
                win.style.left = `${drag.left}px`;
                win.style.top = `${drag.top}px`;
            }
            drag = null;
            document.body.classList.remove('is-window-dragging');
        };

        titlebar.addEventListener('pointerup', stopDrag);
        titlebar.addEventListener('pointercancel', stopDrag);
        titlebar.addEventListener('lostpointercapture', stopDrag);
        titlebar.addEventListener('pointerup', endSwipe);
        titlebar.addEventListener('pointercancel', endSwipe);
        titlebar.addEventListener('lostpointercapture', endSwipe);
    }

    // Window Resizing
    function setupWindowResize(win) {
        const resizeHandle = win.querySelector('.window-resize');
        if (!resizeHandle) return;

        // Same approach as dragging: captured pointer, limits measured once
        // at pointerdown, one size write per frame.
        let resize = null;
        let frame = 0;

        const render = () => {
            frame = 0;
            if (!resize) return;
            win.style.width = `${resize.width}px`;
            win.style.height = `${resize.height}px`;
        };

        resizeHandle.addEventListener('pointerdown', (e) => {
            if (resize || (e.pointerType === 'mouse' && e.button !== 0)) return;

            // Compact layouts are fullscreen (checked per gesture, not at setup)
            if (isCompactViewport()) return;

            bringToFront(win);
            win.classList.remove('zooming');

            const bounds = getDesktopBounds();
            const startWidth = win.offsetWidth;
            const startHeight = win.offsetHeight;

            resize = {
                pointerId: e.pointerId,
                startX: e.clientX,
                startY: e.clientY,
                startWidth,
                startHeight,
                width: startWidth,
                height: startHeight,
                maxWidth: Math.max(400, bounds.width - win.offsetLeft),
                maxHeight: Math.max(300, bounds.height - win.offsetTop)
            };

            try { resizeHandle.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
            document.body.classList.add('is-window-dragging');
            e.preventDefault();
        });

        resizeHandle.addEventListener('pointermove', (e) => {
            if (!resize || e.pointerId !== resize.pointerId) return;

            const dx = e.clientX - resize.startX;
            const dy = e.clientY - resize.startY;

            resize.width = Math.min(resize.maxWidth, Math.max(400, resize.startWidth + dx));
            resize.height = Math.min(resize.maxHeight, Math.max(300, resize.startHeight + dy));
            if (!frame) frame = requestAnimationFrame(render);
        });

        const stopResize = (e) => {
            if (!resize || e.pointerId !== resize.pointerId) return;

            if (frame) {
                cancelAnimationFrame(frame);
                render();
            }
            resize = null;
            document.body.classList.remove('is-window-dragging');
        };

        resizeHandle.addEventListener('pointerup', stopResize);
        resizeHandle.addEventListener('pointercancel', stopResize);
        resizeHandle.addEventListener('lostpointercapture', stopResize);
    }

    // Window Controls
    function setupWindowControls(win, id) {
        const closeBtn = win.querySelector('.traffic-light.close');
        const minimizeBtn = win.querySelector('.traffic-light.minimize');
        const maximizeBtn = win.querySelector('.traffic-light.maximize');

        [closeBtn, minimizeBtn, maximizeBtn].forEach(btn => {
            if (!btn) return;
            btn.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    btn.click();
                }
            });
        });

        // A window can be re-pointed at another page (Previous / Next), which
        // changes its id: read it at click time
        const currentId = () => win.dataset.windowId || id;

        closeBtn.addEventListener('click', () => closeWindow(win, currentId()));

        minimizeBtn.addEventListener('click', () => minimizeWindow(win, currentId()));

        maximizeBtn.addEventListener('click', (e) => {
            // Option-click the green light for real full screen, as on a Mac
            if (e.altKey && canGoFullscreen(currentId())) toggleFullscreen(win);
            else toggleZoom(win);
        });

        const fullscreenBtn = win.querySelector('.titlebar-fullscreen');
        if (fullscreenBtn) fullscreenBtn.addEventListener('click', () => toggleFullscreen(win));

        const shareBtn = win.querySelector('.titlebar-share');
        if (shareBtn) {
            shareBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleSharePopover(shareBtn, win);
            });
        }

        // Double-click the titlebar to zoom, as on a real Mac
        const titlebar = win.querySelector('.window-titlebar');
        if (titlebar) {
            titlebar.addEventListener('dblclick', (e) => {
                if (e.target.closest('.traffic-light') || e.target.closest('.titlebar-link')) return;
                toggleZoom(win);
            });
        }

        // Click on window brings to front
        win.addEventListener('mousedown', () => {
            bringToFront(win);
        });
    }

    function toggleZoom(win) {
        // The stylesheet's .zooming rule transitions the geometry change;
        // it must be gone again before a drag or resize writes sizes per frame
        if (!prefersReducedMotion()) {
            win.classList.add('zooming');
            clearTimeout(win._zoomTimer);
            win._zoomTimer = setTimeout(() => win.classList.remove('zooming'), 260);
        }

        if (win.dataset.maximized === 'true') {
            // Restore
            win.style.left = win.dataset.restoreLeft;
            win.style.top = win.dataset.restoreTop;
            win.style.width = win.dataset.restoreWidth;
            win.style.height = win.dataset.restoreHeight;
            win.dataset.maximized = 'false';
        } else {
            // Maximize
            win.dataset.restoreLeft = win.style.left;
            win.dataset.restoreTop = win.style.top;
            win.dataset.restoreWidth = win.style.width;
            win.dataset.restoreHeight = win.style.height;

            win.style.left = '0';
            win.style.top = '0';
            win.style.width = '100%';
            win.style.height = '100%';
            win.style.transform = '';
            win.dataset.maximized = 'true';
        }
    }

    // Finder Items - SINGLE CLICK to open
    function setupFinderItems(win) {
        const items = win.querySelectorAll('.finder-item, .finder-row, .blog-row');
        items.forEach(item => {
            if (item.dataset.boundFinderItem === 'true') return;
            item.dataset.boundFinderItem = 'true';

            // Anchor for multiplayer cursors. Applied only to live windows, so a
            // peer pointing at a list row lands on the same row for everyone -
            // and it survives each viewer scrolling the list independently.
            const anchorKey = item.dataset.permalink || item.dataset.window;
            if (anchorKey && !item.dataset.cursorAnchor) {
                item.dataset.cursorAnchor = 'item:' + anchorKey;
            }

            item.addEventListener('click', (e) => {
                // If it's a focusable item, allow click
                const windowId = item.dataset.window;
                const title = item.dataset.title;
                const permalink = item.dataset.permalink;

                if (windowId && title) {
                    // Rows may be real links: open a window for a plain click,
                    // leave Cmd/Ctrl/Shift and middle clicks to the browser.
                    if (isModifiedClick(e)) return;
                    e.preventDefault();
                    // Previous / Next page through the same window, like
                    // turning a page, instead of stacking up a new one each time
                    if (permalink && item.matches('.post-navigation .nav-link') && canNavigateInPlace(win)) {
                        navigateWindow(win, windowId, title, permalink);
                        return;
                    }
                    openWindow(windowId, title, { width: 900, height: 650 }, permalink, item);
                }
            });

            // Allow Enter key to trigger click for accessibility
            item.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    item.click();
                }
            });

            // Fetch the page as soon as the visitor shows intent
            if (item.dataset.window && item.dataset.permalink) {
                const warm = () => schedulePrefetch(item.dataset.window, item.dataset.permalink);
                item.addEventListener('pointerenter', warm);
                item.addEventListener('focus', warm);
            }
        });

        // Also handle calendar tooltip events
        const calendarEvents = win.querySelectorAll('.tooltip-event');
        calendarEvents.forEach(event => {
            event.addEventListener('click', (e) => {
                e.stopPropagation();
                const windowId = event.dataset.window;
                const title = event.dataset.title;
                const permalink = event.dataset.permalink;

                if (windowId && title) {
                    openWindow(windowId, title, { width: 900, height: 650 }, permalink);
                }
            });
        });
    }

    // ================================================
    // Paging a content window (Previous / Next)
    // ================================================

    /** Content windows only: apps keep their identity. */
    function canNavigateInPlace(win) {
        const id = win && win.dataset.windowId;
        return !!id && openWindows.get(id) === win && !!win._session &&
            !!win._session.permalink && !isAppId(id) && !!win.querySelector('.window-content');
    }

    /** Point an open content window at another page: new id, title, URL and body. */
    function navigateWindow(win, id, title, permalink) {
        const path = pathOf(permalink);

        // Already open elsewhere: go there rather than showing it twice
        const other = (openWindows.has(id) && openWindows.get(id) !== win)
            ? openWindows.get(id)
            : [...openWindows.values()].find(
                w => w !== win && w.dataset.path === path && !w.classList.contains('closing'));
        if (other) {
            other._urlSilent = false;
            restoreWindow(other);
            bringToFront(other);
            return;
        }

        const oldId = win.dataset.windowId;
        if (oldId !== id) {
            // A window can only be paged while it is on screen, but be safe:
            // its chip and Dock tile are keyed by the id it is about to lose
            if (win._inTray) restoreWindow(win);
            if (openWindows.get(oldId) === win) openWindows.delete(oldId);
            openWindows.set(id, win);
            win.dataset.windowId = id;
            win.dataset.cursorAnchor = 'win:' + id;
        }
        // The pages this window has turned through: Back and Forward between
        // them turn the page here instead of opening a second window
        if (!win._pagedPaths) win._pagedPaths = new Set([win.dataset.path]);
        win._pagedPaths.add(path);
        win.dataset.path = path;
        win._urlSilent = false;
        win._paged = true;
        win._session = Object.assign({}, win._session, { title, permalink });

        const titleEl = win.querySelector('.window-title');
        const titleText = win.querySelector('.window-title-text');
        if (titleText) titleText.textContent = title;
        if (titleEl) {
            const oldIcon = titleEl.querySelector('.app-icon');
            if (oldIcon) oldIcon.remove();
            const iconHtml = getWindowIconHtml(id, path);
            if (iconHtml) titleEl.insertAdjacentHTML('afterbegin', iconHtml);
        }

        const winContent = win.querySelector('.window-content');
        // The Previous / Next link that was activated is about to be replaced
        const pagedFromInside = winContent.contains(document.activeElement);
        winContent.innerHTML = WINDOW_LOADER_HTML;
        winContent.scrollTop = 0;
        if (pagedFromInside) focusWindow(win);

        // A page turned is a step Back can undo
        syncUrlToWindow(win, true);
        bringToFront(win);
        track('window_opened', { id, source: 'paging' });
        loadWindowContent(win, permalink);
    }

    // ================================================
    // Share
    // One popover for every window that has a URL: copy the link, hand it to
    // the system share sheet, post it, or open it in a tab.
    // ================================================

    const SHARE_ICON = '<svg width="13" height="14" viewBox="0 0 16 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 7H3.5A1.5 1.5 0 0 0 2 8.5v6A1.5 1.5 0 0 0 3.5 16h9a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 12.5 7H11"/><path d="M8 11V1.5"/><path d="M5 4.2 8 1.5l3 2.7"/></svg>';

    let sharePopover = null;

    function closeSharePopover() {
        if (!sharePopover) return;
        if (sharePopover._button) sharePopover._button.setAttribute('aria-expanded', 'false');
        sharePopover.remove();
        sharePopover = null;
    }

    /** Clipboard write that also works where the async API is missing or refused. */
    function copyText(text) {
        const fallback = () => new Promise((resolve, reject) => {
            const area = document.createElement('textarea');
            area.value = text;
            area.setAttribute('readonly', '');
            area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
            document.body.appendChild(area);
            area.select();
            let ok = false;
            try { ok = document.execCommand('copy'); } catch (e) { /* not allowed */ }
            area.remove();
            if (ok) resolve();
            else reject(new Error('copy failed'));
        });
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text).catch(fallback);
        }
        return fallback();
    }

    /**
     * @param {HTMLElement} button  the control that was pressed
     * @param {HTMLElement} win     a desktop window, or the static window of an article page
     */
    function toggleSharePopover(button, win) {
        if (sharePopover && sharePopover._button === button) {
            closeSharePopover();
            return;
        }
        closeSharePopover();

        // A desktop window shares its own page; a static window is the page
        const path = win.dataset.path;
        const url = path
            ? new URL(path, window.location.origin).href
            : window.location.origin + window.location.pathname + window.location.search;
        const title = windowTitleOf(win).trim();
        const via = ((document.querySelector('meta[name="twitter:site"]') || {}).content || '').replace(/^@/, '');
        const postUrl = 'https://x.com/intent/post?text=' + encodeURIComponent(title) +
            '&url=' + encodeURIComponent(url) + (via ? '&via=' + encodeURIComponent(via) : '');

        const pop = document.createElement('div');
        pop.className = 'share-popover';
        pop.setAttribute('role', 'menu');
        pop.setAttribute('aria-label', 'Share');
        pop.innerHTML = `
            <button type="button" class="share-item" role="menuitem" data-share="copy">Copy Link</button>
            ${navigator.share ? '<button type="button" class="share-item" role="menuitem" data-share="native">Share…</button>' : ''}
            <a class="share-item" role="menuitem" data-share="x" data-open="tab" target="_blank" rel="noopener" href="${escapeHtml(postUrl)}">Post on X</a>
            <a class="share-item" role="menuitem" data-share="tab" data-open="tab" target="_blank" rel="noopener" href="${escapeHtml(url)}">Open in New Tab</a>
        `;
        pop._button = button;

        pop.addEventListener('click', (e) => {
            const item = e.target.closest('[data-share]');
            if (!item) return;
            const method = item.dataset.share;
            track('share', { method, path: path || window.location.pathname });

            if (method === 'copy') {
                copyText(url).then(() => {
                    showNotification({ title: 'Link Copied', message: url, duration: 2500, sound: false });
                }, () => {
                    showNotification({ title: 'Could not copy the link', message: url, duration: 6000, sound: false });
                });
            } else if (method === 'native') {
                navigator.share({ title, url }).catch(() => { /* cancelled */ });
            }
            // The two links are ordinary new-tab anchors
            closeSharePopover();
        });

        document.body.appendChild(pop);
        sharePopover = pop;
        button.setAttribute('aria-expanded', 'true');

        // Under the button, right edges aligned, kept on screen
        const rect = button.getBoundingClientRect();
        const width = pop.offsetWidth;
        const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width));
        pop.style.left = `${left}px`;
        pop.style.top = `${rect.bottom + 6}px`;

        const first = pop.querySelector('.share-item');
        if (first) first.focus({ preventScroll: true });
    }

    // Anything outside the popover dismisses it (a drag never fires click)
    document.addEventListener('pointerdown', (e) => {
        if (!sharePopover) return;
        if (sharePopover.contains(e.target) || e.target.closest('.titlebar-share') === sharePopover._button) return;
        closeSharePopover();
    }, true);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sharePopover) {
            const button = sharePopover._button;
            closeSharePopover();
            if (button) button.focus();
        }
    });
    window.addEventListener('resize', closeSharePopover);

    // ================================================
    // Full screen
    // The green light only fills the desktop. Games, Doom and the terminal
    // can also take the whole display: Option-click the green light, or use
    // the titlebar button.
    // ================================================

    const FULLSCREEN_ICON = '<svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8.5 1.5H12.5V5.5"/><path d="M5.5 12.5H1.5V8.5"/><path d="M12.5 1.5 8.2 5.8"/><path d="M1.5 12.5l4.3-4.3"/></svg>';

    function canGoFullscreen(id) {
        if (!document.documentElement.requestFullscreen || document.fullscreenEnabled === false) return false;
        return id === 'terminal' || id === 'portal' || id === 'doom' || id === 'quake3' ||
            id === 'itch-game' || id.startsWith('flash-');
    }

    function toggleFullscreen(win) {
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => { /* already leaving */ });
            return;
        }
        // The window body, so the game fills the display without the titlebar
        const target = win.querySelector('.window-content');
        if (!target || !target.requestFullscreen) return;

        target.requestFullscreen().then(() => {
            // Where the browser allows it, let the game have Esc (leave by
            // holding it); elsewhere Esc simply exits full screen
            if (navigator.keyboard && navigator.keyboard.lock) {
                navigator.keyboard.lock(['Escape']).catch(() => { /* not granted */ });
            }
            track('fullscreen', { id: win.dataset.windowId });
        }).catch(() => { /* refused: stay windowed */ });
    }

    document.addEventListener('fullscreenchange', () => {
        const el = document.fullscreenElement;
        const win = el && el.closest ? el.closest('.window') : null;

        if (!el && navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock();

        // The ambient mix stays out of anything running full screen
        fullscreenHold = !!win;
        updateAmbientHold();

        document.querySelectorAll('.titlebar-fullscreen').forEach(btn => {
            const active = !!win && win.contains(btn);
            btn.setAttribute('aria-label', active ? 'Exit full screen' : 'Enter full screen');
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    });

    // ================================================
    // Article furniture
    // Code blocks get a language label and a Copy button. Done here rather
    // than in a render hook so Hugo's own highlighter output stays untouched.
    // ================================================

    function decorateContent(root) {
        if (!root) return;
        root.querySelectorAll('.highlight').forEach(block => {
            if (block.querySelector(':scope > .code-tools')) return;
            const code = block.querySelector('pre code');
            if (!code) return;

            const tools = document.createElement('div');
            tools.className = 'code-tools';

            const lang = code.getAttribute('data-lang') || '';
            if (lang && lang !== 'fallback' && lang !== 'text') {
                const label = document.createElement('span');
                label.className = 'code-lang';
                label.textContent = lang;
                tools.appendChild(label);
            }

            const copy = document.createElement('button');
            copy.type = 'button';
            copy.className = 'code-copy';
            copy.textContent = 'Copy';
            copy.setAttribute('aria-label', 'Copy code');
            tools.appendChild(copy);

            block.appendChild(tools);
        });
    }

    // One listener for every Copy button, including those in windows whose
    // markup was cloned from an already decorated page
    document.addEventListener('click', (e) => {
        const button = e.target.closest ? e.target.closest('.code-copy') : null;
        if (!button) return;
        const block = button.closest('.highlight');
        // With line numbers on, the code is the last <code> in the block
        const codes = block ? block.querySelectorAll('pre code') : [];
        const code = codes[codes.length - 1];
        if (!code) return;

        const done = (label) => {
            button.textContent = label;
            button.classList.toggle('copied', label === 'Copied');
            clearTimeout(button._resetTimer);
            button._resetTimer = setTimeout(() => {
                button.textContent = 'Copy';
                button.classList.remove('copied');
            }, 1600);
        };
        copyText(code.textContent.replace(/\n$/, '')).then(() => done('Copied'), () => done('Failed'));
    });

    // Expose openWindow globally for calendar view and other modules
    window.openWindow = openWindow;

    /**
     * The shell's public surface for scripts that extend the desktop
     * (assets/js/desktop-personal.js is the first). Feature-detect it: it is
     * only there once this file has run.
     */
    window.SiteShell = {
        isDesktop: IS_DESKTOP,
        isCompact: isCompactViewport,
        compactQuery: COMPACT_QUERY,
        prefersReducedMotion,
        /** { id, title, size, permalink } for an app id or alias, else null */
        resolveApp,
        /** Open (or focus) an app by id; `origin` is the element the window grows out of */
        openApp(id, origin, source) {
            const app = resolveApp(id);
            if (!app) return false;
            openWindowFrom(source || 'other', app.id, app.title, app.size, app.permalink, origin || null);
            return true;
        },
        isOpen: (id) => openWindows.has(id),
        /** App icon markup in one of the app-icon size contexts (spotlight, grid, chrome, dock) */
        iconHtml(id, context) {
            const meta = appMetadata.get(id);
            const html = (meta && meta.iconHtml) || '';
            return context && context !== 'spotlight' ? html.replace('app-icon-spotlight', 'app-icon-' + context) : html;
        },
        openPreferences,
        hasPreferences: () => !!resolveApp('preferences'),
        openSearch: () => { if (!document.getElementById('spotlight-overlay')) toggleSpotlight(); },
        openShortcuts: () => window.openShortcuts(),
        /** Floating menu: see showContextMenu() for the item and option shapes */
        showMenu: showContextMenu,
        closeMenu: closeContextMenu,
        getInfo: (id) => openInfoWindow(id, openWindows.get(id) || null),
        /** A dot on an app's Dock and desktop icons */
        setBadge: setAppBadge,
        isDockVisible,
        escapeHtml,
        formatShortcut,
        /** Notification Center banner: { title, message, iconHtml, duration, onClick, onDismiss, sound } */
        notify: (options) => showNotification(options),
        menubarHeight: getMenubarHeight
    };
    window.openContentWindow = function (windowId, title, permalink) {
        openWindow(windowId, title, { width: 900, height: 650 }, permalink);
    };

    // Listen for custom event from calendar view
    window.addEventListener('openContentWindow', function (e) {
        const { windowId, title, permalink } = e.detail;
        if (windowId && title) {
            openWindow(windowId, title, { width: 900, height: 650 }, permalink);
        }
    });

    // ================================================
    // Static windows
    // Article and section pages render one server-side window. Its close
    // light is already a link home; give the other two something to do.
    // ================================================

    function setupStaticWindows() {
        document.querySelectorAll('.static-window').forEach(staticWin => {
            const minimizeBtn = staticWin.querySelector('.traffic-light.minimize');
            const zoomBtn = staticWin.querySelector('.traffic-light.maximize');
            const closeLink = staticWin.querySelector('a.traffic-light.close');
            const home = (closeLink && closeLink.getAttribute('href')) || '/';

            const toggle = () => {
                const zoomed = staticWin.classList.toggle('zoomed');
                if (zoomBtn) zoomBtn.setAttribute('aria-pressed', zoomed ? 'true' : 'false');
            };

            // <div role="button"> needs keyboard activation; real links and
            // buttons already have it.
            const bind = (btn, action) => {
                if (!btn || btn.getAttribute('aria-disabled') === 'true') return;
                const native =btn.tagName === 'A' || btn.tagName === 'BUTTON';
                btn.addEventListener('click', (e) => {
                    if (btn.tagName === 'A' && btn.getAttribute('href')) return; // let the link navigate
                    e.preventDefault();
                    action();
                });
                if (!native) {
                    btn.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            action();
                        }
                    });
                }
            };

            // There is nowhere to minimise to: carry this page over to the
            // desktop as a window (close, the red light, goes to the bare desktop)
            const token = openTokenForPath(window.location.pathname);
            const onDesktop = token
                ? home.replace(/\/?$/, '/') + '?open=' + encodeURIComponent(token).replace(/%2F/gi, '/')
                : home;
            if (minimizeBtn && !minimizeBtn.classList.contains('is-disabled')) {
                if (minimizeBtn.tagName === 'A') minimizeBtn.setAttribute('href', onDesktop);
                minimizeBtn.setAttribute('aria-label', 'Open on the desktop');
                minimizeBtn.dataset.tip = 'Open on the desktop';
            }
            bind(minimizeBtn, () => { window.location.href = onDesktop; });
            bind(zoomBtn, toggle);

            // The titlebar arrow opens this same page in another tab, which
            // helps nobody. With JS it becomes the Share control instead
            // (which still offers "Open in New Tab"); without, it stays a link.
            const shareBtn = staticWin.querySelector('.titlebar-share, a.titlebar-link');
            if (shareBtn) {
                shareBtn.classList.add('titlebar-share');
                shareBtn.setAttribute('aria-label', 'Share');
                shareBtn.setAttribute('aria-haspopup', 'menu');
                if (shareBtn.tagName === 'A') shareBtn.setAttribute('role', 'button');
                shareBtn.dataset.tip = 'Share';
                shareBtn.innerHTML = SHARE_ICON;
                shareBtn.addEventListener('click', (e) => {
                    if (isModifiedClick(e)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    toggleSharePopover(shareBtn, staticWin);
                });
            }

            // Double-click the titlebar to zoom, as in live windows
            const titlebar = staticWin.querySelector('.window-titlebar');
            if (titlebar) {
                titlebar.addEventListener('dblclick', (e) => {
                    if (e.target.closest('.traffic-light') || e.target.closest('a')) return;
                    toggle();
                });
            }
        });
    }

    // ================================================
    // Notification System - macOS Mavericks Style
    // ================================================

    let notificationContainer = null;
    let audioContext = null;

    // ================================================
    // Modal Sheets - replaces native alert()/confirm()
    // A Chrome-branded dialog on top of a fake desktop breaks the illusion
    // harder than anything else on the page.
    // ================================================

    /**
     * @param {Object} opts
     * @param {string} opts.title
     * @param {string} [opts.message]
     * @param {string} [opts.confirmLabel]  defaults to "OK"
     * @param {string} [opts.cancelLabel]   omit for a single-button alert
     * @param {boolean} [opts.danger]       style the confirm button as destructive
     * @returns {Promise<boolean>} true when confirmed, false when cancelled
     */
    function showSheet(opts) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'sheet-overlay';
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');

            const hasCancel = typeof opts.cancelLabel === 'string';

            overlay.innerHTML = `
                <div class="sheet">
                    <div class="sheet-body">
                        <div class="sheet-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="12" y1="8" x2="12" y2="13"></line>
                                <line x1="12" y1="16.5" x2="12" y2="16.5"></line>
                            </svg>
                        </div>
                        <div class="sheet-text">
                            <h2 class="sheet-title"></h2>
                            <p class="sheet-message"></p>
                        </div>
                    </div>
                    <div class="sheet-actions">
                        ${hasCancel ? '<button type="button" class="sheet-btn" data-act="cancel"></button>' : ''}
                        <button type="button" class="sheet-btn primary${opts.danger ? ' danger' : ''}" data-act="confirm"></button>
                    </div>
                </div>
            `;

            // textContent, never innerHTML - messages can carry user-supplied nicknames
            overlay.querySelector('.sheet-title').textContent = opts.title || '';
            const messageEl = overlay.querySelector('.sheet-message');
            messageEl.textContent = opts.message || '';
            messageEl.hidden = !opts.message;

            const confirmBtn = overlay.querySelector('[data-act="confirm"]');
            confirmBtn.textContent = opts.confirmLabel || 'OK';
            const cancelBtn = overlay.querySelector('[data-act="cancel"]');
            if (cancelBtn) cancelBtn.textContent = opts.cancelLabel;

            // Restore focus to whatever opened the sheet
            const previouslyFocused = document.activeElement;

            function close(result) {
                document.removeEventListener('keydown', onKey, true);
                overlay.classList.remove('visible');
                setTimeout(() => {
                    overlay.remove();
                    if (previouslyFocused && previouslyFocused.focus) {
                        try { previouslyFocused.focus(); } catch (e) { /* ignore */ }
                    }
                }, 150);
                resolve(result);
            }

            function onKey(e) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    close(false);
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    close(true);
                } else if (e.key === 'Tab') {
                    // Trap focus inside the sheet
                    const focusables = overlay.querySelectorAll('.sheet-btn');
                    if (!focusables.length) return;
                    const first = focusables[0];
                    const last = focusables[focusables.length - 1];
                    if (e.shiftKey && document.activeElement === first) {
                        e.preventDefault();
                        last.focus();
                    } else if (!e.shiftKey && document.activeElement === last) {
                        e.preventDefault();
                        first.focus();
                    }
                }
            }

            confirmBtn.addEventListener('click', () => close(true));
            if (cancelBtn) cancelBtn.addEventListener('click', () => close(false));
            overlay.addEventListener('mousedown', (e) => {
                // Click the dimmed backdrop to dismiss
                if (e.target === overlay) close(false);
            });
            document.addEventListener('keydown', onKey, true);

            document.body.appendChild(overlay);
            requestAnimationFrame(() => {
                overlay.classList.add('visible');
                confirmBtn.focus();
            });
        });
    }

    function showAlert(title, message) {
        return showSheet({ title: title, message: message, confirmLabel: 'OK' });
    }

    function showConfirm(title, message, opts) {
        return showSheet({
            title: title,
            message: message,
            confirmLabel: (opts && opts.confirmLabel) || 'OK',
            cancelLabel: (opts && opts.cancelLabel) || 'Cancel',
            danger: !!(opts && opts.danger)
        });
    }

    window.showSheet = showSheet;
    window.showAlert = showAlert;
    window.showConfirm = showConfirm;

    function ensureNotificationContainer() {
        if (!notificationContainer) {
            notificationContainer = document.createElement('div');
            notificationContainer.id = 'notification-container';
            // Announced politely as they arrive, and findable as a landmark
            notificationContainer.setAttribute('role', 'region');
            notificationContainer.setAttribute('aria-label', 'Notifications');
            notificationContainer.setAttribute('aria-live', 'polite');
            notificationContainer.setAttribute('aria-relevant', 'additions');
            document.body.appendChild(notificationContainer);
        }
        return notificationContainer;
    }

    // ================================================
    // Sound effects preference
    // One switch for the shell's own sounds (notification chime, startup
    // chord, error bonk, Konami jingle). Music has its own controls.
    // ================================================

    function isMuted() {
        return SiteStore.get(SOUND_KEY) === 'off';
    }

    function setMuted(muted) {
        if (muted) SiteStore.set(SOUND_KEY, 'off');
        else SiteStore.remove(SOUND_KEY);
        updateSoundToggle();
        document.dispatchEvent(new CustomEvent('site-sound-change', { detail: { muted: !!muted } }));
    }

    window.SiteSound = {
        isMuted,
        setMuted,
        toggle() { setMuted(!isMuted()); return isMuted(); }
    };

    const SOUND_ICON_ON = '<svg width="15" height="14" viewBox="0 0 18 16" fill="none" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="white"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5"/><path d="M13.2 3.3a6.5 6.5 0 0 1 0 9.4"/></svg>';
    const SOUND_ICON_OFF = '<svg width="15" height="14" viewBox="0 0 18 16" fill="none" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="white"/><path d="M11.5 6l4 4"/><path d="M15.5 6l-4 4"/></svg>';

    function updateSoundToggle() {
        const btn = document.getElementById('menubar-sound');
        if (!btn) return;
        const muted = isMuted();
        btn.innerHTML = muted ? SOUND_ICON_OFF : SOUND_ICON_ON;
        btn.setAttribute('aria-pressed', muted ? 'true' : 'false');
        btn.setAttribute('aria-label', muted ? 'Sound effects off' : 'Sound effects on');
        btn.dataset.tip = muted ? 'Sound effects: off' : 'Sound effects: on';
    }

    // People online in the menubar. cursors.js (realtime bundle, loaded when
    // the browser is idle) creates the #online-count button and keeps its
    // text ("3 Online") and label current; the shell only moves it into the
    // #menubar-online slot. The button keeps its listeners, so its reactions
    // popover still opens from it, and the shell drops that popover below the
    // menubar, where cursors.js would otherwise place it above the button.
    // data-count mirrors the number for the compact menubar, which shows the
    // glyph and number only (assets/css/apps/desktop-online.css).
    function setupOnlineInMenubar() {
        const slot = document.getElementById('menubar-online');
        if (!slot) return;

        const placePopover = (pill) => {
            const pop = document.getElementById('reactions-popover');
            if (!pop || pop.hidden || !slot.contains(pill)) return;
            const r = pill.getBoundingClientRect();
            const bar = slot.closest('.menubar');
            const top = (bar ? bar.getBoundingClientRect().bottom : r.bottom) + 3;
            const width = pop.offsetWidth;
            const left = Math.max(4, Math.min(Math.round(r.left), window.innerWidth - width - 4));
            pop.style.bottom = 'auto';
            pop.style.top = Math.round(top) + 'px';
            pop.style.left = left + 'px';
        };

        const adopt = (pill) => {
            if (slot.contains(pill)) return;
            const syncCount = () => {
                const n = parseInt(pill.textContent, 10);
                if (Number.isFinite(n) && n > 0) pill.dataset.count = String(n);
                else delete pill.dataset.count;
            };
            slot.appendChild(pill);
            slot.hidden = false;
            document.documentElement.classList.add('online-in-menubar');
            syncCount();
            new MutationObserver(syncCount).observe(pill, { childList: true, characterData: true, subtree: true });
            // Runs after cursors.js's own click handler, which opened the popover
            pill.addEventListener('click', () => placePopover(pill));
            window.addEventListener('resize', () => placePopover(pill), { passive: true });
        };

        const found = document.getElementById('online-count');
        if (found) {
            adopt(found);
            return;
        }
        // cursors.js appends the button straight to <body>
        const watcher = new MutationObserver(() => {
            const pill = document.getElementById('online-count');
            if (!pill) return;
            watcher.disconnect();
            adopt(pill);
        });
        watcher.observe(document.body, { childList: true });
    }

    /** Menubar speaker. Uses #menubar-sound if the page ships one, else adds it. */
    function setupSoundToggle() {
        let btn = document.getElementById('menubar-sound');
        if (!btn) {
            const right = document.querySelector('.menubar-right');
            if (!right) return;
            btn = document.createElement('button');
            btn.type = 'button';
            btn.id = 'menubar-sound';
            btn.className = 'menubar-icon menubar-sound';
            const before = right.querySelector('#clock');
            right.insertBefore(btn, before && before.previousElementSibling ? before.previousElementSibling : before);
        }
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const muted = window.SiteSound.toggle();
            // Confirm "on" the obvious way
            if (!muted) playNotificationSound();
        });
        updateSoundToggle();
    }

    // Play notification sound using Web Audio API
    function playNotificationSound() {
        if (isMuted()) return;
        try {
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            // Resume context if suspended (due to autoplay policies)
            if (audioContext.state === 'suspended') {
                audioContext.resume();
            }

            const now = audioContext.currentTime;

            // Create a pleasant two-tone chime (like macOS)
            const frequencies = [880, 1318.5]; // A5 and E6 - pleasant interval

            frequencies.forEach((freq, i) => {
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();

                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);

                oscillator.frequency.value = freq;
                oscillator.type = 'sine';

                // Stagger the notes slightly
                const startTime = now + (i * 0.08);

                // Quick attack, gentle decay
                gainNode.gain.setValueAtTime(0, startTime);
                gainNode.gain.linearRampToValueAtTime(0.15, startTime + 0.02);
                gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + 0.4);

                oscillator.start(startTime);
                oscillator.stop(startTime + 0.5);
            });
        } catch (e) {
            // Audio not supported or blocked, fail silently
        }
    }

    /**
     * Show a macOS-style notification
     * @param {Object} options - Notification options
     * @param {string} options.title - Notification title
     * @param {string} options.message - Notification message
     * @param {string} [options.icon] - Icon (emoji or image URL)
     * @param {Function} [options.onClick] - Callback when notification is clicked
     * @param {number} [options.duration] - Auto-dismiss after ms (0 = never)
     * @returns {HTMLElement} The notification element
     */
    function showNotification(options) {
        const container = ensureNotificationContainer();

        const notification = document.createElement('div');
        notification.className = 'notification';

        // Determine icon content
        let iconHtml = '';
        if (options.iconHtml) {
            iconHtml = options.iconHtml;
        } else if (options.icon) {
            if (options.icon.startsWith('http') || options.icon.startsWith('/')) {
                iconHtml = `<span class="app-icon app-icon-notification app-icon-type-image app-icon-fit-contain"><img src="${escapeHtml(options.icon)}" draggable="false" alt=""></span>`;
            } else {
                iconHtml = `<span class="app-icon app-icon-notification app-icon-type-fallback app-icon-fit-contain"><span class="spotlight-generic-icon"></span></span>`;
            }
        }

        // With an action, everything but the close button is one real button,
        // so Enter and Space do what a click does. (Spans: a button may only
        // hold phrasing content.)
        const bodyHtml = `
            <span class="notification-icon" aria-hidden="true">${iconHtml}</span>
            <span class="notification-content">
                <span class="notification-title">${escapeHtml(options.title || '')}</span>
                <span class="notification-message">${escapeHtml(options.message || '')}</span>
            </span>`;

        notification.innerHTML = `
            ${options.onClick
                ? `<button type="button" class="notification-body">${bodyHtml}</button>`
                : `<div class="notification-body">${bodyHtml}</div>`}
            <button type="button" class="notification-close" aria-label="Close notification">
                <span class="notification-close-face" aria-hidden="true">
                    <svg class="notification-close-icon" width="14" height="14" viewBox="0 0 14 14" focusable="false">
                        <path d="M3.5 3.5 L10.5 10.5 M10.5 3.5 L3.5 10.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                    </svg>
                </span>
            </button>
        `;

        // Close button handler
        const closeBtn = notification.querySelector('.notification-close');
        // options.onDismiss: the visitor closed or swiped the notification
        // away (not a timeout, and not a click through to its action)
        notification._onDismiss = typeof options.onDismiss === 'function' ? options.onDismiss : null;
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (notification._onDismiss) notification._onDismiss();
            dismissNotification(notification);
        });

        // Click handler (if provided)
        if (options.onClick) {
            notification.classList.add('clickable');
            notification.addEventListener('click', (e) => {
                if (!e.target.closest('.notification-close')) {
                    options.onClick(e);
                    dismissNotification(notification);
                }
            });
        }

        // Setup swipe-to-dismiss
        setupNotificationSwipe(notification);

        // Add to container
        container.appendChild(notification);

        // Trigger slide-in animation and play sound
        requestAnimationFrame(() => {
            notification.classList.add('visible');

            // Play notification sound (unless muted)
            if (options.sound !== false) {
                playNotificationSound();
            }
        });

        // Auto-dismiss if duration is set. The countdown stops while the
        // pointer or keyboard focus is on the notification, so it cannot
        // vanish while it is being read or reached for.
        if (options.duration && options.duration > 0) {
            let remaining = options.duration;
            let timer = null;
            let startedAt = 0;

            const start = () => {
                if (timer || notification.classList.contains('dismissing')) return;
                startedAt = Date.now();
                timer = setTimeout(() => dismissNotification(notification), remaining);
            };
            const pause = () => {
                if (!timer) return;
                clearTimeout(timer);
                timer = null;
                // Always leave a moment to move away again
                remaining = Math.max(2000, remaining - (Date.now() - startedAt));
            };

            // Mouse only: a touch has no "leave" to restart the countdown
            notification.addEventListener('pointerenter', (e) => {
                if (e.pointerType === 'mouse') pause();
            });
            notification.addEventListener('focusin', pause);
            notification.addEventListener('pointerleave', (e) => {
                if (e.pointerType === 'mouse' && !notification.contains(document.activeElement)) start();
            });
            notification.addEventListener('focusout', () => {
                if (!notification.matches(':hover')) start();
            });
            start();
        }

        return notification;
    }

    function dismissNotification(notification) {
        if (!notification || notification.classList.contains('dismissing')) return;

        notification.classList.add('dismissing');
        notification.classList.remove('visible');

        notification.addEventListener('transitionend', () => {
            notification.remove();
        }, { once: true });

        // Fallback removal
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 400);
    }

    /**
     * Setup swipe-to-dismiss gesture for a notification
     * @param {HTMLElement} notification - The notification element
     */
    function setupNotificationSwipe(notification) {
        let startX = 0;
        let currentX = 0;
        let isDragging = false;

        const onStart = (e) => {
            // Don't interfere with close button
            if (e.target.closest('.notification-close')) return;

            isDragging = true;
            startX = e.clientX || (e.touches && e.touches[0].clientX);
            currentX = startX;

            // Cancel any running animation and remove transition during drag
            notification.style.animation = 'none';
            notification.style.transition = 'none';
            // Force the current position to be translateX(0) since animation is now cancelled
            notification.style.transform = 'translateX(0)';
            notification.style.opacity = '1';

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onEnd);
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('touchend', onEnd);
        };

        const onMove = (e) => {
            if (!isDragging) return;

            currentX = e.clientX || (e.touches && e.touches[0].clientX);
            const deltaX = currentX - startX;

            // Only allow dragging to the right (positive deltaX)
            if (deltaX > 0) {
                notification.style.transform = `translateX(${deltaX}px)`;
                // Fade out as user drags further
                notification.style.opacity = Math.max(0.3, 1 - (deltaX / 200));
            }

            // Prevent scrolling while swiping
            if (e.cancelable) {
                e.preventDefault();
            }
        };

        const onEnd = () => {
            if (!isDragging) return;
            isDragging = false;

            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onEnd);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onEnd);

            const deltaX = currentX - startX;

            // If dragged more than 80px to the right, dismiss
            if (deltaX > 80) {
                if (notification._onDismiss) notification._onDismiss();
                // Animate out
                notification.style.transition = 'transform 0.2s ease-out, opacity 0.2s ease-out';
                notification.style.transform = 'translateX(400px)';
                notification.style.opacity = '0';

                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.remove();
                    }
                }, 200);
            } else {
                // Snap back
                notification.style.transition = 'transform 0.2s ease-out, opacity 0.2s ease-out';
                notification.style.transform = 'translateX(0)';
                notification.style.opacity = '1';
            }
        };

        notification.addEventListener('mousedown', onStart);
        notification.addEventListener('touchstart', onStart, { passive: true });
    }

    // Expose globally
    window.showNotification = showNotification;
    window.dismissNotification = dismissNotification;

    // ================================================
    // Easter Eggs
    // ================================================

    // Konami Code: ↑↑↓↓←→←→BA
    const konamiCode = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
        'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight',
        'KeyB', 'KeyA'];
    let konamiProgress = 0;
    let konamiActivated = false;

    function setupKonamiCode() {
        document.addEventListener('keydown', (e) => {
            // Don't trigger if user is typing in an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            const expectedKey = konamiCode[konamiProgress];
            const pressedKey = e.code;

            if (pressedKey === expectedKey) {
                konamiProgress++;

                if (konamiProgress === konamiCode.length) {
                    konamiProgress = 0;
                    if (!konamiActivated) {
                        activateKonamiEasterEgg();
                    }
                }
            } else {
                konamiProgress = 0;
            }
        });
    }

    function activateKonamiEasterEgg() {
        konamiActivated = true;

        // Play a fun sound
        playKonamiSound();

        // Add rainbow effect to the page
        document.body.classList.add('konami-active');

        // Create floating emojis
        const emojis = ['🎮', '🕹️', '👾', '🚀', '⭐', '🌈', '🎉', '✨'];
        for (let i = 0; i < 30; i++) {
            setTimeout(() => {
                const emoji = document.createElement('div');
                emoji.className = 'konami-emoji';
                emoji.textContent = emojis[Math.floor(Math.random() * emojis.length)];
                emoji.style.cssText = `
                    position: fixed;
                    font-size: ${20 + Math.random() * 30}px;
                    left: ${Math.random() * 100}vw;
                    top: -50px;
                    z-index: 999999;
                    pointer-events: none;
                    animation: konami-fall ${3 + Math.random() * 2}s linear forwards;
                `;
                document.body.appendChild(emoji);

                setTimeout(() => emoji.remove(), 5000);
            }, i * 100);
        }

        // Add the animation keyframes if not present
        if (!document.getElementById('konami-styles')) {
            const style = document.createElement('style');
            style.id = 'konami-styles';
            style.textContent = `
                @keyframes konami-fall {
                    0% { transform: translateY(0) rotate(0deg); opacity: 1; }
                    100% { transform: translateY(110vh) rotate(720deg); opacity: 0; }
                }
                .konami-active {
                    animation: konami-rainbow 2s ease;
                }
                @keyframes konami-rainbow {
                    0% { filter: hue-rotate(0deg); }
                    50% { filter: hue-rotate(180deg); }
                    100% { filter: hue-rotate(0deg); }
                }
            `;
            document.head.appendChild(style);
        }

        // Show notification
        showNotification({
            title: "Cheat Code Activated",
            message: "+30 lives, all weapons unlocked, big head mode enabled!",
            icon: "/icons/gamecube.png",
            duration: 5000,
            sound: false // We already played a sound
        });

        // Remove effect after animation
        setTimeout(() => {
            document.body.classList.remove('konami-active');
            konamiActivated = false;
        }, 2000);
    }

    function playKonamiSound() {
        if (isMuted()) return;
        try {
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (audioContext.state === 'suspended') {
                audioContext.resume();
            }

            const now = audioContext.currentTime;

            // Play a triumphant arpeggio (C-E-G-C)
            const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6

            notes.forEach((freq, i) => {
                const osc = audioContext.createOscillator();
                const gain = audioContext.createGain();

                osc.type = 'square';
                osc.frequency.setValueAtTime(freq, now);
                osc.connect(gain);
                gain.connect(audioContext.destination);

                const startTime = now + (i * 0.1);
                gain.gain.setValueAtTime(0, startTime);
                gain.gain.linearRampToValueAtTime(0.1, startTime + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.3);

                osc.start(startTime);
                osc.stop(startTime + 0.4);
            });
        } catch (e) {
            // Audio not supported or blocked, fail silently
        }
    }

    // ================================================
    // Startup chime
    // The classic Mac boot chord: a big detuned F#/Gb major voicing with a
    // long tail. Plays once per visitor, alongside the boot screen.
    // ================================================

    function playStartupChime() {
        if (isMuted()) return false;
        try {
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (audioContext.state === 'suspended') audioContext.resume();
            if (audioContext.state !== 'running') return false;

            const now = audioContext.currentTime + 0.02;
            const master = audioContext.createGain();

            // Gentle low-pass so the chord reads warm rather than buzzy
            const filter = audioContext.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(1800, now);
            filter.frequency.exponentialRampToValueAtTime(700, now + 2.4);

            master.connect(filter);
            filter.connect(audioContext.destination);

            master.gain.setValueAtTime(0, now);
            master.gain.linearRampToValueAtTime(0.16, now + 0.06);
            master.gain.exponentialRampToValueAtTime(0.0001, now + 2.6);

            // F#3 A#3 C#4 F#4 - slightly detuned pairs give the chorused shimmer
            const voices = [185.00, 233.08, 277.18, 369.99, 554.37];

            voices.forEach((freq) => {
                [-2.5, 2.5].forEach((detune) => {
                    const osc = audioContext.createOscillator();
                    const gain = audioContext.createGain();
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(freq, now);
                    osc.detune.setValueAtTime(detune, now);
                    gain.gain.value = 1 / (voices.length * 2);
                    osc.connect(gain);
                    gain.connect(master);
                    osc.start(now);
                    osc.stop(now + 2.7);
                });
            });

            return true;
        } catch (e) {
            return false;
        }
    }

    function setupStartupChime() {
        // baseof.html sets this before the boot screen renders
        if (!window.__firstBoot) return;

        if (isMuted() || playStartupChime()) return;

        // Autoplay policy blocked it - most browsers require a gesture first.
        // A boot chord only makes sense at boot: take an interaction that
        // comes within a second, and otherwise let it go. (It used to fire on
        // the first click however late, on top of whatever that click did.)
        const stop = () => {
            clearTimeout(expiry);
            document.removeEventListener('pointerdown', onGesture);
            document.removeEventListener('keydown', onGesture);
        };
        const onGesture = () => {
            stop();
            playStartupChime();
        };
        const expiry = setTimeout(stop, 1000);
        document.addEventListener('pointerdown', onGesture);
        document.addEventListener('keydown', onGesture);
    }

    // Error/Bonk sound for error notifications
    function playErrorSound() {
        if (isMuted()) return;
        try {
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (audioContext.state === 'suspended') {
                audioContext.resume();
            }

            const now = audioContext.currentTime;

            // Classic Mac "Sosumi" / bonk style sound
            const osc = audioContext.createOscillator();
            const gain = audioContext.createGain();

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(200, now);
            osc.frequency.exponentialRampToValueAtTime(100, now + 0.1);

            osc.connect(gain);
            gain.connect(audioContext.destination);

            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

            osc.start(now);
            osc.stop(now + 0.2);

            // Add a second lower bonk
            const osc2 = audioContext.createOscillator();
            const gain2 = audioContext.createGain();

            osc2.type = 'triangle';
            osc2.frequency.setValueAtTime(150, now + 0.08);
            osc2.frequency.exponentialRampToValueAtTime(80, now + 0.2);

            osc2.connect(gain2);
            gain2.connect(audioContext.destination);

            gain2.gain.setValueAtTime(0, now);
            gain2.gain.setValueAtTime(0.25, now + 0.08);
            gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

            osc2.start(now + 0.08);
            osc2.stop(now + 0.3);
        } catch (e) {
            // Audio not supported or blocked, fail silently
        }
    }

    // Initialize Konami Code listener
    setupKonamiCode();

    // Expose error sound globally for use in onclick handlers
    window.playErrorSound = playErrorSound;

    // Initialize. Last, so every const above exists by the time init() runs,
    // and tolerant of being loaded after the document has already parsed.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
