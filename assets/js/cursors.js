(function () {
    // Only run on desktop/larger screens to save bandwidth/performance on mobile
    if (window.matchMedia("(max-width: 768px)").matches) return;

    console.log("Initializing Multiplayer Cursors with Gun.js");

    // Initialize Gun
    // Using arweave.tech as the relay server
    const gun = Gun(['https://arweave.tech/gun']);

    // Generate or retrieve persistent ID for this user
    let myId = localStorage.getItem('multiplayer-cursor-id');
    if (!myId) {
        myId = Math.random().toString(36).substr(2, 9);
        localStorage.setItem('multiplayer-cursor-id', myId);
    }

    // Scope our app data locally to avoid collisions on public relays
    // "ankushkun-github-io-cursors" could be a good namespace
    const remoteCursors = gun.get('ankushkun-github-io-v1').get('cursors');

    const container = document.body;
    const cursorElements = {};
    const TIMEOUT_MS = 3000; // Remove cursor if no update for 10s

    // Create online count display
    const onlineCountEl = document.createElement('div');
    onlineCountEl.id = 'online-count';
    onlineCountEl.style.cssText = `
        position: fixed;
        bottom: 2px;
        left: 2px;
        background: #666;
        color: white;
        padding: 2px 4px;
        border-radius: 4px;
        font-size: 9px;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        z-index: 999999;
        pointer-events: none;
    `;
    container.appendChild(onlineCountEl);
    updateOnlineCount(); // Initialize with current user

    // Update online count display
    function updateOnlineCount() {
        const activeCount = Object.keys(cursorElements).length + 1; // +1 for current user
        onlineCountEl.textContent = `${activeCount} Online`;
    }

    // Throttle helper
    function throttle(func, limit) {
        let inThrottle;
        return function () {
            const args = arguments;
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        }
    }

    // Publish mouse position
    const updateMyPosition = throttle((e) => {
        const x = e.clientX / window.innerWidth;
        const y = e.pageY; // Absolute document position

        remoteCursors.get(myId).put({
            x: x,
            y: y,
            ts: Date.now()
        });
    }, 50); // 20 updates per second max

    window.addEventListener('mousemove', updateMyPosition);

    // cleanup only on actual browser close with longer delay
    // This allows navigation to preserve the cursor state
    window.addEventListener('beforeunload', () => {
        // Use a longer delay to allow page navigation to complete
        setTimeout(() => {
            remoteCursors.get(myId).put(null);
        }, 5000);
    });

    // Clear any stale cursor from previous browser session on load
    remoteCursors.get(myId).once((data) => {
        if (data && (Date.now() - data.ts > TIMEOUT_MS)) {
            // Clear stale cursor from previous session
            remoteCursors.get(myId).put(null);
        }
    });

    // Subscribe to updates
    remoteCursors.map().on((data, id) => {
        if (!data || id === myId) return; // Ignore null data or own cursor

        // Check if data is too old (stale cursor from previous session)
        if (Date.now() - data.ts > TIMEOUT_MS) {
            // If it's REALLY old (e.g. > 60s), remove from Gun entirely to keep graph clean
            if (Date.now() - data.ts > 60000) {
                remoteCursors.get(id).put(null);
            }
            removeCursor(id);
            return;
        }

        let el = cursorElements[id];

        if (!el) {
            // Create new cursor element
            el = document.createElement('div');
            el.className = 'remote-cursor';
            el.style.position = 'absolute';
            el.style.width = '20px';
            el.style.height = '20px';
            el.style.pointerEvents = 'none';
            el.style.zIndex = '999999';
            el.style.transition = 'transform 0.1s linear';
            el.style.top = '0';
            el.style.left = '0';

            // Custom cursor SVG
            el.innerHTML = `
                <img src="/icons/cursor.svg" width="24" height="24" alt="cursor" />
            `;

            container.appendChild(el);
            cursorElements[id] = el;
            updateOnlineCount();
        }

        // Update position
        const screenX = data.x * window.innerWidth;
        const screenY = data.y; // Absolute Y position
        el.style.transform = `translate(${screenX}px, ${screenY}px)`;

        // Update timestamp for cleanup
        el.dataset.lastSeen = Date.now();
        el.dataset.gunId = id; // Store ID for cleanup
    });

    // Periodic cleanup
    setInterval(() => {
        const now = Date.now();
        for (const id in cursorElements) {
            const el = cursorElements[id];
            const lastSeen = parseInt(el.dataset.lastSeen || 0);

            // Local visual cleanup (fast)
            if (now - lastSeen > TIMEOUT_MS) {
                removeCursor(id);
            }
        }
    }, 2000);

    // Occasional tough cleanup of Graph data
    setInterval(() => {
        const now = Date.now();
        // iterate known cursors and check if they should be nuked from Gun
        // (This relies on us having seen them recently-ish)
        for (const id in cursorElements) {
            const el = cursorElements[id];
            const lastSeen = parseInt(el.dataset.lastSeen || 0);
            if (now - lastSeen > 60000) {
                remoteCursors.get(id).put(null);
            }
        }
    }, 10000);

    function removeCursor(id) {
        if (cursorElements[id]) {
            cursorElements[id].remove();
            delete cursorElements[id];
            updateOnlineCount();
        }
    }

})();
