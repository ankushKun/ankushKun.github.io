/**
 * macOS X 10.9 Mavericks Window Manager
 */

(function () {
    'use strict';

    // Configuration
    // URL reflects the focused window, so a window can be linked and bookmarked
    // and the browser Back button steps back through them.
    const ENABLE_DEEP_LINKING = true;
    const ENABLE_GUESTBOOK_NOTIFICATION = true; // Nudge unsigned visitors after first interaction
    const GUESTBOOK_SIGNED_KEY = 'guestbook-signed';
    const VISITOR_ID_KEY = 'multiplayer-cursor-id';

    // State
    let windowZIndex = 100;
    let activeWindow = null;
    const openWindows = new Map();
    const windowHistory = [];
    let globalSearchIndex = [];
    const appMetadata = new Map();

    // Initialize
    document.addEventListener('DOMContentLoaded', init);

    function getOrCreateVisitorId() {
        let id = localStorage.getItem(VISITOR_ID_KEY);
        if (!id) {
            id = Math.random().toString(36).slice(2, 11);
            localStorage.setItem(VISITOR_ID_KEY, id);
        }
        return id;
    }

    /** True when this visitor already has a guestbook entry (local flag or Gun). */
    function checkGuestbookSigned(visitorId) {
        return new Promise((resolve) => {
            if (!visitorId) return resolve(false);
            if (localStorage.getItem(GUESTBOOK_SIGNED_KEY) === visitorId) {
                return resolve(true);
            }
            if (!window.SiteGun || !window.SiteGun.paths || !window.SiteGun.paths.apps.guestbook) {
                return resolve(false);
            }

            let settled = false;
            const done = (signed) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(signed);
            };

            const timer = setTimeout(() => done(false), 1500);

            try {
                window.SiteGun.paths.apps.guestbook().get(visitorId).once((data) => {
                    if (data && data.name) {
                        localStorage.setItem(GUESTBOOK_SIGNED_KEY, visitorId);
                        done(true);
                    } else {
                        done(false);
                    }
                });
            } catch (e) {
                done(false);
            }
        });
    }

    function getGuestbookNotificationIconHtml() {
        const iconEl = document.querySelector('.desktop-icon[data-window="guestbook"] .icon-image');
        return iconEl ? iconEl.innerHTML : '';
    }

    async function maybeShowGuestbookNotification() {
        if (openWindows.has('guestbook')) return;

        const visitorId = getOrCreateVisitorId();
        if (localStorage.getItem(GUESTBOOK_SIGNED_KEY) === visitorId) return;

        const signed = await checkGuestbookSigned(visitorId);
        if (signed || openWindows.has('guestbook')) return;

        showNotification({
            title: 'Guestbook',
            message: 'Got a minute? Sign the book before you go.',
            iconHtml: getGuestbookNotificationIconHtml(),
            duration: 8000,
            onClick: () => {
                openWindow('guestbook', 'Guestbook');
            }
        });
    }

    function setupGuestbookNotification() {
        if (!ENABLE_GUESTBOOK_NOTIFICATION) return;

        // Show 2 seconds after first user interaction so the notification sound can play
        let hasTriggered = false;
        const onFirstInteraction = () => {
            if (hasTriggered) return;
            hasTriggered = true;

            document.removeEventListener('click', onFirstInteraction);
            document.removeEventListener('keydown', onFirstInteraction);
            document.removeEventListener('touchstart', onFirstInteraction);

            setTimeout(() => {
                maybeShowGuestbookNotification();
            }, 2000);
        };

        document.addEventListener('click', onFirstInteraction);
        document.addEventListener('keydown', onFirstInteraction);
        document.addEventListener('touchstart', onFirstInteraction);
    }

    function init() {
        setupClock();
        setupDesktopIcons();
        updateTimelineDesktopIconDate();
        scheduleTimelineDesktopIconMidnightRefresh();
        setupDesktopClick();
        setupAppleMenuClose();
        setupDropdownItemClose();
        setupExternalLinks();
        setupKeyboardShortcuts();
        preloadHighResWallpaper();
        lazyLoadImages();
        setupSearchIndex();
        setupStartupChime();

        // Check for deep link or auto-open About Me
        setTimeout(() => {
            const urlParams = new URLSearchParams(window.location.search);
            const openApp = urlParams.get('open');

            if (openApp) {
                let appId = openApp;
                let title = openApp.charAt(0).toUpperCase() + openApp.slice(1);

                // Mapping
                if (appId === 'irc') {
                    appId = 'irc-chat';
                    title = 'IRC Chat';
                } else if (appId === 'games') {
                    title = 'Games';
                }

                openWindow(appId, title);
            } else {
                openWindow('about', 'About Me');
            }
        }, 300);

        setupGuestbookNotification();
    }

    // Preload high-resolution wallpaper
    function preloadHighResWallpaper() {
        const highResImage = new Image();
        highResImage.onload = function () {
            // High-res image loaded, add class to trigger CSS transition
            document.body.classList.add('wallpaper-loaded');
        };
        highResImage.src = '/wallpapers/wallpaper.webp';
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
    function setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            const modKey = e.metaKey || e.ctrlKey;

            // Cmd/Ctrl + W: Close active window
            if (modKey && e.key === 'w') {
                e.preventDefault();
                if (activeWindow) {
                    const id = activeWindow.dataset.windowId;
                    closeWindow(activeWindow, id);
                }
            }

            // Cmd/Ctrl + M: Minimize active window
            if (modKey && e.key === 'm') {
                e.preventDefault();
                if (activeWindow) {
                    const minimizeBtn = activeWindow.querySelector('.traffic-light.minimize');
                    if (minimizeBtn) minimizeBtn.click();
                }
            }

            // Cmd/Ctrl + H: Hide all windows (show desktop).
            // Minimizes into the tray rather than hiding outright, otherwise
            // every open window becomes unreachable.
            if (modKey && e.key === 'h') {
                e.preventDefault();
                openWindows.forEach((win, id) => {
                    if (win.style.display !== 'none') minimizeWindow(win, id);
                });
                deactivateAllWindows();
                activeWindow = null;
                const activeAppName = document.getElementById('active-app-name');
                if (activeAppName) activeAppName.textContent = 'Finder';
            }

            // Cmd/Ctrl + ` (backtick): Cycle through windows
            if (modKey && e.key === '`') {
                e.preventDefault();
                cycleWindows();
            }

            // Cmd/Ctrl + Space: Open Spotlight search
            if (modKey && e.key === ' ') {
                e.preventDefault();
                toggleSpotlight();
            }

            // Escape: Close Spotlight, then any open dropdown
            if (e.key === 'Escape') {
                // Close Spotlight if open
                const spotlight = document.getElementById('spotlight-overlay');
                if (spotlight) {
                    spotlight.remove();
                    return;
                }

                // Close any open dropdowns
                const appleDropdown = document.getElementById('apple-dropdown');
                const finderDropdown = document.getElementById('finder-dropdown');
                if (appleDropdown) appleDropdown.classList.remove('open');
                if (finderDropdown) finderDropdown.classList.remove('open');
                if (typeof window.closeMusicMenu === 'function') window.closeMusicMenu();
            }
        });
    }

    // Cycle through open windows
    function cycleWindows() {
        const windows = Array.from(openWindows.values()).filter(w => w.style.display !== 'none');
        if (windows.length === 0) return;

        if (!activeWindow || !windows.includes(activeWindow)) {
            bringToFront(windows[0]);
            return;
        }

        const currentIndex = windows.indexOf(activeWindow);
        const nextIndex = (currentIndex + 1) % windows.length;
        bringToFront(windows[nextIndex]);
    }

    // Expose Spotlight toggle for menubar click
    window.toggleSpotlightFromMenu = function () {
        toggleSpotlight();
    };

    // Spotlight Search
    function toggleSpotlight() {
        let spotlight = document.getElementById('spotlight-overlay');

        if (spotlight) {
            spotlight.remove();
            return;
        }

        // Create spotlight overlay
        spotlight = document.createElement('div');
        spotlight.id = 'spotlight-overlay';
        spotlight.innerHTML = `
            <div class="spotlight-container">
                <div class="spotlight-search">
                    <svg class="spotlight-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="11" cy="11" r="8"></circle>
                        <path d="m21 21-4.3-4.3"></path>
                    </svg>
                    <input type="text" id="spotlight-input" placeholder="Search..." autocomplete="off" spellcheck="false">
                </div>
                <div class="spotlight-results" id="spotlight-results"></div>
            </div>
        `;
        document.body.appendChild(spotlight);

        // Add styles if not already present
        if (!document.getElementById('spotlight-styles')) {
            const styles = document.createElement('style');
            styles.id = 'spotlight-styles';
            styles.textContent = `
                #spotlight-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.4);
                    display: flex;
                    justify-content: center;
                    align-items: flex-start;
                    padding-top: 20vh;
                    z-index: 100000;
                    animation: spotlightFadeIn 0.15s ease;
                }
                @keyframes spotlightFadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                .spotlight-container {
                    width: 680px;
                    max-width: 90%;
                    background: rgba(30, 30, 30, 0.98);
                    backdrop-filter: blur(40px);
                    -webkit-backdrop-filter: blur(40px);
                    border-radius: 10px;
                    box-shadow: 0 25px 80px rgba(0, 0, 0, 0.6), 
                                0 0 0 1px rgba(255, 255, 255, 0.1),
                                inset 0 1px 0 rgba(255, 255, 255, 0.05);
                    overflow: hidden;
                    animation: spotlightSlideIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
                }
                @keyframes spotlightSlideIn {
                    from { transform: scale(0.96) translateY(-10px); opacity: 0; }
                    to { transform: scale(1) translateY(0); opacity: 1; }
                }
                .spotlight-search {
                    display: flex;
                    align-items: center;
                    padding: 14px 18px;
                    gap: 12px;
                }
                .spotlight-icon {
                    color: rgba(255, 255, 255, 0.5);
                    flex-shrink: 0;
                }
                #spotlight-input {
                    flex: 1;
                    background: transparent;
                    border: none;
                    outline: none;
                    font-size: 20px;
                    color: white;
                    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif;
                    font-weight: 300;
                    letter-spacing: -0.3px;
                }
                #spotlight-input::placeholder {
                    color: rgba(255, 255, 255, 0.35);
                }
                .spotlight-results {
                    max-height: 380px;
                    overflow-y: auto;
                    border-top: 1px solid rgba(255, 255, 255, 0.08);
                }
                .spotlight-results:empty {
                    display: none;
                }
                .spotlight-result {
                    display: flex;
                    align-items: center;
                    padding: 10px 18px;
                    cursor: pointer;
                    transition: background 0.08s;
                    gap: 12px;
                }
                .spotlight-result:hover, .spotlight-result.selected {
                    background: rgba(0, 122, 255, 0.9);
                }
                .spotlight-result-icon {
                    width: 32px;
                    height: 32px;
                    display: grid;
                    place-items: center;
                    flex-shrink: 0;
                }
                .spotlight-result-icon .app-icon {
                    --app-icon-size: 32px;
                }
                .spotlight-generic-icon {
                    width: 22px;
                    height: 26px;
                    border-radius: 3px;
                    background: linear-gradient(180deg, #ffffff, #dfe7ef);
                    border: 1px solid rgba(0, 0, 0, 0.16);
                    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.24);
                    position: relative;
                }
                .spotlight-generic-icon::after {
                    content: "";
                    position: absolute;
                    left: 5px;
                    right: 5px;
                    top: 9px;
                    height: 2px;
                    background: #7ca8d6;
                    box-shadow: 0 5px 0 #a9b6c3, 0 10px 0 #a9b6c3;
                }
                .spotlight-generic-icon.folder {
                    width: 26px;
                    height: 20px;
                    margin-top: 5px;
                    border-radius: 3px;
                    background: linear-gradient(180deg, #78b7ff, #2375d1);
                }
                .spotlight-generic-icon.folder::before {
                    content: "";
                    position: absolute;
                    top: -5px;
                    left: 2px;
                    width: 11px;
                    height: 6px;
                    border-radius: 3px 3px 0 0;
                    background: #5aa0ee;
                }
                .spotlight-generic-icon.folder::after {
                    display: none;
                }
                .spotlight-result-content {
                    flex: 1;
                    min-width: 0;
                }
                .spotlight-result-title {
                    color: white;
                    font-size: 14px;
                    font-weight: 500;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .spotlight-result-type {
                    color: rgba(255, 255, 255, 0.5);
                    font-size: 11px;
                    margin-top: 1px;
                }
                .spotlight-result.selected .spotlight-result-type {
                    color: rgba(255, 255, 255, 0.7);
                }
                .spotlight-no-results {
                    padding: 24px 18px;
                    text-align: center;
                    color: rgba(255, 255, 255, 0.4);
                    font-size: 13px;
                }
                .spotlight-hint {
                    padding: 8px 18px;
                    color: rgba(255, 255, 255, 0.32);
                    font-size: 11px;
                    text-align: center;
                    border-top: 1px solid rgba(255, 255, 255, 0.06);
                }
                .spotlight-section {
                    padding: 8px 18px 4px;
                    color: rgba(255, 255, 255, 0.38);
                    font-size: 10px;
                    font-weight: 600;
                    letter-spacing: 0.6px;
                    text-transform: uppercase;
                }
            `;
            document.head.appendChild(styles);
        }

        // Focus input
        const input = document.getElementById('spotlight-input');
        input.focus();

        // Persistent hint footer (the .spotlight-hint rule existed but nothing
        // ever rendered it)
        const hint = document.createElement('div');
        hint.className = 'spotlight-hint';
        hint.textContent = '↑↓ to navigate · ↵ to open · esc to close';
        spotlight.querySelector('.spotlight-container').appendChild(hint);

        const getIconHtml = (item) => {
            if (item.iconHtml) return item.iconHtml;
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
            const apps = globalSearchIndex.filter(i => i.openWindow && i.type === 'app').slice(0, 4);
            const rest = globalSearchIndex
                .filter(i => !i.openWindow && (i.type === 'blogs' || i.type === 'projects'))
                .slice(0, 4);
            return apps.concat(rest).slice(0, 8).map(decorate);
        }

        // Handle search
        let selectedIndex = -1;

        function runSearch() {
            const query = input.value.toLowerCase().trim();
            const results = query
                ? globalSearchIndex.filter(item =>
                    item.title.toLowerCase().includes(query) ||
                    (item.type && item.type.toLowerCase().includes(query)) ||
                    (item.type && `${item.type}s`.toLowerCase().includes(query)) ||
                    (item.description && item.description.toLowerCase().includes(query)) ||
                    (item.content && item.content.toLowerCase().includes(query))
                ).slice(0, 8).map(decorate)
                : defaultSuggestions();

            renderResults(results, !query);
            selectedIndex = results.length > 0 ? 0 : -1;
            updateSelection();
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
            document.querySelectorAll('.spotlight-result').forEach((el, i) => {
                el.classList.toggle('selected', i === selectedIndex);
            });
        }

        function renderResults(results, isDefault) {
            const container = document.getElementById('spotlight-results');
            if (results.length === 0) {
                container.innerHTML = input.value.trim()
                    ? '<div class="spotlight-no-results">No results found</div>'
                    : '';
                return;
            }
            const heading = isDefault
                ? '<div class="spotlight-section">Suggestions</div>'
                : '';
            container.innerHTML = heading + results.map(item => {
                return `
                <div class="spotlight-result" role="button" tabindex="0" data-window="${escapeHtml(item.windowId)}" data-title="${escapeHtml(item.title)}" data-permalink="${escapeHtml(item.permalink || '')}" data-width="${item.width || 900}" data-height="${item.height || 650}">
                    <span class="spotlight-result-icon">${item.iconHtml}</span>
                    <div class="spotlight-result-content">
                        <div class="spotlight-result-title">${escapeHtml(item.title)}</div>
                        <div class="spotlight-result-type">${escapeHtml(item.type || 'item')}</div>
                    </div>
                </div>
            `}).join('');

            // Add click handlers
            container.querySelectorAll('.spotlight-result').forEach(el => {
                el.addEventListener('click', () => {
                    const windowId = el.dataset.window;
                    const title = el.dataset.title;
                    const permalink = el.dataset.permalink;
                    const width = parseInt(el.dataset.width, 10) || 900;
                    const height = parseInt(el.dataset.height, 10) || 650;
                    spotlight.remove();
                    openWindow(windowId, title, { width, height }, permalink || null);
                });
            });
        }

        // Click outside to close
        spotlight.addEventListener('click', (e) => {
            if (e.target === spotlight) {
                spotlight.remove();
            }
        });

        // Show suggestions immediately rather than an empty panel
        runSearch();
    }

    // Load search index for Spotlight
    function setupSearchIndex() {
        fetch('/index.json')
            .then(r => r.json())
            .then(data => {
                // Apps and content pages are now all in index.json
                globalSearchIndex = data;
                appMetadata.clear();
                data.forEach(item => {
                    if (item.openWindow) appMetadata.set(item.openWindow, item);
                });
            })
            .catch(e => console.error('Failed to load search index', e));
    }

    function getWindowIconHtml(id) {
        const meta = appMetadata.get(id);
        if (!meta) return '';
        return meta.iconHtmlChrome || meta.iconHtml || '';
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

    function getIconForType(type) {
        const t = (type || '').toLowerCase();
        if (t.includes('project') || t.includes('game') || t.includes('app')) return 'folder';
        return 'document';
    }

    /** Sync Timeline desktop calendar icon month/day to the visitor's local date (static Hugo build uses build-time defaults). */
    function updateTimelineDesktopIconDate() {
        const svg = document.querySelector('.desktop-icon[data-window="timeline"] svg');
        if (!svg) return;
        const monthEl = svg.querySelector('#timeline-desktop-cal-month');
        const dayEl = svg.querySelector('#timeline-desktop-cal-day');
        if (!monthEl || !dayEl) return;
        const d = new Date();
        monthEl.textContent = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
        dayEl.textContent = String(d.getDate());
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

        function updateClock() {
            const now = new Date();
            const options = {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            };
            let timeStr = now.toLocaleDateString('en-US', options);

            // Blink the colon on odd seconds
            if (now.getSeconds() % 2 === 1) {
                // Replace the time colon (between hour and minute) with a space
                timeStr = timeStr.replace(/(\d+):(\d{2})/, '$1 $2');
            }

            clock.textContent = timeStr;
        }

        updateClock();
        setInterval(updateClock, 1000);
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
                    const width = parseInt(icon.dataset.width, 10) || 1000;
                    const height = parseInt(icon.dataset.height, 10) || 700;
                    const permalink = icon.dataset.permalink || null;
                    openWindow(windowId, title, { width, height }, permalink);
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
                // Reset menubar to Finder
                const activeAppName = document.getElementById('active-app-name');
                if (activeAppName) activeAppName.textContent = 'Finder';
                resetUrlToDesktop();
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

            const href = link.getAttribute('href');

            // Handle Deep Linking (?open=app)
            if (href && href.includes('?open=')) {
                try {
                    const tempUrl = new URL(href, window.location.origin);
                    const openApp = tempUrl.searchParams.get('open');

                    if (openApp) {
                        // Only intercept if we are on the home page
                        if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
                            e.preventDefault();
                            e.stopPropagation();

                            let appId = openApp;
                            let title = openApp.charAt(0).toUpperCase() + openApp.slice(1);

                            // Mapping optimizations
                            if (appId === 'irc') {
                                appId = 'irc-chat';
                                title = 'IRC Chat';
                            } else if (appId === 'games') {
                                title = 'Games';
                            }

                            openWindow(appId, title);
                        }
                        // If not on home page, let the link navigate (it points to /?open=...)
                        return;
                    }
                } catch (e) {
                    console.error('Deep Link Error:', e);
                }
            }

            // Skip internal links, mailto, tel, and javascript
            if (!href ||
                href.startsWith('#') ||
                href.startsWith('/') ||
                href.startsWith('mailto:') ||
                href.startsWith('tel:') ||
                href.startsWith('javascript:')) {
                return;
            }

            // Check if it's a true external link (starts with http)
            if (href.startsWith('http://') || href.startsWith('https://')) {
                // Ignore same-origin links
                try {
                    if (new URL(href).origin === window.location.origin) return;
                } catch (e) { }

                // Most of the web sends X-Frame-Options/frame-ancestors, and we
                // cannot detect that from script (a cross-origin probe always
                // throws). A block-list was effectively "list the whole web",
                // and anything missed became a permanently blank window.
                // So: new tab by default, embed only what we know embeds.
                const EMBEDDABLE_HOSTS = [
                    'cal.com',
                    'thelongestyard.link',
                    'ankush.one'
                ];

                // Take over the click first, so we never both window.open() and
                // let the browser navigate the current page.
                e.preventDefault();
                e.stopPropagation();

                let host;
                try {
                    host = new URL(href).hostname.replace(/^www\./, '');
                } catch {
                    window.open(href, '_blank', 'noopener');
                    return;
                }

                const embeddable = EMBEDDABLE_HOSTS.some(
                    (allowed) => host === allowed || host.endsWith('.' + allowed)
                );

                if (!embeddable) {
                    window.open(href, '_blank', 'noopener');
                    return;
                }

                openExternalWindow(href, host);
            }
        });
    }

    /** Traffic lights markup (shared by dynamically created windows). */
    function getTrafficLightsMarkup() {
        return `
                <div class="traffic-lights">
                    <div class="traffic-light close" role="button" tabindex="0" aria-label="Close window"><span class="traffic-light-face"><span class="traffic-light-symbol" aria-hidden="true"><svg width="8" height="8" viewBox="0 0 10 10" focusable="false"><path d="M2.5 2.5 L7.5 7.5 M7.5 2.5 L2.5 7.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></span></span></div>
                    <div class="traffic-light minimize" role="button" tabindex="0" aria-label="Minimize window"><span class="traffic-light-face"><span class="traffic-light-symbol" aria-hidden="true"><svg width="8" height="8" viewBox="0 0 10 10" focusable="false"><line x1="2.5" y1="5" x2="7.5" y2="5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></span></span></div>
                    <div class="traffic-light maximize" role="button" tabindex="0" aria-label="Zoom window"><span class="traffic-light-face"><span class="traffic-light-symbol" aria-hidden="true"><svg width="8" height="8" viewBox="0 0 10 10" focusable="false"><line x1="5" y1="2.5" x2="5" y2="7.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="2.5" y1="5" x2="7.5" y2="5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></span></span></div>
                </div>`;
    }

    // Open external URL in iframe window
    function openExternalWindow(url, title) {

        const windowId = 'external-' + Date.now();

        const win = document.createElement('div');
        win.className = 'window external-window';
        win.dataset.windowId = windowId;
        win.dataset.cursorAnchor = 'win:' + windowId;
        // escapeHtml on every interpolation - a bare quote in a URL would
        // otherwise break out of the attribute and mangle the window.
        const safeUrl = escapeHtml(url);
        win.innerHTML = `
            <div class="window-titlebar">
                ${getTrafficLightsMarkup()}
                <div class="window-title"><span class="window-title-text">${escapeHtml(title)}</span></div>
            </div>
            <div class="window-toolbar">
                <div class="url-bar">
                    <span class="url-icon">🔒</span>
                    <span class="url-text">${safeUrl}</span>
                </div>
                <a href="${safeUrl}" target="_blank" rel="noopener" class="open-external" data-tip="Open in new tab">↗</a>
            </div>
            <div class="window-iframe-container">
                <div class="window-loader">
                    <div class="spinner"></div>
                </div>
                <iframe src="${safeUrl}" frameborder="0"></iframe>
                <div class="iframe-blocked-fallback" style="display: none;">
                    <div class="fallback-icon">🚫</div>
                    <h3>This site cannot be displayed in a window</h3>
                    <p>The website blocked embedding for security reasons.</p>
                    <a href="${safeUrl}" target="_blank" rel="noopener" class="fallback-btn open-external">Open in New Tab ↗</a>
                </div>
            </div>
            <div class="window-resize"></div>
        `;

        // Position
        const offsetX = (openWindows.size) * 30;
        const offsetY = (openWindows.size) * 30;
        win.style.left = `${80 + offsetX}px`;
        win.style.top = `${40 + offsetY}px`;
        win.style.width = '1000px';
        win.style.height = '700px';

        document.getElementById('windows-container').appendChild(win);
        openWindows.set(windowId, win);

        const iframe = win.querySelector('iframe');
        const fallback = win.querySelector('.iframe-blocked-fallback');
        const loader = win.querySelector('.window-loader');

        let settled = false;
        const settle = (blocked) => {
            if (settled) return;
            settled = true;
            loader.style.display = 'none';
            if (blocked) {
                iframe.style.display = 'none';
                fallback.style.display = 'flex';
            }
        };

        iframe.addEventListener('load', () => settle(false));
        iframe.addEventListener('error', () => settle(true));

        // Only hosts we already know embed cleanly reach this code path, so a
        // timeout here means "slow", not "blocked" - just retire the spinner.
        // (The old cross-origin contentDocument probe always threw, which made
        // the fallback UI unreachable.)
        setTimeout(() => settle(false), 8000);



        win.classList.add('opening');
        setTimeout(() => win.classList.remove('opening'), 200);

        setupWindowDrag(win);
        setupWindowResize(win);
        setupWindowControls(win, windowId);
        bringToFront(win);
    }

    // Apple Menu Functions
    function setupAppleMenuClose() {
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            const dropdown = document.getElementById('apple-dropdown');
            const appleMenu = document.querySelector('.apple-menu');
            if (dropdown && !appleMenu.contains(e.target)) {
                dropdown.classList.remove('open');
            }

            // Also close Finder dropdown
            const finderDropdown = document.getElementById('finder-dropdown');
            const finderMenu = document.querySelector('.finder-menu');
            if (finderDropdown && finderMenu && !finderMenu.contains(e.target)) {
                finderDropdown.classList.remove('open');
            }
        });
    }

    // Close dropdowns when clicking on dropdown items
    function setupDropdownItemClose() {
        document.addEventListener('click', (e) => {
            // Check if clicked element is a dropdown item
            if (e.target.classList.contains('dropdown-item') || e.target.closest('.dropdown-item')) {
                const appleDropdown = document.getElementById('apple-dropdown');
                const finderDropdown = document.getElementById('finder-dropdown');

                // Close both dropdowns
                if (appleDropdown) appleDropdown.classList.remove('open');
                if (finderDropdown) finderDropdown.classList.remove('open');
            }
        });
    }

    window.toggleAppleMenu = function (e) {
        e.stopPropagation();

        // If click is inside the dropdown, do nothing (let item handlers manage it)
        if (e.target.closest('.apple-dropdown')) return;

        const dropdown = document.getElementById('apple-dropdown');
        if (dropdown) {
            dropdown.classList.toggle('open');
        }
        // Close Finder dropdown
        const finderDropdown = document.getElementById('finder-dropdown');
        if (finderDropdown) finderDropdown.classList.remove('open');
        if (typeof window.closeMusicMenu === 'function') window.closeMusicMenu();
    };

    // Finder Menu - Show open windows
    window.toggleFinderMenu = function (e) {
        e.stopPropagation();

        // If click is inside the dropdown, do nothing
        if (e.target.closest('.finder-dropdown')) return;

        const dropdown = document.getElementById('finder-dropdown');
        if (!dropdown) return;

        // Close Apple dropdown
        const appleDropdown = document.getElementById('apple-dropdown');
        if (appleDropdown) appleDropdown.classList.remove('open');
        if (typeof window.closeMusicMenu === 'function') window.closeMusicMenu();

        // Update windows list before showing
        updateFinderWindowsList();

        dropdown.classList.toggle('open');
    };

    function updateFinderWindowsList() {
        const list = document.getElementById('finder-windows-list');
        if (!list) return;

        if (openWindows.size === 0) {
            list.innerHTML = '<div class="dropdown-item empty">No windows open</div>';
            return;
        }

        let html = '';
        openWindows.forEach((win, id) => {
            const title = win.querySelector('.window-title-text')?.textContent || win.querySelector('.window-title')?.textContent || id;
            const isActive = win === activeWindow;
            const isMinimized = win.classList.contains('minimized') || win.style.display === 'none';
            html += `<div class="dropdown-item window-item ${isActive ? 'active-window' : ''} ${isMinimized ? 'minimized-window' : ''}" data-window-id="${escapeHtml(id)}">
                <span class="window-item-check">${isActive ? '✓' : ''}</span>
                <span class="window-item-title">${escapeHtml(title)}</span>
                ${isMinimized ? '<span class="window-item-state">Minimized</span>' : ''}
            </div>`;
        });
        list.innerHTML = html;

        // Add click handlers
        list.querySelectorAll('.window-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const windowId = item.dataset.windowId;
                const win = openWindows.get(windowId);
                if (win) {
                    restoreWindow(win);
                    bringToFront(win);
                }
                document.getElementById('finder-dropdown').classList.remove('open');
            });
        });
    }

    // Global function to close all dropdowns
    window.closeDropdowns = function () {
        const appleDropdown = document.getElementById('apple-dropdown');
        const finderDropdown = document.getElementById('finder-dropdown');
        if (appleDropdown) appleDropdown.classList.remove('open');
        if (finderDropdown) finderDropdown.classList.remove('open');
        if (typeof window.closeMusicMenu === 'function') window.closeMusicMenu();
    };

    window.closeAllWindows = function () {
        const dropdown = document.getElementById('apple-dropdown');
        if (dropdown) dropdown.classList.remove('open');

        openWindows.forEach((win, id) => {
            removeFromTray(id);
            win.classList.add('closing');
            setTimeout(() => {
                win.remove();
            }, 150);
        });
        openWindows.clear();
        activeWindow = null;

        // Reset menubar
        const activeAppName = document.getElementById('active-app-name');
        if (activeAppName) activeAppName.textContent = 'Finder';
    };

    window.tileWindows = function () {
        const dropdown = document.getElementById('apple-dropdown');
        if (dropdown) dropdown.classList.remove('open');

        const windows = Array.from(openWindows.values());
        if (windows.length === 0) return;

        const cols = Math.ceil(Math.sqrt(windows.length));
        const rows = Math.ceil(windows.length / cols);
        const winWidth = Math.floor(window.innerWidth / cols);
        const winHeight = Math.floor((window.innerHeight - 24) / rows); // 24 = menubar

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
        const dropdown = document.getElementById('apple-dropdown');
        if (dropdown) dropdown.classList.remove('open');

        // Get Git info from meta tags
        const commitHash = document.querySelector('meta[name="git-commit-hash"]')?.content;
        const commitShort = document.querySelector('meta[name="git-commit-short"]')?.content;
        const commitDate = document.querySelector('meta[name="git-commit-date"]')?.content;
        const commitAuthor = document.querySelector('meta[name="git-commit-author"]')?.content;

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
            bringToFront(openWindows.get('about-this-mac'));
            return;
        }

        const win = document.createElement('div');
        win.className = 'window about-window centered';
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

        win.style.left = '50%';
        win.style.top = '50%';
        win.style.transform = 'translate(-50%, -50%)';
        win.style.width = '380px';
        win.style.height = 'auto';
        win.style.minHeight = '360px';

        document.getElementById('windows-container').appendChild(win);
        openWindows.set('about-this-mac', win);

        win.classList.add('opening');
        setTimeout(() => win.classList.remove('opening'), 200);

        setupWindowDrag(win);
        setupWindowControls(win, 'about-this-mac');
        bringToFront(win);
    };

    // Keyboard shortcuts reference. Every shortcut below already worked; none
    // of them were discoverable anywhere in the UI.
    window.openShortcuts = function () {
        if (openWindows.has('shortcuts')) {
            const existing = openWindows.get('shortcuts');
            restoreWindow(existing);
            bringToFront(existing);
            return;
        }

        const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
        const mod = isMac ? '⌘' : 'Ctrl';

        const groups = [
            {
                name: 'Windows',
                items: [
                    [mod + ' W', 'Close the active window'],
                    [mod + ' M', 'Minimize to the menubar'],
                    [mod + ' H', 'Minimize everything'],
                    [mod + ' `', 'Cycle between windows'],
                    ['Double-click titlebar', 'Zoom the window']
                ]
            },
            {
                name: 'Navigation',
                items: [
                    [mod + ' Space', 'Open search'],
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

        const width = 380;
        win.style.width = width + 'px';
        win.style.height = 'auto';
        win.style.left = Math.max(20, (window.innerWidth - width) / 2) + 'px';
        win.style.top = '90px';

        document.getElementById('windows-container').appendChild(win);
        openWindows.set('shortcuts', win);

        win.classList.add('opening');
        setTimeout(() => win.classList.remove('opening'), 200);

        setupWindowDrag(win);
        setupWindowControls(win, 'shortcuts');
        bringToFront(win);
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
            script.onerror = reject;
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
                <div class="spinner"></div>
                <div style="color: #ccc; margin-top: 12px;">Loading Flash game...</div>
            </div>
        `;

        loadRuffle().then(() => {
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
            }).catch(err => {
                console.error('Failed to load Flash game:', err);
                container.innerHTML = `
                    <div class="flash-error">
                        <span class="flash-error-icon">⚠️</span>
                        <div class="flash-error-text">Failed to load game</div>
                        <div class="flash-error-detail">${err.message || 'Unknown error'}</div>
                    </div>
                `;
            });
        }).catch(err => {
            console.error('Failed to load Ruffle:', err);
            container.innerHTML = `
                <div class="flash-error">
                    <span class="flash-error-icon">⚠️</span>
                    <div class="flash-error-text">Failed to load Flash player</div>
                    <div class="flash-error-detail">${err.message || 'Could not load Ruffle'}</div>
                </div>
            `;
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
        'music': { urlKey: 'MUSIC_URL', init: 'initMusicPlayer', cleanup: 'musicCleanup' }
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
        loadLazyApp(app).then(() => {
            if (typeof window[app.init] === 'function') window[app.init](win);
        }).catch((err) => {
            console.error(err);
            const content = win.querySelector('.window-content');
            if (content) {
                content.innerHTML = '<div style="padding:24px;text-align:center;color:#888;">This app failed to load. Check your connection and try again.</div>';
            }
        });
    }

    // Window Management
    async function openWindow(id, title, size = { width: 1000, height: 700 }, permalink = null) {
        // Check if window already exists
        if (openWindows.has(id)) {
            const existingWindow = openWindows.get(id);
            restoreWindow(existingWindow);
            bringToFront(existingWindow);
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

        // 1. Try to get content from existing DOM element (e.g. About, Contact)
        const contentElement = document.getElementById(`content-${id}`);
        let content = '';
        let shouldFetchJson = false;

        if (contentElement) {
            content = contentElement.innerHTML;
            if (!permalink) {
                permalink = contentElement.getAttribute('data-permalink');
            }
        } else if (permalink) {
            // 2. If no DOM element but we have a permalink, we need to fetch it
            console.log(`Fetching content for ${id} from ${permalink}`);
            content = `<div class="window-loader"><div class="spinner"></div></div>`;
            shouldFetchJson = true;
        } else {
            console.error(`Content not found for ${id}`);
            return;
        }

        // Create window
        const win = createWindowElement(id, title, content, size, permalink);

        // Check if mobile device
        const isMobile = window.innerWidth <= 768;

        if (isMobile) {
            // On mobile, make windows fullscreen
            win.style.left = '8px';
            win.style.top = '8px';
            win.style.width = `calc(100vw - 16px)`;
            win.style.height = `calc(100vh - var(--menubar-height) - 16px)`;
        } else if (id === 'about' || id === 'irc-chat') {
            // Center the About Me and IRC Chat windows on screen
            const finalWidth = Math.min(size.width, window.innerWidth - 100);
            const finalHeight = Math.min(size.height, window.innerHeight - 100);
            const centerX = (window.innerWidth - finalWidth) / 2;
            const centerY = (window.innerHeight - finalHeight) / 2 - 22; // Adjust for menubar
            win.style.left = `${centerX}px`;
            win.style.top = `${Math.max(20, centerY)}px`;
            win.style.width = `${finalWidth}px`;
            win.style.height = `${finalHeight}px`;
        } else {
            // Desktop: cascade, wrapping every 6 windows. The offset used to
            // grow without bound, so the 8th window opened mostly off-screen.
            const step = openWindows.size % 6;
            const offsetX = step * 30;
            const offsetY = step * 30;

            // Clamp size to screen
            const maxWidth = window.innerWidth - 100;
            const maxHeight = window.innerHeight - 100;
            const finalWidth = Math.min(size.width, maxWidth);
            const finalHeight = Math.min(size.height, maxHeight);

            win.style.left = `${100 + offsetX}px`;
            win.style.top = `${50 + offsetY}px`;
            win.style.width = `${finalWidth}px`;
            win.style.height = `${finalHeight}px`;
        }

        document.getElementById('windows-container').appendChild(win);
        openWindows.set(id, win);

        // Animate
        win.classList.add('opening');
        setTimeout(() => win.classList.remove('opening'), 200);

        // Setup interactions
        setupWindowDrag(win);
        setupWindowResize(win);
        setupWindowControls(win, id);
        setupFinderItems(win);

        // Activate any lazy-loaded iframes in the window
        activateLazyIframes(win);
        activateTwitterEmbeds(win);

        // Setup terminal if this is a terminal window or portal window
        if (id === 'terminal' || id === 'portal') {
            // Lazy load v86-terminal.js if not loaded yet
            if (!window.setupV86Terminal && window.V86_TERMINAL_URL) {
                const script = document.createElement('script');
                script.src = window.V86_TERMINAL_URL;
                script.onload = () => {
                    if (window.setupV86Terminal) {
                        window.setupV86Terminal(id);
                    }
                };
                document.head.appendChild(script);
            } else if (window.setupV86Terminal) {
                window.setupV86Terminal(id);
            }
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
        }

        bringToFront(win);
        // Newly opened window gets its own history entry; refocusing an
        // existing one (handled in bringToFront) only replaces.
        syncUrlToWindow(win, true);

        // If we need to fetch content, do it now
        if (shouldFetchJson && permalink) {
            try {
                // Try to fetch JSON first (more efficient)
                let jsonUrl = permalink.endsWith('/') ? permalink + 'index.json' : permalink.replace(/\/$/, '') + '/index.json';
                const response = await fetch(jsonUrl);

                if (response.ok) {
                    const data = await response.json();
                    const winContent = win.querySelector('.window-content');

                    if (winContent && data.content) {
                        winContent.innerHTML = data.content;

                        // Re-setup finder items and embeds
                        setupFinderItems(win);
                        activateTwitterEmbeds(win);
                    }
                } else {
                    throw new Error('JSON not found, falling back to HTML');
                }
            } catch (err) {
                console.warn('Failed to fetch JSON, trying HTML fallback:', err);

                // Fallback to HTML parsing
                try {
                    const response = await fetch(permalink);
                    if (!response.ok) throw new Error('Network response was not ok');
                    const html = await response.text();

                    const parser = new DOMParser();
                    const doc = parser.parseFromString(html, 'text/html');
                    const fetchedContent = doc.querySelector('.window-content');

                    if (fetchedContent) {
                        const winContent = win.querySelector('.window-content');
                        if (winContent) {
                            winContent.innerHTML = fetchedContent.innerHTML;
                            setupFinderItems(win);
                            activateTwitterEmbeds(win);
                        }
                    } else {
                        throw new Error('Could not find content in fetched page');
                    }
                } catch (htmlErr) {
                    console.error('Failed to fetch content:', htmlErr);
                    const winContent = win.querySelector('.window-content');
                    if (winContent) {
                        winContent.innerHTML = `
                            <div style="padding: 20px; text-align: center; color: #666;">
                                <p>Failed to load content.</p>
                                <a href="${permalink}" target="_blank" class="fallback-btn" style="margin-top: 10px;">Open in New Tab</a>
                            </div>
                        `;
                    }
                }
            }
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
                'timeline': '/timeline/',
                'wins': '/wins/',
                'contact': '/contact/'
            };
            if (map[id]) urlPath = map[id];
        }
        win.dataset.path = urlPath;

        const linkHtml = permalink
            ? `<a href="${permalink}" target="_blank" class="titlebar-link" title="Open in new tab">↗</a>`
            : '';
        const iconHtml = getWindowIconHtml(id);

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

        return win;
    }

    function closeWindow(win, id) {
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

        removeFromTray(id);
        win.classList.add('closing');
        setTimeout(() => {
            win.remove();
            openWindows.delete(id);

            // Remove from history
            const histIndex = windowHistory.indexOf(win);
            if (histIndex > -1) {
                windowHistory.splice(histIndex, 1);
            }

            if (activeWindow === win) {
                activeWindow = null;

                // Try to activate previous window
                const prevWin = [...windowHistory].reverse().find(item => item.style.display !== 'none');
                if (prevWin) {
                    bringToFront(prevWin);
                } else {
                    // Reset to Finder if no windows
                    const activeAppName = document.getElementById('active-app-name');
                    if (activeAppName) activeAppName.textContent = 'Finder';
                    // Reset URL to desktop
                    resetUrlToDesktop();
                }
            }
        }, 150);
    }

    // ================================================
    // Minimize / restore via the menubar tray
    // There is no dock, so a minimized window used to be reachable only through
    // the Finder dropdown - nothing on screen said it still existed.
    // ================================================

    function getMinimizedTray() {
        return document.getElementById('menubar-minimized');
    }

    function windowTitleOf(win) {
        return win.querySelector('.window-title-text')?.textContent
            || win.querySelector('.window-title')?.textContent
            || 'Window';
    }

    function addToTray(win, id) {
        const tray = getMinimizedTray();
        if (!tray || tray.querySelector(`[data-tray-for="${CSS.escape(id)}"]`)) return null;

        const title = windowTitleOf(win).trim();
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'menubar-min-chip';
        chip.dataset.trayFor = id;
        chip.setAttribute('aria-label', `Restore ${title}`);
        chip.dataset.tip = `Restore ${title}`;

        const icon = getWindowIconHtml(id);
        chip.innerHTML =
            `<span class="menubar-min-icon">${icon || ''}</span>` +
            `<span class="menubar-min-label"></span>`;
        chip.querySelector('.menubar-min-label').textContent = title;

        chip.addEventListener('click', (e) => {
            e.stopPropagation();
            const target = openWindows.get(id);
            if (target) {
                restoreWindow(target);
                bringToFront(target);
            }
        });

        tray.appendChild(chip);
        return chip;
    }

    function removeFromTray(id) {
        const tray = getMinimizedTray();
        if (!tray) return;
        const chip = tray.querySelector(`[data-tray-for="${CSS.escape(id)}"]`);
        if (chip) chip.remove();
    }

    /** Genie-ish fly toward the tray chip, mirroring the sticky note's animation. */
    function minimizeWindow(win, id) {
        if (win.classList.contains('minimized')) return;

        const chip = addToTray(win, id);
        const winRect = win.getBoundingClientRect();
        const targetRect = chip ? chip.getBoundingClientRect() : null;

        win.classList.add('minimized');

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

        setTimeout(() => {
            win.style.display = 'none';
            win.style.transition = '';
            win.style.transform = '';
            win.style.opacity = '';
            win.style.transformOrigin = '';

            if (activeWindow === win) {
                activeWindow = null;
                const previous = [...windowHistory].reverse().find(item => item !== win && item.style.display !== 'none');
                if (previous) {
                    bringToFront(previous);
                } else {
                    deactivateAllWindows();
                    const activeAppName = document.getElementById('active-app-name');
                    if (activeAppName) activeAppName.textContent = 'Finder';
                }
            }
        }, prefersReducedMotion() ? 0 : 260);
    }

    function prefersReducedMotion() {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function restoreWindow(win) {
        const wasMinimized = win.classList.contains('minimized');
        win.style.display = '';
        win.style.transform = '';
        win.style.opacity = '';
        win.classList.remove('minimized');

        if (wasMinimized) {
            removeFromTray(win.dataset.windowId);
            if (!prefersReducedMotion()) {
                win.classList.add('restoring');
                setTimeout(() => win.classList.remove('restoring'), 220);
            }
        }
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

    function windowUrl(win) {
        const path = win && win.dataset.path;
        if (!path || path === '/') return null;
        return path;
    }

    function syncUrlToWindow(win, forcePush) {
        if (!ENABLE_DEEP_LINKING || suppressHistory) return;

        const path = windowUrl(win);
        const target = path || '/';
        if (target === location.pathname + location.search) return;

        const id = win ? win.dataset.windowId : null;
        const state = id ? { windowId: id } : null;

        if (forcePush) {
            history.pushState(state, '', target);
        } else {
            history.replaceState(state, '', target);
        }
    }

    function resetUrlToDesktop() {
        if (!ENABLE_DEEP_LINKING || suppressHistory) return;
        if (location.pathname === '/' && !location.search) return;
        history.replaceState(null, '', '/');
    }

    /**
     * Back/forward: bring the window for the target URL to the front, opening it
     * if it was closed. An unrecognised entry means "the desktop".
     */
    window.addEventListener('popstate', (e) => {
        if (!ENABLE_DEEP_LINKING) return;

        const targetId = e.state && e.state.windowId;

        // openWindow is async, so suppressHistory has to be released when the
        // work finishes - a try/finally would clear it before openWindow got
        // as far as pushing, adding a bogus entry and breaking Forward.
        suppressHistory = true;
        const release = () => { suppressHistory = false; };

        if (targetId && openWindows.has(targetId)) {
            const win = openWindows.get(targetId);
            restoreWindow(win);
            bringToFront(win);
            release();
            return;
        }

        // The window was closed since that entry was created - reopen it from
        // the search index if we can identify it.
        const meta = targetId ? appMetadata.get(targetId) : null;
        if (targetId && meta) {
            Promise.resolve(
                openWindow(targetId, meta.title, {
                    width: meta.width || 1000,
                    height: meta.height || 700
                }, meta.permalink || null)
            ).then(release, release);
            return;
        }

        const byPath = [...openWindows.values()].find(w => w.dataset.path === location.pathname);
        if (byPath) {
            restoreWindow(byPath);
            bringToFront(byPath);
            release();
            return;
        }

        // Nothing matches: show the desktop.
        openWindows.forEach((win, id) => {
            if (win.style.display !== 'none') minimizeWindow(win, id);
        });
        deactivateAllWindows();
        activeWindow = null;
        const activeAppName = document.getElementById('active-app-name');
        if (activeAppName) activeAppName.textContent = 'Finder';
        release();
    });

    function deactivateAllWindows() {
        document.querySelectorAll('.window').forEach(w => {
            w.classList.add('inactive');
        });
    }

    // Window Dragging
    function setupWindowDrag(win) {
        const titlebar = win.querySelector('.window-titlebar');
        const isMobile = window.innerWidth <= 768;

        // Disable dragging on mobile
        if (isMobile) return;

        let isDragging = false;
        let startX, startY, startLeft, startTop;

        const onStart = (e) => {
            const clientX = e.clientX || (e.touches && e.touches[0].clientX);
            const clientY = e.clientY || (e.touches && e.touches[0].clientY);

            if (e.target.closest('.traffic-light') || e.target.closest('.titlebar-link')) {
                return;
            }

            isDragging = true;
            startX = clientX;
            startY = clientY;

            // Handle centered windows - use getBoundingClientRect for accurate position
            if (win.style.transform.includes('translate')) {
                const rect = win.getBoundingClientRect();
                win.style.transform = '';
                win.style.left = `${rect.left}px`;
                win.style.top = `${rect.top - 24}px`; // 24px = menubar height
            }

            startLeft = win.offsetLeft;
            startTop = win.offsetTop;

            bringToFront(win);

            document.addEventListener('mousemove', onDrag);
            document.addEventListener('mouseup', stopDrag);
            document.addEventListener('touchmove', onDrag);
            document.addEventListener('touchend', stopDrag);
        };

        titlebar.addEventListener('mousedown', onStart);
        titlebar.addEventListener('touchstart', onStart);

        function onDrag(e) {
            if (!isDragging) return;

            const clientX = e.clientX || (e.touches && e.touches[0].clientX);
            const clientY = e.clientY || (e.touches && e.touches[0].clientY);

            const dx = clientX - startX;
            const dy = clientY - startY;

            let newLeft = startLeft + dx;
            let newTop = startTop + dy;

            // Keep window on screen
            const visibleGrip = Math.min(80, win.offsetWidth);
            const maxLeft = window.innerWidth - visibleGrip;
            const minLeft = -(win.offsetWidth - visibleGrip);
            const maxTop = window.innerHeight - parseInt(getComputedStyle(document.documentElement).getPropertyValue('--menubar-height'), 10) - 40;
            newLeft = Math.min(maxLeft, Math.max(minLeft, newLeft));
            newTop = Math.min(maxTop, Math.max(0, newTop));

            // Snap to screen edges and to the horizontal centre when close,
            // unless Alt is held to place freely.
            if (!e.altKey) {
                const SNAP = 12;
                const rightEdge = window.innerWidth - win.offsetWidth;
                const centreLeft = Math.round((window.innerWidth - win.offsetWidth) / 2);

                if (Math.abs(newLeft) <= SNAP) newLeft = 0;
                else if (Math.abs(newLeft - rightEdge) <= SNAP) newLeft = rightEdge;
                else if (Math.abs(newLeft - centreLeft) <= SNAP) newLeft = centreLeft;

                if (Math.abs(newTop) <= SNAP) newTop = 0;
            }

            win.style.left = `${newLeft}px`;
            win.style.top = `${newTop}px`;
        }

        function stopDrag() {
            isDragging = false;
            document.removeEventListener('mousemove', onDrag);
            document.removeEventListener('mouseup', stopDrag);
            document.removeEventListener('touchmove', onDrag);
            document.removeEventListener('touchend', stopDrag);
        }
    }

    // Window Resizing
    function setupWindowResize(win) {
        const resizeHandle = win.querySelector('.window-resize');
        if (!resizeHandle) return;

        const isMobile = window.innerWidth <= 768;

        // Disable resizing on mobile
        if (isMobile) return;

        let isResizing = false;
        let startX, startY, startWidth, startHeight;

        const onStart = (e) => {
            const clientX = e.clientX || (e.touches && e.touches[0].clientX);
            const clientY = e.clientY || (e.touches && e.touches[0].clientY);

            isResizing = true;
            startX = clientX;
            startY = clientY;
            startWidth = win.offsetWidth;
            startHeight = win.offsetHeight;

            bringToFront(win);

            document.addEventListener('mousemove', onResize);
            document.addEventListener('mouseup', stopResize);
            document.addEventListener('touchmove', onResize);
            document.addEventListener('touchend', stopResize);
            e.preventDefault();
        };

        resizeHandle.addEventListener('mousedown', onStart);
        resizeHandle.addEventListener('touchstart', onStart);

        function onResize(e) {
            if (!isResizing) return;

            const clientX = e.clientX || (e.touches && e.touches[0].clientX);
            const clientY = e.clientY || (e.touches && e.touches[0].clientY);

            const dx = clientX - startX;
            const dy = clientY - startY;

            const rect = win.getBoundingClientRect();
            const menubarHeight = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--menubar-height'), 10) || 24;
            const maxWidth = Math.max(400, window.innerWidth - rect.left);
            const maxHeight = Math.max(300, window.innerHeight - menubarHeight - win.offsetTop);
            const newWidth = Math.min(maxWidth, Math.max(400, startWidth + dx));
            const newHeight = Math.min(maxHeight, Math.max(300, startHeight + dy));

            win.style.width = `${newWidth}px`;
            win.style.height = `${newHeight}px`;
        }

        function stopResize() {
            isResizing = false;
            document.removeEventListener('mousemove', onResize);
            document.removeEventListener('mouseup', stopResize);
            document.removeEventListener('touchmove', onResize);
            document.removeEventListener('touchend', stopResize);
        }
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

        closeBtn.addEventListener('click', () => closeWindow(win, id));

        minimizeBtn.addEventListener('click', () => minimizeWindow(win, id));

        maximizeBtn.addEventListener('click', () => toggleZoom(win));

        // Double-click the titlebar to zoom, as on a real Mac
        const titlebar = win.querySelector('.window-titlebar');
        if (titlebar) {
            titlebar.addEventListener('dblclick', (e) => {
                if (e.target.closest('.traffic-light') || e.target.closest('.titlebar-link')) return;
                toggleZoom(win);
            });
        }

        // Click on window brings to front
        win.addEventListener('mousedown', () => bringToFront(win));
    }

    function toggleZoom(win) {
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
                    openWindow(windowId, title, { width: 900, height: 650 }, permalink);
                }
            });

            // Allow Enter key to trigger click for accessibility
            item.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    item.click();
                }
            });
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

    // Expose openWindow globally for calendar view and other modules
    window.openWindow = openWindow;
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

    // Global function for timeline year switching
    // This needs to be global because inline onclick handlers in dynamically loaded HTML need it
    window.switchTimelineYear = function (year, id) {
        const container = document.getElementById('timeline-container-' + id);
        if (!container) {
            console.warn('Timeline container not found:', 'timeline-container-' + id);
            return;
        }

        // Update tabs
        container.querySelectorAll('.year-tab').forEach(function (tab) {
            if (tab.dataset.year === year) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });

        // Update sections
        container.querySelectorAll('.timeline-year-section').forEach(function (section) {
            if (section.dataset.year === year) {
                section.classList.add('active');
            } else {
                section.classList.remove('active');
            }
        });
    };

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
            document.body.appendChild(notificationContainer);
        }
        return notificationContainer;
    }

    // Play notification sound using Web Audio API
    function playNotificationSound() {
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
            console.log('Notification sound unavailable:', e.message);
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

        notification.innerHTML = `
            <div class="notification-icon">${iconHtml}</div>
            <div class="notification-content">
                <div class="notification-title">${escapeHtml(options.title || '')}</div>
                <div class="notification-message">${escapeHtml(options.message || '')}</div>
            </div>
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
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
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

        // Auto-dismiss if duration is set
        if (options.duration && options.duration > 0) {
            setTimeout(() => {
                dismissNotification(notification);
            }, options.duration);
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
            console.log('Konami sound unavailable:', e.message);
        }
    }

    // ================================================
    // Startup chime
    // The classic Mac boot chord: a big detuned F#/Gb major voicing with a
    // long tail. Plays once per visitor, alongside the boot screen.
    // ================================================

    function playStartupChime() {
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

        if (playStartupChime()) return;

        // Autoplay policy blocked it - most browsers require a gesture first.
        // Take the very next interaction, once, and then stop listening.
        const onGesture = () => {
            document.removeEventListener('pointerdown', onGesture);
            document.removeEventListener('keydown', onGesture);
            playStartupChime();
        };
        document.addEventListener('pointerdown', onGesture, { once: true });
        document.addEventListener('keydown', onGesture, { once: true });
    }

    // Error/Bonk sound for error notifications
    function playErrorSound() {
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
            console.log('Error sound unavailable:', e.message);
        }
    }

    // Initialize Konami Code listener
    setupKonamiCode();

    // Expose error sound globally for use in onclick handlers
    window.playErrorSound = playErrorSound;


})();
