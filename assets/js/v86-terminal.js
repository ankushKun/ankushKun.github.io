/**
 * v86 Linux Emulator Integration for Terminal
 * Uses v86 (x86 emulator in JavaScript/WebAssembly) with Linux
 * Provides VGA display only
 * 
 * Keyboard Control:
 * - Click on terminal to capture keyboard
 * - Press Escape to release keyboard capture
 * - Click outside terminal also releases capture
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

        // Buildroot - Linux kernel with busybox
        buildroot: {
            name: 'Buildroot Linux',
            type: 'bzimage',
            path: '/v86/images/buildroot-bzimage.bin',
            memory: 64 * 1024 * 1024,      // 64 MB
            vgaMemory: 8 * 1024 * 1024,    // 8 MB
            // Optional: kernel command line parameters
            cmdline: 'console=ttyS0',
        },
    };

    // ============================================================
    // ACTIVE PROFILE - Change this to switch boot images!
    // Options: 'stillalive', 'linux4', 'buildroot'
    // ============================================================
    const ACTIVE_PROFILE = 'linux4';

    // ============================================================
    // v86 Core Configuration
    // ============================================================
    const V86_CORE = {
        libv86Url: '/v86/libv86.js',
        wasmUrl: '/v86/v86.wasm',
        biosUrl: '/v86/seabios.bin',
        vgaBiosUrl: '/v86/vgabios.bin',
    };

    let v86Emulator = null;
    let v86Loaded = false;
    let keyboardCaptured = false;
    let screenContainer = null;

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

    // Toggle keyboard capture state
    function setKeyboardCapture(enabled) {
        if (!v86Emulator) return;

        keyboardCaptured = enabled;
        v86Emulator.keyboard_set_enabled(enabled);

        // Update visual indicator
        if (screenContainer) {
            screenContainer.classList.toggle('keyboard-captured', enabled);
        }

        console.log(`Keyboard capture: ${enabled ? 'ON' : 'OFF'}`);
    }

    // Build v86 options based on active profile
    function buildV86Options(container) {
        const profile = BOOT_PROFILES[ACTIVE_PROFILE];
        if (!profile) {
            console.error(`Unknown boot profile: ${ACTIVE_PROFILE}`);
            return null;
        }

        console.log(`Booting: ${profile.name}`);

        // Base options - start with keyboard DISABLED (user clicks to enable)
        const options = {
            wasm_path: V86_CORE.wasmUrl,
            memory_size: profile.memory,
            vga_memory_size: profile.vgaMemory,
            screen_container: container,

            // Mouse always disabled for browser interaction
            disable_mouse: true,
            // Keyboard starts disabled - enabled on click
            disable_keyboard: false,

            // BIOS
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
            default:
                console.error(`Unknown boot type: ${profile.type}`);
                return null;
        }

        return options;
    }

    // Setup keyboard capture toggle handlers
    function setupKeyboardToggle(container, windowElement) {
        // Click on screen to capture keyboard
        container.addEventListener('click', () => {
            if (!keyboardCaptured) {
                setKeyboardCapture(true);
            }
        });

        // Escape key releases keyboard capture
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && keyboardCaptured) {
                e.preventDefault();
                e.stopPropagation();
                setKeyboardCapture(false);
            }
        });

        // Click outside terminal window releases capture
        document.addEventListener('mousedown', (e) => {
            if (keyboardCaptured && windowElement && !windowElement.contains(e.target)) {
                setKeyboardCapture(false);
            }
        });

        // Add hint overlay
        const hint = document.createElement('div');
        hint.className = 'v86-keyboard-hint';
        hint.innerHTML = 'Click to type • <kbd>Esc</kbd> to release';
        container.appendChild(hint);
    }

    // Setup v86 terminal with VGA output only
    async function setupV86Terminal(terminalId) {
        // Find the actual window element (not the template in #window-contents)
        const windowElement = document.querySelector(`[data-window-id="${terminalId}"]`);
        if (!windowElement) {
            console.log('v86 window not found, waiting...');
            setTimeout(() => setupV86Terminal(terminalId), 100);
            return;
        }

        // Find the container inside the window
        const contentContainer = windowElement.querySelector('.v86-terminal-container');
        if (!contentContainer) {
            console.log('v86 terminal container not found in window');
            return;
        }

        // Find the screen container for VGA
        screenContainer = contentContainer.querySelector('#screen_container');
        if (!screenContainer) {
            console.log('v86 screen container not found');
            return;
        }

        try {
            console.log('Loading v86 script...');
            await loadV86Script();

            console.log('Initializing v86 emulator...');
            const options = buildV86Options(screenContainer);
            if (!options) {
                throw new Error('Failed to build v86 options');
            }

            v86Emulator = new V86(options);

            // Listen for emulator events
            v86Emulator.add_listener("emulator-ready", function () {
                console.log('v86 emulator ready!');
                // Start with keyboard disabled
                setKeyboardCapture(false);
            });

            v86Emulator.add_listener("emulator-started", function () {
                console.log('v86 emulator started!');
            });

            // Setup keyboard capture toggle
            setupKeyboardToggle(screenContainer, windowElement);

            v86Loaded = true;
            console.log('v86 setup complete!');

        } catch (error) {
            console.error('v86 loading error:', error);
        }
    }

    // Cleanup when terminal window is closed
    function destroyV86() {
        // Release keyboard capture first
        if (v86Emulator && keyboardCaptured) {
            setKeyboardCapture(false);
        }

        if (v86Emulator) {
            v86Emulator.stop();
            v86Emulator = null;
        }
        v86Loaded = false;
        keyboardCaptured = false;
        screenContainer = null;
    }

    // Expose functions globally
    window.setupV86Terminal = setupV86Terminal;
    window.destroyV86 = destroyV86;

    // Expose profiles for debugging/inspection
    window.V86_PROFILES = BOOT_PROFILES;
    window.V86_ACTIVE = ACTIVE_PROFILE;

})();
