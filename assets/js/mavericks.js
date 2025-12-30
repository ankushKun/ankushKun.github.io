/**
 * macOS X 10.9 Mavericks Window Manager
 */

(function () {
    'use strict';

    // Configuration
    const ENABLE_DEEP_LINKING = false; // Set to true to enable URL state updates

    // State
    let windowZIndex = 100;
    let activeWindow = null;
    const openWindows = new Map();
    const windowHistory = [];
    let globalSearchIndex = [];

    // Initialize
    document.addEventListener('DOMContentLoaded', init);

    function init() {
        setupClock();
        setupDesktopIcons();
        setupDesktopClick();
        setupAppleMenuClose();
        setupDropdownItemClose();
        setupExternalLinks();
        setupKeyboardShortcuts();
        preloadHighResWallpaper();
        lazyLoadImages();
        setupSearchIndex();

        // Auto-open About Me window on page load
        setTimeout(() => {
            openWindow('about', 'About Me');
        }, 300);

        // Show hire notification 2 seconds after first user interaction (so sound can play)
        let hasShownHireNotification = false;
        const showHireNotification = () => {
            if (hasShownHireNotification) return;
            hasShownHireNotification = true;

            // Remove listeners
            document.removeEventListener('click', showHireNotification);
            document.removeEventListener('keydown', showHireNotification);
            document.removeEventListener('touchstart', showHireNotification);

            setTimeout(() => {
                showNotification({
                    title: "I am Available for Hire!",
                    message: "Looking for an engineer or know someone who is? Click here to see resume.",
                    icon: "/pfp.png",
                    onClick: () => {
                        openWindow('resume', 'Resume');
                    }
                });
            }, 2000);
        };

        document.addEventListener('click', showHireNotification);
        document.addEventListener('keydown', showHireNotification);
        document.addEventListener('touchstart', showHireNotification);
    }

    // Preload high-resolution wallpaper
    function preloadHighResWallpaper() {
        const highResImage = new Image();
        highResImage.onload = function () {
            // High-res image loaded, add class to trigger CSS transition
            document.body.classList.add('wallpaper-loaded');
        };
        highResImage.src = '/wallpaper.webp';
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

            // Cmd/Ctrl + H: Hide all windows (show desktop)
            if (modKey && e.key === 'h') {
                e.preventDefault();
                openWindows.forEach((win) => {
                    win.style.display = 'none';
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

            // Escape: Close Spotlight, deselect everything
            if (e.key === 'Escape') {
                // Close Spotlight if open
                const spotlight = document.getElementById('spotlight-overlay');
                if (spotlight) {
                    spotlight.remove();
                    return;
                }

                document.querySelectorAll('.desktop-icon').forEach(i => i.classList.remove('selected'));
                // Close any open dropdowns
                const appleDropdown = document.getElementById('apple-dropdown');
                const finderDropdown = document.getElementById('finder-dropdown');
                if (appleDropdown) appleDropdown.classList.remove('open');
                if (finderDropdown) finderDropdown.classList.remove('open');
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
                    font-size: 22px;
                    width: 28px;
                    text-align: center;
                    flex-shrink: 0;
                }
                .spotlight-result-icon-img {
                    width: 28px;
                    height: 28px;
                    object-fit: contain;
                    flex-shrink: 0;
                    border-radius: 4px;
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
                    padding: 10px 18px;
                    color: rgba(255, 255, 255, 0.3);
                    font-size: 11px;
                    text-align: center;
                    border-top: 1px solid rgba(255, 255, 255, 0.06);
                }
            `;
            document.head.appendChild(styles);
        }

        // Focus input
        const input = document.getElementById('spotlight-input');
        input.focus();

        // Create icon mapping helper
        const getIcon = (item) => {
            // Use icon from search index if available
            if (item.icon) return item.icon;

            // App-specific icons
            if (item.type === 'app') {
                if (item.title === 'Wins') return '🥇';
                if (item.title === 'Contact') return '📇';
                if (item.title === 'Schedule Call') return '📅';
                if (item.title === 'Timeline') return '⏳';
                if (item.title === 'Projects') return '🚀';
                if (item.title === 'Blogs') return '📝';
                if (item.title === 'Resume') return '📄';
                if (item.title === 'About Me') return '🍎';
                if (item.title === 'Terminal') return '💻';
                if (item.title === 'Games') return '🕹️';
                return '🖥️';
            }
            return getIconForType(item.type);
        };

        // Handle search
        let selectedIndex = -1;
        input.addEventListener('input', () => {
            const query = input.value.toLowerCase().trim();
            const results = query ? globalSearchIndex.filter(item =>
                item.title.toLowerCase().includes(query) ||
                (item.type && item.type.toLowerCase().includes(query)) ||
                (item.type && `${item.type}s`.toLowerCase().includes(query)) ||
                (item.description && item.description.toLowerCase().includes(query)) ||
                (item.content && item.content.toLowerCase().includes(query))
            ).slice(0, 8).map(item => ({
                ...item,
                icon: getIcon(item),
                windowId: item.openWindow || ('content-' + item.permalink.replace(/[^a-z0-9]/gi, '-'))
            })) : [];

            renderResults(results);
            selectedIndex = results.length > 0 ? 0 : -1;
            updateSelection();
        });

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

        function renderResults(results) {
            const container = document.getElementById('spotlight-results');
            if (results.length === 0 && input.value.trim()) {
                container.innerHTML = '<div class="spotlight-no-results">No results found</div>';
                return;
            }
            container.innerHTML = results.map(item => {
                const iconHtml = (item.icon.startsWith('/') || item.icon.startsWith('http'))
                    ? `<img src="${item.icon}" class="spotlight-result-icon-img" alt="">`
                    : `<span class="spotlight-result-icon">${item.icon}</span>`;

                return `
                <div class="spotlight-result" data-window="${item.windowId}" data-title="${item.title}" data-permalink="${item.permalink || ''}">
                    ${iconHtml}
                    <div class="spotlight-result-content">
                        <div class="spotlight-result-title">${item.title}</div>
                        <div class="spotlight-result-type">${item.type}</div>
                    </div>
                </div>
            `}).join('');

            // Add click handlers
            container.querySelectorAll('.spotlight-result').forEach(el => {
                el.addEventListener('click', () => {
                    const windowId = el.dataset.window;
                    const title = el.dataset.title;
                    const permalink = el.dataset.permalink;
                    spotlight.remove();
                    openWindow(windowId, title, { width: 900, height: 650 }, permalink || null);
                });
            });
        }

        // Click outside to close
        spotlight.addEventListener('click', (e) => {
            if (e.target === spotlight) {
                spotlight.remove();
            }
        });
    }

    // Load search index for Spotlight
    function setupSearchIndex() {
        fetch('/index.json')
            .then(r => r.json())
            .then(data => {
                // Apps and content pages are now all in index.json
                globalSearchIndex = data;
            })
            .catch(e => console.error('Failed to load search index', e));
    }

    function getIconForType(type) {
        const t = (type || '').toLowerCase();
        if (t.includes('blog') || t.includes('post')) return '📝';
        if (t.includes('project')) return '📁';
        if (t.includes('timeline')) return '⏰';
        if (t.includes('game')) return '🎮';
        if (t.includes('app')) return '🚀';
        return '📄';
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
                    openWindow(windowId, title);
                }
                // Else it might have an onclick handler (like Schedule Call)
            });
        });
    }

    function setupDesktopClick() {
        const desktop = document.getElementById('desktop');
        if (!desktop) return;

        desktop.addEventListener('click', (e) => {
            if (e.target === desktop || e.target.classList.contains('desktop-icons')) {
                document.querySelectorAll('.desktop-icon').forEach(i => i.classList.remove('selected'));
                deactivateAllWindows();
                // Reset menubar to Finder
                const activeAppName = document.getElementById('active-app-name');
                if (activeAppName) activeAppName.textContent = 'Finder';
                if (ENABLE_DEEP_LINKING) history.replaceState(null, 'Home', '/');
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

                e.preventDefault();
                e.stopPropagation();

                // Known domains that block iframes
                const BLOCKED_DOMAINS = [
                    'github.com', 'twitter.com', 'x.com',
                    'youtube.com', 'youtu.be', 'linkedin.com',
                    'instagram.com', 'facebook.com', 'medium.com',
                    't.me', 'discord.com', 'discord.gg', 'reddit.com',
                    'pw.live', 'devfolio.co', 'npmjs.com', 'itch.io',
                    'gohugo.io', 'mozilla.org'
                ];

                // Get the domain for the window title
                let title;
                try {
                    const url = new URL(href);
                    title = url.hostname.replace('www.', '');

                    // Check if domain is blocked
                    if (BLOCKED_DOMAINS.some(domain => title.includes(domain))) {
                        window.open(href, '_blank');
                        return;
                    }
                } catch {
                    title = 'External Link';
                }

                openExternalWindow(href, title);
            }
        });
    }

    // Open external URL in iframe window
    function openExternalWindow(url, title) {

        const windowId = 'external-' + Date.now();

        const win = document.createElement('div');
        win.className = 'window external-window';
        win.dataset.windowId = windowId;
        win.innerHTML = `
            <div class="window-titlebar">
                <div class="traffic-lights">
                    <div class="traffic-light close"><span></span></div>
                    <div class="traffic-light minimize"><span></span></div>
                    <div class="traffic-light maximize"><span></span></div>
                </div>
                <div class="window-title">🌐 ${title}</div>
            </div>
            <div class="window-toolbar">
                <div class="url-bar">
                    <span class="url-icon">🔒</span>
                    <span class="url-text">${url}</span>
                </div>
                <a href="${url}" target="_blank" class="open-external" title="Open in new tab">↗</a>
            </div>
            <div class="window-iframe-container">
                <div class="window-loader">
                    <div class="spinner"></div>
                </div>
                <iframe src="${url}" frameborder="0"></iframe>
                <div class="iframe-blocked-fallback" style="display: none;">
                    <div class="fallback-icon">🚫</div>
                    <h3>This site cannot be displayed in a window</h3>
                    <p>The website blocked embedding for security reasons.</p>
                    <a href="${url}" target="_blank" class="fallback-btn open-external">Open in New Tab ↗</a>
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

        // Detect iframe load failure
        const iframe = win.querySelector('iframe');
        const fallback = win.querySelector('.iframe-blocked-fallback');
        const loader = win.querySelector('.window-loader');

        iframe.onload = () => {
            loader.style.display = 'none';
        };

        iframe.addEventListener('error', () => {
            iframe.style.display = 'none';
            loader.style.display = 'none';
            fallback.style.display = 'flex';
        });

        // Also set a timeout to check if iframe loaded
        setTimeout(() => {
            try {
                // Try to access iframe content - will throw if blocked
                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                if (!iframeDoc || iframeDoc.body.innerHTML === '') {
                    iframe.style.display = 'none';
                    loader.style.display = 'none';
                    fallback.style.display = 'flex';
                } else {
                    loader.style.display = 'none';
                }
            } catch (e) {
                // Cross-origin error means it's loading (good) or blocked
                // We can't reliably detect, so leave it, but hide loader
                loader.style.display = 'none';
            }
        }, 3000);



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
            const title = win.querySelector('.window-title')?.textContent || id;
            const isActive = win === activeWindow;
            html += `<div class="dropdown-item window-item ${isActive ? 'active-window' : ''}" data-window-id="${id}">
                ${isActive ? '✓ ' : '  '}${title}
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
                    // If minimized, restore it
                    if (win.style.display === 'none') {
                        win.style.display = '';
                    }
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
    };

    window.closeAllWindows = function () {
        const dropdown = document.getElementById('apple-dropdown');
        if (dropdown) dropdown.classList.remove('open');

        openWindows.forEach((win, id) => {
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
                            <a href="https://copy.sh/v86/" target="_blank" rel="noopener">v86</a> + 
                            <a href="https://ruffle.rs" target="_blank" rel="noopener">Ruffle</a>
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
                <div class="traffic-lights">
                    <div class="traffic-light close"><span></span></div>
                    <div class="traffic-light minimize"><span></span></div>
                    <div class="traffic-light maximize"><span></span></div>
                </div>
                <div class="window-title">About This Site</div>
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

    // Initialize CommentKit widgets in a container
    function initializeCommentKit(container) {
        // Find all elements with data-commentkit attribute
        const commentWidgets = container.querySelectorAll('[data-commentkit]');

        if (commentWidgets.length === 0) return;

        // CommentKit scans for [data-commentkit] elements when its script loads
        // For dynamically loaded content, we inject a fresh script tag
        const script = document.createElement('script');
        script.src = 'https://commentkit.ankush.one/bundle.js';
        script.async = true;

        // Append to container so it executes in context
        container.appendChild(script);

        console.log(`Initialized CommentKit for ${commentWidgets.length} widget(s)`);
    }

    // Window Management
    async function openWindow(id, title, size = { width: 1000, height: 700 }, permalink = null) {
        // Check if window already exists
        if (openWindows.has(id)) {
            const existingWindow = openWindows.get(id);
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
                    icon: '⚠️',
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
        } else if (id === 'about') {
            // Center the About Me window on screen
            const finalWidth = Math.min(size.width, window.innerWidth - 100);
            const finalHeight = Math.min(size.height, window.innerHeight - 100);
            const centerX = (window.innerWidth - finalWidth) / 2;
            const centerY = (window.innerHeight - finalHeight) / 2 - 22; // Adjust for menubar
            win.style.left = `${centerX}px`;
            win.style.top = `${Math.max(20, centerY)}px`;
            win.style.width = `${finalWidth}px`;
            win.style.height = `${finalHeight}px`;
        } else {
            // Desktop: Position - cascade windows
            const offsetX = (openWindows.size) * 30;
            const offsetY = (openWindows.size) * 30;

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

        bringToFront(win);

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

                        // Initialize CommentKit for blog posts
                        initializeCommentKit(winContent);
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
                            initializeCommentKit(winContent);
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

        win.innerHTML = `
            <div class="window-titlebar">
                <div class="traffic-lights">
                    <div class="traffic-light close"><span></span></div>
                    <div class="traffic-light minimize"><span></span></div>
                    <div class="traffic-light maximize"><span></span></div>
                </div>
                <div class="window-title">${title}</div>
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
        // Cleanup v86 emulator if this is the terminal or portal window
        if ((id === 'terminal' || id === 'portal') && window.destroyV86) {
            window.destroyV86();
        }

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
                if (windowHistory.length > 0) {
                    const prevWin = windowHistory[windowHistory.length - 1];
                    bringToFront(prevWin);
                } else {
                    // Reset to Finder if no windows
                    const activeAppName = document.getElementById('active-app-name');
                    if (activeAppName) activeAppName.textContent = 'Finder';
                    // Reset URL to desktop
                    if (ENABLE_DEEP_LINKING) history.replaceState(null, 'Home', '/');
                }
            }
        }, 150);
    }

    function bringToFront(win) {
        windowZIndex++;
        win.style.zIndex = windowZIndex;

        // Mark all windows as inactive
        deactivateAllWindows();

        // Mark this window as active
        win.classList.remove('inactive');
        activeWindow = win;

        // Update menubar title
        const title = win.querySelector('.window-title').textContent;
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

        // Update Browser URL (Deep Linking)
        const path = win.dataset.path;
        if (path && path !== '/') {
            if (ENABLE_DEEP_LINKING) history.replaceState(null, title, path);
        }
    }

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

            if (e.target.classList.contains('traffic-light') ||
                e.target.parentElement.classList.contains('traffic-light') ||
                e.target.classList.contains('titlebar-link')) {
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
            newTop = Math.max(0, newTop);

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

            const newWidth = Math.max(400, startWidth + dx);
            const newHeight = Math.max(300, startHeight + dy);

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

        closeBtn.addEventListener('click', () => closeWindow(win, id));

        minimizeBtn.addEventListener('click', () => {
            // Simple minimize effect
            win.style.transform = 'scale(0.1)';
            win.style.opacity = '0';
            setTimeout(() => {
                win.style.display = 'none';
                win.style.transform = '';
                win.style.opacity = '';
            }, 200);
        });

        maximizeBtn.addEventListener('click', () => {
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
        });

        // Click on window brings to front
        win.addEventListener('mousedown', () => bringToFront(win));
    }

    // Finder Items - SINGLE CLICK to open
    function setupFinderItems(win) {
        const items = win.querySelectorAll('.finder-item, .finder-row, .blog-row');
        items.forEach(item => {
            items.forEach(item => {
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
        if (options.icon) {
            if (options.icon.startsWith('http') || options.icon.startsWith('/')) {
                iconHtml = `<img src="${options.icon}" draggable="false" alt="" class="notification-icon-img">`;
            } else {
                iconHtml = `<span class="notification-icon-emoji">${options.icon}</span>`;
            }
        }

        notification.innerHTML = `
            <div class="notification-icon">${iconHtml}</div>
            <div class="notification-content">
                <div class="notification-title">${options.title || ''}</div>
                <div class="notification-message">${options.message || ''}</div>
            </div>
            <button class="notification-close" aria-label="Close notification">×</button>
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
                if (!e.target.classList.contains('notification-close')) {
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
            if (e.target.classList.contains('notification-close')) return;

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
            title: "🎮 Cheat Code Activated!",
            message: "+30 lives, all weapons unlocked, big head mode enabled!",
            icon: "👾",
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
