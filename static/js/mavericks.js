/**
 * macOS X 10.9 Mavericks Window Manager
 */

(function () {
    'use strict';

    // State
    let windowZIndex = 100;
    let activeWindow = null;
    const openWindows = new Map();

    // Initialize
    document.addEventListener('DOMContentLoaded', init);

    function init() {
        setupClock();
        setupDesktopIcons();
        setupDesktopClick();
        setupAppleMenuClose();
        setupExternalLinks();

        // Auto-open About Me window on page load
        setTimeout(() => {
            openWindow('about', 'About Me');
        }, 300);
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
            clock.textContent = now.toLocaleDateString('en-US', options);
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
                // Else it might have an onclick handler (like Book a Call)
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
                    't.me', 'discord.com', 'discord.gg', 'reddit.com'
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

    window.toggleAppleMenu = function (e) {
        e.stopPropagation();
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
    function openWindow(id, title, size = { width: 1000, height: 700 }) {
        // Check if window already exists
        if (openWindows.has(id)) {
            const existingWindow = openWindows.get(id);
            bringToFront(existingWindow);
            return;
        }

        // Get content
        const contentElement = document.getElementById(`content-${id}`);
        if (!contentElement) {
            console.error(`Content element not found: content-${id}`);
            return;
        }

        const content = contentElement.innerHTML;
        const permalink = contentElement.getAttribute('data-permalink');
        console.log(`OpenWindow: ${id}, Permalink: ${permalink}`);

        // Create window
        const win = createWindowElement(id, title, content, size, permalink);
        // Position - cascade windows
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

        bringToFront(win);
    }

    function createWindowElement(id, title, content, size, permalink = null) {
        const win = document.createElement('div');
        win.className = 'window';
        win.dataset.windowId = id;

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
            if (activeWindow === win) {
                activeWindow = null;
                // Reset to Finder if no windows
                if (openWindows.size === 0) {
                    const activeAppName = document.getElementById('active-app-name');
                    if (activeAppName) activeAppName.textContent = 'Finder';
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
    }

    function deactivateAllWindows() {
        document.querySelectorAll('.window').forEach(w => {
            w.classList.add('inactive');
        });
    }

    // Window Dragging
    function setupWindowDrag(win) {
        const titlebar = win.querySelector('.window-titlebar');
        let isDragging = false;
        let startX, startY, startLeft, startTop;

        titlebar.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('traffic-light') ||
                e.target.parentElement.classList.contains('traffic-light') ||
                e.target.classList.contains('titlebar-link')) {
                return;
            }

            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;

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
        });

        function onDrag(e) {
            if (!isDragging) return;

            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

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
        }
    }

    // Window Resizing
    function setupWindowResize(win) {
        const resizeHandle = win.querySelector('.window-resize');
        if (!resizeHandle) return;

        let isResizing = false;
        let startX, startY, startWidth, startHeight;

        resizeHandle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            startWidth = win.offsetWidth;
            startHeight = win.offsetHeight;

            bringToFront(win);

            document.addEventListener('mousemove', onResize);
            document.addEventListener('mouseup', stopResize);
            e.preventDefault();
        });

        function onResize(e) {
            if (!isResizing) return;

            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            const newWidth = Math.max(400, startWidth + dx);
            const newHeight = Math.max(300, startHeight + dy);

            win.style.width = `${newWidth}px`;
            win.style.height = `${newHeight}px`;
        }

        function stopResize() {
            isResizing = false;
            document.removeEventListener('mousemove', onResize);
            document.removeEventListener('mouseup', stopResize);
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
            item.addEventListener('click', () => {
                const windowId = item.dataset.window;
                const title = item.dataset.title;
                if (windowId && title) {
                    openWindow(windowId, title, { width: 900, height: 650 });
                }
            });
        });
    }

})();
