// The Terminal's filesystem: home is the site, every page a file (fs.json, built with the site), plus
// a few files that are only here. Paths are from home, which is also `/`, so `cd /` and `cd ~` agree.
import type { Fs, FsFile } from '../../pages/apps/terminal/fs.json';

export interface File extends FsFile {
  kind: 'file';
  name: string;
  /** Left out of ls without -a. */
  hidden?: boolean;
  /** What cat says, for a file that is only here (no page of its own). */
  text?: string;
}

export interface Dir {
  kind: 'dir';
  name: string;
  /** The page a folder is, if any: blog/ is /blogs/. */
  url?: string;
  hidden?: boolean;
  children: Map<string, Node>;
}

export type Node = File | Dir;

const DIR_URLS: Record<string, string> = { blog: '/blogs/', projects: '/projects/', timeline: '/timeline/', apps: '/apps/', games: '/games/' };

/** Files that are only here, for whoever looks. */
const EXTRAS: { path: string; text: string; hidden?: boolean }[] = [
  {
    path: '.plan',
    hidden: true,
    text: `Plan:
- finish the plaza (it is never finished)
- teach Miku a second dance
- port one more game to the 3DS
- answer the guestbook
- stop adding easter eggs to the terminal`,
  },
  {
    path: '.secrets/README',
    hidden: true,
    text: `You found the secrets folder. There isn't much in this one.
The good stuff is in a real Linux. Type linux and look around in there.
Start with ls -a.`,
  },
  {
    path: '.secrets/konami.txt',
    hidden: true,
    text: `up up down down left right left right B A

Try it on the plaza. The whole crowd will thank you.`,
  },
];

export function buildFs(fs: Fs): Dir {
  const root: Dir = { kind: 'dir', name: '', children: new Map() };
  const dirAt = (parts: string[], hidden = false) => {
    let d = root;
    for (const part of parts) {
      let next = d.children.get(part);
      if (!next || next.kind !== 'dir') {
        next = { kind: 'dir', name: part, url: d === root ? DIR_URLS[part] : undefined, hidden: hidden || part.startsWith('.'), children: new Map() };
        d.children.set(part, next);
      }
      d = next;
    }
    return d;
  };
  for (const f of fs.files) {
    const parts = f.path.split('/');
    const name = parts.pop()!;
    dirAt(parts).children.set(name, { ...f, kind: 'file', name });
  }
  for (const x of EXTRAS) {
    const parts = x.path.split('/');
    const name = parts.pop()!;
    dirAt(parts, x.hidden).children.set(name, { kind: 'file', name, path: x.path, title: name, url: '', text: x.text, hidden: x.hidden });
  }
  return root;
}

/** A path from `cwd` (a list of names from home) made whole, or null if it climbs out of nothing. */
export function resolve(cwd: string[], path: string): string[] {
  const parts = path.startsWith('/') || path.startsWith('~') ? [] : [...cwd];
  for (const p of path.replace(/^~/, '').split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') parts.pop();
    else parts.push(p);
  }
  return parts;
}

export function lookup(root: Dir, parts: string[]): Node | null {
  let n: Node = root;
  for (const p of parts) {
    if (n.kind !== 'dir') return null;
    const next: Node | undefined = n.children.get(p);
    if (!next) return null;
    n = next;
  }
  return n;
}

/** "~/blog" for a cwd. */
export const pretty = (parts: string[]) => (parts.length ? `~/${parts.join('/')}` : '~');

/** Every file under a folder, with its path from home. */
export function* walk(d: Dir, base: string[] = []): Generator<[string[], Node]> {
  for (const [name, n] of d.children) {
    const path = [...base, name];
    yield [path, n];
    if (n.kind === 'dir') yield* walk(n, path);
  }
}
