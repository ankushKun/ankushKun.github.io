/**
 * v86 Linux Emulator Integration for Terminal
 * Uses v86 (x86 emulator in JavaScript/WebAssembly) with Linux
 * Provides both VGA display and Serial console (xterm.js)
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

        // ISO image (alternative boot option)
        // isoUrl: '/v86/images/linux4.iso',
    };

    let v86Emulator = null;
    let v86Loaded = false;
    let v86Loading = false;
    let serialTerminal = null;
    let serialFitAddon = null;

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

    // Create xterm.js terminal for serial console
    function createSerialTerminal(container) {
        if (typeof Terminal === 'undefined') {
            console.error('xterm.js not loaded');
            return null;
        }

        const term = new Terminal({
            cursorBlink: true,
            fontSize: 14,
            fontFamily: '"SF Mono", "Monaco", "Menlo", "Consolas", monospace',
            theme: {
                background: '#1e1e1e',
                foreground: '#f0f0f0',
                cursor: '#00ff00',
                cursorAccent: '#1e1e1e',
                black: '#1e1e1e',
                red: '#ff6b6b',
                green: '#69db7c',
                yellow: '#feca57',
                blue: '#74b9ff',
                magenta: '#a29bfe',
                cyan: '#00cec9',
                white: '#f0f0f0',
                brightBlack: '#636e72',
                brightRed: '#ff7675',
                brightGreen: '#00b894',
                brightYellow: '#fdcb6e',
                brightBlue: '#0984e3',
                brightMagenta: '#6c5ce7',
                brightCyan: '#00cec9',
                brightWhite: '#ffffff'
            },
            allowTransparency: false,
            scrollback: 5000,
            convertEol: true
        });

        // Load fit addon
        if (typeof FitAddon !== 'undefined') {
            const fitAddon = new FitAddon.FitAddon();
            term.loadAddon(fitAddon);
            serialFitAddon = fitAddon;
        }

        // Load web links addon
        if (typeof WebLinksAddon !== 'undefined') {
            term.loadAddon(new WebLinksAddon.WebLinksAddon());
        }

        term.open(container);

        // Fit to container
        if (serialFitAddon) {
            setTimeout(() => serialFitAddon.fit(), 50);
        }

        return term;
    }

    // Update status indicator
    function updateStatus(container, status, isRunning = false) {
        const statusText = container.querySelector('.v86-status-text');
        const statusIndicator = container.querySelector('.v86-status-indicator');

        if (statusText) statusText.textContent = status;
        if (statusIndicator) {
            statusIndicator.classList.toggle('running', isRunning);
        }
    }

    // Setup tab switching
    function setupTabs(container) {
        const tabs = container.querySelectorAll('.v86-tab');
        const panels = container.querySelectorAll('.v86-panel');

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const targetPanel = tab.dataset.tab;

                // Update tabs
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                // Update panels
                panels.forEach(p => {
                    if (p.dataset.panel === targetPanel) {
                        p.classList.add('active');
                    } else {
                        p.classList.remove('active');
                    }
                });

                // Refit serial terminal if switching to it
                if (targetPanel === 'serial' && serialFitAddon) {
                    setTimeout(() => serialFitAddon.fit(), 50);
                }
            });
        });
    }

    // Setup v86 terminal with both VGA and Serial outputs
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

        // Find the serial container for xterm.js
        const serialContainer = contentContainer.querySelector('.terminal-xterm-container');
        if (!serialContainer) {
            console.log('Serial container not found');
            return;
        }

        // Setup tab switching
        setupTabs(contentContainer);

        // Update status
        updateStatus(contentContainer, 'Loading emulator...');

        try {
            console.log('Loading v86 script...');
            await loadV86Script();

            // Wait for xterm.js to be available
            if (typeof Terminal === 'undefined') {
                console.log('Waiting for xterm.js...');
                setTimeout(() => setupV86Terminal(terminalId), 100);
                return;
            }

            // Create serial terminal
            serialTerminal = createSerialTerminal(serialContainer);
            if (serialTerminal) {
                serialTerminal.writeln('\x1b[32m╔════════════════════════════════════════════════╗');
                serialTerminal.writeln('║     v86 Linux Emulator - Serial Console        ║');
                serialTerminal.writeln('╚════════════════════════════════════════════════╝\x1b[0m');
                serialTerminal.writeln('');
                serialTerminal.writeln('Initializing emulator...');
            }

            updateStatus(contentContainer, 'Starting system...');

            console.log('Initializing v86 emulator...');
            v86Emulator = new V86({
                wasm_path: V86_CONFIG.wasmUrl,
                memory_size: 64 * 1024 * 1024,
                vga_memory_size: 8 * 1024 * 1024,

                // VGA output - for graphical display
                screen_container: screenContainer,

                // Serial output - connected to xterm.js
                // v86 will create this internally when we add listener

                bios: { url: V86_CONFIG.biosUrl },
                vga_bios: { url: V86_CONFIG.vgaBiosUrl },

                // Boot from Floppy
                fda: { url: V86_CONFIG.floppyUrl },

                // Boot from ISO (alternative)
                // cdrom: { url: V86_CONFIG.isoUrl },

                autostart: true,
            });

            // Connect serial output to xterm.js
            v86Emulator.add_listener("serial0-output-byte", function (byte) {
                if (serialTerminal) {
                    const char = String.fromCharCode(byte);
                    serialTerminal.write(char);
                }
            });

            // Connect xterm.js input to serial
            if (serialTerminal) {
                serialTerminal.onData(data => {
                    if (v86Emulator) {
                        for (let i = 0; i < data.length; i++) {
                            v86Emulator.serial0_send(data.charCodeAt(i));
                        }
                    }
                });
            }

            // Listen for emulator events
            v86Emulator.add_listener("emulator-ready", function () {
                console.log('v86 emulator ready!');
                updateStatus(contentContainer, 'Running', true);
                if (serialTerminal) {
                    serialTerminal.writeln('\x1b[32mEmulator ready!\x1b[0m\n');
                }
            });

            v86Emulator.add_listener("emulator-started", function () {
                console.log('v86 emulator started!');
            });

            v86Loaded = true;
            console.log('v86 setup complete!');

            // Handle window resize
            const resizeObserver = new ResizeObserver(() => {
                if (serialFitAddon) {
                    serialFitAddon.fit();
                }
            });
            resizeObserver.observe(serialContainer);

            // Focus serial terminal
            if (serialTerminal) {
                serialTerminal.focus();
            }

        } catch (error) {
            console.error('v86 loading error:', error);
            updateStatus(contentContainer, 'Error: ' + error.message);

            if (serialTerminal) {
                serialTerminal.writeln('\x1b[31mError loading v86: ' + error.message + '\x1b[0m');
            }

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
        if (serialTerminal) {
            serialTerminal.dispose();
            serialTerminal = null;
        }
        serialFitAddon = null;
        v86Loaded = false;
    }

    // Expose functions globally
    window.setupV86Terminal = setupV86Terminal;
    window.destroyV86 = destroyV86;

})();
