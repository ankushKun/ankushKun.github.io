/**
 * Terminal Simulator for macOS X 10.9 Mavericks Portfolio
 * Uses xterm.js for terminal emulation
 */

(function () {
    'use strict';

    // Terminal Commands
    const terminalCommands = {
        help: {
            description: 'Show available commands',
            run: () => `Available commands:
  help          Show this help message
  ls            List files in current directory
  cat <file>    Display file contents
  whoami        Display current user
  neofetch      Display system information
  clear         Clear the terminal
  pwd           Print working directory
  date          Show current date and time
  echo <text>   Echo text back
  fortune       Get a random fortune
  cowsay <msg>  Make a cow say something
  open <app>    Open an application window
  sudo <cmd>    Try running as superuser
  exit          Close the terminal

For fun: try 'rm -rf /', 'sudo hire me', or 'make sandwich'`
        },

        ls: {
            description: 'List files',
            run: () => `drwxr-xr-x  projects/
drwxr-xr-x  blogs/
drwxr-xr-x  timeline/
-rw-r--r--  resume.pdf
-rw-r--r--  about.txt
-rw-r--r--  contact.txt
-rw-r--r--  skills.json
-rw-r--r--  .secrets      (hidden)`
        },

        cat: {
            description: 'Display file contents',
            run: (args) => {
                const files = {
                    'about.txt': `Hi! I'm Ankush, a software engineer who loves building things.
I specialize in web development, blockchain, and developer tools.
Currently exploring the decentralized web with Arweave and AO.`,
                    'contact.txt': `Email: ankushkun@example.com
GitHub: github.com/ankushKun
Twitter: @ankushKun_
Schedule a call: cal.com/ankushkun`,
                    'skills.json': `{
  "languages": ["TypeScript", "Python", "Rust", "Go"],
  "frameworks": ["React", "Next.js", "Node.js"],
  "blockchain": ["Arweave", "AO", "Ethereum"],
  "tools": ["Docker", "Git", "Linux"]
}`,
                    'resume.pdf': `[Binary file - use 'open resume' to view]`,
                    '.secrets': `Nice try! 🕵️ But the real secrets are:
1. The Konami code works here (↑↑↓↓←→←→BA)
2. You can run Crysis... just kidding, you can't.
3. sudo hire me`
                };

                const filename = args[0];
                if (!filename) return 'usage: cat <filename>';
                if (files[filename]) return files[filename];
                return `cat: ${filename}: No such file or directory`;
            }
        },

        whoami: {
            description: 'Display current user',
            run: () => 'guest@ankush-portfolio'
        },

        pwd: {
            description: 'Print working directory',
            run: () => '/Users/guest/ankush-portfolio'
        },

        date: {
            description: 'Show current date',
            run: () => new Date().toString()
        },

        echo: {
            description: 'Echo text',
            run: (args) => args.join(' ') || ''
        },

        clear: {
            description: 'Clear terminal',
            run: () => null // Handled specially
        },

        neofetch: {
            description: 'System information',
            run: () => `
        .:'                    ankush@portfolio
    __ :'__                   ------------------
 .'  .   .  '.                OS: AnkushOS Mavericks
:    _   _    :               Host: portfolio.local
:   (o) (o)   :               Kernel: Hugo v0.152
:   .-'''-.   :               Uptime: since 2020
 :  '._Y_.'  :                Shell: mavericks.js
  '.  '''  .'                 Theme: macOS X 10.9
    '-----'                   Terminal: Web Terminal
                              CPU: Brain @ ∞ GHz
                              Memory: Full of ideas`
        },

        fortune: {
            description: 'Random fortune',
            run: () => {
                const fortunes = [
                    "A bug in the code is worth two in the documentation.",
                    "There are only 10 types of people: those who understand binary and those who don't.",
                    "// This code works, don't touch it",
                    "It's not a bug, it's an undocumented feature.",
                    "Console.log() is my debugger.",
                    "There is no place like 127.0.0.1",
                    "sudo make me a sandwich",
                    "Keep calm and clear cache",
                    "Have you tried turning it off and on again?",
                    "In case of fire: git commit, git push, leave building"
                ];
                return fortunes[Math.floor(Math.random() * fortunes.length)];
            }
        },

        cowsay: {
            description: 'Make a cow say something',
            run: (args) => {
                const message = args.join(' ') || 'Moo!';
                const border = '-'.repeat(message.length + 2);
                return `
 ${border}
< ${message} >
 ${border}
        \\   ^__^
         \\  (oo)\\_______
            (__)\\       )\\/\\
                ||----w |
                ||     ||`;
            }
        },

        open: {
            description: 'Open an application',
            run: (args) => {
                const apps = {
                    'about': { id: 'about', title: 'About Me' },
                    'resume': { id: 'resume', title: 'Resume' },
                    'projects': { id: 'projects', title: 'Projects' },
                    'blogs': { id: 'blogs', title: 'Blogs' },
                    'timeline': { id: 'timeline', title: 'Timeline' },
                    'games': { id: 'games', title: 'Games' },
                    'contact': { id: 'contact', title: 'Contact' },
                    'wins': { id: 'wins', title: 'Wins' }
                };

                const appName = (args[0] || '').toLowerCase();
                if (!appName) {
                    return `usage: open <app>\nAvailable apps: ${Object.keys(apps).join(', ')}`;
                }

                if (apps[appName]) {
                    setTimeout(() => {
                        if (window.openContentWindow) {
                            window.openContentWindow(apps[appName].id, apps[appName].title, null);
                        }
                    }, 100);
                    return `Opening ${apps[appName].title}...`;
                }

                return `open: ${appName}: Application not found. Try: ${Object.keys(apps).join(', ')}`;
            }
        },

        sudo: {
            description: 'Superuser do',
            run: (args) => {
                const cmd = args.join(' ').toLowerCase();

                if (cmd === 'hire me' || cmd === 'hireme') {
                    setTimeout(() => {
                        if (window.openContentWindow) {
                            window.openContentWindow('resume', 'Resume', null);
                        }
                    }, 500);
                    return `✨ Opening resume... You have excellent taste in candidates!`;
                }

                if (cmd === 'make sandwich' || cmd === 'make me a sandwich') {
                    return '🥪 Okay.';
                }

                if (cmd.startsWith('rm')) {
                    if (window.playErrorSound) window.playErrorSound();
                    return `sudo: Operation not permitted. Nice try though! 😏`;
                }

                return `[sudo] password for guest: 
Sorry, try again.
[sudo] password for guest: 
Sorry, try again.
sudo: 3 incorrect password attempts`;
            }
        },

        rm: {
            description: 'Remove files',
            run: (args) => {
                if (args.includes('-rf') && (args.includes('/') || args.includes('*'))) {
                    if (window.playErrorSound) window.playErrorSound();
                    return `rm: Permission denied. 
Also, that's not very nice! This portfolio took effort to build. 😢`;
                }
                return 'rm: cannot remove: Permission denied';
            }
        },

        make: {
            description: 'Build target',
            run: (args) => {
                if (args[0] === 'sandwich') {
                    return "What? Make it yourself.";
                }
                if (args[0] === 'love') {
                    return "make: *** No rule to make target 'love'. Stop.";
                }
                return `make: *** No rule to make target '${args[0] || ''}'. Stop.`;
            }
        },

        exit: {
            description: 'Exit terminal',
            run: () => {
                setTimeout(() => {
                    const terminalWindow = document.querySelector('[data-window-id="terminal"]');
                    if (terminalWindow) {
                        const closeBtn = terminalWindow.querySelector('.traffic-light.close');
                        if (closeBtn) closeBtn.click();
                    }
                }, 200);
                return 'logout\n[Process completed]';
            }
        }
    };

    // xterm.js based terminal
    let xtermInstance = null;
    let xtermFitAddon = null;

    function setupTerminal(terminalId) {
        // Find the container inside the opened window
        const win = document.querySelector(`[data-window-id="${terminalId}"]`);
        if (!win) {
            setTimeout(() => setupTerminal(terminalId), 100);
            return;
        }

        const container = win.querySelector('.terminal-xterm-container');
        if (!container) {
            console.log('Terminal container not found');
            return;
        }

        // Wait for xterm to be loaded
        if (typeof Terminal === 'undefined') {
            setTimeout(() => setupTerminal(terminalId), 100);
            return;
        }

        // Create terminal instance
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
            scrollback: 1000
        });

        // Load addons
        if (typeof FitAddon !== 'undefined') {
            const fitAddon = new FitAddon.FitAddon();
            term.loadAddon(fitAddon);
            xtermFitAddon = fitAddon;
        }

        if (typeof WebLinksAddon !== 'undefined') {
            term.loadAddon(new WebLinksAddon.WebLinksAddon());
        }

        // Open terminal
        term.open(container);

        // Fit to container
        if (xtermFitAddon) {
            setTimeout(() => xtermFitAddon.fit(), 0);
        }

        xtermInstance = term;

        // State
        let currentLine = '';
        const history = [];
        let historyIndex = -1;

        // Welcome message
        const welcomeArt = [
            '\x1b[32m',
            ' _____     _           _    _____         ',
            '|  _  |___| |_ _ _ ___| |_ |  |  |_ _ ___ ',
            '|     |   | \'_| | |_ -|   ||    -| | |   |',
            '|__|__|_|_|_,_|___|___|_|_||__|__|___|_|_|',
            '\x1b[0m',
            '',
            '\x1b[36mWelcome to AnkushOS v1.0.0 (Mavericks Edition)\x1b[0m',
            'Type \x1b[33mhelp\x1b[0m for available commands.',
            ''
        ];

        welcomeArt.forEach(line => term.writeln(line));
        writePrompt();

        function writePrompt() {
            term.write('\x1b[32mankush@portfolio\x1b[0m \x1b[34m~\x1b[0m $ ');
        }

        function executeXtermCommand(commandLine) {
            const parts = commandLine.trim().split(/\s+/);
            const cmd = parts[0].toLowerCase();
            const args = parts.slice(1);

            if (!cmd) {
                writePrompt();
                return;
            }

            // Add to history
            if (commandLine.trim()) {
                history.unshift(commandLine.trim());
                if (history.length > 50) history.pop();
            }
            historyIndex = -1;

            if (terminalCommands[cmd]) {
                const result = terminalCommands[cmd].run(args, terminalId, term);
                if (result !== null && result !== undefined) {
                    if (cmd === 'clear') {
                        term.clear();
                    } else {
                        const lines = result.split('\n');
                        lines.forEach(line => term.writeln(line));
                    }
                }
            } else {
                term.writeln('\x1b[31mzsh: command not found: ' + cmd + '\x1b[0m');
            }

            writePrompt();
        }

        // Handle keyboard input
        term.onKey(({ key, domEvent }) => {
            const ev = domEvent;
            const printable = !ev.altKey && !ev.ctrlKey && !ev.metaKey;

            if (ev.key === 'Enter') {
                term.writeln('');
                executeXtermCommand(currentLine);
                currentLine = '';
            } else if (ev.key === 'Backspace') {
                if (currentLine.length > 0) {
                    currentLine = currentLine.slice(0, -1);
                    term.write('\b \b');
                }
            } else if (ev.key === 'ArrowUp') {
                if (history.length > 0 && historyIndex < history.length - 1) {
                    while (currentLine.length > 0) {
                        term.write('\b \b');
                        currentLine = currentLine.slice(0, -1);
                    }
                    historyIndex++;
                    currentLine = history[historyIndex];
                    term.write(currentLine);
                }
            } else if (ev.key === 'ArrowDown') {
                while (currentLine.length > 0) {
                    term.write('\b \b');
                    currentLine = currentLine.slice(0, -1);
                }
                if (historyIndex > 0) {
                    historyIndex--;
                    currentLine = history[historyIndex];
                    term.write(currentLine);
                } else {
                    historyIndex = -1;
                    currentLine = '';
                }
            } else if (ev.key === 'Tab') {
                ev.preventDefault();
                const partial = currentLine.toLowerCase();
                const matches = Object.keys(terminalCommands).filter(c => c.startsWith(partial));
                if (matches.length === 1) {
                    const completion = matches[0].slice(currentLine.length);
                    currentLine += completion + ' ';
                    term.write(completion + ' ');
                } else if (matches.length > 1) {
                    term.writeln('');
                    term.writeln('\x1b[36m' + matches.join('  ') + '\x1b[0m');
                    writePrompt();
                    term.write(currentLine);
                }
            } else if (printable) {
                currentLine += key;
                term.write(key);
            }
        });

        // Handle paste
        term.onData(data => {
            if (data.length > 1 && !data.startsWith('\x1b')) {
                currentLine += data;
                term.write(data);
            }
        });

        // Focus terminal on click
        container.addEventListener('click', () => term.focus());

        // Handle window resize
        const resizeObserver = new ResizeObserver(() => {
            if (xtermFitAddon) xtermFitAddon.fit();
        });
        resizeObserver.observe(container);

        term.focus();
    }

    // Expose globally
    window.setupTerminal = setupTerminal;

})();
