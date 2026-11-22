// The Terminal's shell: a small bash over the site (fs.ts), drawn by main.ts. Each command prints
// lines of DOM (text, links you can press, a page's Markdown), never HTML. It drives the rest of
// the site too: open shows a page on the TV, play starts a game, music runs the radio, theme
// switches the lights, and linux boots a real one.
import * as radio from '../../scripts/music/engine';
import { clock } from '../../data/music';
import type { Fs } from '../../pages/apps/terminal/fs.json';
import { lookup, pretty, resolve, walk, type Dir, type File, type Node as FsNode } from './fs';
import { markdown } from './markdown';

export interface Screen {
  /** Prints a line of text and nodes. */
  print(...parts: (Node | string)[]): HTMLElement;
  clear(): void;
  /** Shows a page of the site on the TV. */
  go(url: string): void;
  /** Your name, as the live apps know it, or guest. */
  nick(): string;
  history(): string[];
  clearHistory(): void;
  linux(): void;
  /** When the Terminal opened, for uptime. */
  readonly since: number;
}

type Part = Node | string;
type Command = { help?: string; run(args: string[], line: string): unknown };

export const span = (text: string, cls?: string) => {
  const s = document.createElement('span');
  if (cls) s.className = cls;
  s.textContent = text;
  return s;
};

const link = (text: string, href: string, cls?: string) => {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  if (cls) a.className = cls;
  return a;
};

