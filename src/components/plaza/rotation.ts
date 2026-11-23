// Random picks where every kind of thing gets an equal share, however many of it there are: the
// bubbles (posts, projects, the timeline, chat, Paint) and the feature block (covers, games, apps,
// Paint). Kinds come round in a shuffled order, each once a round, never the same one twice running;
// within a kind, its items come off a shuffled deck, so each shows once before any shows again.

interface Group<T> {
  all: T[];
  left: T[];
  last: T | null;
}

export class Rotation<T> {
  private groups = new Map<string, Group<T>>();
  /** The kinds still to come this round. */
  private round: string[] = [];
  private lastKind = '';
  private current: T | null = null;
  /** Taken before any kind's turn, in order. */
  private ahead: T[] = [];

  constructor(
    private kindOf: (item: T) => string,
    items: T[] = [],
  ) {
    for (const item of items) this.add(item);
  }

  /** Puts `item` in with the others of its kind, or `first`, next of all. */
  add(item: T, first = false) {
    const kind = this.kindOf(item);
    let g = this.groups.get(kind);
    if (!g) this.groups.set(kind, (g = { all: [], left: [], last: null }));
    g.all.push(item);
    g.left.splice(Math.floor(Math.random() * (g.left.length + 1)), 0, item);
    if (first) this.ahead.push(item);
  }

  /** Everything of `kind`, in place of what it had before. */
  set(kind: string, items: T[]) {
    this.groups.delete(kind);
    this.ahead = this.ahead.filter((item) => this.kindOf(item) !== kind);
    if (this.current && this.kindOf(this.current) === kind) this.current = null;
    for (const item of items) this.add(item);
  }

  /** What comes next, without taking it; null when there is nothing. */
  peek(): T | null {
    this.current ??= this.ahead.shift() ?? this.draw();
    return this.current;
  }

  /** Moves on from what `peek` gave. */
  skip() {
    this.current = null;
  }

  private draw(): T | null {
    this.round = this.round.filter((k) => this.groups.has(k));
    if (!this.round.length) {
      this.round = shuffle([...this.groups.keys()]);
      if (this.round[0] === this.lastKind && this.round.length > 1) this.round.push(this.round.shift()!);
    }
    const kind = this.round.shift();
    if (kind === undefined) return null;
    this.lastKind = kind;
    const g = this.groups.get(kind)!;
    if (!g.left.length) {
      g.left = shuffle([...g.all]);
      if (g.left[0] === g.last && g.left.length > 1) g.left.push(g.left.shift()!);
    }
    g.last = g.left.shift()!;
    return g.last;
  }
}

export function shuffle<T>(list: T[]) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
