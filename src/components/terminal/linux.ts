// The Terminal's Linux: a real one (Buildroot, kernel 5.6 with BusyBox, the image the old site ran)
// booted in the page by v86 (copy.sh/v86, BSD-2-Clause, files in public/v86/), its serial console
// drawn by xterm.js. Everything about it happens in the terminal itself, as text: the download as an
// ASCII bar, the kernel's own boot log (console=ttyS0), then the moving-in steps. Once it's up, a home
// of its own goes in through v86's shared folder (linux-files.ts: notes, a playlist, the site's
// pages, games in shell script and a few secrets) and the shell moves into it. Nothing is saved.
//
// It can reach the page. The scripts in its ~/bin print a private escape sequence, OSC 7777 with
// "command;argument", that xterm hands to the page instead of drawing:
//   open, play, theme, music   the site does it (main.ts), and writes /mnt/.np for music to read
//   upload                     a file picker; the files land in /mnt/uploads, then /mnt/.upload-done
//   download <file>            the script copies it to /mnt/downloads, and the page saves it
// Files dropped on the terminal land in /mnt/uploads too.
//
// The network: v86's fetch backend by default, which makes the guest's HTTP requests from the page
// (upgraded to https on an https page), so sites that allow it by CORS answer. PUBLIC_LINUX_CORS_PROXY
// (a URL the address is appended to) opens that to every site; PUBLIC_LINUX_RELAY points it at a
// wisp server (wss://...) instead, for real TCP.
import { MUSIC } from '../../data/music';
import type { Fs } from '../../pages/apps/terminal/fs.json';
import { homeFiles } from './linux-files';

interface V86 {
  add_listener(event: string, fn: (v: never) => void): void;
  serial0_send(text: string): void;
  create_file(path: string, data: Uint8Array): Promise<void>;
  read_file(path: string): Promise<Uint8Array | null>;
  destroy(): void;
  /** The shared folder's filesystem, which only makes folders one at a time. */
  fs9p: { SearchPath(path: string): { id: number }; CreateDirectory(name: string, parent: number): number };
}

declare global {
  interface Window {
    V86?: new (opts: Record<string, unknown>) => V86;
  }
}

