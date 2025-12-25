/**
 * v86 Linux Emulator Integration for Terminal
 * Uses v86 (x86 emulator in JavaScript/WebAssembly) with Linux
 * 
 * Uses v86's built-in xterm.js support via serial_container_xtermjs
 * which expects a DOM element (not a Terminal instance)
 */

(function () {
    'use strict';

    // ============================================================
    // BOOT PROFILES - Easy switching between different images
    // Change ACTIVE_PROFILE to switch boot images
    // ============================================================

    const BOOT_PROFILES = {
        // Still Alive - Musical demo (floppy boot, lightweight)
        stillalive: {
            name: 'Still Alive Demo',
            type: 'floppy',
            path: '/v86/floppy/stillalive.img',
            memory: 32 * 1024 * 1024,      // 32 MB
            vgaMemory: 8 * 1024 * 1024,    // 8 MB
        },

        // Linux 4 - Minimal Linux ISO
        linux4: {
            name: 'Linux 4 (ISO)',
            type: 'cdrom',
            path: '/v86/images/linux4.iso',
            memory: 64 * 1024 * 1024,      // 64 MB
            vgaMemory: 8 * 1024 * 1024,    // 8 MB
        },

        // NodeOS - Linux kernel bzImage (v4.8.5)
        // Uses VGA output (not serial) - matches official v86 demo
        nodeos: {
            name: 'NodeOS Kernel',
            type: 'bzimage',
            path: '/v86/images/nodeos-kernel.bin',
            memory: 128 * 1024 * 1024,     // 128 MB
            vgaMemory: 8 * 1024 * 1024,    // 8 MB
            // Official v86 cmdline - uses VGA, not serial console
            cmdline: 'tsc=reliable mitigations=off random.trust_cpu=on',
            // Use VGA output (not serial)
            vga: true,
        },

        // Buildroot - Minimal Linux kernel v5.6.15 with busybox
        buildroot: {
            name: 'Buildroot Linux',
            type: 'bzimage',
            path: '/v86/bzimage/buildroot.bin',
            memory: 64 * 1024 * 1024,      // 64 MB
            vgaMemory: 8 * 1024 * 1024,    // 8 MB
            cmdline: 'tsc=reliable mitigations=off random.trust_cpu=on',
            // vga: true
        },
    };

    // ============================================================
    // DEFAULT PROFILE
    // ============================================================
    const DEFAULT_PROFILE = 'buildroot';

    // ============================================================
    // v86 Core Configuration
    // ============================================================
    const V86_CORE = {
        libv86Url: '/v86/libv86.js',
        wasmUrl: '/v86/v86.wasm',
        biosUrl: '/v86/seabios.bin',
        vgaBiosUrl: '/v86/vgabios.bin',
    };

    // State
    let v86Emulator = null;
    let v86Loaded = false;
    let displayMode = 'vga'; // 'vga' or 'serial'
    let inputCaptured = false;
    let currentProfile = null;
    let currentScreenContainer = null;
    let currentWindowElement = null;
    let serialFitAddon = null;
    let loaderOverlay = null;
    let autoSaveInterval = null;
    let currentTerminalId = null;
    let autoSaveEnabled = false; // Can be toggled via toolbar
    let saveOnCloseEnabled = false; // Save state when window/tab closes

    // ============================================================
    // IndexedDB State Persistence
    // ============================================================
    const DB_NAME = 'v86_state_db';
    const DB_VERSION = 1;
    const STORE_NAME = 'emulator_states';
    const AUTO_SAVE_INTERVAL_MS = 15000; // Auto-save every 15 seconds

    // Open IndexedDB database
    function openStateDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };
        });
    }

    // State save status indicator (shows in window title)
    let saveStatusTimeout = null;
    let originalWindowTitle = null;

    function showSaveStatus(message, isComplete = false) {
        if (!currentWindowElement) return;

        // Update window title
        const titleElement = currentWindowElement.querySelector('.window-title');
        if (!titleElement) return;

        // Store original title if not already stored
        if (!originalWindowTitle) {
            originalWindowTitle = titleElement.textContent;
        }

        // Update title with status
        titleElement.textContent = `${originalWindowTitle} - ${message}`;

        // Clear any existing timeout
        if (saveStatusTimeout) {
            clearTimeout(saveStatusTimeout);
            saveStatusTimeout = null;
        }

        // Auto-restore title after 2 seconds if complete
        if (isComplete) {
            saveStatusTimeout = setTimeout(() => {
                if (titleElement && originalWindowTitle) {
                    titleElement.textContent = originalWindowTitle;
                }
            }, 2000);
        }
    }

    // Capture xterm.js terminal buffer content
    function captureTerminalBuffer() {
        if (!v86Emulator?.serial_adapter?.term) {
            return null;
        }

        try {
            const term = v86Emulator.serial_adapter.term;
            const buffer = term.buffer.active;
            const lines = [];

            // Capture all lines in the buffer (scrollback + viewport)
            const totalLines = buffer.length;
            // Limit to last 1000 lines to keep state size reasonable
            const startLine = Math.max(0, totalLines - 1000);

            for (let i = startLine; i < totalLines; i++) {
                const line = buffer.getLine(i);
                if (line) {
                    lines.push(line.translateToString(true));
                }
            }

            // Also capture cursor position
            return {
                lines: lines,
                cursorX: buffer.cursorX,
                cursorY: buffer.cursorY,
            };
        } catch (e) {
            console.warn('Could not capture terminal buffer:', e);
            return null;
        }
    }

    // Restore terminal buffer content
    function restoreTerminalBuffer(terminalData) {
        if (!terminalData?.lines || !v86Emulator?.serial_adapter?.term) {
            return false;
        }

        try {
            const term = v86Emulator.serial_adapter.term;

            // Clear current terminal
            term.clear();

            // Write back the saved lines
            // Join with newlines but don't add trailing newline to preserve cursor position
            const content = terminalData.lines.join('\r\n');
            term.write(content);

            // Add a newline at the end to show the prompt properly
            term.write('\r\n');

            console.log(`Restored ${terminalData.lines.length} lines of terminal history`);
            return true;
        } catch (e) {
            console.warn('Could not restore terminal buffer:', e);
            return false;
        }
    }

    // Save emulator state to IndexedDB
    async function saveEmulatorState(terminalId) {
        if (!v86Emulator || !v86Loaded) {
            console.log('Cannot save state: emulator not ready');
            return false;
        }

        try {
            showSaveStatus('[saving state...]');
            console.log('Saving v86 state...');
            const state = await v86Emulator.save_state();
            const db = await openStateDB();

            return new Promise((resolve, reject) => {
                const transaction = db.transaction([STORE_NAME], 'readwrite');
                const store = transaction.objectStore(STORE_NAME);

                // Also capture terminal buffer for serial mode
                const terminalBuffer = captureTerminalBuffer();

                const record = {
                    id: terminalId || currentTerminalId || 'default',
                    state: state,
                    profile: currentProfile ? Object.keys(BOOT_PROFILES).find(k => BOOT_PROFILES[k] === currentProfile) : DEFAULT_PROFILE,
                    savedAt: Date.now(),
                    displayMode: displayMode,
                    terminalBuffer: terminalBuffer
                };

                const request = store.put(record);
                request.onsuccess = () => {
                    console.log(`State saved (${formatBytes(state.byteLength)})`);
                    showSaveStatus(`[saved state (${formatBytes(state.byteLength)})]`, true);
                    resolve(true);
                };
                request.onerror = () => {
                    showSaveStatus('[save failed]', true);
                    reject(request.error);
                };
            });
        } catch (error) {
            console.error('Failed to save emulator state:', error);
            showSaveStatus('[save failed]', true);
            return false;
        }
    }

    // Load emulator state from IndexedDB
    async function loadEmulatorState(terminalId) {
        try {
            const db = await openStateDB();

            return new Promise((resolve, reject) => {
                const transaction = db.transaction([STORE_NAME], 'readonly');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.get(terminalId || 'default');

                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.error('Failed to load emulator state:', error);
            return null;
        }
    }

    // Delete saved state from IndexedDB
    async function clearEmulatorState(terminalId) {
        try {
            const db = await openStateDB();

            return new Promise((resolve, reject) => {
                const transaction = db.transaction([STORE_NAME], 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.delete(terminalId || currentTerminalId || 'default');

                request.onsuccess = () => {
                    console.log('Saved state cleared');
                    resolve(true);
                };
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.error('Failed to clear emulator state:', error);
            return false;
        }
    }

    // Restore emulator from saved state
    async function restoreFromSavedState(savedState) {
        if (!v86Emulator || !savedState?.state) {
            return false;
        }

        try {
            console.log('Restoring saved state...');
            await v86Emulator.restore_state(savedState.state);
            console.log('State restored successfully!');

            // Restore display mode
            if (savedState.displayMode && savedState.displayMode !== displayMode) {
                const screenContainer = currentScreenContainer;
                const serialContainer = screenContainer?.parentElement?.querySelector('.v86-serial-container');
                setDisplayMode(savedState.displayMode, screenContainer, serialContainer);
            }

            // Restore terminal buffer content (for serial mode)
            if (savedState.terminalBuffer) {
                // Small delay to ensure terminal is ready
                setTimeout(() => {
                    restoreTerminalBuffer(savedState.terminalBuffer);
                }, 100);
            }

            return true;
        } catch (error) {
            console.error('Failed to restore state:', error);
            return false;
        }
    }

    // Start auto-save interval
    function startAutoSave(terminalId) {
        stopAutoSave(); // Clear any existing interval

        // Only enable auto-save for 'terminal' window, not portal or others
        if (terminalId !== 'terminal') {
            console.log('Auto-save not available for this window type');
            return;
        }

        if (!autoSaveEnabled) {
            console.log('Auto-save disabled');
            return;
        }

        autoSaveInterval = setInterval(() => {
            if (v86Emulator && v86Loaded && autoSaveEnabled && currentTerminalId === 'terminal') {
                saveEmulatorState(terminalId).catch(console.error);
            }
        }, AUTO_SAVE_INTERVAL_MS);

        // Save state when tab becomes hidden or before unload
        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('beforeunload', handleBeforeUnload);

        console.log(`Auto-save enabled (every ${AUTO_SAVE_INTERVAL_MS / 1000}s)`);
    }

    // Stop auto-save interval
    function stopAutoSave() {
        if (autoSaveInterval) {
            clearInterval(autoSaveInterval);
            autoSaveInterval = null;
        }
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('beforeunload', handleBeforeUnload);
    }

    // Toggle auto-save
    function setAutoSaveEnabled(enabled) {
        autoSaveEnabled = enabled;
        if (enabled && currentTerminalId) {
            startAutoSave(currentTerminalId);
        } else {
            stopAutoSave();
        }
        console.log(`Auto-save ${enabled ? 'enabled' : 'disabled'}`);
    }

    // Handle visibility change (tab hidden/visible)
    function handleVisibilityChange() {
        // Only auto-save for 'terminal' window
        if (document.hidden && v86Emulator && v86Loaded && autoSaveEnabled && currentTerminalId === 'terminal') {
            saveEmulatorState().catch(console.error);
        }
    }

    // Handle before unload (tab closing)
    function handleBeforeUnload() {
        // Only save on close for 'terminal' window
        if (v86Emulator && v86Loaded && saveOnCloseEnabled && currentTerminalId === 'terminal') {
            saveEmulatorState().catch(console.error);
        }
    }

    // ============================================================
    // State Management Toolbar
    // ============================================================

    function createToolbar(container) {
        if (!currentWindowElement) return null;

        // Only show state management toolbar for 'terminal' window, not portal or others
        if (currentTerminalId !== 'terminal') return null;

        // Find the title bar
        const titleBar = currentWindowElement.querySelector('.window-titlebar');
        if (!titleBar) return null;

        // Create dropdown button (arrow) for title bar
        const dropdownBtn = document.createElement('button');
        dropdownBtn.className = 'v86-dropdown-btn';
        dropdownBtn.innerHTML = '▼';
        dropdownBtn.title = 'State management options';

        // Create toolbar/dropdown menu
        const toolbar = document.createElement('div');
        toolbar.className = 'v86-toolbar';
        toolbar.innerHTML = `
            <div class="v86-toolbar-row">
                <button class="v86-toolbar-btn" data-action="save" title="Save state now">💾 Save</button>
                <button class="v86-toolbar-btn" data-action="load" title="Load saved state">📂 Load</button>
            </div>
            <div class="v86-toolbar-divider"></div>
            <button class="v86-toolbar-btn danger" data-action="reset" title="Delete saved state">🗑️ Reset</button>
            <div class="v86-toolbar-divider"></div>
            <label class="v86-toolbar-checkbox">
                <input type="checkbox" id="v86-autosave-toggle" ${autoSaveEnabled ? 'checked' : ''}>
                <span>Auto-save (15s)</span>
            </label>
            <label class="v86-toolbar-checkbox">
                <input type="checkbox" id="v86-save-on-close" ${saveOnCloseEnabled ? 'checked' : ''}>
                <span>Save on close</span>
            </label>
        `;

        // Toggle dropdown visibility
        let isOpen = false;
        function toggleDropdown(e) {
            e.stopPropagation();
            isOpen = !isOpen;
            toolbar.classList.toggle('open', isOpen);
            dropdownBtn.classList.toggle('open', isOpen);
        }

        function closeDropdown() {
            isOpen = false;
            toolbar.classList.remove('open');
            dropdownBtn.classList.remove('open');
        }

        dropdownBtn.addEventListener('click', toggleDropdown);

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (isOpen && !toolbar.contains(e.target) && e.target !== dropdownBtn) {
                closeDropdown();
            }
        });

        // Add event listeners for toolbar actions
        toolbar.querySelector('[data-action="save"]').addEventListener('click', async (e) => {
            e.stopPropagation();
            if (v86Emulator && v86Loaded) {
                await saveEmulatorState();
            }
        });

        toolbar.querySelector('[data-action="load"]').addEventListener('click', async (e) => {
            e.stopPropagation();
            const savedState = await loadEmulatorState(currentTerminalId);
            if (savedState) {
                await restoreFromSavedState(savedState);
                showSaveStatus('state loaded ✓', true);
            } else {
                showSaveStatus('no saved state', true);
            }
        });

        toolbar.querySelector('[data-action="reset"]').addEventListener('click', async (e) => {
            e.stopPropagation();
            if (confirm('Delete saved state and restart? The terminal will reboot fresh.')) {
                await clearEmulatorState(currentTerminalId);
                closeDropdown();

                // Temporarily disable save on close to prevent saving during restart
                saveOnCloseEnabled = false;

                // Store the terminal ID before closing
                const termId = currentTerminalId;

                // Find and close the terminal window, then reopen it
                const win = currentWindowElement;
                if (win) {
                    // Close the window by clicking the close button
                    const closeBtn = win.querySelector('.traffic-light.close');
                    if (closeBtn) {
                        closeBtn.click();
                    }

                    // Reopen the terminal window after a short delay
                    setTimeout(() => {
                        // Use the global openWindow function from mavericks.js
                        if (window.openContentWindow) {
                            window.openContentWindow(termId, 'Terminal', null);
                        }
                    }, 300);
                }
            }
        });

        toolbar.querySelector('#v86-autosave-toggle').addEventListener('change', (e) => {
            e.stopPropagation();
            setAutoSaveEnabled(e.target.checked);
        });

        toolbar.querySelector('#v86-save-on-close').addEventListener('change', (e) => {
            e.stopPropagation();
            saveOnCloseEnabled = e.target.checked;
            console.log(`Save on close ${saveOnCloseEnabled ? 'enabled' : 'disabled'}`);
        });

        // Prevent toolbar interactions from affecting the terminal
        toolbar.addEventListener('mousedown', (e) => e.stopPropagation());
        toolbar.addEventListener('keydown', (e) => e.stopPropagation());

        // Add button and toolbar to title bar
        titleBar.appendChild(dropdownBtn);
        titleBar.appendChild(toolbar);

        return toolbar;
    }

    // ============================================================
    // Download Progress Loader
    // ============================================================

    // Format bytes to human readable
    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    // Create loader overlay
    function createLoaderOverlay(container) {
        const overlay = document.createElement('div');
        overlay.className = 'v86-loader-overlay';
        overlay.innerHTML = `
            <div class="v86-loader-content">
                <div class="v86-loader-title">v86 Linux Emulator</div>
                <div class="v86-loader-status">Initializing...</div>
                <div class="v86-loader-progress-line">
                    <span class="v86-loader-percent">0%</span>
                    <div class="v86-loader-bar-container">
                        <span class="v86-loader-bar-bracket">[</span>
                        <span class="v86-loader-bar"></span>
                        <span class="v86-loader-bar-bracket">]</span>
                    </div>
                </div>
                <div class="v86-loader-size">Preparing...</div>
            </div>
        `;
        container.appendChild(overlay);
        return overlay;
    }

    // Update loader progress
    function updateLoaderProgress(overlay, loaded, fileSize, fileName) {
        if (!overlay) return;

        const percent = fileSize > 0 ? Math.round((loaded / fileSize) * 100) : 0;
        const barWidth = 25; // characters (reduced to fit smaller screens)
        const filledChars = Math.round((percent / 100) * barWidth);
        const emptyChars = Math.max(0, barWidth - filledChars);
        const bar = '#'.repeat(filledChars) + ' '.repeat(emptyChars);

        // Update status text
        const statusText = fileName
            ? `Downloading <span style="color: #4ec9b0;">${fileName}</span>`
            : 'Downloading resources...';

        overlay.querySelector('.v86-loader-status').innerHTML = statusText;
        overlay.querySelector('.v86-loader-percent').textContent = percent + '%';
        overlay.querySelector('.v86-loader-bar').textContent = bar;

        const sizeText = fileSize > 0
            ? `${formatBytes(loaded)} / ${formatBytes(fileSize)}`
            : formatBytes(loaded);
        overlay.querySelector('.v86-loader-size').textContent = sizeText;
    }

    // Hide loader overlay
    function hideLoaderOverlay(overlay) {
        if (!overlay) return;
        overlay.classList.add('hidden');
        // Remove after transition
        setTimeout(() => {
            overlay.remove();
        }, 300);
    }

    // Load v86 library dynamically
    function loadV86Script() {
        return new Promise((resolve, reject) => {
            if (window.V86) {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = V86_CORE.libv86Url;
            script.onload = resolve;
            script.onerror = () => reject(new Error('Failed to load v86'));
            document.head.appendChild(script);
        });
    }

    // Load xterm.js, FitAddon, and v86 CSS lazily
    let xtermLoading = null;
    function loadXterm() {
        if (xtermLoading) return xtermLoading;
        if (typeof Terminal !== 'undefined' && typeof FitAddon !== 'undefined') {
            return Promise.resolve();
        }

        xtermLoading = new Promise((resolve, reject) => {
            // Load v86 CSS
            if (window.V86_CSS_URL) {
                const v86Link = document.createElement('link');
                v86Link.rel = 'stylesheet';
                v86Link.href = window.V86_CSS_URL;
                document.head.appendChild(v86Link);
            }

            // Load xterm CSS
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = '/xterm/xterm.css';
            document.head.appendChild(link);

            // Load xterm.js
            const xtermScript = document.createElement('script');
            xtermScript.src = '/xterm/xterm.js';
            xtermScript.onload = () => {
                // Load FitAddon after xterm
                const addonScript = document.createElement('script');
                addonScript.src = '/xterm/addon.js';
                addonScript.onload = resolve;
                addonScript.onerror = () => reject(new Error('Failed to load xterm-addon-fit'));
                document.head.appendChild(addonScript);
            };
            xtermScript.onerror = () => reject(new Error('Failed to load xterm.js'));
            document.head.appendChild(xtermScript);
        });

        return xtermLoading;
    }

    // Switch display mode between VGA and Serial
    function setDisplayMode(mode, screenContainer, serialContainer) {
        if (mode === displayMode) return;

        console.log(`Switching to ${mode} mode`);
        displayMode = mode;

        if (mode === 'serial') {
            // Show serial, hide VGA
            if (serialContainer) serialContainer.style.display = 'block';
            if (screenContainer) screenContainer.style.display = 'none';

            // Fit the terminal after it becomes visible
            if (serialFitAddon) {
                setTimeout(() => {
                    serialFitAddon.fit();
                    console.log('Serial terminal fitted on mode switch');
                }, 50);
            }
        } else {
            // Show VGA, hide serial
            if (serialContainer) serialContainer.style.display = 'none';
            if (screenContainer) screenContainer.style.display = 'flex';
        }
    }

    // Setup v86 terminal with VGA and Serial support
    async function setupV86Terminal(terminalId) {
        // Find the window element
        const windowElement = document.querySelector(`[data-window-id="${terminalId}"]`);
        if (!windowElement) {
            console.log('v86 window not found, waiting...');
            setTimeout(() => setupV86Terminal(terminalId), 100);
            return;
        }

        // Find containers
        const contentContainer = windowElement.querySelector('.v86-terminal-container');
        if (!contentContainer) {
            console.log('v86 terminal container not found');
            return;
        }

        const screenContainer = contentContainer.querySelector('.v86-screen-container');
        const serialContainer = contentContainer.querySelector('.v86-serial-container');
        const xtermContainer = serialContainer?.querySelector('.v86-xterm');

        if (!screenContainer) {
            console.log('v86 screen container not found');
            return;
        }

        // Store terminal ID for state persistence
        currentTerminalId = terminalId;

        // Check for saved state
        const savedState = await loadEmulatorState(terminalId);
        if (savedState) {
            const savedTime = new Date(savedState.savedAt).toLocaleString();
            console.log(`Found saved state from ${savedTime} (profile: ${savedState.profile})`);
        }

        try {
            console.log('Loading xterm.js and v86...');
            await Promise.all([loadXterm(), loadV86Script()]);

            console.log('Initializing v86 emulator...');

            // Determine profile based on ID
            let profileKey = DEFAULT_PROFILE;
            if (terminalId === 'portal') {
                profileKey = 'stillalive';
            }

            // Build v86 options
            const profile = BOOT_PROFILES[profileKey];
            if (!profile) {
                throw new Error(`Unknown boot profile: ${profileKey}`);
            }

            console.log(`Booting: ${profile.name}`);

            // cleanup existing emulator if any
            if (v86Emulator) {
                destroyV86();
            }

            // Store profile and containers for input capture
            currentProfile = profile;
            currentScreenContainer = screenContainer;
            currentWindowElement = windowElement;

            // Create loader overlay for download progress
            loaderOverlay = createLoaderOverlay(contentContainer);

            // Create state management toolbar
            createToolbar(contentContainer);

            // Track download progress
            let downloadedFiles = 0;
            let totalFiles = 4; // bios, vga_bios, wasm, boot image
            let currentFileLoaded = 0;
            let currentFileSize = 0;

            const options = {
                wasm_path: V86_CORE.wasmUrl,
                memory_size: profile.memory,
                vga_memory_size: profile.vgaMemory,
                screen_container: screenContainer,

                // v86's built-in xterm.js support expects a DOM element!
                // v86 will create its own Terminal and call open() on this element
                serial_container_xtermjs: xtermContainer,

                // If vga mode, we manage keyboard/mouse capture manually
                // Otherwise disable them for serial mode
                disable_keyboard: !profile.vga,
                disable_mouse: !profile.vga,

                bios: { url: V86_CORE.biosUrl },
                vga_bios: { url: V86_CORE.vgaBiosUrl },

                // public relay server for networking
                net_device: {
                    relay_url: "wss://relay.widgetry.org/",
                    // relay_url: "fetch",
                    type: "ne2k",
                },

                autostart: true,
            };

            // Add boot device based on type
            switch (profile.type) {
                case 'floppy':
                    options.fda = { url: profile.path };
                    break;
                case 'cdrom':
                    options.cdrom = { url: profile.path };
                    break;
                case 'bzimage':
                    options.bzimage = { url: profile.path };
                    if (profile.cmdline) {
                        options.cmdline = profile.cmdline;
                    }
                    break;
                case 'hda':
                    options.hda = { url: profile.path };
                    break;
            }

            v86Emulator = new V86(options);

            // Track if we've received serial output
            let serialOutputReceived = false;

            // Listen for serial output to switch display mode
            // Only switch if the profile doesn't have vga: true
            v86Emulator.add_listener("serial0-output-byte", function (byte) {
                if (!serialOutputReceived && !profile.vga) {
                    serialOutputReceived = true;
                    console.log('Serial output detected, switching to serial mode');
                    setDisplayMode('serial', screenContainer, serialContainer);
                }
            });

            // Listen for emulator events
            v86Emulator.add_listener("emulator-ready", async function () {
                console.log('v86 emulator ready!');

                // Try to attach FitAddon to v86's xterm terminal
                if (v86Emulator.serial_adapter && v86Emulator.serial_adapter.term) {
                    try {
                        const term = v86Emulator.serial_adapter.term;
                        if (typeof FitAddon !== 'undefined') {
                            serialFitAddon = new FitAddon.FitAddon();
                            term.loadAddon(serialFitAddon);
                            setTimeout(() => {
                                serialFitAddon.fit();
                                console.log('Serial terminal fitted');
                            }, 100);

                            // Re-fit on container resize
                            if (serialContainer) {
                                const resizeObserver = new ResizeObserver(() => {
                                    serialFitAddon.fit();
                                });
                                resizeObserver.observe(serialContainer);
                            }
                        }
                    } catch (e) {
                        console.warn('Could not attach FitAddon to v86 terminal:', e);
                    }
                }

                // Restore saved state if available
                if (savedState) {
                    // Small delay to ensure emulator is fully initialized
                    setTimeout(async () => {
                        const restored = await restoreFromSavedState(savedState);
                        if (restored) {
                            console.log('Emulator restored from saved state!');
                        }
                    }, 500);
                }
            });

            v86Emulator.add_listener("emulator-started", function () {
                console.log('v86 emulator started!');
                // Hide loader when emulator starts
                if (loaderOverlay) {
                    hideLoaderOverlay(loaderOverlay);
                    loaderOverlay = null;
                }
            });

            // Listen for download progress
            v86Emulator.add_listener("download-progress", function (e) {
                const { file_name, file_index, file_count, loaded, total } = e;

                // Update progress display
                updateLoaderProgress(
                    loaderOverlay,
                    loaded,
                    total,
                    file_name ? file_name.split('/').pop() : null
                );
            });

            // Setup VGA input capture if profile uses VGA
            if (profile.vga) {
                setupVGAInputCapture(screenContainer, windowElement);
            }

            // Start auto-save for state persistence
            startAutoSave(terminalId);

            v86Loaded = true;
            console.log('v86 setup complete!');

        } catch (error) {
            console.error('v86 loading error:', error);
        }
    }

    // Toggle VGA input capture
    function setInputCapture(enabled) {
        if (!v86Emulator || !currentProfile?.vga) return;

        inputCaptured = enabled;
        v86Emulator.keyboard_set_enabled(enabled);
        v86Emulator.mouse_set_enabled(enabled);

        // Update visual indicator
        if (currentScreenContainer) {
            currentScreenContainer.classList.toggle('input-captured', enabled);
        }

        console.log(`Input capture: ${enabled ? 'LOCKED' : 'UNLOCKED'}`);
    }

    // Setup VGA input capture handlers
    function setupVGAInputCapture(screenContainer, windowElement) {
        // Start with input NOT captured
        setInputCapture(false);

        // Click on screen to capture input
        screenContainer.addEventListener('click', () => {
            if (!inputCaptured) {
                setInputCapture(true);
            }
        });

        // Escape key releases capture
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && inputCaptured) {
                e.preventDefault();
                e.stopPropagation();
                setInputCapture(false);
            }
        });

        // Click outside window releases capture
        document.addEventListener('mousedown', (e) => {
            if (inputCaptured && windowElement && !windowElement.contains(e.target)) {
                setInputCapture(false);
            }
        });

        // Add hint overlay
        const hint = document.createElement('div');
        hint.className = 'v86-keyboard-hint';
        hint.innerHTML = 'Click to capture input • <kbd>Esc</kbd> to release';
        screenContainer.appendChild(hint);
    }

    // Cleanup when terminal window is closed
    async function destroyV86() {
        // Stop auto-save
        stopAutoSave();

        // Save state before closing (if enabled and this is the terminal window)
        if (saveOnCloseEnabled && v86Emulator && v86Loaded && currentTerminalId === 'terminal') {
            try {
                await saveEmulatorState();
                console.log('State saved before closing');
            } catch (e) {
                console.warn('Could not save state before closing:', e);
            }
        }

        // Release input capture first
        if (inputCaptured) {
            setInputCapture(false);
        }

        // Remove loader overlay if still visible
        if (loaderOverlay) {
            loaderOverlay.remove();
            loaderOverlay = null;
        }

        if (v86Emulator) {
            v86Emulator.stop();
            v86Emulator = null;
        }
        v86Loaded = false;
        displayMode = 'vga';
        inputCaptured = false;
        currentProfile = null;
        currentScreenContainer = null;
        currentWindowElement = null;
        currentTerminalId = null;
    }

    // Expose functions globally
    window.setupV86Terminal = setupV86Terminal;
    window.destroyV86 = destroyV86;

    // Expose state management functions
    window.saveV86State = saveEmulatorState;
    window.clearV86State = clearEmulatorState;
    window.loadV86State = loadEmulatorState;

    // Expose for debugging
    window.V86_PROFILES = BOOT_PROFILES;
    window.V86_ACTIVE = DEFAULT_PROFILE;

})();
