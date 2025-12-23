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
        nodeos: {
            name: 'NodeOS Kernel',
            type: 'bzimage',
            path: '/v86/images/nodeos-kernel.bin',
            memory: 128 * 1024 * 1024,     // 128 MB
            vgaMemory: 8 * 1024 * 1024,    // 8 MB
            cmdline: 'console=ttyS0',      // Output to serial console
        },
    };

    // ============================================================
    // ACTIVE PROFILE - Change this to switch boot images!
    // Options: 'stillalive', 'linux4', 'nodeos'
    // ============================================================
    const ACTIVE_PROFILE = 'nodeos';

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

    // Switch display mode between VGA and Serial
    function setDisplayMode(mode, screenContainer, serialContainer) {
        if (mode === displayMode) return;

        console.log(`Switching to ${mode} mode`);
        displayMode = mode;

        if (mode === 'serial') {
            // Show serial, hide VGA
            if (serialContainer) serialContainer.style.display = 'block';
            if (screenContainer) screenContainer.style.display = 'none';
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

        const screenContainer = contentContainer.querySelector('#screen_container');
        const serialContainer = contentContainer.querySelector('.v86-serial-container');
        const xtermContainer = serialContainer?.querySelector('.v86-xterm');

        if (!screenContainer) {
            console.log('v86 screen container not found');
            return;
        }

        try {
            console.log('Loading v86 script...');
            await loadV86Script();

            // Wait for xterm.js to be available
            if (typeof Terminal === 'undefined') {
                console.log('Waiting for xterm.js...');
                setTimeout(() => setupV86Terminal(terminalId), 100);
                return;
            }

            console.log('Initializing v86 emulator...');

            // Build v86 options
            const profile = BOOT_PROFILES[ACTIVE_PROFILE];
            if (!profile) {
                throw new Error(`Unknown boot profile: ${ACTIVE_PROFILE}`);
            }

            console.log(`Booting: ${profile.name}`);

            const options = {
                wasm_path: V86_CORE.wasmUrl,
                memory_size: profile.memory,
                vga_memory_size: profile.vgaMemory,
                screen_container: screenContainer,

                // v86's built-in xterm.js support expects a DOM element!
                // v86 will create its own Terminal and call open() on this element
                serial_container_xtermjs: xtermContainer,

                disable_keyboard: true,
                disable_mouse: true,

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
            v86Emulator.add_listener("serial0-output-byte", function (byte) {
                if (!serialOutputReceived) {
                    serialOutputReceived = true;
                    console.log('Serial output detected, switching to serial mode');
                    setDisplayMode('serial', screenContainer, serialContainer);
                }
            });

            // Listen for emulator events
            v86Emulator.add_listener("emulator-ready", function () {
                console.log('v86 emulator ready!');
            });

            v86Emulator.add_listener("emulator-started", function () {
                console.log('v86 emulator started!');
            });

            v86Loaded = true;
            console.log('v86 setup complete!');

        } catch (error) {
            console.error('v86 loading error:', error);
        }
    }

    // Cleanup when terminal window is closed
    function destroyV86() {
        if (v86Emulator) {
            v86Emulator.stop();
            v86Emulator = null;
        }
        v86Loaded = false;
        displayMode = 'vga';
    }

    // Expose functions globally
    window.setupV86Terminal = setupV86Terminal;
    window.destroyV86 = destroyV86;

    // Expose for debugging
    window.V86_PROFILES = BOOT_PROFILES;
    window.V86_ACTIVE = ACTIVE_PROFILE;

})();