const BASE = '/v86/';
const RELAY: string = import.meta.env.PUBLIC_LINUX_RELAY || 'fetch';
const CORS_PROXY: string | undefined = import.meta.env.PUBLIC_LINUX_CORS_PROXY || undefined;
const SPIN = ['|', '/', '-', '\\'];
/** The shell's prompt on this image, once it has booted. */
const READY = /(~|\/)[#$%] $/;
const MAX_UPLOAD = 32 * 1024 * 1024;

// ANSI, for the lines the page writes itself.
const DIM = '\x1b[2m';
const GREEN = '\x1b[1;32m';
const CYAN = '\x1b[36m';
const RED = '\x1b[31m';
const OFF = '\x1b[0m';

function loadScript(src: string) {
  return new Promise<void>((done, fail) => {
    if (window.V86) return done();
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => done();
    s.onerror = () => fail(new Error(`Could not load ${src}`));
    document.head.append(s);
  });
}

export interface Linux {
  stop(): void;
  /** Writes a file into the shared folder, which the guest sees under /mnt. */
  write(path: string, text: string): void;
  /** Types into it, as the phone's row of keys does. */
  send(text: string): void;
}

const mb = (n: number) => (n / 1048576).toFixed(1);

/** An ASCII bar: [=========>          ] */
const bar = (done: number, width = 30) => {
  const n = Math.round(Math.max(0, Math.min(1, done)) * width);
  return `[${'='.repeat(Math.max(0, n - 1))}${n ? (n === width ? '=' : '>') : ''}${' '.repeat(width - n)}]`;
};

export async function startLinux(
  host: HTMLElement,
  opts: {
    nick: string;
    fs: Fs | null;
    dark: boolean;
    /** It was powered off from inside. */
    onExit(): void;
    /** It asked the site for something (open, play, theme, music). */
    onCommand(name: string, arg: string): void;
  },
): Promise<Linux> {
  const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit'), import('@xterm/xterm/css/xterm.css')]);
  const term = new Terminal({
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: host.clientWidth < 600 ? 12 : 14,
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: 5000,
    theme: opts.dark
      ? { background: '#101416', foreground: '#c9d2d6', cursor: '#6fd93a', selectionBackground: '#2b3a44', green: '#6fd93a', brightGreen: '#8de35f', blue: '#4fb8e6', brightBlue: '#7fcdf0', cyan: '#4fb8e6' }
      : { background: '#fbfcfc', foreground: '#3d4245', cursor: '#3a9617', selectionBackground: '#cfe6f3', green: '#2f7d12', brightGreen: '#3a9617', blue: '#1f7fb0', brightBlue: '#2f8fe0', cyan: '#1f7fb0', black: '#3d4245', white: '#6f787c', brightWhite: '#2a2f31' },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  fit.fit();
  const resize = new ResizeObserver(() => fit.fit());
  resize.observe(host);

  term.writeln(`${GREEN}ankush.one${OFF} ${DIM}power-on self test${OFF}`);
  term.writeln(`${DIM}cpu: x86 in WebAssembly (v86)   memory: 64 MB   network: ${RELAY === 'fetch' ? 'fetch' : 'relay'}${OFF}`);
  term.writeln('');

  // The download, one ASCII bar per file, rewritten in place.
  let fetched = false;
  let lastFile = '';
  const progress = (name: string, loaded: number, total: number) => {
    const label = (/buildroot/.test(name) ? 'linux kernel + initramfs' : /wasm/.test(name) ? 'v86 cpu' : /vga/.test(name) ? 'vga bios' : /bios/.test(name) ? 'bios' : name).padEnd(25);
    if (lastFile && lastFile !== name) term.write('\r\n');
    lastFile = name;
    fetched = true;
    const size = total ? `${mb(loaded)}/${mb(total)} MB` : `${mb(loaded)} MB`;
    term.write(`\r${DIM}fetch${OFF} ${label} ${CYAN}${bar(total ? loaded / total : 0)}${OFF} ${size.padStart(13)}`);
  };

  try {
    await loadScript(`${BASE}libv86.js`);
  } catch (err) {
    term.writeln(`${RED}could not load the emulator${OFF}`);
    throw err;
  }

  const emulator = new window.V86!({
    wasm_path: `${BASE}v86.wasm`,
    memory_size: 64 * 1024 * 1024,
    vga_memory_size: 2 * 1024 * 1024,
    bios: { url: `${BASE}seabios.bin` },
    vga_bios: { url: `${BASE}vgabios.bin` },
    bzimage: { url: `${BASE}buildroot.bin` },
    cmdline: 'tsc=reliable mitigations=off random.trust_cpu=on',
    net_device: { relay_url: RELAY, type: 'ne2k', cors_proxy: CORS_PROXY },
    filesystem: {},
    disable_keyboard: true,
    disable_mouse: true,
    autostart: true,
  });

  // Bytes from the serial console, written a frame at a time.
  let buf: number[] = [];
  let tail = '';
  let frame = 0;
  let ready = false;
  let exited = false;
  /** Until it's moved in, the console is kept quiet: the kernel's log is played back in order then. */
  let swallow = true;
  let spin = 0;
  let filesIn: Promise<void> | null = null;
  const flush = () => {
    frame = 0;
    term.write(new Uint8Array(buf));
    buf = [];
  };
  /** Set once the guest has echoed the line that moves it in; what follows is shown. */
  let echoed = false;
  emulator.add_listener('serial0-output-byte', ((byte: number) => {
    tail = (tail + String.fromCharCode(byte)).slice(-200);
    if (!ready && READY.test(tail)) {
      ready = true;
      void (filesIn ?? Promise.resolve()).then(() => emulator.serial0_send(' . /mnt/.welcome\n'));
    }
    if (swallow) {
      if (ready && byte === 10 && /\.welcome/.test(tail)) echoed = true;
      if (echoed) {
        swallow = false;
        clearInterval(spin);
        term.write('\r\x1b[K');
      }
      return;
    }
    buf.push(byte);
    frame ||= requestAnimationFrame(flush);
    if (!exited && /System halted|reboot: Power down|Powering off\.\.\.\r?\n/.test(tail)) {
      exited = true;
      opts.onExit();
    }
  }) as (v: never) => void);
  emulator.add_listener('download-progress', ((e: { loaded: number; total: number; file_name: string }) => {
    progress(e.file_name, e.loaded, e.total);
  }) as (v: never) => void);
  emulator.add_listener('emulator-ready', (() => {
    if (fetched) term.write('\r\n');
    term.writeln('');
    let i = 0;
    spin = window.setInterval(() => term.write(`\r${DIM}starting cpu ${SPIN[i++ % 4]}${OFF}`), 90);
    filesIn = putHome(emulator, opts.nick, opts.fs).catch((err) => console.warn('Linux home', err instanceof Error ? err.message : err));
  }) as (v: never) => void);
  const typed = term.onData((d) => emulator.serial0_send(d));

  // Uploads and downloads, through the shared folder.
  const say = (text: string) => term.write(`\r\n${DIM}${text}${OFF}\r\n`);
  async function takeIn(files: FileList | File[]) {
    const names: string[] = [];
    for (const f of files) {
      if (f.size > MAX_UPLOAD) {
        say(`${f.name} is over ${mb(MAX_UPLOAD)} MB, left out`);
        continue;
      }
      const name = f.name.replace(/[^\w.+-]/g, '_').slice(0, 100) || 'upload';
      await putFile(emulator, `/uploads/${name}`, new Uint8Array(await f.arrayBuffer()));
      names.push(name);
    }
    return names;
  }
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.multiple = true;
  picker.addEventListener('change', async () => {
    const names = picker.files ? await takeIn(picker.files) : [];
    picker.value = '';
    await emulator.create_file('/.upload-done', enc.encode(names.map((n) => `${n}\n`).join('')));
  });
  picker.addEventListener('cancel', () => void emulator.create_file('/.upload-done', new Uint8Array()));

  async function save(name: string) {
    const safe = name.replace(/[/\\]/g, '');
    const bytes = await emulator.read_file(`/downloads/${safe}`).catch(() => null);
    if (!bytes) return say(`download: couldn't read ${safe}`);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
    a.download = safe;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  const asked = term.parser.registerOscHandler(7777, (data) => {
    const i = data.indexOf(';');
    const name = i < 0 ? data : data.slice(0, i);
    const arg = i < 0 ? '' : data.slice(i + 1).slice(0, 500);
    if (name === 'upload') picker.click();
    else if (name === 'download') void save(arg);
    else opts.onCommand(name, arg);
    return true;
  });

  const over = (e: DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
  };
  const drop = async (e: DragEvent) => {
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    if (!ready) return;
    const names = await takeIn(e.dataTransfer.files);
    if (names.length) say(`dropped into /mnt/uploads: ${names.join(', ')}`);
  };
  host.addEventListener('dragover', over);
  host.addEventListener('drop', drop);
  term.focus();

  return {
    stop() {
      cancelAnimationFrame(frame);
      clearInterval(spin);
      typed.dispose();
      asked.dispose();
      resize.disconnect();
      host.removeEventListener('dragover', over);
      host.removeEventListener('drop', drop);
      try {
        emulator.destroy();
      } catch {
        // Already stopping.
      }
      term.dispose();
    },
    write(path, text) {
      if (ready) void emulator.create_file(path, enc.encode(text)).catch(() => {});
    },
    send(text) {
      emulator.serial0_send(text);
      term.focus();
    },
  };
}

const enc = new TextEncoder();

/** A file into the shared folder, making its folders first: it only takes a file into one that's there. */
async function putFile(emulator: V86, path: string, data: Uint8Array) {
  let parent = 0;
  let walked = '';
  for (const part of path.split('/').filter(Boolean).slice(0, -1)) {
    walked += `/${part}`;
    const found = emulator.fs9p.SearchPath(walked).id;
    parent = found !== -1 ? found : emulator.fs9p.CreateDirectory(part, parent);
  }
  await emulator.create_file(path, data);
}

/** Puts the home in the shared folder (the guest sees it at /mnt) and the script that moves in. */
async function putHome(emulator: V86, nick: string, fs: Fs | null) {
  const files = homeFiles(nick);
  // The site's pages, to read with less or grep through.
  for (const f of fs?.files ?? []) if (f.body !== undefined) files[`site/${f.path}`] = `# ${f.title}\n\n${f.body}\n`;
  const games = (fs?.files ?? []).filter((f) => f.path.startsWith('games/')).map((f) => f.path.slice(6));
  files['bin/play'] = `#!/bin/sh
# play: starts one of the site's games on the TV.
if [ -z "$1" ]; then
  echo "${games.join('  ')}"
  echo "play <name> to start one."
  exit 0
fi
printf '\\033]7777;play;%s\\007' "$1"
`;
  files['music/playlist.m3u'] = ['#EXTM3U', ...MUSIC.tracks.flatMap((t) => [`#EXTINF:${t.durationSec},${t.artist} - ${t.title}`, `https://youtu.be/${t.videoId}`])].join('\n') + '\n';
  for (const [path, text] of Object.entries(files)) await putFile(emulator, `/home/${path}`, enc.encode(text));
  await putFile(emulator, '/uploads/.keep', new Uint8Array());
  await putFile(emulator, '/downloads/.keep', new Uint8Array());

  const safe = nick.replace(/[^A-Za-z0-9_-]/g, '') || 'guest';
  const home = `/home/${safe}`;
  // Moving in, drawn as boot steps are: [  ok  ] in green, one at a time.
  await emulator.create_file(
    '/.welcome',
    enc.encode(`dmesg | while IFS= read -r l; do printf '%s\\n' "$l"; usleep 6000 2>/dev/null; done
step() { printf '\\033[1;32m[  ok  ]\\033[0m %s\\n' "$1"; usleep 90000 2>/dev/null; }
mkdir -p ${home}; cp -r /mnt/home/. ${home}/ 2>/dev/null
chmod +x ${home}/bin/* ${home}/games/*.sh 2>/dev/null
echo
step "Mounted the site at ~/site"
step "Unpacked notes, games and a playlist"
if udhcpc -q -n -t 3 -T 2 >/dev/null 2>&1; then step "Network up"; else printf '\\033[1;33m[ skip ]\\033[0m %s\\n' "No network"; fi
step "Hid a trophy somewhere"
step "Plaza link up (see README)"
export HOME=${home} USER=${safe} PATH=${home}/bin:$PATH
export PS1='\\[\\033[1;32m\\]${safe}@ankush.one\\[\\033[0m\\]:\\[\\033[1;34m\\]$(pwd | sed "s|^$HOME|~|")\\[\\033[0m\\]\\$ '
alias ll='ls -la' la='ls -a' exit=poweroff logout=poweroff np='music np'
poweroff() {
  for s in "the radio" "the plaza link" "the network" "${safe}'s session"; do printf '\\033[1;32m[  ok  ]\\033[0m Stopped %s\\n' "$s"; usleep 120000 2>/dev/null; done
  echo 'Powering off...'
}
halt() { poweroff; }
shutdown() { poweroff; }
# Ctrl D on an empty line ends the shell: that's a power off too.
trap poweroff EXIT
cd
while IFS= read -r line; do printf '%s\\n' "$line"; usleep 25000 2>/dev/null; done < ${home}/.motd
`),
  );
}