export function createShell(screen: Screen, root: Dir, me: Fs['me']) {
  let cwd: string[] = [];
  let prev: string[] = [];
  const say = (...p: Part[]) => screen.print(...p);
  const err = (text: string) => say(span(text, 't-err'));

  const nameOf = (n: FsNode) => (n.kind === 'dir' ? `${n.name}/` : n.name);
  const clsOf = (n: FsNode) => (n.kind === 'dir' ? 't-dir' : n.run ? 't-run' : n.hidden ? 't-dim' : '');

  /** A node as something to press: a folder goes into it, a file opens its page. */
  function entry(n: FsNode, path: string[], label = nameOf(n)) {
    const a = link(label, n.kind === 'file' && n.url ? n.url : '#', clsOf(n));
    a.dataset.cmd = n.kind === 'dir' ? `cd ${pretty(path)}` : n.run ? `open ${pretty(path)}` : `cat ${pretty(path)}`;
    return a;
  }

  function find(arg: string | undefined, want?: 'dir' | 'file'): { node: FsNode; path: string[] } | null {
    const path = resolve(cwd, arg ?? '.');
    const node = lookup(root, path);
    if (!node) {
      err(`${arg}: No such file or directory`);
      return null;
    }
    if (want === 'dir' && node.kind !== 'dir') {
      err(`${arg}: Not a directory`);
      return null;
    }
    if (want === 'file' && node.kind === 'dir') {
      err(`${arg}: Is a directory`);
      return null;
    }
    return { node, path };
  }

  const flags = (args: string[]) => {
    const f = new Set<string>();
    const rest: string[] = [];
    for (const a of args) {
      if (/^-[a-zA-Z]+$/.test(a)) for (const c of a.slice(1)) f.add(c);
      else rest.push(a);
    }
    return { f, rest };
  };

  const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const shortDate = (iso?: string) => (iso ? DATE.format(new Date(iso)) : '');

  const commands: Record<string, Command> = {
    help: {
      run([cmd]) {
        if (cmd && commands[cmd]?.help) return void say(span(cmd, 't-cmd'), `  ${commands[cmd].help}`);
        const grid = document.createElement('div');
        grid.className = 't-grid';
        for (const [name, c] of Object.entries(commands)) {
          if (!c.help || HIDDEN.has(name)) continue;
          const a = span(name, 't-cmd');
          a.dataset.cmd = name;
          grid.append(a, span(c.help, 't-soft'));
        }
        say(grid);
        say(span('Press Tab to finish a name, and the arrows for what you typed before.', 't-dim'));
      },
    },
    ls: {
      help: 'what is here',
      run(args) {
        const { f, rest } = flags(args);
        const found = find(rest[0]);
        if (!found) return;
        const { node, path } = found;
        if (node.kind === 'file') return void say(entry(node, path));
        let list = [...node.children.values()].filter((n) => f.has('a') || !n.hidden);
        if (f.has('t')) list.sort((a, b) => String((b as File).date ?? '').localeCompare(String((a as File).date ?? '')));
        else list.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
        if (f.has('r')) list = list.reverse();
        if (f.has('l') || f.has('t')) {
          const grid = document.createElement('div');
          grid.className = 't-list';
          for (const n of list) grid.append(span(n.kind === 'file' ? shortDate(n.date) : '', 't-dim'), entry(n, [...path, n.name]));
          return void say(grid);
        }
        const row = document.createElement('div');
        row.className = 't-row';
        if (f.has('a')) row.append(span('./', 't-dir'), span('../', 't-dir'));
        row.append(...list.map((n) => entry(n, [...path, n.name])));
        say(row);
      },
    },
    cd: {
      help: 'go into a folder',
      run([arg]) {
        if (arg === '-') {
          [cwd, prev] = [prev, cwd];
          return;
        }
        const found = find(arg ?? '~', 'dir');
        if (!found) return;
        prev = cwd;
        cwd = found.path;
      },
    },
    pwd: { run: () => void say(cwd.length ? `/home/${screen.nick()}/${cwd.join('/')}` : `/home/${screen.nick()}`) },
    cat: {
      help: 'read a page here',
      run(args) {
        if (!args.length) return err('cat: what should I read? Try cat about.md');
        for (const a of args) {
          const found = find(a, 'file');
          if (!found) continue;
          const f = found.node as File;
          if (f.text) {
            say(span(f.text, 't-pre'));
            continue;
          }
          if (f.run) {
            say(span(`${f.name} is a program. Run it with `, 't-soft'), cmdLink(`open ${pretty(found.path)}`));
            continue;
          }
          if (f.body === undefined) {
            say(span(`${f.name} is a file to download. `, 't-soft'), link('Open it', f.url));
            continue;
          }
          const box = document.createElement('div');
          box.className = 't-page';
          const h = box.appendChild(document.createElement('h2'));
          h.className = 't-title';
          h.textContent = f.title;
          const meta = [shortDate(f.date), ...(f.tags ?? [])].filter(Boolean).join(', ');
          if (meta) box.append(span(meta, 't-dim'));
          box.append(markdown(f.body, f.url));
          const end = box.appendChild(document.createElement('p'));
          end.className = 't-dim';
          end.append('Read it on the TV with ', cmdLink(`open ${pretty(found.path)}`), '.');
          say(box);
        }
      },
    },
    open: {
      help: 'show it on the TV',
      run([arg]) {
        if (!arg) return err('open: open what? Try open about.md');
        if (/^https?:\/\//.test(arg)) {
          window.open(arg, '_blank', 'noopener');
          return;
        }
        const found = find(arg);
        if (!found) return;
        const n = found.node;
        const url = n.kind === 'dir' ? (n.url ?? (found.path.length ? null : '/')) : n.url;
        if (!url) return err(`${arg}: nothing to open`);
        say(span(`Opening ${url}`, 't-dim'));
        screen.go(url);
      },
    },
    grep: {
      help: 'search every page',
      run(args) {
        const { f, rest } = flags(args);
        // Every page, wherever you are, unless you say where.
        const base = rest.length > 1 && lookup(root, resolve(cwd, rest.at(-1)!))?.kind === 'dir' ? resolve(cwd, rest.pop()!) : [];
        const q = rest.join(' ').replace(/^["']|["']$/g, '');
        if (!q) return err('grep: search for what? Try grep 3ds');
        const needle = q.toLowerCase();
        const start = lookup(root, base);
        if (!start || start.kind !== 'dir') return;
        let hits = 0;
        for (const [path, n] of walk(start, base)) {
          if (n.kind !== 'file' || (n.hidden && !f.has('a'))) continue;
          const text = `${n.title}\n${n.description ?? ''}\n${n.body ?? n.text ?? ''}`;
          const i = text.toLowerCase().indexOf(needle);
          if (i < 0) continue;
          if (++hits > 40) {
            say(span('...and more. Narrow it down.', 't-dim'));
            break;
          }
          const lineStart = text.lastIndexOf('\n', i) + 1;
          const lineEnd = text.indexOf('\n', i);
          let line = text
            .slice(lineStart, lineEnd < 0 ? undefined : lineEnd)
            .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/[#*`>]/g, '')
            .trim();
          let at = line.toLowerCase().indexOf(needle);
          if (line.length > 90 && at > 40) {
            line = `...${line.slice(at - 30)}`;
            at = 33;
          }
          line = line.slice(0, 120);
          const hit = document.createElement('span');
          hit.className = 't-soft';
          if (at >= 0) hit.append(line.slice(0, at), span(line.slice(at, at + q.length), 't-hit'), line.slice(at + q.length));
          else hit.textContent = line;
          say(entry(n, path, path.join('/')), span('  ', ''), hit);
        }
        if (!hits) say(span(`Nothing mentions "${q}".`, 't-dim'));
      },
    },
    tree: {
      run([arg]) {
        const found = find(arg, 'dir');
        if (!found) return;
        const pre = document.createElement('div');
        pre.className = 't-tree';
        const draw = (d: Dir, path: string[], pad: string) => {
          const kids = [...d.children.values()].filter((n) => !n.hidden).sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
          kids.forEach((n, i) => {
            const last = i === kids.length - 1;
            const row = pre.appendChild(document.createElement('div'));
            row.append(span(`${pad}${last ? '`-- ' : '|-- '}`, 't-dim'), entry(n, [...path, n.name]));
            if (n.kind === 'dir') draw(n, [...path, n.name], pad + (last ? '    ' : '|   '));
          });
        };
        draw(found.node as Dir, found.path, '');
        say(pre);
      },
    },
    find: {
      run(args) {
        const q = args.join(' ').replace(/^-name\s+/, '').replace(/["'*]/g, '').toLowerCase();
        let hits = 0;
        for (const [path, n] of walk(root)) {
          if (n.hidden || !n.name.toLowerCase().includes(q)) continue;
          say(entry(n, path, path.join('/')));
          if (++hits >= 60) break;
        }
        if (!hits) say(span('Nothing by that name.', 't-dim'));
      },
    },
    play: {
      help: 'start a game',
      run([arg]) {
        const games = lookup(root, ['games']) as Dir | null;
        if (!games) return;
        if (!arg) {
          const row = document.createElement('div');
          row.className = 't-row';
          for (const g of games.children.values()) row.append(entry(g, ['games', g.name]));
          say(row);
          return void say(span('play <name> to start one.', 't-dim'));
        }
        const g = games.children.get(arg.toLowerCase());
        if (!g || g.kind !== 'file') return err(`play: no game called ${arg}. Type play to see them.`);
        say(span(`Loading ${g.title}...`, 't-dim'));
        screen.go(g.url);
      },
    },
    music: {
      help: 'play, pause, next, prev, np',
      run([what, n]) {
        const s = radio.snapshot();
        switch (what) {
          case 'play':
          case 'pause':
          case 'next':
          case 'prev':
            radio[what]();
            if (what === 'pause') return void say(span('Paused.', 't-dim'));
            setTimeout(() => commands.np.run([], ''), 600);
            return;
          case 'vol':
          case 'volume': {
            const v = Number(n);
            if (!Number.isFinite(v)) return void say(`Volume ${s.volume}%`);
            radio.setVolume(Math.max(0, Math.min(100, Math.round(v))));
            return void say(span(`Volume ${radio.snapshot().volume}%`, 't-dim'));
          }
          case 'shuffle':
            radio.setShuffle(!s.shuffle);
            return void say(span(`Shuffle ${radio.snapshot().shuffle ? 'on' : 'off'}.`, 't-dim'));
          case undefined:
          case 'np':
            return commands.np.run([], '');
          default:
            err(`music: ${what}? Try music play, pause, next, prev, vol 50 or shuffle.`);
        }
      },
    },
    np: {
      run() {
        const s = radio.snapshot();
        const t = s.tracks[s.index];
        if (!t) return void say(span('Nothing playing. ', 't-dim'), cmdLink('music play'));
        say(span(s.playing ? '>> ' : '|| ', 't-run'), span(t.title, 't-strong'), span(`, ${t.artist}`, 't-soft'), span(`  ${clock(radio.playhead())} / ${clock(s.duration || t.durationSec)}`, 't-dim'));
      },
    },
    theme: {
      help: 'day or night',
      run([want]) {
        const now = document.documentElement.dataset.theme === 'dark' ? 'night' : 'day';
        const target = want === 'light' || want === 'day' ? 'day' : want === 'dark' || want === 'night' ? 'night' : want ? null : now === 'day' ? 'night' : 'day';
        if (!target) return err('theme: day or night?');
        if (target !== now) document.querySelector<HTMLElement>('[data-theme-toggle]')?.click();
        say(span(target === 'night' ? 'Lights off.' : 'Lights on.', 't-dim'));
      },
    },
    fetch: {
      help: 'about me',
      run() {
        const box = document.createElement('div');
        box.className = 't-fetch';
        const img = box.appendChild(document.createElement('img'));
        img.src = '/mii/me.webp';
        img.alt = `${me.name}'s Mii`;
        img.width = 150;
        img.height = 150;
        const info = box.appendChild(document.createElement('div'));
        info.className = 't-list';
        const count = (dir: string) => {
          const d = lookup(root, [dir]);
          return d?.kind === 'dir' ? d.children.size : 0;
        };
        const s = radio.snapshot();
        const t = s.playing ? s.tracks[s.index] : null;
        const rows: [string, string][] = [
          ['blog', `${count('blog')} posts`],
          ['projects', `${count('projects')} projects`],
          ['timeline', `${count('timeline')} entries`],
          ['games', `${count('games')} to play`],
          ...(t ? ([['playing', `${t.title}, ${t.artist}`]] as [string, string][]) : []),
          ['up', uptime()],
        ];
        info.append(span('ankush', 't-user'), span(`${me.name}, ${me.job} at ${me.at}`, 't-soft'));
        for (const [k, v] of rows) info.append(span(k, 't-dir'), span(v));
        const swatches = document.createElement('span');
        swatches.className = 't-swatches';
        swatches.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < 7; i++) swatches.appendChild(document.createElement('i'));
        info.append(span(''), swatches);
        say(box);
      },
    },
    whoami: { run: () => void say(screen.nick()) },
    date: { run: () => void say(new Date().toString().replace(/ \(.*\)$/, '')) },
    uptime: { run: () => void say(uptime()) },
    echo: { run: (_args, line) => void say(line.replace(/^\s*echo\s?/, '').replace(/^["']|["']$/g, '')) },
    history: {
      run([arg]) {
        if (arg === '-c') return screen.clearHistory();
        const h = screen.history();
        h.slice(-30).forEach((cmd, i) => say(span(String(h.length - Math.min(30, h.length) + i + 1).padStart(4), 't-dim'), `  ${cmd}`));
      },
    },
    clear: { run: () => screen.clear() },
    linux: { help: 'boot a real one', run: () => screen.linux() },
    exit: { run: () => screen.go('/apps/') },
    man: {
      run([cmd]) {
        if (!cmd) return err('What manual page do you want?');
        if (commands[cmd]?.help) return commands.help.run([cmd], '');
        err(`No manual entry for ${cmd}`);
      },
    },

    // Things people type to see what happens.
    sudo: { run: (args) => void say(args[0] === 'make' && args.includes('sandwich') ? 'Okay.' : `${screen.nick()} is not in the sudoers file. This incident will be reported to the plaza.`) },
    rm: { run: (args) => void (args.some((a) => a.includes('r')) ? say('The Miis held hands and refused.') : err('rm: this filesystem is read only. Try linux.')) },
    vim: { run: () => void say("There's no editor out here. ", cmdLink('linux'), ' has vi.') },
    xyzzy: { run: () => void say('Nothing happens.') },
    coffee: { run: () => void say("418 I'm a teapot") },
    ping: { run: ([host = 'ankush.one']) => void say(`64 bytes from ${host}: icmp_seq=1 ttl=64 time=0.39 ms`, span('  (it says hi back)', 't-dim')) },
    hello: { run: () => void say(`Hi, ${screen.nick()}! Type `, cmdLink('help'), ' to look around.') },
    konami: { run: () => void say('Not here. Try it on the plaza: up up down down left right left right B A') },
    plaza: { run: () => screen.go('/') },
    make: { run: (args) => void say(args.includes('coffee') ? "418 I'm a teapot" : args.join(' ') === 'me a sandwich' ? 'What? Make it yourself.' : "make: *** No targets specified and no makefile found. Stop.") },
    git: { run: () => void say("fatal: not a git repository. The site's code is on GitHub: ", link('ankushKun', 'https://github.com/ankushKun', 't-link')) },
  };
  for (const [alias, to] of Object.entries({ dir: 'ls', l: 'ls', ll: 'ls', less: 'cat', more: 'cat', bat: 'cat', search: 'grep', neofetch: 'fetch', fastfetch: 'fetch', nano: 'vim', emacs: 'vim', vi: 'vim', quit: 'exit', logout: 'exit', cls: 'clear', hi: 'hello' }))
    commands[alias] = { run: (a, l) => commands[to].run(alias === 'll' ? ['-l', ...a] : a, l) };
  /** Left out of help, to be found. */
  const HIDDEN = new Set(['pwd', 'tree', 'find', 'np', 'whoami', 'date', 'uptime', 'echo', 'history', 'clear', 'exit', 'man']);

  function cmdLink(cmd: string) {
    const a = span(cmd, 't-cmd');
    a.dataset.cmd = cmd;
    a.tabIndex = 0;
    return a;
  }

  function uptime() {
    const s = Math.round((Date.now() - screen.since) / 1000);
    const m = Math.floor(s / 60);
    return m ? `${m} min, ${s % 60} s in here` : `${s} s in here`;
  }

  async function run(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;
    // `a && b` and `a ; b`, and a pipe into head as a kindness: the rest of a pipe is ignored.
    for (const part of trimmed.split(/\s*(?:&&|;)\s*/)) {
      const [first] = part.split(/\s*\|\s*/);
      const words = first.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
      const [name, ...args] = words.map((w) => w.replace(/^["'](.*)["']$/, '$1'));
      if (!name) continue;
      const cmd = commands[name.toLowerCase()];
      if (!cmd) {
        say(span(`${name}: command not found. `, 't-err'), span('Try ', 't-dim'), cmdLink('help'));
        return;
      }
      await cmd.run(args, first);
    }
  }

  /** Tab: what the word under the caret could be. */
  function complete(line: string): string[] {
    const words = line.split(/\s+/);
    const word = words.at(-1) ?? '';
    if (words.length <= 1) return Object.keys(commands).filter((c) => c.startsWith(word) && (!HIDDEN.has(c) || word.length > 1)).sort();
    const cmd = words[0];
    if (cmd === 'play') {
      const games = lookup(root, ['games']) as Dir | null;
      return games ? [...games.children.keys()].filter((g) => g.startsWith(word)) : [];
    }
    if (cmd === 'music') return ['play', 'pause', 'next', 'prev', 'np', 'vol', 'shuffle'].filter((w) => w.startsWith(word));
    if (cmd === 'theme') return ['day', 'night'].filter((w) => w.startsWith(word));
    const slash = word.lastIndexOf('/');
    const dirPart = slash >= 0 ? word.slice(0, slash + 1) : '';
    const rest = word.slice(slash + 1);
    const dir = lookup(root, resolve(cwd, dirPart || '.'));
    if (!dir || dir.kind !== 'dir') return [];
    return [...dir.children.values()]
      .filter((n) => n.name.startsWith(rest) && (!n.hidden || rest.startsWith('.')) && (cmd !== 'cd' || n.kind === 'dir'))
      .map((n) => dirPart + nameOf(n))
      .sort();
  }

  return {
    run,
    complete,
    prompt: () => pretty(cwd),
  };
}
