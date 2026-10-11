/**
 * Terminal shell - the Terminal window's default view.
 *
 * A small bash-like shell on xterm.js (static/xterm) that opens instantly and
 * treats the site as a read-only filesystem built from /index.json:
 *
 *   ~/blogs/<slug>.md       ~/projects/<slug>.md     ~/timeline/<slug>.md
 *   ~/about.md, ~/resume.md ... (pages that belong to an app)
 *   /Applications/<App>.app (every searchable app and game)
 *
 * `cat` fetches a page's markdown twin (<permalink>index.md) and prints it,
 * `open` opens a page or app in its desktop window, and `linux` hands the
 * window over to the v86 Linux VM (assets/js/v86-terminal.js), which boots
 * with the same files mounted at /mnt/site.
 *
 * Loaded on demand by v86-terminal.js (window.TERMINAL_SHELL_URL). Public API:
 *   window.TerminalShell.start(id, container, hooks) -> shell
 *   window.TerminalShell.get(id) / .destroy(id) / .show(id, note) / .hide(id)
 *   window.TerminalShell.siteFiles() -> Promise<[{ path, url }]>
 * hooks: { onLinux(), hasSavedLinux() -> Promise<boolean> }
 *
 * localStorage `terminal-shell-v1`: { history: string[] (last 100 commands),
 * lastLogin: ms }. Nothing leaves the browser except same-origin fetches.
 */
