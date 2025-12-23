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
            v86Emulator.add_listener("emulator-ready", function () {
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
            });

            v86Emulator.add_listener("emulator-started", function () {
                console.log('v86 emulator started!');
            });

            // Setup VGA input capture if profile uses VGA
            if (profile.vga) {
                setupVGAInputCapture(screenContainer, windowElement);
            }

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
    function destroyV86() {
        // Release input capture first
        if (inputCaptured) {
            setInputCapture(false);
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
    }

    // Expose functions globally
    window.setupV86Terminal = setupV86Terminal;
    window.destroyV86 = destroyV86;

    // Expose for debugging
    window.V86_PROFILES = BOOT_PROFILES;
    window.V86_ACTIVE = DEFAULT_PROFILE;

})();
