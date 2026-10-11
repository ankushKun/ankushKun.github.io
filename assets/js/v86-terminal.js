/**
 * v86 Linux Emulator Integration for Terminal
 * Uses v86 (x86 emulator in JavaScript/WebAssembly) with Linux
 *
 * Uses v86's built-in xterm.js support via serial_container_xtermjs
 * which expects a DOM element (not a Terminal instance)
 *
 * State is per-window: Terminal and Portal each get their own emulator
 * instance, keyed by window id, so opening or closing one never touches
 * the other.
 *
 * The Terminal window opens on a JS shell first (assets/js/terminal-shell.js,
 * see setupV86Terminal) and boots Linux only when the visitor types `linux`.
 */

(function () {
    'use strict';

    // ============================================================
    // BOOT PROFILES - one per window: Terminal boots DEFAULT_PROFILE,
    // Portal boots 'stillalive'. Only images listed here are deployed.
    // ============================================================

    // Verbose logging is off in production; flip to true when debugging.
    const DEBUG = false;
    const log = DEBUG ? console.log.bind(console) : function () { };

    const BOOT_PROFILES = {
        // Still Alive - Musical demo (floppy boot, lightweight)
        stillalive: {
            name: 'Still Alive Demo',
            type: 'floppy',
            path: '/v86/floppy/stillalive.img',
            memory: 32 * 1024 * 1024,      // 32 MB
            vgaMemory: 8 * 1024 * 1024,    // 8 MB
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

    // Which window id is allowed to persist state to IndexedDB.
    const PERSISTED_WINDOW_ID = 'terminal';

    // ============================================================
    // v86 Core Configuration
    // ============================================================
    const V86_CORE = {
        libv86Url: '/v86/libv86.js',
        wasmUrl: '/v86/v86.wasm',
        biosUrl: '/v86/seabios.bin',
        vgaBiosUrl: '/v86/vgabios.bin',
    };

    // ============================================================
    // Per-window instance registry
    // ============================================================
    // terminalId -> instance. Every piece of mutable emulator state lives on an
    // instance so Terminal and Portal can run side by side.
    const instances = new Map();

    // Save toggles are remembered across visits (Terminal window only).
    const PREF_AUTOSAVE = 'v86-autosave';
    const PREF_SAVE_ON_CLOSE = 'v86-save-on-close';

    function readPref(key) {
        try { return localStorage.getItem(key) === '1'; } catch (e) { return false; }
    }

    function writePref(key, enabled) {
        try { localStorage.setItem(key, enabled ? '1' : '0'); } catch (e) { /* ignore */ }
    }

    function createInstance(terminalId) {
        const persisted = terminalId === PERSISTED_WINDOW_ID;
        return {
            id: terminalId,
            emulator: null,
            loaded: false,
            displayMode: 'vga',        // 'vga' or 'serial'
            inputCaptured: false,
            profile: null,
            screenContainer: null,
            serialContainer: null,
            windowElement: null,
            fitAddon: null,
            resizeObserver: null,
            loaderOverlay: null,
            autoSaveInterval: null,
            autoSaveEnabled: persisted && readPref(PREF_AUTOSAVE),         // Can be toggled via toolbar
            saveOnCloseEnabled: persisted && readPref(PREF_SAVE_ON_CLOSE), // Save state when window/tab closes
            saving: null,              // In-flight save promise (saves never overlap)
            failed: false,             // Setup or a download failed; error panel is showing
            started: false,            // Emulator has booted at least once
            pausedByShell: false,      // Stopped via pauseV86() (window minimized)
            saveStatusTimeout: null,
            originalWindowTitle: null,
            // Teardown callbacks for every document/window listener and observer
            // this instance registers. Without these the listeners outlive the window.
            cleanups: [],
        };
    }

    function getInstance(terminalId) {
        return instances.get(terminalId) || null;
    }

    /** Register a listener and return a remover, tracked for teardown. */
    function addTrackedListener(inst, target, type, handler, options) {
        target.addEventListener(type, handler, options);
        inst.cleanups.push(() => target.removeEventListener(type, handler, options));
    }

    function runCleanups(inst) {
        inst.cleanups.forEach((fn) => {
            try { fn(); } catch (e) { /* ignore */ }
        });
        inst.cleanups = [];
    }

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
    function showSaveStatus(inst, message, isComplete = false) {
        if (!inst || !inst.windowElement) return;

        // Update the title text span, not the whole titlebar
        const titleElement = inst.windowElement.querySelector('.window-title-text')
            || inst.windowElement.querySelector('.window-title');
        if (!titleElement) return;

        if (!inst.originalWindowTitle) {
            inst.originalWindowTitle = titleElement.textContent;
        }

        titleElement.textContent = `${inst.originalWindowTitle} - ${message}`;

        if (inst.saveStatusTimeout) {
            clearTimeout(inst.saveStatusTimeout);
            inst.saveStatusTimeout = null;
        }

        if (isComplete) {
            inst.saveStatusTimeout = setTimeout(() => {
                if (titleElement && inst.originalWindowTitle) {
                    titleElement.textContent = inst.originalWindowTitle;
                }
            }, 2000);
        }
    }

    // Capture xterm.js terminal buffer content
    function captureTerminalBuffer(inst) {
        if (!inst.emulator?.serial_adapter?.term) {
            return null;
        }

        try {
            const term = inst.emulator.serial_adapter.term;
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
    function restoreTerminalBuffer(inst, terminalData) {
        if (!terminalData?.lines || !inst.emulator?.serial_adapter?.term) {
            return false;
        }

        try {
            const term = inst.emulator.serial_adapter.term;

            // Clear current terminal
            term.clear();

            // Write back the saved lines
            // Join with newlines but don't add trailing newline to preserve cursor position
            const content = terminalData.lines.join('\r\n');
            term.write(content);

            // Add a newline at the end to show the prompt properly
            term.write('\r\n');

            log(`Restored ${terminalData.lines.length} lines of terminal history`);
            return true;
        } catch (e) {
            console.warn('Could not restore terminal buffer:', e);
            return false;
        }
    }

    // Save emulator state to IndexedDB. A snapshot is the whole guest RAM, so
    // overlapping requests (interval + tab hidden + close) share one write.
    function saveEmulatorState(inst) {
        if (!inst) return Promise.resolve(false);
        if (inst.saving) return inst.saving;
        inst.saving = writeEmulatorState(inst).finally(() => { inst.saving = null; });
        return inst.saving;
    }

    async function writeEmulatorState(inst) {
        if (!inst || !inst.emulator || !inst.loaded) {
            log('Cannot save state: emulator not ready');
            return false;
        }

        try {
            showSaveStatus(inst, '[saving state...]');
            log('Saving v86 state...');
            const state = await inst.emulator.save_state();
            const db = await openStateDB();

            return new Promise((resolve, reject) => {
                const transaction = db.transaction([STORE_NAME], 'readwrite');
                const store = transaction.objectStore(STORE_NAME);

                // Also capture terminal buffer for serial mode
                const terminalBuffer = captureTerminalBuffer(inst);

                const record = {
                    id: inst.id,
                    state: state,
                    profile: inst.profile
                        ? Object.keys(BOOT_PROFILES).find(k => BOOT_PROFILES[k] === inst.profile)
                        : DEFAULT_PROFILE,
                    savedAt: Date.now(),
                    displayMode: inst.displayMode,
                    terminalBuffer: terminalBuffer
                };

                const request = store.put(record);
                request.onsuccess = () => {
                    log(`State saved (${formatBytes(state.byteLength)})`);
                    showSaveStatus(inst, `[saved state (${formatBytes(state.byteLength)})]`, true);
                    resolve(true);
                };
                request.onerror = () => {
                    showSaveStatus(inst, '[save failed]', true);
                    reject(request.error);
                };
            });
        } catch (error) {
            console.error('Failed to save emulator state:', error);
            showSaveStatus(inst, '[save failed]', true);
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
                const request = store.get(terminalId || PERSISTED_WINDOW_ID);

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
                const request = store.delete(terminalId || PERSISTED_WINDOW_ID);

                request.onsuccess = () => {
                    log('Saved state cleared');
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
    async function restoreFromSavedState(inst, savedState) {
        if (!inst || !inst.emulator || !savedState?.state) {
            return false;
        }

        try {
            log('Restoring saved state...');
            await inst.emulator.restore_state(savedState.state);
            log('State restored successfully!');

            // Restore display mode
            if (savedState.displayMode && savedState.displayMode !== inst.displayMode) {
                setDisplayMode(inst, savedState.displayMode);
            }

            // Restore terminal buffer content (for serial mode)
            if (savedState.terminalBuffer) {
                // Small delay to ensure terminal is ready
                setTimeout(() => {
                    restoreTerminalBuffer(inst, savedState.terminalBuffer);
                }, 100);
            }

            return true;
        } catch (error) {
            console.error('Failed to restore state:', error);
            return false;
        }
    }

    // Start auto-save interval
    function startAutoSave(inst) {
        stopAutoSave(inst); // Clear any existing interval

        // Only persist the main Terminal window, not Portal or others
        if (inst.id !== PERSISTED_WINDOW_ID) {
            log('Auto-save not available for this window type');
            return;
        }

        if (!inst.autoSaveEnabled) {
            log('Auto-save disabled');
            return;
        }

        inst.autoSaveInterval = setInterval(() => {
            if (inst.emulator && inst.loaded && inst.autoSaveEnabled) {
                saveEmulatorState(inst).catch(console.error);
            }
        }, AUTO_SAVE_INTERVAL_MS);

        log(`Auto-save enabled (every ${AUTO_SAVE_INTERVAL_MS / 1000}s)`);
    }

    // Stop auto-save interval
    function stopAutoSave(inst) {
        if (inst.autoSaveInterval) {
            clearInterval(inst.autoSaveInterval);
            inst.autoSaveInterval = null;
        }
    }

    // Save when the tab is hidden or the page is going away, if either toggle
    // is on. The write is an async IndexedDB transaction, which a beforeunload
    // handler cannot reliably finish; visibilitychange fires early enough
    // (tab switch, app switch, close on mobile) and pagehide covers the rest.
    function setupLifecycleSave(inst) {
        if (inst.id !== PERSISTED_WINDOW_ID) return;

        const saveIfEnabled = () => {
            if (inst.emulator && inst.loaded && (inst.autoSaveEnabled || inst.saveOnCloseEnabled)) {
                saveEmulatorState(inst).catch(console.error);
            }
        };

        addTrackedListener(inst, document, 'visibilitychange', () => {
            if (document.hidden) saveIfEnabled();
        });
        addTrackedListener(inst, window, 'pagehide', saveIfEnabled);
    }

    // Toggle auto-save
    function setAutoSaveEnabled(inst, enabled) {
        inst.autoSaveEnabled = enabled;
        writePref(PREF_AUTOSAVE, enabled);
        if (enabled) {
            startAutoSave(inst);
        } else {
            stopAutoSave(inst);
        }
        log(`Auto-save ${enabled ? 'enabled' : 'disabled'}`);
    }

    // ============================================================
    // State Management Toolbar
    // ============================================================

    function createToolbar(inst) {
        if (!inst.windowElement) return null;

        // Only show state management toolbar for the persisted Terminal window
        if (inst.id !== PERSISTED_WINDOW_ID) return null;

        // Find the title bar
        const titleBar = inst.windowElement.querySelector('.window-titlebar');
        if (!titleBar) return null;

        // Create dropdown button (arrow) for title bar
        const dropdownBtn = document.createElement('button');
        dropdownBtn.className = 'v86-dropdown-btn';
        dropdownBtn.innerHTML = '▼';
        dropdownBtn.title = 'Linux options';
        dropdownBtn.setAttribute('aria-label', 'Linux options');
        dropdownBtn.setAttribute('aria-expanded', 'false');

        // Started from the shell: offer the way back to it first
        const fromShell = !!(window.TerminalShell && window.TerminalShell.get(inst.id));

        // Create toolbar/dropdown menu
        const toolbar = document.createElement('div');
        toolbar.className = 'v86-toolbar';
        toolbar.innerHTML = `
            ${fromShell ? `<button class="v86-toolbar-btn" data-action="quit" title="Stop Linux and go back to the shell">Quit Linux</button>
            <div class="v86-toolbar-divider"></div>` : ''}
            <div class="v86-toolbar-row">
                <button class="v86-toolbar-btn" data-action="save" title="Save state now">💾 Save</button>
                <button class="v86-toolbar-btn" data-action="load" title="Load saved state">📂 Load</button>
            </div>
            <div class="v86-toolbar-divider"></div>
            <button class="v86-toolbar-btn danger" data-action="reset" title="Delete saved state">🗑️ Reset</button>
            <div class="v86-toolbar-divider"></div>
            <label class="v86-toolbar-checkbox">
                <input type="checkbox" data-toggle="autosave" ${inst.autoSaveEnabled ? 'checked' : ''}>
                <span>Auto-save (15s)</span>
            </label>
            <label class="v86-toolbar-checkbox">
                <input type="checkbox" data-toggle="save-on-close" ${inst.saveOnCloseEnabled ? 'checked' : ''}>
                <span>Save on close</span>
            </label>
            <div class="v86-toolbar-label">upload files by<br/>dropping them on<br/> the terminal window<br/>(they appear in /mnt/)</div>
            <div class="v86-toolbar-label">network: HTTP only, fetched<br/>by your browser (CORS applies)<br/>run <code>udhcpc</code> to enable</div>
        `;

        // Toggle dropdown visibility
        let isOpen = false;
        function toggleDropdown(e) {
            e.stopPropagation();
            isOpen = !isOpen;
            toolbar.classList.toggle('open', isOpen);
            dropdownBtn.classList.toggle('open', isOpen);
            dropdownBtn.setAttribute('aria-expanded', String(isOpen));
        }

        function closeDropdown() {
            isOpen = false;
            toolbar.classList.remove('open');
            dropdownBtn.classList.remove('open');
            dropdownBtn.setAttribute('aria-expanded', 'false');
        }

        dropdownBtn.addEventListener('click', toggleDropdown);

        // Close dropdown when clicking outside (tracked so it dies with the window)
        addTrackedListener(inst, document, 'click', (e) => {
            if (isOpen && !toolbar.contains(e.target) && e.target !== dropdownBtn) {
                closeDropdown();
            }
        });

        // Add event listeners for toolbar actions
        const quitBtn = toolbar.querySelector('[data-action="quit"]');
        if (quitBtn) {
            quitBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeDropdown();
                quitLinux(inst.id);
            });
        }

        toolbar.querySelector('[data-action="save"]').addEventListener('click', async (e) => {
            e.stopPropagation();
            if (inst.emulator && inst.loaded) {
                await saveEmulatorState(inst);
            }
        });

        toolbar.querySelector('[data-action="load"]').addEventListener('click', async (e) => {
            e.stopPropagation();
            const savedState = await loadEmulatorState(inst.id);
            if (savedState) {
                const restored = await restoreFromSavedState(inst, savedState);
                showSaveStatus(inst, restored ? 'state loaded ✓' : 'could not load state', true);
            } else {
                showSaveStatus(inst, 'no saved state', true);
            }
        });

        toolbar.querySelector('[data-action="reset"]').addEventListener('click', async (e) => {
            e.stopPropagation();
            const confirmReset = window.showConfirm
                ? window.showConfirm('Delete saved state?', 'The terminal will reboot fresh and any saved session will be lost.', { confirmLabel: 'Delete & Restart', danger: true })
                : Promise.resolve(confirm('Delete saved state and restart? The terminal will reboot fresh.'));
            if (await confirmReset) {
                await clearEmulatorState(inst.id);
                closeDropdown();

                // Prevent saving during the restart
                inst.saveOnCloseEnabled = false;

                // Reboot in place: the window (and the shell behind it) stays
                const termId = inst.id;
                const container = inst.windowElement && inst.windowElement.querySelector('.v86-terminal-container');
                await destroyEmulator(termId);
                if (container) resetVmMarkup(container);
                bootV86(termId);
            }
        });

        toolbar.querySelector('[data-toggle="autosave"]').addEventListener('change', (e) => {
            e.stopPropagation();
            setAutoSaveEnabled(inst, e.target.checked);
        });

        toolbar.querySelector('[data-toggle="save-on-close"]').addEventListener('change', (e) => {
            e.stopPropagation();
            inst.saveOnCloseEnabled = e.target.checked;
            writePref(PREF_SAVE_ON_CLOSE, inst.saveOnCloseEnabled);
            log(`Save on close ${inst.saveOnCloseEnabled ? 'enabled' : 'disabled'}`);
        });

        // Prevent toolbar interactions from affecting the terminal
        toolbar.addEventListener('mousedown', (e) => e.stopPropagation());
        toolbar.addEventListener('keydown', (e) => e.stopPropagation());

        // Add button and toolbar to title bar
        titleBar.appendChild(dropdownBtn);
        titleBar.appendChild(toolbar);

        // Removed on teardown so a retry in the same window does not stack them
        inst.cleanups.push(() => {
            dropdownBtn.remove();
            toolbar.remove();
        });

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

    // No download progress and no boot for this long counts as a failed load.
    // v86 retries failed requests silently and reports nothing for a 404.
    const LOAD_STALL_MS = 30000;

    function discardEmulator(emulator) {
        if (!emulator) return;
        try {
            // destroy() stops the CPU and releases the audio context, keyboard,
            // mouse, screen and network adapters; stop() alone leaks them.
            const done = emulator.destroy ? emulator.destroy() : emulator.stop();
            if (done && done.catch) done.catch(() => { /* ignore */ });
        } catch (e) { /* ignore */ }
    }

    // Swap the loader for an error panel with a Retry button. Shown when a
    // library, the BIOS or the boot image cannot be fetched, or v86 fails to start.
    function showLoadError(inst, container, detail) {
        if (!inst || inst.failed || instances.get(inst.id) !== inst) return;

        inst.failed = true;
        inst.loaded = false;
        stopAutoSave(inst);
        discardEmulator(inst.emulator);
        inst.emulator = null;

        const overlay = inst.loaderOverlay || createLoaderOverlay(container);
        inst.loaderOverlay = overlay;
        overlay.classList.remove('hidden');
        overlay.innerHTML = `
            <div class="v86-loader-content v86-loader-error" role="alert">
                <div class="v86-loader-title">Could not start the emulator</div>
                <div class="v86-loader-status"></div>
                <div class="v86-loader-size">Check your connection and try again.</div>
                <button type="button" class="v86-loader-retry">Retry</button>
            </div>
        `;
        overlay.querySelector('.v86-loader-status').textContent = detail || 'A required file failed to load.';

        overlay.querySelector('.v86-loader-retry').addEventListener('click', async () => {
            const id = inst.id;
            if (instances.get(id) !== inst) return;

            await destroyEmulator(id);
            resetVmMarkup(container);
            bootV86(id);
        });

        // Booted from the shell: the shell still works without the network
        if (window.TerminalShell && window.TerminalShell.get(inst.id)) {
            const back = document.createElement('button');
            back.type = 'button';
            back.className = 'v86-loader-retry';
            back.textContent = 'Back to Shell';
            back.addEventListener('click', () => quitLinux(inst.id));
            overlay.querySelector('.v86-loader-retry').after(back);
        }
    }

    // Put the window markup back to its pre-boot state before booting again
    function resetVmMarkup(container) {
        const xterm = container.querySelector('.v86-xterm');
        if (xterm) xterm.innerHTML = '';
        const serial = container.querySelector('.v86-serial-container');
        if (serial) serial.style.display = 'none';
        const screen = container.querySelector('.v86-screen-container');
        if (screen) screen.style.display = '';
    }

    // Load v86 library dynamically (shared across instances)
    let v86ScriptPromise = null;
    function loadV86Script() {
        if (window.V86) return Promise.resolve();
        if (v86ScriptPromise) return v86ScriptPromise;

        v86ScriptPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = V86_CORE.libv86Url;
            script.onload = resolve;
            script.onerror = () => {
                v86ScriptPromise = null;
                reject(new Error('Failed to load v86'));
            };
            document.head.appendChild(script);
        });

        return v86ScriptPromise;
    }

    // Load xterm.js, FitAddon, and v86 CSS lazily (shared across instances)
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
                addonScript.onerror = () => {
                    xtermLoading = null;
                    reject(new Error('Failed to load xterm-addon-fit'));
                };
                document.head.appendChild(addonScript);
            };
            xtermScript.onerror = () => {
                xtermLoading = null;
                reject(new Error('Failed to load xterm.js'));
            };
            document.head.appendChild(xtermScript);
        });

        return xtermLoading;
    }

    // Switch display mode between VGA and Serial
    function setDisplayMode(inst, mode) {
        if (mode === inst.displayMode) return;

        log(`[${inst.id}] Switching to ${mode} mode`);
        inst.displayMode = mode;

        const screenContainer = inst.screenContainer;
        const serialContainer = inst.serialContainer;

        if (mode === 'serial') {
            // Show serial, hide VGA
            if (serialContainer) serialContainer.style.display = 'block';
            if (screenContainer) screenContainer.style.display = 'none';

            // Fit the terminal after it becomes visible
            if (inst.fitAddon) {
                setTimeout(() => {
                    try { inst.fitAddon.fit(); } catch (e) { /* ignore */ }
                }, 50);
            }
        } else {
            // Show VGA, hide serial
            if (serialContainer) serialContainer.style.display = 'none';
            if (screenContainer) screenContainer.style.display = 'flex';
        }
    }

    // ============================================================
    // Shell first, Linux on demand (Terminal window only)
    // ============================================================
    // The Terminal opens on the instant JS shell (assets/js/terminal-shell.js),
    // which reads the site as files, and boots Linux only when asked with
    // `linux`. Portal still boots its demo straight away.

    let shellScriptPromise = null;
    function loadShellScript() {
        if (window.TerminalShell) return Promise.resolve();
        if (shellScriptPromise) return shellScriptPromise;
        const src = window.TERMINAL_SHELL_URL;
        if (!src) return Promise.reject(new Error('Missing URL for the terminal shell'));

        shellScriptPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = () => {
                shellScriptPromise = null;
                reject(new Error('Failed to load the terminal shell'));
            };
            document.head.appendChild(script);
        });
        return shellScriptPromise;
    }

    // Whether a Linux session was saved, without creating the database on a
    // first visit just to look.
    async function hasSavedLinux(terminalId) {
        try {
            if (indexedDB.databases) {
                const dbs = await indexedDB.databases();
                if (!dbs.some(d => d.name === DB_NAME)) return false;
            }
            const saved = await loadEmulatorState(terminalId);
            return !!(saved && saved.state);
        } catch (e) {
            return false;
        }
    }

    async function setupV86Terminal(terminalId) {
        if (terminalId !== PERSISTED_WINDOW_ID) return bootV86(terminalId);

        const windowElement = document.querySelector(`[data-window-id="${terminalId}"]`);
        const container = windowElement && windowElement.querySelector('.v86-terminal-container');
        if (!container) return bootV86(terminalId);

        try {
            await Promise.all([loadXterm(), loadShellScript()]);
        } catch (e) {
            // No shell (or no xterm): fall back to booting Linux as before
            console.warn('Terminal shell unavailable, booting Linux instead:', e);
            return bootV86(terminalId);
        }

        // Closed while the scripts were loading, or already running
        if (!windowElement.isConnected || windowElement.classList.contains('closing')) return;
        if (window.TerminalShell.get(terminalId) || instances.has(terminalId)) return;

        const screen = container.querySelector('.v86-screen-container');
        if (screen) screen.style.display = 'none';

        const shell = window.TerminalShell.start(terminalId, container, {
            onLinux: () => startLinux(terminalId),
            hasSavedLinux: () => hasSavedLinux(terminalId)
        });

        // The window took focus when it opened; hand it to the prompt
        const active = document.activeElement;
        if (!active || active === document.body || windowElement.contains(active)) shell.term.focus();
    }

    // `linux` in the shell: the shell steps aside and the VM boots in its place
    function startLinux(terminalId) {
        if (instances.has(terminalId)) return;
        const windowElement = document.querySelector(`[data-window-id="${terminalId}"]`);
        if (!windowElement || !windowElement.isConnected) return;
        if (window.TerminalShell) window.TerminalShell.hide(terminalId);
        const container = windowElement.querySelector('.v86-terminal-container');
        if (container) resetVmMarkup(container);
        bootV86(terminalId);
    }

    // "Quit Linux" (title bar menu, or the error panel): stop the VM, saving
    // first if Save on close is on, and bring the shell back
    async function quitLinux(terminalId) {
        const inst = getInstance(terminalId);
        const windowElement = (inst && inst.windowElement) || document.querySelector(`[data-window-id="${terminalId}"]`);
        const originalTitle = inst && inst.originalWindowTitle;

        await destroyEmulator(terminalId);

        if (!windowElement || !windowElement.isConnected) return;
        if (originalTitle) {
            const titleElement = windowElement.querySelector('.window-title-text') || windowElement.querySelector('.window-title');
            if (titleElement) titleElement.textContent = originalTitle;
        }
        const container = windowElement.querySelector('.v86-terminal-container');
        if (container) {
            resetVmMarkup(container);
            const screen = container.querySelector('.v86-screen-container');
            if (screen) screen.style.display = 'none';
        }
        if (!window.TerminalShell || !window.TerminalShell.show(terminalId, 'Linux has stopped. Type linux to boot it again.')) {
            setupV86Terminal(terminalId);
        }
    }

    // The site's pages as files inside the guest. The buildroot image mounts
    // the 9p host share at /mnt, so files created at /site appear in
    // /mnt/site. Same-origin fetches, a few at a time, once the VM is up;
    // a page that fails to load is simply left out.
    async function mountSiteFiles(inst) {
        const emulator = inst.emulator;
        const fs = emulator && emulator.fs9p;
        if (!fs || typeof fs.SearchPath !== 'function' || typeof fs.CreateDirectory !== 'function') return;
        if (!window.TerminalShell || !window.TerminalShell.siteFiles) return;

        let files;
        try {
            files = await window.TerminalShell.siteFiles();
        } catch (e) {
            return;
        }

        const alive = () => inst.emulator === emulator && instances.get(inst.id) === inst;
        const ensureDir = (path) => {
            let parent = 0; // the share's root inode
            let walked = '';
            path.split('/').filter(Boolean).forEach((part) => {
                walked += '/' + part;
                const found = fs.SearchPath(walked);
                parent = found.id !== -1 ? found.id : fs.CreateDirectory(part, parent);
            });
        };

        if (!alive()) return;
        ensureDir('/site');
        // A restored session already has the files it was saved with
        const queue = files.filter(f => fs.SearchPath('/site/' + f.path).id === -1);
        let written = 0;

        const worker = async () => {
            while (queue.length && alive()) {
                const file = queue.shift();
                try {
                    const res = await fetch(file.url, { credentials: 'same-origin' });
                    if (!res.ok || !alive()) continue;
                    const bytes = new Uint8Array(await res.arrayBuffer());
                    if (!alive()) return;
                    const full = '/site/' + file.path;
                    ensureDir(full.slice(0, full.lastIndexOf('/')));
                    if (fs.SearchPath(full).id === -1) {
                        await emulator.create_file(full, bytes);
                        written++;
                    }
                } catch (e) { /* leave this one out */ }
            }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
        log(`[${inst.id}] Mounted ${written} site files at /mnt/site`);
    }

    // Boot the v86 emulator in a window, with VGA and Serial support
    async function bootV86(terminalId) {
        // Find the window element
        const windowElement = document.querySelector(`[data-window-id="${terminalId}"]`);
        if (!windowElement) {
            log('v86 window not found, waiting...');
            setTimeout(() => bootV86(terminalId), 100);
            return;
        }

        // Find containers
        const contentContainer = windowElement.querySelector('.v86-terminal-container');
        if (!contentContainer) {
            log('v86 terminal container not found');
            return;
        }

        const screenContainer = contentContainer.querySelector('.v86-screen-container');
        const serialContainer = contentContainer.querySelector('.v86-serial-container');
        const xtermContainer = serialContainer?.querySelector('.v86-xterm');

        if (!screenContainer) {
            log('v86 screen container not found');
            return;
        }

        // Tear down only a previous instance of THIS window, never a sibling window's.
        if (instances.has(terminalId)) {
            await destroyEmulator(terminalId);
        }

        const inst = createInstance(terminalId);
        instances.set(terminalId, inst);

        // Check for saved state
        const savedState = await loadEmulatorState(terminalId);
        if (savedState) {
            const savedTime = new Date(savedState.savedAt).toLocaleString();
            log(`Found saved state from ${savedTime} (profile: ${savedState.profile})`);
        }

        try {
            log('Loading xterm.js and v86...');
            await Promise.all([loadXterm(), loadV86Script()]);

            // The window may have been closed while the libraries were downloading.
            if (instances.get(terminalId) !== inst) return;

            log('Initializing v86 emulator...');

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

            log(`Booting: ${profile.name}`);

            // Store profile and containers for input capture
            inst.profile = profile;
            inst.screenContainer = screenContainer;
            inst.serialContainer = serialContainer;
            inst.windowElement = windowElement;

            // Create loader overlay for download progress
            inst.loaderOverlay = createLoaderOverlay(contentContainer);

            // Create state management toolbar
            createToolbar(inst);

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

                // v86's built-in fetch backend: the guest's HTTP requests are made
                // by this browser tab (so CORS applies), with no third-party
                // relay and no virtual LAN shared with other visitors.
                net_device: {
                    relay_url: "fetch",
                    type: "ne2k",
                },

                // Enable 9p filesystem for create_file/read_file support
                filesystem: {},

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

            const emulator = new V86(options);
            inst.emulator = emulator;

            // Surface failed or stalled downloads instead of sitting on the loader
            let lastProgressAt = Date.now();
            let stallTimer = setInterval(() => {
                if (Date.now() - lastProgressAt > LOAD_STALL_MS) {
                    showLoadError(inst, contentContainer, 'The download stalled.');
                }
            }, 5000);
            const stopStallTimer = () => {
                if (stallTimer) {
                    clearInterval(stallTimer);
                    stallTimer = null;
                }
            };
            inst.cleanups.push(stopStallTimer);

            emulator.add_listener("download-error", function (e) {
                const name = e && e.file_name ? e.file_name.split('/').pop() : 'a required file';
                const status = e && e.request && e.request.status;
                showLoadError(inst, contentContainer,
                    `Could not download ${name}` + (status ? ` (HTTP ${status})` : '') + '.');
            });

            // Track if we've received serial output
            let serialOutputReceived = false;

            // Listen for serial output to switch display mode
            // Only switch if the profile doesn't have vga: true
            inst.emulator.add_listener("serial0-output-byte", function () {
                if (!serialOutputReceived && !profile.vga) {
                    serialOutputReceived = true;
                    log('Serial output detected, switching to serial mode');
                    setDisplayMode(inst, 'serial');
                }
            });

            // Listen for emulator events
            inst.emulator.add_listener("emulator-ready", async function () {
                log(`[${inst.id}] v86 emulator ready!`);
                if (inst.emulator !== emulator) return;

                // Try to attach FitAddon to v86's xterm terminal
                if (inst.emulator.serial_adapter && inst.emulator.serial_adapter.term) {
                    try {
                        const term = inst.emulator.serial_adapter.term;
                        if (typeof FitAddon !== 'undefined') {
                            inst.fitAddon = new FitAddon.FitAddon();
                            term.loadAddon(inst.fitAddon);
                            setTimeout(() => {
                                try { inst.fitAddon.fit(); } catch (e) { /* ignore */ }
                            }, 100);

                            // Re-fit on container resize (disconnected on teardown)
                            if (serialContainer) {
                                inst.resizeObserver = new ResizeObserver(() => {
                                    try { inst.fitAddon.fit(); } catch (e) { /* ignore */ }
                                });
                                inst.resizeObserver.observe(serialContainer);
                            }
                        }
                    } catch (e) {
                        console.warn('Could not attach FitAddon to v86 terminal:', e);
                    }
                }

                // The Terminal's Linux gets the site at /mnt/site. A restore
                // replaces the whole 9p filesystem, so files go in after it.
                const mountSite = () => {
                    if (terminalId === PERSISTED_WINDOW_ID && instances.get(terminalId) === inst) {
                        mountSiteFiles(inst).catch(() => { /* optional extra */ });
                    }
                };

                // Restore saved state if available
                if (savedState) {
                    // Small delay to ensure emulator is fully initialized
                    setTimeout(async () => {
                        if (instances.get(terminalId) !== inst) return;
                        const restored = await restoreFromSavedState(inst, savedState);
                        if (restored) {
                            log('Emulator restored from saved state!');
                        }
                        mountSite();
                    }, 500);
                } else {
                    mountSite();
                }
            });

            inst.emulator.add_listener("emulator-started", function () {
                log(`[${inst.id}] v86 emulator started!`);
                stopStallTimer();

                // The window was closed, or the load was given up on, while the
                // images were still downloading: do not leave this running.
                if (instances.get(terminalId) !== inst || inst.failed) {
                    discardEmulator(emulator);
                    return;
                }

                inst.started = true;

                // Minimized while booting: stay paused until the window is restored
                if (inst.pausedByShell) {
                    setTimeout(() => {
                        if (inst.pausedByShell && inst.emulator === emulator) emulator.stop();
                    }, 0);
                }

                // Hide loader when emulator starts
                if (inst.loaderOverlay) {
                    hideLoaderOverlay(inst.loaderOverlay);
                    inst.loaderOverlay = null;
                }
            });

            // Listen for download progress
            inst.emulator.add_listener("download-progress", function (e) {
                const { file_name, loaded, total } = e;

                lastProgressAt = Date.now();
                if (inst.failed) return;

                updateLoaderProgress(
                    inst.loaderOverlay,
                    loaded,
                    total,
                    file_name ? file_name.split('/').pop() : null
                );
            });

            // Setup VGA input capture if profile uses VGA
            if (profile.vga) {
                setupVGAInputCapture(inst);
            }

            // Start auto-save for state persistence
            startAutoSave(inst);
            setupLifecycleSave(inst);

            // Setup drag-and-drop file upload
            setupFileDrop(inst, contentContainer);

            inst.loaded = true;
            log(`[${inst.id}] v86 setup complete!`);

        } catch (error) {
            console.error('v86 loading error:', error);
            showLoadError(inst, contentContainer, error && error.message ? `${error.message}.` : '');
        }
    }

    // ============================================================
    // Drag and Drop File Upload
    // ============================================================

    function setupFileDrop(inst, container) {
        if (!container) return;

        // Create drop overlay
        const dropOverlay = document.createElement('div');
        dropOverlay.className = 'v86-drop-overlay';
        dropOverlay.innerHTML = `
            <div class="v86-drop-content">
                <div class="v86-drop-icon">📁</div>
                <div class="v86-drop-text">Drop files to upload</div>
                <div class="v86-drop-hint">Files will appear in /mnt/ inside the guest</div>
            </div>
        `;
        container.appendChild(dropOverlay);
        inst.cleanups.push(() => dropOverlay.remove());

        let dragCounter = 0;

        addTrackedListener(inst, container, 'dragenter', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dragCounter++;
            dropOverlay.classList.add('visible');
        });

        addTrackedListener(inst, container, 'dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dragCounter--;
            if (dragCounter === 0) {
                dropOverlay.classList.remove('visible');
            }
        });

        addTrackedListener(inst, container, 'dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });

        addTrackedListener(inst, container, 'drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            dragCounter = 0;
            dropOverlay.classList.remove('visible');

            if (!inst.emulator || !inst.loaded) {
                console.warn('Emulator not ready for file upload');
                return;
            }

            const files = e.dataTransfer.files;
            if (files.length === 0) return;

            for (const file of files) {
                try {
                    const arrayBuffer = await file.arrayBuffer();
                    const uint8Array = new Uint8Array(arrayBuffer);

                    // Upload to root directory in the emulator (files accessible from /)
                    const path = `/${file.name}`;
                    inst.emulator.create_file(path, uint8Array);

                    log(`Uploaded file: ${file.name} (${file.size} bytes) to ${path}`);
                    showSaveStatus(inst, `uploaded ${file.name} ✓`, true);
                } catch (err) {
                    console.error(`Failed to upload ${file.name}:`, err);
                    showSaveStatus(inst, `upload failed: ${file.name}`, true);
                }
            }
        });
    }

    // Toggle VGA input capture
    function setInputCapture(inst, enabled) {
        if (!inst.emulator || !inst.profile?.vga) return;

        inst.inputCaptured = enabled;
        inst.emulator.keyboard_set_enabled(enabled);
        inst.emulator.mouse_set_enabled(enabled);

        // Update visual indicator
        if (inst.screenContainer) {
            inst.screenContainer.classList.toggle('input-captured', enabled);
        }

        log(`[${inst.id}] Input capture: ${enabled ? 'LOCKED' : 'UNLOCKED'}`);
    }

    // Setup VGA input capture handlers
    function setupVGAInputCapture(inst) {
        const screenContainer = inst.screenContainer;
        const windowElement = inst.windowElement;

        // Start with input NOT captured
        setInputCapture(inst, false);

        // Click on screen to capture input
        screenContainer.addEventListener('click', () => {
            if (!inst.inputCaptured) {
                setInputCapture(inst, true);
            }
        });

        // Escape key releases capture (tracked - previously leaked per window)
        addTrackedListener(inst, document, 'keydown', (e) => {
            if (e.key === 'Escape' && inst.inputCaptured) {
                e.preventDefault();
                e.stopPropagation();
                setInputCapture(inst, false);
            }
        });

        // Click outside window releases capture
        addTrackedListener(inst, document, 'mousedown', (e) => {
            if (inst.inputCaptured && windowElement && !windowElement.contains(e.target)) {
                setInputCapture(inst, false);
            }
        });

        // Add hint overlay
        const hint = document.createElement('div');
        hint.className = 'v86-keyboard-hint';
        hint.innerHTML = 'Click to capture input • <kbd>Esc</kbd> to release';
        screenContainer.appendChild(hint);
    }

    // Cleanup when a terminal window is closed: the VM and the shell. Scoped to
    // one window id so closing Portal can never stop the Terminal's emulator
    // (or vice versa).
    async function destroyV86(terminalId) {
        if (window.TerminalShell && terminalId) window.TerminalShell.destroy(terminalId);
        await destroyEmulator(terminalId);
    }

    // Stop and release one window's emulator (the shell, if any, stays).
    async function destroyEmulator(terminalId) {
        const inst = terminalId ? getInstance(terminalId) : null;
        if (!inst) return;

        // Remove from the registry first so in-flight async callbacks bail out.
        instances.delete(inst.id);

        // Stop auto-save
        stopAutoSave(inst);

        // Save state before closing (if enabled and this is the persisted window)
        if (inst.saveOnCloseEnabled && inst.emulator && inst.loaded && inst.id === PERSISTED_WINDOW_ID) {
            try {
                await saveEmulatorState(inst);
                log('State saved before closing');
            } catch (e) {
                console.warn('Could not save state before closing:', e);
            }
        }

        // Release input capture first
        if (inst.inputCaptured) {
            setInputCapture(inst, false);
        }

        if (inst.saveStatusTimeout) {
            clearTimeout(inst.saveStatusTimeout);
            inst.saveStatusTimeout = null;
        }

        if (inst.resizeObserver) {
            inst.resizeObserver.disconnect();
            inst.resizeObserver = null;
        }

        // Remove every document/window listener this instance registered
        runCleanups(inst);

        // Remove loader overlay if still visible
        if (inst.loaderOverlay) {
            inst.loaderOverlay.remove();
            inst.loaderOverlay = null;
        }

        if (inst.emulator) {
            discardEmulator(inst.emulator);
            inst.emulator = null;
        }

        inst.loaded = false;
        inst.fitAddon = null;
        inst.profile = null;
        inst.screenContainer = null;
        inst.serialContainer = null;
        inst.windowElement = null;
    }

    // Pause / resume one window's emulator (the shell calls these when the
    // window is minimized and restored). Only resumes what it paused itself.
    function pauseV86(terminalId) {
        const inst = getInstance(terminalId);
        if (!inst || inst.failed || inst.pausedByShell) return false;
        inst.pausedByShell = true;
        // Still downloading: the "emulator-started" listener applies the pause
        if (inst.emulator && inst.emulator.is_running()) {
            inst.emulator.stop();
        }
        return true;
    }

    function resumeV86(terminalId) {
        const inst = getInstance(terminalId);
        if (!inst || !inst.pausedByShell) return false;
        inst.pausedByShell = false;
        // Before the first boot there is nothing to resume; autostart handles it.
        // run() also cancels a stop that has not taken effect yet.
        if (inst.emulator && inst.started && !inst.failed) {
            inst.emulator.run();
        }
        return true;
    }

    // Expose functions globally
    window.setupV86Terminal = setupV86Terminal;
    window.destroyV86 = destroyV86;
    window.pauseV86 = pauseV86;
    window.resumeV86 = resumeV86;

    // Expose state management functions (id-scoped; default to the Terminal window)
    window.saveV86State = (id) => {
        const inst = getInstance(id || PERSISTED_WINDOW_ID);
        return inst ? saveEmulatorState(inst) : Promise.resolve(false);
    };
    window.clearV86State = (id) => clearEmulatorState(id || PERSISTED_WINDOW_ID);
    window.loadV86State = (id) => loadEmulatorState(id || PERSISTED_WINDOW_ID);

    // Expose for debugging
    window.V86_PROFILES = BOOT_PROFILES;
    window.V86_ACTIVE = DEFAULT_PROFILE;
    window.V86_INSTANCES = instances;

})();
