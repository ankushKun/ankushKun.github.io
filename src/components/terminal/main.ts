// Runs the Terminal (Terminal.astro). It boots a real Linux (linux.ts) as it opens, answers what that
// Linux asks of the site (open a page, start a game, switch the lights, run the radio) and goes back
// to the apps once it's powered off. Where Linux can't run, it's a lighter shell over the site's
// files instead (shell.ts, fs.json built with the site), with history, Tab to finish a name, and
// `linux` to try again.
import { navigate } from 'astro:transitions/client';
import * as radio from '../../scripts/music/engine';
import { clock } from '../../data/music';
import { play } from '../../scripts/sfx';
import { STORE, store } from '../live/store';
import type { Fs } from '../../pages/apps/terminal/fs.json';
import { buildFs } from './fs';
import type { Linux } from './linux';
import { createShell, span, type Screen } from './shell';

/** The old site's key, so a returning visitor keeps their history and last login. */
const KEY = 'terminal-shell-v1';
const KEEP = 100;

export function mount(root: HTMLElement): () => void {
  const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const screenEl = $('[data-screen]');
  const shellEl = $('[data-shell]');
  const log = $('[data-log]');
  const form = $<HTMLFormElement>('[data-line]');
  const input = $<HTMLInputElement>('[data-input]');
  const ghost = $('[data-ghost]');
  const linuxEl = $('[data-linux]');
  const power = $<HTMLButtonElement>('[data-power]');

  let saved: { history?: string[]; lastLogin?: number } = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    // A fresh start.
  }
  let history = Array.isArray(saved.history) ? saved.history.filter((h) => typeof h === 'string').slice(-KEEP) : [];
  const lastLogin = Number(saved.lastLogin) || 0;
  const persist = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ history, lastLogin: Date.now() }));
    } catch {
      // Kept for this visit only.
    }
  };
  persist();

  const nick = () => store.get(STORE.nick) || 'guest';
  let fs: Fs | null = null;
  let linux: Linux | null = null;
  let booting = false;
  let stopped = false;

  const toBottom = () => (screenEl.scrollTop = screenEl.scrollHeight);

  const screen: Screen = {
    print(...parts) {
      const line = document.createElement('div');
      line.className = 'tm-out';
      line.append(...parts);
      log.append(line);
      return line;
    },
    clear() {
      log.replaceChildren();
    },
    go(url) {
      setTimeout(() => void navigate(url), 250);
    },
    nick,
    history: () => history,
    clearHistory() {
      history = [];
      persist();
    },
    linux: () => void bootLinux(),
    since: Date.now(),
  };

  function promptLine(cmd: string) {
    const line = screen.print(span(`${nick()}@ankush.one`, 't-user'), ' ', span(shell?.prompt() ?? '~', 't-dir'), ' ', span('$', 't-dim'), ' ');
    line.append(cmd);
    return line;
  }

  let shell: ReturnType<typeof createShell> | null = null;

  function drawPrompt() {
    $('[data-user]').textContent = `${nick()}@ankush.one`;
    $('[data-cwd]').textContent = shell?.prompt() ?? '~';
  }

  async function run(cmd: string, record = true) {
    if (!shell) return;
    promptLine(cmd);
    if (record && cmd.trim() && history.at(-1) !== cmd) {
      history.push(cmd);
      history = history.slice(-KEEP);
      persist();
    }
    await shell.run(cmd);
    drawPrompt();
    toBottom();
  }

  // Typing ----------------------------------------------------------------------------------------

  let back = -1;
  let draft = '';

  function suggest() {
    ghost.textContent = '';
    if (!shell || !input.value || input.selectionStart !== input.value.length) return;
    const opts = shell.complete(input.value);
    const word = input.value.split(/\s+/).at(-1) ?? '';
    if (opts.length === 1 && opts[0].length > word.length) ghost.textContent = opts[0].slice(word.length);
    ghost.style.setProperty('--at', `${input.value.length}ch`);
  }

  function tab() {
    if (!shell) return;
    const opts = shell.complete(input.value);
    const words = input.value.split(/\s+/);
    const word = words.at(-1) ?? '';
    if (!opts.length) return play('nope');
    if (opts.length === 1) {
      words[words.length - 1] = opts[0];
      input.value = words.join(' ') + (opts[0].endsWith('/') ? '' : ' ');
    } else {
      // As far as they all agree, then list them.
      let common = opts[0];
      for (const o of opts) while (!o.startsWith(common)) common = common.slice(0, -1);
      if (common.length > word.length) {
        words[words.length - 1] = common;
        input.value = words.join(' ');
      } else {
        promptLine(input.value);
        const row = document.createElement('div');
        row.className = 't-row';
        row.append(...opts.map((o) => span(o, o.endsWith('/') ? 't-dir' : '')));
        screen.print(row);
        toBottom();
      }
    }
    suggest();
  }

  function stepHistory(n: number) {
    if (!history.length) return;
    if (back === -1) draft = input.value;
    back = Math.max(-1, Math.min(history.length - 1, back + n));
    input.value = back === -1 ? draft : history[history.length - 1 - back];
    requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
    suggest();
  }

  function key(k: string, ctrl = false) {
    if (ctrl && k === 'c') {
      promptLine(`${input.value}^C`);
      input.value = '';
      back = -1;
      suggest();
      toBottom();
      return true;
    }
    if (ctrl && k === 'l') {
      screen.clear();
      return true;
    }
    if (k === 'Tab') tab();
    else if (k === 'ArrowUp') stepHistory(1);
    else if (k === 'ArrowDown') stepHistory(-1);
    else if (k === 'ArrowRight' && ghost.textContent && input.selectionStart === input.value.length) {
      input.value += ghost.textContent;
      suggest();
    } else return false;
    return true;
  }

  input.addEventListener('keydown', (e) => {
    if (key(e.key, e.ctrlKey && !e.metaKey)) e.preventDefault();
  });
  input.addEventListener('input', () => {
    back = -1;
    suggest();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const cmd = input.value;
    input.value = '';
    ghost.textContent = '';
    back = -1;
    void run(cmd);
  });

  // The keys a phone keyboard lacks.
  $('[data-keys]').addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button');
    if (!b) return;
    if (linux) {
      const keys: Record<string, string> = { Tab: '\t', ArrowUp: '\x1b[A', ArrowDown: '\x1b[B', c: '\x03' };
      return linux.send(b.dataset.type ? `${b.dataset.type}\r` : (keys[b.dataset.key!] ?? ''));
    }
    if (b.dataset.type) {
      input.value = '';
      void run(b.dataset.type);
    } else key(b.dataset.key!, b.hasAttribute('data-ctrl'));
    input.focus();
  });

  // Pressing a name runs it, as if typed: a folder goes in, a file is read. A modified click opens the
  // page as a link would.
  log.addEventListener('click', (e) => {
    const t = (e.target as Element).closest<HTMLElement>('[data-cmd]');
    if (!t || (e as MouseEvent).metaKey || (e as MouseEvent).ctrlKey || (e as MouseEvent).shiftKey) return;
    e.preventDefault();
    void run(t.dataset.cmd!);
    input.focus();
  });
  log.addEventListener('keydown', (e) => {
    const t = (e.target as Element).closest<HTMLElement>('span[data-cmd]');
    if (t && e.key === 'Enter') void run(t.dataset.cmd!);
  });
  // A press anywhere on the screen (not a selection) puts you back on the line.
  screenEl.addEventListener('mouseup', () => {
    if (!linux && !getSelection()?.toString()) input.focus({ preventScroll: true });
  });

  // Linux -------------------------------------------------------------------------------------------

  async function bootLinux() {
    if (linux || booting) return;
    booting = true;
    shellEl.hidden = true;
    linuxEl.hidden = false;
    power.hidden = false;
    try {
      const { startLinux } = await import('./linux');
      if (stopped) return;
      linux = await startLinux($('[data-xterm]'), {
        nick: nick(),
        fs,
        dark: document.documentElement.dataset.theme === 'dark',
        onExit: () => setTimeout(poweredOff, 700),
        onCommand: answer,
      });
      if (stopped) linux.stop();
    } catch (err) {
      console.warn(err);
      endLinux();
      screen.print(span("Linux couldn't start here, so this is the lighter shell. Type ", 't-dim'), span('linux', 't-cmd'), span(' to try again.', 't-dim'));
    } finally {
      booting = false;
    }
  }

  /** Linux couldn't run here: the lighter shell takes the screen. */
  function endLinux() {
    linux?.stop();
    linux = null;
    linuxEl.hidden = true;
    shellEl.hidden = false;
    power.hidden = true;
    $('[data-xterm]').replaceChildren();
    drawPrompt();
    toBottom();
    input.focus();
  }

  /** Shut down, from inside or with the bar's button: back to the apps. */
  let leaving = false;
  function poweredOff() {
    if (leaving || stopped) return;
    leaving = true;
    linux?.stop();
    linux = null;
    void navigate('/apps/');
  }

  // The button shuts it down as `poweroff` does, so the shutdown is seen; a Linux still booting, or
  // one that doesn't answer, is simply switched off.
  power.addEventListener('click', () => {
    if (!linux) return poweredOff();
    linux.send('\x03poweroff\r');
    setTimeout(poweredOff, 4000);
  });

  /** What's playing, in the shared folder for the Linux's `music` to read. */
  const nowPlaying = () => {
    const st = radio.snapshot();
    const t = st.tracks[st.index];
    return t ? `${st.playing ? '>>' : '||'} ${t.title}, ${t.artist}  ${clock(radio.playhead())} / ${clock(st.duration || t.durationSec)}\n` : 'Nothing playing. Try: music play\n';
  };

  /** The site's side of the Linux's open, play, theme and music. */
  function answer(name: string, arg: string) {
    if (name === 'open') {
      if (/^https?:\/\//.test(arg)) return void window.open(arg, '_blank', 'noopener');
      const site = /\/site\/(.*)$/.exec(arg)?.[1];
      if (site !== undefined) {
        const rel = site.replace(/\/$/, '');
        const file = fs?.files.find((f) => f.path === rel);
        const dir = { blog: '/blogs/', projects: '/projects/', timeline: '/timeline/', '': '/' }[rel];
        const url = file?.url ?? dir;
        if (url) screen.go(url);
        return;
      }
      if (arg.startsWith('/') && !/^\/(home|mnt|root|etc|bin|usr|proc|sys|tmp|var|dev)\b/.test(arg)) screen.go(arg.endsWith('/') || arg.includes('.') ? arg : `${arg}/`);
      return;
    }
    if (name === 'play') {
      const game = fs?.files.find((f) => f.path === `games/${arg.toLowerCase()}`);
      if (game) screen.go(game.url);
      return;
    }
    if (name === 'theme') {
      const dark = document.documentElement.dataset.theme === 'dark';
      const want = /^(night|dark)$/.test(arg) ? true : /^(day|light)$/.test(arg) ? false : !dark;
      if (want !== dark) document.querySelector<HTMLElement>('[data-theme-toggle]')?.click();
      return;
    }
    if (name === 'music') {
      if (arg === 'play' || arg === 'pause' || arg === 'next' || arg === 'prev') radio[arg]();
      setTimeout(() => linux?.write('/.np', nowPlaying()), arg === 'np' ? 0 : 700);
    }
  }


  // Start ------------------------------------------------------------------------------------------

  // Linux comes up first; the lighter shell waits behind it.
  shellEl.hidden = true;
  linuxEl.hidden = false;

  const DATE = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  log.replaceChildren();
  screen.print(span(lastLogin ? `Last login: ${DATE.format(lastLogin).replace(',', '')} from the plaza.` : 'Welcome to ankush.one.', 't-dim'), ' ', span('Type help, or press Tab.', 't-dim'));
  form.hidden = false;
  drawPrompt();
  if (matchMedia('(pointer: fine)').matches) input.focus();

  void fetch('/apps/terminal/fs.json')
    .then((r) => r.json() as Promise<Fs>)
    .then((data) => {
      if (stopped) return;
      fs = data;
      shell = createShell(screen, buildFs(data), data.me);
    })
    .catch(() => screen.print(span("The site's files didn't load. Try again in a moment.", 't-err')))
    .finally(() => void (stopped || bootLinux()));

  return () => {
    stopped = true;
    linux?.stop();
  };
}
