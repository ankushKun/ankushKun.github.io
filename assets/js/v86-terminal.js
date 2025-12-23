/**
 * v86 Linux Emulator Integration for Terminal
 * Uses v86 (x86 emulator in JavaScript/WebAssembly) with Linux
 * Provides VGA display only
 */

(function () {
    'use strict';

    // v86 configuration - using local files from static/v86/
    const V86_CONFIG = {
        // v86 core files
        libv86Url: '/v86/libv86.js',
        wasmUrl: '/v86/v86.wasm',

        // BIOS files
        biosUrl: '/v86/seabios.bin',
        vgaBiosUrl: '/v86/vgabios.bin',

        // Floppy image
        floppyUrl: '/v86/floppy/stillalive.img',
    };

    let v86Emulator = null;
    let v86Loaded = false;

    // Load v86 library dynamically
    function loadV86Script() {
        return new Promise((resolve, reject) => {
            if (window.V86) {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = V86_CONFIG.libv86Url;
            script.onload = resolve;
            script.onerror = () => reject(new Error('Failed to load v86'));
            document.head.appendChild(script);
        });
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
        const screenContainer = contentContainer.querySelector('#screen_container');
        if (!screenContainer) {
            console.log('v86 screen container not found');
            return;
        }

        try {
            console.log('Loading v86 script...');
            await loadV86Script();

            console.log('Initializing v86 emulator...');
            v86Emulator = new V86({
                wasm_path: V86_CONFIG.wasmUrl,
                memory_size: 64 * 1024 * 1024,
                vga_memory_size: 8 * 1024 * 1024,

                // VGA output - for graphical display
                screen_container: screenContainer,

                // Disable mouse capture to allow normal browser interaction (Cmd+R, etc.)
                disable_mouse: true,

                // Disable keyboard capture to allow browser shortcuts (Cmd+R, etc.)
                disable_keyboard: true,

                bios: { url: V86_CONFIG.biosUrl },
                vga_bios: { url: V86_CONFIG.vgaBiosUrl },

                // Boot from Floppy
                fda: { url: V86_CONFIG.floppyUrl },

                autostart: true,
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

            // Fall back to the fake terminal if available
            if (window.setupFakeTerminal) {
                console.log('Falling back to fake terminal...');
                window.setupFakeTerminal(terminalId);
            }
        }
    }

    // Cleanup when terminal window is closed
    function destroyV86() {
        if (v86Emulator) {
            v86Emulator.stop();
            v86Emulator = null;
        }
        v86Loaded = false;
    }

    // Expose functions globally
    window.setupV86Terminal = setupV86Terminal;
    window.destroyV86 = destroyV86;

})();
