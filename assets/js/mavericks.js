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
            if (item.type === 'app') {
                if (item.title === 'Wins') return '🥇';
                if (item.title === 'Contact') return '📇';
                if (item.title === 'Schedule Call') return '📅';
                if (item.title === 'Timeline') return '⏳';
                if (item.title === 'Projects') return '🚀';
                if (item.title === 'Blogs') return '📝';
                if (item.title === 'Resume') return '📄';
                if (item.title === 'DOOM') return '🎮';
                if (item.title === 'About Me') return '🍎';
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
            container.innerHTML = results.map(item => `
                <div class="spotlight-result" data-window="${item.windowId}" data-title="${item.title}" data-permalink="${item.permalink || ''}">
                    <span class="spotlight-result-icon">${item.icon}</span>
                    <div class="spotlight-result-content">
                        <div class="spotlight-result-title">${item.title}</div>
                        <div class="spotlight-result-type">${item.type}</div>
                    </div>
                </div>
            `).join('');

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

    // Old buildSearchIndex was replaced below by setupSearchIndex logic
    // Removing the residual body lines


    function setupSearchIndex() {
        fetch('/index.json')
            .then(r => r.json())
            .then(data => { globalSearchIndex = data; })
            .catch(e => console.error('Failed to load search index', e));
    }

    // Unused but kept for reference or legacy functionality
    function buildSearchIndex() { return []; }

    function getIconForType(type) {
        const t = (type || '').toLowerCase();
        if (t.includes('blog') || t.includes('post')) return '📝';
        if (t.includes('project')) return '📁';
        if (t.includes('timeline')) return '⏰';
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
                    'pw.live', 'devfolio.co', 'npmjs.com'
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

        const aboutContent = `
            <div class="about-this-mac">
                <div class="about-icon">🍎</div>
                <h1>ankush.one</h1>
                <div class="about-specs">
                    <p><strong>Developer:</strong> Ankush Singh</p>
                    <p><strong>Built with:</strong> Hugo + JavaScript</p>
                </div>
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
        win.style.minHeight = '280px';

        document.getElementById('windows-container').appendChild(win);
        openWindows.set('about-this-mac', win);

        win.classList.add('opening');
        setTimeout(() => win.classList.remove('opening'), 200);

        setupWindowDrag(win);
        setupWindowControls(win, 'about-this-mac');
        bringToFront(win);
    };

    // Window Management
    async function openWindow(id, title, size = { width: 1000, height: 700 }, permalink = null) {
        // Check if window already exists
        if (openWindows.has(id)) {
            const existingWindow = openWindows.get(id);
            bringToFront(existingWindow);
            return;
        }

        // 1. Try to get content from existing DOM element (e.g. About, Contact)
        const contentElement = document.getElementById(`content-${id}`);
        let content = '';

        if (contentElement) {
            content = contentElement.innerHTML;
            if (!permalink) {
                permalink = contentElement.getAttribute('data-permalink');
            }
        } else if (permalink) {
            // 2. If no DOM element but we have a permalink, we need to fetch it
            console.log(`Fetching content for ${id} from ${permalink}`);
            content = `<div class="window-loader"><div class="spinner"></div></div>`;
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

        bringToFront(win);

        // If we need to fetch content, do it now
        if (!contentElement && permalink) {
            try {
                const response = await fetch(permalink);
                if (!response.ok) throw new Error('Network response was not ok');
                const html = await response.text();

                // Parse HTML to extract the content
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');

                // We assume the content is inside .window-content or .static-window .window-content
                // Based on window-frame.html, it's inside .window-content
                const fetchedContent = doc.querySelector('.window-content');

                if (fetchedContent) {
                    const winContent = win.querySelector('.window-content');
                    if (winContent) {
                        winContent.innerHTML = fetchedContent.innerHTML;
                        // Re-setup finder items just in case the fetched content has links
                        setupFinderItems(win);
                        activateTwitterEmbeds(win);
                    }
                } else {
                    throw new Error('Could not find content in fetched page');
                }
            } catch (err) {
                console.error('Failed to fetch content:', err);
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
        const items = win.querySelectorAll('.finder-item, .finder-row');
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
                iconHtml = `<img src="${options.icon}" alt="" class="notification-icon-img">`;
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

    // Expose globally
    window.showNotification = showNotification;
    window.dismissNotification = dismissNotification;

})();

