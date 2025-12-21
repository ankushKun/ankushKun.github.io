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

    // Desktop Icons
    function setupDesktopIcons() {
        const icons = document.querySelectorAll('.desktop-icon');
        icons.forEach(icon => {
            icon.addEventListener('click', (e) => {
                // Deselect others
                icons.forEach(i => i.classList.remove('selected'));
                icon.classList.add('selected');
            });

            icon.addEventListener('dblclick', (e) => {
                const windowId = icon.dataset.window;
                const title = icon.dataset.title;
                openWindow(windowId, title);
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
            }
        });
    }

    // Window Management
    function openWindow(id, title, size = { width: 600, height: 450 }) {
        // Check if window already exists
        if (openWindows.has(id)) {
            const existingWindow = openWindows.get(id);
            bringToFront(existingWindow);
            return;
        }

        // Get content
        const contentElement = document.getElementById(`content-${id}`);
        if (!contentElement) return;

        const content = contentElement.innerHTML;

        // Create window
        const win = createWindowElement(id, title, content, size);
        document.getElementById('windows-container').appendChild(win);
        openWindows.set(id, win);

        // Position
        const offsetX = (openWindows.size - 1) * 30;
        const offsetY = (openWindows.size - 1) * 30;
        win.style.left = `${100 + offsetX}px`;
        win.style.top = `${50 + offsetY}px`;
        win.style.width = `${size.width}px`;
        win.style.height = `${size.height}px`;

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

    function createWindowElement(id, title, content, size) {
        const win = document.createElement('div');
        win.className = 'window';
        win.dataset.windowId = id;

        win.innerHTML = `
            <div class="window-titlebar">
                <div class="traffic-lights">
                    <div class="traffic-light close"><span></span></div>
                    <div class="traffic-light minimize"><span></span></div>
                    <div class="traffic-light maximize"><span></span></div>
                </div>
                <div class="window-title">${title}</div>
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
        const activeMenuItem = document.querySelector('.menu-item.active');
        if (activeMenuItem) {
            activeMenuItem.textContent = title;
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
                e.target.parentElement.classList.contains('traffic-light')) {
                return;
            }

            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
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
                win.dataset.maximized = 'true';
            }
        });

        // Click on window brings to front
        win.addEventListener('mousedown', () => bringToFront(win));
    }

    // Finder Items (open sub-windows for blog posts, etc.)
    function setupFinderItems(win) {
        const items = win.querySelectorAll('.finder-item');
        items.forEach(item => {
            item.addEventListener('dblclick', () => {
                const windowId = item.dataset.window;
                const title = item.dataset.title;
                if (windowId && title) {
                    openWindow(windowId, title, { width: 700, height: 500 });
                }
            });
        });
    }

})();