(function () {
    'use strict';

    if (window.TerminalShell) return;

    const STORE_KEY = 'terminal-shell-v1';
    const HISTORY_MAX = 100;
    const HOST = 'ankush.one';
    const USER = 'guest';
    const HOME = '/Users/' + USER;
    const BOOTED_AT = Date.now();

    // ANSI styling. Colours are the 16 ANSI slots, which the xterm theme maps
    // to the --term-* tokens in assets/css/apps/terminal-shell.css.
    const C = {
        reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', italic: '\x1b[3m', underline: '\x1b[4m',
        noUnderline: '\x1b[24m', noBold: '\x1b[22m', noItalic: '\x1b[23m', fg: '\x1b[39m',
        red: '\x1b[31m', green: '\x1b[32m', blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m'
    };
    const ANSI_RE = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x07]*\x07/g;
    const LINK_RE = /\x1b\]8;;([^\x07]*)\x07/g;

    /** Terminal cells a plain string takes (xterm counts code points; marks and joiners take none). */
    function cells(s) {
        let n = 0;
        for (const ch of s) {
            if (!/[\u0300-\u036f\u200b-\u200f\ufe00-\ufe0f]/.test(ch)) n++;
        }
        return n;
    }

    const visibleLength = (s) => cells(s.replace(ANSI_RE, ''));

    /**
     * A clickable span. Written with OSC 8 markers, which the shell strips
     * on output and turns into hover links (see Shell.println): `shell:`
     * targets run a command, others open a page or URL.
     */
    function link(label, target) {
        return '\x1b]8;;' + target + '\x07' + label + '\x1b]8;;\x07';
    }
    const cmdLink = (label, command) => link(label, 'shell:' + encodeURIComponent(command));

    function readStore() {
        try {
            const data = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
            return {
                history: Array.isArray(data.history)
                    ? data.history.filter(h => typeof h === 'string' && h.length <= 500).slice(-HISTORY_MAX) : [],
                lastLogin: typeof data.lastLogin === 'number' ? data.lastLogin : 0
            };
        } catch (e) {
            return { history: [], lastLogin: 0 };
        }
    }

    function writeStore(patch) {
        try {
            const data = Object.assign(readStore(), patch);
            localStorage.setItem(STORE_KEY, JSON.stringify(data));
        } catch (e) { /* private mode: history just is not kept */ }
    }

    // ============================================================
    // Site index -> virtual filesystem
    // ============================================================

    let indexPromise = null;

    function loadIndex() {
        if (!indexPromise) {
            indexPromise = fetch('/index.json', { credentials: 'same-origin' })
                .then(r => {
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.json();
                })
                .then(data => {
                    if (!Array.isArray(data)) throw new Error('bad index');
                    return buildFs(data);
                })
                .catch(err => {
                    indexPromise = null;
                    throw err;
                });
        }
        return indexPromise;
    }

    function makeDir(name, parent, extra) {
        const node = Object.assign({ name, type: 'dir', parent, children: new Map() }, extra || {});
        if (parent) parent.children.set(name, node);
        return node;
    }

    function makeFile(name, parent, extra) {
        const node = Object.assign({ name, type: 'file', parent }, extra || {});
        parent.children.set(name, node);
        return node;
    }

    function lastSegment(permalink) {
        const parts = String(permalink || '').split('/').filter(Boolean);
        return parts.length ? parts[parts.length - 1] : '';
    }

    const SECTIONS = ['blogs', 'projects', 'timeline'];
    const SAFE_NAME = /^[\w.@+-]+$/;

    function buildFs(index) {
        const root = makeDir('', null);
        const apps = makeDir('Applications', root);
        const users = makeDir('Users', root);
        const home = makeDir(USER, users);

        const sectionDirs = {};
        SECTIONS.forEach(s => { sectionDirs[s] = makeDir(s, home); });
        // ~/Applications leads to /Applications, as a symlink would
        home.children.set('Applications', apps);

        index.forEach(item => {
            if (!item || typeof item.title !== 'string') return;
            const permalink = typeof item.permalink === 'string' && item.permalink.charAt(0) === '/' ? item.permalink : '';

            if (item.kind === 'app') {
                if (typeof item.openWindow !== 'string') return;
                const name = item.title.replace(/[\/\x00-\x1f]/g, '') + '.app';
                makeFile(name, apps, { type: 'app', item, title: item.title });
                // An app with a page of its own (About, Resume, Privacy...) is also a file in ~
                if (permalink && SECTIONS.indexOf(item.openWindow) === -1) {
                    const slug = lastSegment(permalink);
                    if (slug && SAFE_NAME.test(slug) && !home.children.has(slug + '.md')) {
                        makeFile(slug + '.md', home, { item, title: item.title, permalink });
                    }
                }
                if (sectionDirs[item.openWindow]) sectionDirs[item.openWindow].item = item;
                return;
            }

            const dir = sectionDirs[item.type];
            const slug = lastSegment(permalink);
            if (!dir || !slug || !SAFE_NAME.test(slug)) return;
            makeFile(slug + '.md', dir, { item, title: item.title, permalink, date: item.date || '' });
        });

        return { root, home, apps };
    }

    function pathOf(node) {
        const parts = [];
        for (let n = node; n && n.parent; n = n.parent) parts.unshift(n.name);
        return '/' + parts.join('/');
    }

    function displayPath(node) {
        const p = pathOf(node);
        if (p === HOME) return '~';
        if (p.indexOf(HOME + '/') === 0) return '~' + p.slice(HOME.length);
        return p;
    }

    function findChild(dir, name) {
        if (!dir || !dir.children) return null;
        if (dir.children.has(name)) return dir.children.get(name);
        // Like the Mac's own disk: names are case-insensitive
        const lower = name.toLowerCase();
        for (const [key, child] of dir.children) {
            if (key.toLowerCase() === lower) return child;
        }
        return null;
    }

    /** Resolve a shell path against cwd. Returns the node or null. */
    function resolvePath(fs, cwd, input) {
        let path = String(input || '');
        let node;
        if (path === '~' || path.indexOf('~/') === 0) {
            node = fs.home;
            path = path.slice(1);
        } else if (path.charAt(0) === '/') {
            node = fs.root;
        } else {
            node = cwd;
        }
        const parts = path.split('/').filter(Boolean);
        for (const part of parts) {
            if (part === '.') continue;
            if (part === '..') {
                node = node.parent || node;
                continue;
            }
            if (node.type !== 'dir') return null;
            node = findChild(node, part);
            if (!node) return null;
        }
        return node;
    }

    /** Every file under a directory, depth first. */
    function walk(node, out) {
        out = out || [];
        if (node.type !== 'dir') {
            out.push(node);
            return out;
        }
        sortedChildren(node).forEach(child => walk(child, out));
        return out;
    }

    function sortedChildren(dir, byTime) {
        const list = Array.from(dir.children.values());
        if (byTime) {
            list.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || a.name.localeCompare(b.name));
        } else {
            list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        }
        return list;
    }

    /** Styled name as `ls -G` would print it, clickable. */
    function styledName(node, label) {
        const name = label || node.name;
        if (node.type === 'dir') return cmdLink(C.bold + C.blue + name + C.reset, 'cd ' + shellQuote(displayPath(node)) + ' && ls');
        if (node.type === 'app') return cmdLink(C.magenta + name + C.reset, 'open ' + shellQuote(displayPath(node)));
        return cmdLink(name, 'cat ' + shellQuote(displayPath(node)));
    }

    function shellQuote(s) {
        return /^[\w.\/~@+-]+$/.test(s) ? s : "'" + s.replace(/'/g, "'\\''") + "'";
    }

    // ============================================================
    // Page text: markdown twin -> terminal text
    // ============================================================

    const pageCache = new Map();

    function fetchMarkdown(permalink, signal) {
        if (pageCache.has(permalink)) return Promise.resolve(pageCache.get(permalink));
        const url = permalink.replace(/\/?$/, '/') + 'index.md';
        return fetch(url, { credentials: 'same-origin', signal }).then(r => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.text();
        }).then(text => {
            pageCache.set(permalink, text);
            return text;
        });
    }

    const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

    function decodeEntities(s) {
        return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
            if (code[0] === '#') {
                const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
                return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
            }
            return ENTITIES[code.toLowerCase()] || m;
        });
    }

    /** Strip anything a terminal must not interpret (escape sequences, controls). */
    function sanitize(s) {
        return String(s)
            .replace(/[\x00-\x08\x0b-\x1f\x7f\x9b]/g, '')
            // xterm gives an emoji one cell but the font draws two: pad it,
            // and drop the joiners and variation selectors it cannot combine
            .replace(/[\u200d\ufe0f]/g, '')
            .replace(/(\p{Extended_Pictographic})/gu, '$1\u00a0');
    }

    function parseFrontMatter(md) {
        const meta = {};
        const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
        if (!m) return { meta, body: md };
        m[1].split(/\r?\n/).forEach(line => {
            const kv = /^(\w+):\s*(.*)$/.exec(line);
            if (!kv) return;
            let value = kv[2].trim();
            if (/^".*"$/.test(value)) {
                try { value = JSON.parse(value); } catch (e) { value = value.slice(1, -1); }
            } else if (/^\[.*\]$/.test(value)) {
                try { value = JSON.parse(value); } catch (e) { /* keep text */ }
            }
            meta[kv[1]] = value;
        });
        return { meta, body: md.slice(m[0].length) };
    }

    /** Inline markdown -> ANSI. Code spans are protected from the other rules. */
    function inline(text) {
        const codes = [];
        let s = text.replace(/`([^`]+)`/g, (m, code) => {
            codes.push(C.cyan + code + C.fg);
            return '\u0000' + (codes.length - 1) + '\u0000';
        });
        // Backslash escapes (\" \* \_ ...) are literal characters
        s = s.replace(/\\([\\`*_{}\[\]()#+\-.!"'|<>~])/g, (m, ch) => {
            codes.push(ch);
            return '\u0000' + (codes.length - 1) + '\u0000';
        });
        s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, (m, alt) => C.dim + '[image' + (alt ? ': ' + alt : '') + ']' + C.noBold);
        s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, label, href) => {
            const target = /^(https?:|\/)/.test(href) ? href : null;
            const styled = C.underline + label + C.noUnderline;
            return target ? link(styled, target) : styled;
        });
        s = s.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (m, a, b) => C.bold + (a || b) + C.noBold);
        s = s.replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, (m, pre, t) => pre + C.italic + t + C.noItalic);
        s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => codes[+i]);
        return s;
    }

    /**
     * Word-wrap ANSI text to `width` columns. Continuation lines start with
     * `indent` (a plain string of spaces).
     */
    function wrap(text, width, firstPrefix, indent) {
        const prefix = firstPrefix || '';
        const next = indent == null ? ' '.repeat(visibleLength(prefix)) : indent;
        const lines = [];
        let line = prefix;
        let len = visibleLength(prefix);
        let empty = true;
        text.split(/ +/).forEach(word => {
            if (!word) return;
            const w = visibleLength(word);
            if (empty) {
                line += word;
                len += w;
            } else if (len + 1 + w > width) {
                lines.push(line);
                line = next + word;
                len = visibleLength(next) + w;
            } else {
                line += ' ' + word;
                len += 1 + w;
            }
            empty = false;
        });
        lines.push(line);
        return lines;
    }

    /** Markdown body -> array of terminal lines. */
    function renderMarkdown(body, width, skipTitle) {
        const out = [];
        // Remove what a terminal cannot show: raw HTML blocks, comments, embeds
        let md = body
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/<(style|script|iframe|svg|video|audio|noscript)\b[\s\S]*?<\/\1>/gi, '');

        const src = md.split(/\r?\n/);
        let para = [];
        let inFence = false;
        let skippedTitle = !skipTitle;
        const blank = () => { if (out.length && out[out.length - 1] !== '') out.push(''); };

        const flush = () => {
            if (!para.length) return;
            // Collapse spaces and tabs only: emoji padding is a no-break space
            const text = inline(para.join(' ').replace(/[ \t]+/g, ' ').trim());
            if (text) wrap(text, width, '', '').forEach(l => out.push(l));
            para = [];
            blank();
        };

        for (let raw of src) {
            if (/^\s*(```|~~~)/.test(raw)) {
                flush();
                inFence = !inFence;
                if (!inFence) blank();
                continue;
            }
            if (inFence) {
                out.push('    ' + C.cyan + sanitize(raw) + C.fg);
                continue;
            }

            // HTML tags outside code: keep their text only
            let line = decodeEntities(raw.replace(/<[^>]+>/g, ''));
            line = sanitize(line).replace(/\s+$/, '');

            if (!line.trim()) {
                flush();
                continue;
            }

            const heading = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line);
            if (heading) {
                flush();
                if (!skippedTitle && heading[1].length === 1) {
                    skippedTitle = true;
                    continue;
                }
                blank();
                const style = heading[1].length <= 2 ? C.bold + C.underline : C.bold;
                wrap(style + inline(heading[2]) + C.reset, width, '', '').forEach(l => out.push(l));
                blank();
                continue;
            }

            if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
                flush();
                out.push(C.dim + '─'.repeat(Math.min(width, 48)) + C.reset);
                blank();
                continue;
            }

            const quote = /^\s*>\s?(.*)$/.exec(line);
            if (quote) {
                flush();
                wrap(C.dim + inline(quote[1]) + C.reset, width, C.dim + '│ ' + C.reset, C.dim + '│ ' + C.reset)
                    .forEach(l => out.push(l));
                continue;
            }

            const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
            if (item) {
                flush();
                const depth = Math.min(Math.floor(item[1].replace(/\t/g, '    ').length / 2), 4);
                const bullet = /\d/.test(item[2]) ? item[2] : '•';
                const lead = '  '.repeat(depth) + '  ' + bullet + ' ';
                wrap(inline(item[3]), width, lead, ' '.repeat(lead.length)).forEach(l => out.push(l));
                continue;
            }

            if (/^\s*\|/.test(line)) {
                flush();
                if (/^\s*\|?[\s:|-]+\|?\s*$/.test(line)) continue; // table rule
                const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(c => inline(c.trim()));
                wrap(cells.join(C.dim + '  │  ' + C.reset), width, '  ', '  ').forEach(l => out.push(l));
                continue;
            }

            // Two trailing spaces in the source mark a hard line break
            para.push(line.trim());
            if (/ {2}$/.test(raw)) flush();
        }
        flush();
        while (out.length && out[out.length - 1] === '') out.pop();
        return out;
    }

    // ============================================================
    // Commands
    // ============================================================

    const COMMANDS = {};
    function command(name, spec) { COMMANDS[name] = spec; }

    command('help', {
        desc: 'list the commands',
        run(sh) {
            sh.println(C.bold + 'Site' + C.reset);
            ['ls', 'cd', 'cat', 'open', 'grep', 'tree', 'random', 'linux'].forEach(n => sh.printHelpLine(n));
            sh.println('');
            sh.println(C.bold + 'Shell' + C.reset);
            ['pwd', 'history', 'clear', 'echo', 'date', 'uptime', 'whoami', 'uname', 'man', 'exit']
                .forEach(n => sh.printHelpLine(n));
            sh.println('');
            sh.println(C.dim + 'Tab completes names, ↑ ↓ walk the history, Ctrl+C cancels. Names and commands on screen can be clicked.' + C.reset);
        }
    });

    command('ls', {
        usage: 'ls [-l] [-t] [-r] [path ...]',
        desc: 'list a directory (-l adds dates and titles, -t sorts newest first)',
        async run(sh, args) {
            const fs = await sh.fs();
            const { flags, rest } = parseFlags(args, 'altr1');
            const targets = rest.length ? rest : ['.'];
            let first = true;
            for (const target of targets) {
                const node = resolvePath(fs, sh.cwd, target);
                if (!node) {
                    sh.error('ls: ' + target + ': No such file or directory');
                    continue;
                }
                if (targets.length > 1 && node.type === 'dir') {
                    if (!first) sh.println('');
                    sh.println(target + ':');
                }
                first = false;
                let list = node.type === 'dir' ? sortedChildren(node, flags.t) : [node];
                if (flags.r) list = list.slice().reverse();
                if (flags.l) sh.printLong(list);
                else sh.printColumns(list.map(n => ({ text: styledName(n), width: n.name.length })));
            }
        }
    });

    command('cd', {
        usage: 'cd [path]',
        desc: 'change directory (no path: home)',
        async run(sh, args) {
            const fs = await sh.fs();
            const target = args[0] || '~';
            const node = target === '-' ? (sh.prevCwd || sh.cwd) : resolvePath(fs, sh.cwd, target);
            if (!node) return sh.error('-bash: cd: ' + target + ': No such file or directory');
            if (node.type !== 'dir') return sh.error('-bash: cd: ' + target + ': Not a directory');
            sh.prevCwd = sh.cwd;
            sh.cwd = node;
        }
    });

    command('pwd', {
        desc: 'print the working directory',
        async run(sh) {
            await sh.fs();
            sh.println(pathOf(sh.cwd));
        }
    });

    command('cat', {
        usage: 'cat <file ...>',
        desc: 'print a page (blog post, project, ...) right here',
        aliases: ['less', 'more', 'bat'],
        async run(sh, args, ctx) {
            const fs = await sh.fs();
            if (!args.length) return sh.error('usage: cat <file ...>   e.g. ' + C.reset + cmdLink('cat ~/about.md', 'cat ~/about.md'));
            for (const target of args) {
                const node = resolvePath(fs, sh.cwd, target);
                if (!node) {
                    sh.error('cat: ' + target + ': No such file or directory');
                    continue;
                }
                if (node.type === 'dir' || node.type === 'app') {
                    sh.error('cat: ' + target + ': Is a directory' +
                        (node.type === 'app' ? C.reset + C.dim + '  (try ' + cmdLink('open ' + shellQuote(displayPath(node)), 'open ' + shellQuote(displayPath(node))) + ')' + C.reset : ''));
                    continue;
                }
                let text;
                try {
                    text = await fetchMarkdown(node.permalink, ctx.signal);
                } catch (e) {
                    if (ctx.signal.aborted) return;
                    sh.error('cat: ' + target + ': could not be read (' + (navigator.onLine === false ? 'offline' : e.message) + ')');
                    continue;
                }
                if (ctx.signal.aborted) return;
                sh.printPage(node, text);
            }
        }
    });

    command('open', {
        usage: 'open <file | dir | app | url>',
        desc: 'open a page or app in its window',
        async run(sh, args) {
            const fs = await sh.fs();
            // `open -a Paint` names an app; the flag changes nothing here
            const targets = args.filter(a => a !== '-a');
            if (!targets.length) return sh.error('usage: open <file | dir | app>   e.g. ' + C.reset + cmdLink('open Paint.app', 'open /Applications/Paint.app'));
            for (const target of targets) {
                if (/^https?:\/\//i.test(target)) {
                    sh.openUrl(target);
                    continue;
                }
                let node = resolvePath(fs, sh.cwd, target);
                // `open paint` / `open -a Paint`: an app by name or id
                if (!node) node = findApp(fs, target);
                if (!node) {
                    sh.error('The file ' + pathOf(sh.cwd).replace(/\/$/, '') + '/' + target + ' does not exist.');
                    continue;
                }
                if (!sh.openNode(node)) sh.error('open: ' + target + ': nothing to open');
            }
        }
    });

    command('grep', {
        usage: 'grep <words> [path]',
        desc: 'search titles and summaries under a directory (default: here)',
        aliases: ['search', 'find'],
        async run(sh, args) {
            const fs = await sh.fs();
            const { rest } = parseFlags(args, 'irnlR');
            if (!rest.length) return sh.error('usage: grep <words> [path]');
            let scope = sh.cwd;
            let terms = rest;
            if (rest.length > 1) {
                const maybeDir = resolvePath(fs, sh.cwd, rest[rest.length - 1]);
                if (maybeDir) {
                    scope = maybeDir;
                    terms = rest.slice(0, -1);
                }
            }
            // From / or ~, search everything; elsewhere only below the directory
            if (scope === fs.root) scope = fs.home;
            const query = terms.join(' ').toLowerCase().trim();
            const words = query.split(/\s+/).filter(Boolean);
            const hits = walk(scope).filter(n => {
                if (n.type !== 'file' || !n.item) return false;
                const hay = (n.title + ' ' + (n.item.description || '') + ' ' + (n.item.content || '') + ' ' + (n.item.tags || []).join(' ')).toLowerCase();
                return words.every(w => hay.indexOf(w) !== -1);
            });
            if (!hits.length) {
                sh.println(C.dim + 'No matches for “' + sanitize(query) + '” in ' + displayPath(scope) + '.' + C.reset);
                return;
            }
            const re = new RegExp('(' + words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
            const mark = (s) => sanitize(s).replace(re, C.bold + C.red + '$1' + C.fg + C.noBold);
            hits.slice(0, 40).forEach(n => {
                const label = cmdLink(C.magenta + displayPath(n) + C.fg, 'cat ' + shellQuote(displayPath(n)));
                sh.println(label + C.dim + ':' + C.reset + ' ' + mark(n.title));
                // Show the field the words were found in
                const fields = [n.item.description, n.item.content].filter(f => typeof f === 'string' && f);
                const tags = Array.isArray(n.item.tags) ? n.item.tags.filter(t => typeof t === 'string').map(t => '#' + t).join(' ') : '';
                const field = fields.find(f => words.some(w => f.toLowerCase().indexOf(w) !== -1)) ||
                    (tags && words.some(w => tags.toLowerCase().indexOf(w) !== -1) ? tags : fields[0] || '');
                const blurb = snippet(field, words);
                if (blurb) wrap(C.dim + mark(blurb) + C.reset, sh.cols(), '    ', '    ').forEach(l => sh.println(l));
            });
            if (hits.length > 40) sh.println(C.dim + '… and ' + (hits.length - 40) + ' more. Narrow it down with more words.' + C.reset);
        }
    });

    command('tree', {
        usage: 'tree [path]',
        desc: 'show a directory and everything in it',
        async run(sh, args) {
            const fs = await sh.fs();
            const node = resolvePath(fs, sh.cwd, args[0] || '.');
            if (!node) return sh.error('tree: ' + args[0] + ': No such file or directory');
            sh.println(C.bold + C.blue + (args[0] || '.') + C.reset);
            let dirs = 0, files = 0;
            const draw = (dir, prefix) => {
                const list = sortedChildren(dir);
                list.forEach((child, i) => {
                    const lastOne = i === list.length - 1;
                    sh.println(C.dim + prefix + (lastOne ? '└── ' : '├── ') + C.reset + styledName(child));
                    if (child.type === 'dir') {
                        dirs++;
                        draw(child, prefix + (lastOne ? '    ' : '│   '));
                    } else {
                        files++;
                    }
                });
            };
            if (node.type === 'dir') draw(node, '');
            sh.println('');
            sh.println(dirs + (dirs === 1 ? ' directory, ' : ' directories, ') + files + (files === 1 ? ' file' : ' files'));
        }
    });

    command('random', {
        desc: 'a random post or project to read',
        aliases: ['fortune'],
        async run(sh) {
            const fs = await sh.fs();
            const pool = walk(fs.home).filter(n => n.type === 'file' && n.item && (n.parent.name === 'blogs' || n.parent.name === 'projects'));
            if (!pool.length) return sh.error('random: nothing to pick from');
            const n = pool[Math.floor(Math.random() * pool.length)];
            sh.println(C.bold + sanitize(n.title) + C.reset + (n.date ? C.dim + '  ' + n.date + C.reset : ''));
            const blurb = n.item.description || n.item.content || '';
            if (blurb) wrap(sanitize(blurb).replace(/\s+/g, ' ').slice(0, 280), sh.cols(), '', '').forEach(l => sh.println(l));
            const p = shellQuote(displayPath(n));
            sh.println(C.dim + 'Read it: ' + C.reset + cmdLink('cat ' + p, 'cat ' + p) + C.dim + '  or  ' + C.reset + cmdLink('open ' + p, 'open ' + p));
        }
    });

    command('linux', {
        desc: 'boot a real Linux (Buildroot, in an x86 emulator); the site is at /mnt/site',
        run(sh) {
            if (!sh.hooks.onLinux) return sh.error('linux: the emulator is not available here');
            sh.println('Booting Buildroot Linux in v86, an x86 emulator running in your browser.');
            sh.println(C.dim + 'The first boot downloads about 8 MB. This site’s pages are mounted at /mnt/site.' + C.reset);
            sh.println(C.dim + 'Back to this shell: “Quit Linux” in the ▼ menu at the right of the title bar.' + C.reset);
            if (window.track) window.track('terminal_linux', {});
            // Let the lines paint before the window switches over
            setTimeout(() => sh.hooks.onLinux(), 350);
        }
    });

    command('history', {
        desc: 'commands you have run (-c clears them)',
        run(sh, args) {
            if (args[0] === '-c') {
                sh.history = [];
                writeStore({ history: [] });
                return;
            }
            const start = Math.max(0, sh.history.length - 50);
            sh.history.slice(start).forEach((h, i) => {
                sh.println(String(start + i + 1).padStart(5) + '  ' + sanitize(h));
            });
        }
    });

    command('clear', {
        desc: 'clear the screen (Ctrl+L)',
        run(sh) { sh.term.clear(); }
    });

    command('echo', {
        desc: 'print its arguments',
        run(sh, args) { sh.println(sanitize(args.join(' '))); }
    });

    command('date', {
        desc: 'the date and time where you are',
        run(sh) {
            const d = new Date();
            const tz = (d.toTimeString().match(/\(([^)]+)\)/) || [])[1] || '';
            const abbrev = /\s/.test(tz) ? tz.split(/\s+/).map(w => w[0]).join('') : tz;
            const p = (n) => String(n).padStart(2, '0');
            const day = d.toLocaleDateString('en-US', { weekday: 'short' });
            const mon = d.toLocaleDateString('en-US', { month: 'short' });
            sh.println(day + ' ' + mon + ' ' + String(d.getDate()).padStart(2) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + ' ' + abbrev + ' ' + d.getFullYear());
        }
    });

    command('uptime', {
        desc: 'how long this page has been open',
        run(sh) {
            const mins = Math.floor((Date.now() - BOOTED_AT) / 60000);
            const span = mins < 60 ? mins + (mins === 1 ? ' min' : ' mins')
                : Math.floor(mins / 60) + ':' + String(mins % 60).padStart(2, '0');
            const now = new Date();
            sh.println(String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + '  up ' + span + ', 1 user');
        }
    });

    command('whoami', { desc: 'who you are here', run(sh) { sh.println(USER); } });
    command('hostname', { desc: 'this machine', run(sh) { sh.println(HOST); }, hidden: true });

    command('uname', {
        desc: 'the system (-a for everything)',
        run(sh, args) {
            sh.println(args[0] === '-a'
                ? 'Darwin ' + HOST + ' 13.4.0 Darwin Kernel Version 13.4.0 (well, JavaScript in your browser) x86_64'
                : 'Darwin');
        }
    });

    command('man', {
        usage: 'man <command>',
        desc: 'what a command does',
        run(sh, args) {
            if (!args[0]) return sh.println('What manual page do you want?');
            const spec = lookup(args[0]);
            if (!spec) return sh.println('No manual entry for ' + sanitize(args[0]));
            sh.println(C.bold + (spec.usage || spec.name) + C.reset);
            wrap(spec.desc || '', sh.cols(), '    ', '    ').forEach(l => sh.println(l));
            if (spec.aliases) sh.println(C.dim + '    also: ' + spec.aliases.join(', ') + C.reset);
        }
    });

    command('exit', {
        desc: 'close the window',
        aliases: ['logout', 'quit'],
        run(sh) {
            sh.println('');
            sh.println('[Process completed]');
            sh.closing = true;
            setTimeout(() => {
                const close = sh.win && sh.win.querySelector('.traffic-light.close');
                if (close) close.click();
            }, 400);
        }
    });

    // A little personality, as any good shell has
    command('sudo', {
        hidden: true,
        run(sh) {
            sh.println('Password:');
            sh.println(USER + ' is not in the sudoers file.  This incident will be reported.');
        }
    });

    ['rm', 'mv', 'cp', 'mkdir', 'touch', 'rmdir', 'chmod', 'chown', 'ln'].forEach(name => command(name, {
        hidden: true,
        run(sh, args) {
            const target = args.filter(a => a.charAt(0) !== '-')[0] || '';
            sh.error(name + ': ' + (target ? target + ': ' : '') + 'Read-only file system');
        }
    }));

    ['vim', 'vi', 'nano', 'emacs', 'pico'].forEach(name => command(name, {
        hidden: true,
        run(sh) { sh.error('-bash: ' + name + ': this shell can only read. ' + C.reset + cmdLink('linux', 'linux') + C.red + ' has vi.'); }
    }));

    command('cowsay', {
        hidden: true,
        run(sh, args) {
            const text = sanitize(args.join(' ') || 'Moo. Try `random`.');
            const lines = wrap(text, Math.min(40, sh.cols() - 6), '', '');
            const w = Math.max(...lines.map(visibleLength));
            sh.println(' ' + '_'.repeat(w + 2));
            lines.forEach((l, i) => {
                const edge = lines.length === 1 ? ['<', '>'] : i === 0 ? ['/', '\\'] : i === lines.length - 1 ? ['\\', '/'] : ['|', '|'];
                sh.println(edge[0] + ' ' + l + ' '.repeat(w - visibleLength(l)) + ' ' + edge[1]);
            });
            sh.println(' ' + '-'.repeat(w + 2));
            ['        \\   ^__^', '         \\  (oo)\\_______', '            (__)\\       )\\/\\', '                ||----w |', '                ||     ||']
                .forEach(l => sh.println(l));
        }
    });

    command('xyzzy', { hidden: true, run(sh) { sh.println('Nothing happens.'); } });

    function lookup(name) {
        if (COMMANDS[name]) return Object.assign({ name }, COMMANDS[name]);
        for (const key of Object.keys(COMMANDS)) {
            if ((COMMANDS[key].aliases || []).indexOf(name) !== -1) return Object.assign({ name: key }, COMMANDS[key]);
        }
        return null;
    }

    function commandNames() {
        const names = [];
        Object.keys(COMMANDS).forEach(k => {
            if (!COMMANDS[k].hidden) names.push(k);
            (COMMANDS[k].aliases || []).forEach(a => names.push(a));
        });
        return names.sort();
    }

    function parseFlags(args, known) {
        const flags = {};
        const rest = [];
        args.forEach(a => {
            if (/^-[a-zA-Z]+$/.test(a) && a.slice(1).split('').every(f => known.indexOf(f) !== -1)) {
                a.slice(1).split('').forEach(f => { flags[f] = true; });
            } else {
                rest.push(a);
            }
        });
        return { flags, rest };
    }

    function findApp(fs, name) {
        const key = name.replace(/\.app$/i, '').toLowerCase();
        for (const node of fs.apps.children.values()) {
            if (node.item.openWindow.toLowerCase() === key || node.title.toLowerCase() === key) return node;
        }
        if (window.SiteShell && window.SiteShell.resolveApp) {
            const app = window.SiteShell.resolveApp(key);
            if (app) {
                for (const node of fs.apps.children.values()) {
                    if (node.item.openWindow === app.id) return node;
                }
            }
        }
        return null;
    }

    function snippet(text, words) {
        const flat = String(text).replace(/\s+/g, ' ').trim();
        if (!flat) return '';
        const lower = flat.toLowerCase();
        let at = -1;
        words.some(w => { at = lower.indexOf(w); return at !== -1; });
        if (at < 0 || at < 60) return flat.slice(0, 160) + (flat.length > 160 ? '…' : '');
        const start = flat.lastIndexOf(' ', at - 40) + 1;
        return '…' + flat.slice(start, start + 160) + (start + 160 < flat.length ? '…' : '');
    }

    /** Split a command line into words, honouring quotes and backslashes. */
    function tokenize(line) {
        const out = [];
        let cur = '', quote = null, has = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (quote) {
                if (ch === quote) quote = null;
                else if (ch === '\\' && quote === '"' && i + 1 < line.length) cur += line[++i];
                else cur += ch;
            } else if (ch === '"' || ch === "'") {
                quote = ch;
                has = true;
            } else if (ch === '\\' && i + 1 < line.length) {
                cur += line[++i];
                has = true;
            } else if (/\s/.test(ch)) {
                if (cur || has) out.push(cur);
                cur = '';
                has = false;
            } else {
                cur += ch;
            }
        }
        if (cur || has) out.push(cur);
        return out;
    }

    /** `a && b; c` -> [{ words, and }] where `and` means: only if the previous one worked */
    function splitChain(line) {
        const parts = [];
        let cur = '', quote = null;
        let and = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (quote) {
                if (ch === quote) quote = null;
                cur += ch;
            } else if (ch === '"' || ch === "'") {
                quote = ch;
                cur += ch;
            } else if (ch === ';' || (ch === '&' && line[i + 1] === '&')) {
                parts.push({ text: cur, and });
                and = ch === '&';
                if (and) i++;
                cur = '';
            } else {
                cur += ch;
            }
        }
        parts.push({ text: cur, and });
        return parts.filter(p => p.text.trim());
    }

    // ============================================================
    // The shell
    // ============================================================

    const shells = new Map();

    function cssVar(el, name, fallback) {
        const v = getComputedStyle(el).getPropertyValue(name).trim();
        return v || fallback;
    }

    function themeFrom(el) {
        const v = (n, f) => cssVar(el, '--term-' + n, f);
        return {
            background: v('bg', '#ffffff'),
            foreground: v('fg', '#000000'),
            cursor: v('cursor', '#7f7f7f'),
            cursorAccent: v('bg', '#ffffff'),
            selectionBackground: v('selection', '#b4d5fe'),
            black: v('black', '#000000'),
            red: v('red', '#c23621'),
            green: v('green', '#25bc24'),
            yellow: v('yellow', '#adad27'),
            blue: v('blue', '#492ee1'),
            magenta: v('magenta', '#d338d3'),
            cyan: v('cyan', '#33bbc8'),
            white: v('white', '#cbcccd'),
            brightBlack: v('bright-black', '#818383'),
            brightRed: v('red', '#c23621'),
            brightGreen: v('green', '#25bc24'),
            brightYellow: v('yellow', '#adad27'),
            brightBlue: v('blue', '#492ee1'),
            brightMagenta: v('magenta', '#d338d3'),
            brightCyan: v('cyan', '#33bbc8'),
            brightWhite: v('white', '#cbcccd')
        };
    }

    class Shell {
        constructor(id, container, hooks) {
            this.id = id;
            this.hooks = hooks || {};
            this.container = container;
            this.win = container.closest('.window');
            this.cleanups = [];
            const store = readStore();
            this.history = store.history;
            this.lastLogin = store.lastLogin;
            this.histIndex = this.history.length;
            this.draft = '';
            this.line = '';
            this.cursor = 0;
            this.cursorRow = 0;     // row of the cursor within the prompt+input block
            this.busy = false;
            this.queue = '';
            this.abort = null;
            this.cwd = null;
            this.prevCwd = null;
            this.tabPending = false;
            this.closing = false;
            this.mount();
        }

        mount() {
            const el = document.createElement('div');
            el.className = 'terminal-shell';
            const screen = document.createElement('div');
            screen.className = 'terminal-shell-screen';
            el.appendChild(screen);

            // Touch keyboards have no Tab, arrows or Ctrl: a key row stands in
            const keys = document.createElement('div');
            keys.className = 'terminal-shell-keys';
            keys.setAttribute('role', 'toolbar');
            keys.setAttribute('aria-label', 'Terminal keys');
            [['Tab', '\t', 'Complete'], ['↑', '\x1b[A', 'Previous command'], ['↓', '\x1b[B', 'Next command'],
                ['←', '\x1b[D', 'Cursor left'], ['→', '\x1b[C', 'Cursor right'], ['^C', '\x03', 'Cancel'],
                ['help', 'help\r', 'Run help'], ['ls', 'ls\r', 'Run ls']].forEach(([label, data, name]) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'terminal-shell-key';
                b.textContent = label;
                b.setAttribute('aria-label', name);
                // Keep the on-screen keyboard up: never take focus from the terminal
                b.addEventListener('pointerdown', (e) => e.preventDefault());
                b.addEventListener('click', () => {
                    if (/\r$/.test(data) && !this.busy) {
                        this.setLine('');
                    }
                    this.input(data);
                    this.term.focus();
                });
                keys.appendChild(b);
            });
            el.appendChild(keys);
            this.container.appendChild(el);
            this.el = el;

            const mono = cssVar(el, '--font-mono', 'Menlo, Monaco, monospace');
            const compact = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
            this.term = new window.Terminal({
                fontFamily: mono,
                fontSize: compact ? 12 : 13,
                lineHeight: 1.15,
                cursorBlink: !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches),
                cursorStyle: 'block',
                scrollback: 2000,
                convertEol: false,
                allowProposedApi: false,
                // Mirrors the screen into an accessibility tree with a live region
                screenReaderMode: true,
                macOptionIsMeta: true,
                theme: themeFrom(el)
            });
            this.fit = typeof window.FitAddon !== 'undefined' ? new window.FitAddon.FitAddon() : null;
            if (this.fit) this.term.loadAddon(this.fit);
            this.term.open(screen);
            const textarea = screen.querySelector('textarea');
            if (textarea) textarea.setAttribute('aria-label', 'Terminal input');
            this.refit();

            this.term.onData(data => this.input(data));
            this.links = [];
            this.carryLink = null;
            this.term.registerLinkProvider({ provideLinks: (y, cb) => cb(this.linksAt(y)) });
            // Cmd+K clears, as in Terminal.app; Cmd+C/V stay with the browser
            this.term.attachCustomKeyEventHandler(e => {
                if (e.type === 'keydown' && e.metaKey && (e.key === 'k' || e.key === 'K')) {
                    this.term.clear();
                    return false;
                }
                return true;
            });

            const ro = new ResizeObserver(() => this.refit());
            ro.observe(screen);
            this.cleanups.push(() => ro.disconnect());

            // Follow the appearance (light / dark / accent) live
            const mo = new MutationObserver(() => { this.term.options.theme = themeFrom(el); });
            mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-appearance', 'data-accent', 'class'] });
            this.cleanups.push(() => mo.disconnect());
            const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
            if (mq && mq.addEventListener) {
                const onScheme = () => { this.term.options.theme = themeFrom(el); };
                mq.addEventListener('change', onScheme);
                this.cleanups.push(() => mq.removeEventListener('change', onScheme));
            }

            this.greet();
        }

        refit() {
            if (!this.fit || !this.el || this.el.hidden) return;
            try {
                this.fit.fit();
            } catch (e) { /* not laid out yet */ }
            this.cursorRow = Math.floor((this.promptLength() + this.cursor) / Math.max(1, this.term.cols));
        }

        cols() { return Math.max(20, this.term.cols - 1); }

        write(s) { this.term.write(s); }
        println(s) {
            String(s == null ? '' : s).split(/\r?\n/).forEach(line => this.printLine(line));
        }

        /** One output line; its link markers become hover links over the cells they cover. */
        printLine(line) {
            const ranges = [];
            let open = null;
            let width = 0;
            let clean = '';
            if (this.carryLink) {
                // A link wrapped onto this line: it resumes after the indent
                const lead = /^ */.exec(line.replace(ANSI_RE, ''))[0].length;
                open = { target: this.carryLink, start: lead };
                this.carryLink = null;
            }
            let last = 0;
            line.replace(LINK_RE, (m, target, at) => {
                const piece = line.slice(last, at);
                clean += piece;
                width += visibleLength(piece);
                last = at + m.length;
                if (target) {
                    open = { target, start: width };
                } else if (open) {
                    if (width > open.start) ranges.push({ target: open.target, start: open.start, end: width });
                    open = null;
                }
                return '';
            });
            const tail = line.slice(last);
            clean += tail;
            width += visibleLength(tail);
            if (open) {
                if (width > open.start) ranges.push({ target: open.target, start: open.start, end: width });
                this.carryLink = open.target;
            }
            if (!ranges.length) {
                this.term.write(clean + '\r\n');
                return;
            }
            this.term.write(clean + '\r\n', () => {
                // The cursor now sits on the line after this one
                const rows = Math.max(1, Math.ceil(width / Math.max(1, this.term.cols)));
                const marker = this.term.registerMarker(-rows);
                if (!marker) return;
                this.links.push({ marker, width, ranges });
                if (this.links.length > 600) this.links = this.links.filter(l => !l.marker.isDisposed).slice(-400);
            });
        }

        linksAt(y) {
            const row = y - 1;
            const cols = Math.max(1, this.term.cols);
            const out = [];
            this.links.forEach(rec => {
                if (rec.marker.isDisposed || rec.marker.line < 0) return;
                const first = rec.marker.line;
                if (row < first || row >= first + Math.max(1, Math.ceil(rec.width / cols))) return;
                rec.ranges.forEach(r => {
                    const startRow = first + Math.floor(r.start / cols);
                    const endRow = first + Math.floor((r.end - 1) / cols);
                    if (row < startRow || row > endRow) return;
                    out.push({
                        range: {
                            start: { x: (r.start % cols) + 1, y: startRow + 1 },
                            end: { x: ((r.end - 1) % cols) + 1, y: endRow + 1 }
                        },
                        text: r.target,
                        decorations: { pointerCursor: true, underline: true },
                        activate: () => this.activateLink(r.target)
                    });
                });
            });
            return out;
        }
        error(s) { this.println(C.red + s + C.reset); this.failed = true; }

        printHelpLine(name) {
            const spec = COMMANDS[name];
            const pad = ' '.repeat(Math.max(1, 10 - name.length));
            const lead = '  ' + cmdLink(C.bold + name + C.reset, name === 'cat' || name === 'open' || name === 'grep' ? 'man ' + name : name) + pad;
            wrap(spec.desc || '', this.cols(), lead, ' '.repeat(12)).forEach(l => this.println(l));
        }

        /** Names in columns, like ls without -l */
        printColumns(items) {
            if (!items.length) return;
            const widest = Math.max(...items.map(i => i.width)) + 2;
            const perRow = Math.max(1, Math.floor(this.cols() / widest));
            const rows = Math.ceil(items.length / perRow);
            for (let r = 0; r < rows; r++) {
                let line = '';
                for (let c = 0; c < perRow; c++) {
                    const item = items[c * rows + r];
                    if (!item) continue;
                    line += item.text + ' '.repeat(widest - item.width);
                }
                this.println(line.replace(/\s+$/, ''));
            }
        }

        printLong(list) {
            const width = this.cols();
            const nameWidth = Math.min(32, Math.max(...list.map(n => n.name.length + (n.type === 'dir' ? 1 : 0))));
            list.forEach(n => {
                const date = n.date ? formatLsDate(n.date) : (n.type === 'dir' ? countLabel(n) : '            ');
                const shownName = n.name + (n.type === 'dir' ? '/' : '');
                const fitted = shownName.length > nameWidth ? shownName.slice(0, nameWidth - 1) + '…' : shownName;
                let line = C.dim + date + C.reset + '  ' + styledName(n, fitted) + ' '.repeat(Math.max(1, nameWidth - fitted.length + 2));
                const room = width - visibleLength(line);
                const title = sanitize(n.type === 'dir' ? (n.item ? n.item.description || '' : '') : (n.title || ''));
                if (room > 8 && title) line += C.dim + (title.length > room ? title.slice(0, room - 1) + '…' : title) + C.reset;
                this.println(line);
            });
        }

        printPage(node, markdown) {
            const { meta, body } = parseFrontMatter(markdown);
            const width = this.cols();
            const title = sanitize(meta.title || node.title || node.name);
            this.println('');
            wrap(C.bold + title + C.reset, width, '', '').forEach(l => this.println(l));
            const bits = [];
            if (meta.date) bits.push(String(meta.date).slice(0, 10));
            if (Array.isArray(meta.tags) && meta.tags.length) bits.push(meta.tags.map(t => '#' + sanitize(t)).join(' '));
            if (bits.length) this.println(C.dim + bits.join('  ·  ') + C.reset);
            this.println('');
            renderMarkdown(body, width, true).forEach(l => this.println(l));
            this.println('');
            const p = shellQuote(displayPath(node));
            wrap(C.dim + '──' + C.reset + ' ' + cmdLink('open ' + p, 'open ' + p) + ' ' + C.dim + 'to read it in a window' + C.reset, width, '', '   ')
                .forEach(l => this.println(l));
        }

        fs() {
            return loadIndex().then(fs => {
                if (!this.cwd) this.cwd = fs.home;
                return fs;
            }, err => {
                throw new ShellError('cannot read the site index (' + (navigator.onLine === false ? 'offline' : err.message) + ')');
            });
        }

        openNode(node) {
            const item = node.item;
            if (node.type === 'app' || (node.type === 'dir' && item)) {
                if (window.SiteShell && window.SiteShell.openApp) return window.SiteShell.openApp(item.openWindow, null, 'terminal');
                return false;
            }
            if (node.type === 'file' && item) {
                if (item.kind === 'app' && window.SiteShell && window.SiteShell.openApp) {
                    return window.SiteShell.openApp(item.openWindow, null, 'terminal');
                }
                if (typeof window.openWindow === 'function') {
                    window.openWindow(item.openWindow, item.title, { width: item.width || 900, height: item.height || 650 }, item.permalink);
                    return true;
                }
                window.location.href = item.permalink;
                return true;
            }
            return false;
        }

        openUrl(url) {
            let parsed;
            try { parsed = new URL(url, window.location.origin); } catch (e) { return; }
            if (!/^https?:$/.test(parsed.protocol)) return;
            if (parsed.origin === window.location.origin || parsed.hostname === HOST) {
                // A page of this site: open its window rather than leave the desktop
                loadIndex().then(fs => {
                    const target = walk(fs.home).concat(Array.from(fs.apps.children.values()))
                        .find(n => n.item && n.item.permalink === parsed.pathname);
                    if (!target || !this.openNode(target)) window.location.href = parsed.pathname + parsed.search + parsed.hash;
                }, () => { window.location.href = parsed.pathname; });
                return;
            }
            window.open(parsed.href, '_blank', 'noopener');
        }

        activateLink(uri) {
            if (uri.indexOf('shell:') === 0) {
                if (this.busy || this.closing) return;
                let cmd = '';
                try { cmd = decodeURIComponent(uri.slice(6)); } catch (e) { return; }
                this.setLine(cmd);
                this.input('\r');
                return;
            }
            this.openUrl(uri);
        }

        // ---------------- prompt + line editor ----------------

        promptText() {
            const where = this.cwd ? (pathOf(this.cwd) === HOME ? '~' : (this.cwd.parent ? this.cwd.name : '/')) : '~';
            return HOST + ':' + where + ' ' + USER + '$ ';
        }

        promptLength() { return this.promptText().length; }

        prompt() {
            this.line = '';
            this.cursor = 0;
            this.cursorRow = 0;
            this.histIndex = this.history.length;
            this.draft = '';
            this.write(this.promptText());
        }

        /** Redraw the prompt and input, leaving the cursor where it belongs. */
        render() {
            const cols = Math.max(1, this.term.cols);
            let s = '';
            if (this.cursorRow > 0) s += '\x1b[' + this.cursorRow + 'A';
            s += '\r\x1b[J' + this.promptText() + this.line;
            const end = this.promptLength() + this.line.length;
            // Exactly at the edge, the cursor waits to wrap: make it wrap now
            if (end > 0 && end % cols === 0) s += ' \b\x1b[K';
            const target = this.promptLength() + this.cursor;
            const endRow = Math.floor(end / cols);
            const row = Math.floor(target / cols);
            if (endRow > row) s += '\x1b[' + (endRow - row) + 'A';
            s += '\x1b[' + ((target % cols) + 1) + 'G';
            this.cursorRow = row;
            this.write(s);
        }

        setLine(text, cursor) {
            this.line = text;
            this.cursor = cursor == null ? text.length : cursor;
            this.render();
        }

        insert(text) {
            const clean = text.replace(/[\x00-\x1f\x7f]/g, '');
            if (!clean) return;
            this.line = this.line.slice(0, this.cursor) + clean + this.line.slice(this.cursor);
            this.cursor += clean.length;
            this.render();
        }

        input(data) {
            if (this.closing) return;
            if (this.busy) {
                if (data.indexOf('\x03') !== -1) {
                    this.queue = '';
                    if (this.abort) this.abort.abort();
                } else {
                    // Typed ahead (or pasted several lines): run it once this is done
                    this.queue += data;
                }
                return;
            }
            let i = 0;
            while (i < data.length && !this.busy) {
                const rest = data.slice(i);
                const esc = /^\x1b(\[[0-9;]*[~A-Za-z]|O[A-Za-z]|[bf]|.)?/.exec(rest);
                if (rest[0] === '\x1b' && esc) {
                    this.key(esc[0]);
                    i += esc[0].length || 1;
                    continue;
                }
                const ch = rest[0];
                if (ch === '\r' || ch === '\n') {
                    if (ch === '\r' && rest[1] === '\n') i++;
                    i++;
                    this.submit();
                    if (this.busy) {
                        this.queue += data.slice(i);
                        return;
                    }
                    continue;
                }
                if (ch < ' ' || ch === '\x7f') {
                    this.key(ch);
                    i++;
                    continue;
                }
                // A run of printable text in one go (typing or paste)
                const run = /^[^\x00-\x1f\x7f]+/.exec(rest)[0];
                this.insert(run);
                this.tabPending = false;
                i += run.length;
            }
        }

        key(k) {
            if (k !== '\t') this.tabPending = false;
            switch (k) {
                case '\x7f': case '\b': // Backspace
                    if (this.cursor > 0) {
                        this.line = this.line.slice(0, this.cursor - 1) + this.line.slice(this.cursor);
                        this.cursor--;
                        this.render();
                    }
                    break;
                case '\x1b[3~': // Delete
                    if (this.cursor < this.line.length) {
                        this.line = this.line.slice(0, this.cursor) + this.line.slice(this.cursor + 1);
                        this.render();
                    }
                    break;
                case '\x1b[D': case '\x02':
                    if (this.cursor > 0) { this.cursor--; this.render(); }
                    break;
                case '\x1b[C': case '\x06':
                    if (this.cursor < this.line.length) { this.cursor++; this.render(); }
                    break;
                case '\x1b[H': case '\x1bOH': case '\x01':
                    this.cursor = 0; this.render();
                    break;
                case '\x1b[F': case '\x1bOF': case '\x05':
                    this.cursor = this.line.length; this.render();
                    break;
                case '\x1bb': case '\x1b[1;3D': case '\x1b[1;5D': { // word left
                    const before = this.line.slice(0, this.cursor).replace(/\s+$/, '');
                    this.cursor = before.lastIndexOf(' ') + 1;
                    this.render();
                    break;
                }
                case '\x1bf': case '\x1b[1;3C': case '\x1b[1;5C': { // word right
                    const m = /^\s*\S*/.exec(this.line.slice(this.cursor));
                    this.cursor += m ? m[0].length : 0;
                    this.render();
                    break;
                }
                case '\x1b[A': case '\x10':
                    this.historyStep(-1);
                    break;
                case '\x1b[B': case '\x0e':
                    this.historyStep(1);
                    break;
                case '\x15': // Ctrl+U
                    this.line = this.line.slice(this.cursor);
                    this.cursor = 0;
                    this.render();
                    break;
                case '\x0b': // Ctrl+K
                    this.line = this.line.slice(0, this.cursor);
                    this.render();
                    break;
                case '\x17': { // Ctrl+W
                    const before = this.line.slice(0, this.cursor);
                    const cut = before.replace(/\S+\s*$/, '');
                    this.line = cut + this.line.slice(this.cursor);
                    this.cursor = cut.length;
                    this.render();
                    break;
                }
                case '\x03': // Ctrl+C
                    this.cursor = this.line.length;
                    this.render();
                    this.write('^C\r\n');
                    this.prompt();
                    break;
                case '\x0c': // Ctrl+L
                    this.write('\x1b[H\x1b[2J');
                    this.cursorRow = 0;
                    this.render();
                    break;
                case '\x04': // Ctrl+D on an empty line logs out
                    if (!this.line) {
                        this.write('\r\n');
                        this.run('exit');
                    }
                    break;
                case '\t':
                    this.complete();
                    break;
                default:
                    break;
            }
        }

        historyStep(dir) {
            if (!this.history.length) return;
            if (this.histIndex === this.history.length) this.draft = this.line;
            const next = Math.min(this.history.length, Math.max(0, this.histIndex + dir));
            if (next === this.histIndex) return;
            this.histIndex = next;
            this.setLine(next === this.history.length ? this.draft : this.history[next]);
        }

        submit() {
            const line = this.line;
            this.cursor = this.line.length;
            this.render();
            this.write('\r\n');
            this.cursorRow = 0;
            const trimmed = line.trim();
            if (trimmed && trimmed !== this.history[this.history.length - 1] && trimmed.length <= 500) {
                this.history.push(trimmed);
                if (this.history.length > HISTORY_MAX) this.history = this.history.slice(-HISTORY_MAX);
                writeStore({ history: this.history });
            }
            this.run(trimmed);
        }

        async run(line) {
            if (!line) {
                this.prompt();
                return;
            }
            this.busy = true;
            this.abort = new AbortController();
            const ctx = { signal: this.abort.signal };
            let ok = true;
            try {
                for (const part of splitChain(line)) {
                    if (part.and && !ok) continue;
                    if (ctx.signal.aborted) break;
                    ok = await this.exec(part.text, ctx);
                }
            } finally {
                const aborted = this.abort.signal.aborted;
                this.abort = null;
                this.busy = false;
                if (aborted) this.write('^C\r\n');
                if (!this.closing) {
                    this.prompt();
                    const queued = this.queue;
                    this.queue = '';
                    if (queued) this.input(queued);
                }
            }
        }

        async exec(text, ctx) {
            const unquoted = text.replace(/(["']).*?\1/g, '');
            if (/(^|[^|])\|(?!\|)/.test(unquoted) || />/.test(unquoted)) {
                this.error('-bash: pipes and redirection are not supported in this shell. ' + C.reset + cmdLink('linux', 'linux') + C.red + ' has them.');
                return false;
            }
            const words = tokenize(text);
            if (!words.length) return true;
            const name = words[0];
            const spec = lookup(name);
            if (!spec) {
                this.error('-bash: ' + sanitize(name) + ': command not found');
                if (!this.hintedHelp) {
                    this.hintedHelp = true;
                    this.println(C.dim + 'Type ' + C.reset + cmdLink('help', 'help') + C.dim + ' to see what this shell can do.' + C.reset);
                }
                return false;
            }
            if (window.track) window.track('terminal_command', { command: spec.name });
            this.failed = false;
            try {
                await spec.run(this, words.slice(1), ctx);
            } catch (e) {
                if (ctx.signal.aborted) return false;
                this.error(spec.name + ': ' + (e instanceof ShellError ? e.message : 'something went wrong'));
                if (!(e instanceof ShellError)) console.error(e);
                return false;
            }
            return !this.failed;
        }

        // ---------------- completion ----------------

        async complete() {
            const before = this.line.slice(0, this.cursor);
            const words = before.split(/\s+/);
            const word = words[words.length - 1];
            let candidates = [];
            let base = '';
            if (words.length === 1) {
                candidates = commandNames().filter(n => n.indexOf(word) === 0).map(n => ({ name: n, suffix: ' ' }));
            } else {
                let fs;
                try { fs = await this.fs(); } catch (e) { return; }
                const slash = word.lastIndexOf('/');
                base = slash === -1 ? '' : word.slice(0, slash + 1);
                const partial = slash === -1 ? word : word.slice(slash + 1);
                const dir = base ? resolvePath(fs, this.cwd, base) : this.cwd;
                if (dir && dir.type === 'dir') {
                    const lower = partial.toLowerCase();
                    candidates = sortedChildren(dir)
                        .filter(n => n.name.toLowerCase().indexOf(lower) === 0)
                        .map(n => ({ name: n.name, suffix: n.type === 'dir' ? '/' : ' ', node: n }));
                }
                // `open pai<Tab>` also finds apps by name
                if (!base && /^(open|man)$/.test(words[0]) && words.length === 2) {
                    if (words[0] === 'man') {
                        candidates = commandNames().filter(n => n.indexOf(word) === 0).map(n => ({ name: n, suffix: ' ' }));
                    } else {
                        const lower = partial.toLowerCase();
                        fs.apps.children.forEach(n => {
                            if (n.name.toLowerCase().indexOf(lower) === 0 && !candidates.some(c => c.name === n.name)) {
                                candidates.push({ name: n.name, suffix: ' ', node: n });
                            }
                        });
                    }
                }
            }
            if (this.busy || this.line.slice(0, this.cursor) !== before) return;
            if (!candidates.length) return;

            const replaceWord = (text) => {
                const start = this.cursor - word.length;
                this.line = this.line.slice(0, start) + text + this.line.slice(this.cursor);
                this.cursor = start + text.length;
                this.render();
            };

            if (candidates.length === 1) {
                const c = candidates[0];
                replaceWord(base + escapeWord(c.name) + c.suffix);
                this.tabPending = false;
                return;
            }
            const common = commonPrefix(candidates.map(c => c.name));
            const typed = word.slice(base.length);
            if (common.length > typed.length) {
                replaceWord(base + escapeWord(common));
                this.tabPending = true;
                return;
            }
            if (!this.tabPending) {
                this.tabPending = true;
                this.term.write('\x07');
                return;
            }
            // Second Tab: list the options, then redraw the prompt
            this.cursor = this.line.length;
            this.render();
            this.write('\r\n');
            this.printColumns(candidates.map(c => ({ text: c.name + (c.suffix === '/' ? '/' : ''), width: c.name.length + (c.suffix === '/' ? 1 : 0) })));
            this.cursorRow = 0;
            const keep = this.line;
            this.write(this.promptText());
            this.line = '';
            this.cursor = 0;
            this.setLine(keep);
            this.tabPending = false;
        }

        // ---------------- lifecycle ----------------

        async greet() {
            const t = this.term;
            // Keys typed while the welcome is printing wait for the prompt
            this.busy = true;
            if (this.lastLogin) {
                const d = new Date(this.lastLogin);
                const p = (n) => String(n).padStart(2, '0');
                const day = d.toLocaleDateString('en-US', { weekday: 'short' });
                const mon = d.toLocaleDateString('en-US', { month: 'short' });
                t.write('Last login: ' + day + ' ' + mon + ' ' + String(d.getDate()).padStart(2) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + ' on ttys000\r\n');
            }
            writeStore({ lastLogin: Date.now() });

            this.println(C.bold + 'Welcome to ' + HOST + '.' + C.reset + ' Every post and project on this site is a file here.');
            this.println('');
            const row = (cmd, run, what) => {
                const pad = ' '.repeat(Math.max(1, 18 - cmd.length));
                this.println('  ' + cmdLink(C.bold + cmd + C.reset, run) + pad + C.dim + what + C.reset);
            };
            row('ls -lt blogs', 'ls -lt blogs', 'the latest writing');
            row('cat <file>', 'man cat', 'read a page right here');
            row('open <file>', 'man open', 'open it in a window');
            row('random', 'random', 'pick something to read');
            row('linux', 'linux', 'boot a real Linux VM');
            row('help', 'help', 'everything else');
            this.println('');

            try {
                if (this.hooks.hasSavedLinux && await this.hooks.hasSavedLinux()) {
                    this.println(C.dim + 'You have a saved Linux session. Type ' + C.reset + cmdLink('linux', 'linux') + C.dim + ' to resume it.' + C.reset);
                    this.println('');
                }
            } catch (e) { /* no saved state */ }

            // Warm the index so the first `ls` is instant
            try { await this.fs(); } catch (e) { /* reported when a command needs it */ }
            if (!this.el) return;
            this.busy = false;
            this.prompt();
            const queued = this.queue.replace(/\x03/g, '');
            this.queue = '';
            if (queued) this.input(queued);
        }

        show(note) {
            if (!this.el) return;
            this.el.hidden = false;
            this.closing = false;
            this.refit();
            if (note && !this.busy) {
                // The note takes the waiting prompt's place, then the prompt returns below it
                let s = this.cursorRow > 0 ? '\x1b[' + this.cursorRow + 'A' : '';
                s += '\r\x1b[J' + C.dim + note + C.reset + '\r\n';
                this.write(s);
                this.cursorRow = 0;
                const keep = this.line;
                this.write(this.promptText());
                this.line = '';
                this.setLine(keep);
            }
            this.term.focus();
        }

        hide() {
            if (this.el) this.el.hidden = true;
        }

        destroy() {
            if (this.abort) this.abort.abort();
            this.cleanups.forEach(fn => { try { fn(); } catch (e) { /* ignore */ } });
            this.cleanups = [];
            try { this.term.dispose(); } catch (e) { /* ignore */ }
            if (this.el) this.el.remove();
            this.el = null;
            this.closing = true;
        }
    }

    class ShellError extends Error { }

    function formatLsDate(iso) {
        const d = new Date(iso + 'T00:00:00');
        if (isNaN(d)) return '            ';
        const mon = d.toLocaleDateString('en-US', { month: 'short' });
        return mon + ' ' + String(d.getDate()).padStart(2) + '  ' + d.getFullYear();
    }

    function countLabel(dir) {
        const n = dir.children ? dir.children.size : 0;
        return (n + (n === 1 ? ' item' : ' items')).padStart(12);
    }

    function commonPrefix(names) {
        if (!names.length) return '';
        let prefix = names[0];
        names.forEach(n => {
            let i = 0;
            while (i < prefix.length && i < n.length && prefix[i].toLowerCase() === n[i].toLowerCase()) i++;
            prefix = prefix.slice(0, i);
        });
        return prefix;
    }

    function escapeWord(s) {
        return s.replace(/([\s'"\\])/g, '\\$1');
    }

    window.TerminalShell = {
        start(id, container, hooks) {
            const existing = shells.get(id);
            if (existing) existing.destroy();
            const shell = new Shell(id, container, hooks);
            shells.set(id, shell);
            return shell;
        },
        get: (id) => shells.get(id) || null,
        show(id, note) {
            const shell = shells.get(id);
            if (shell) shell.show(note);
            return !!shell;
        },
        hide(id) {
            const shell = shells.get(id);
            if (shell) shell.hide();
        },
        destroy(id) {
            const shell = shells.get(id);
            if (!shell) return;
            shells.delete(id);
            shell.destroy();
        },
        /**
         * Every page as { path, url } for the Linux VM's /mnt/site share:
         * path is relative to ~ (e.g. "blogs/doom-style-renderer.md").
         */
        siteFiles() {
            return loadIndex().then(fs => walk(fs.home).filter(n => n.type === 'file' && n.permalink).map(n => ({
                path: pathOf(n).slice(HOME.length + 1),
                url: n.permalink.replace(/\/?$/, '/') + 'index.md'
            })));
        }
    };
})();
