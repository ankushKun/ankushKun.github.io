// The Music block while the radio plays: the track's cover fills the glass, with a row of bars
// dancing over it while the music is heard and lying low while it is held or muted. Every change
// is a crossfade: the icon into the first cover, one cover into the next, and back to the icon when
// the radio stops. The bars keep time on their own: YouTube's sound plays in a frame of its own,
// out of the page's reach. The bars and the shade under them are drawn apart from the cover, as
// marks the glass lays over the picture (cubes.ts, uOver), so they stay when the track's video
// takes the cover's place (film.ts).
import * as THREE from 'three';

const SIZE = 256;
/** Redraws a second while anything moves: enough to read as motion, cheap to upload. */
const FPS = 30;
/** Seconds a crossfade takes. */
const FADE = 0.8;
const BARS = [
  { speed: 7.1, phase: 0.3, wobble: 2.3 },
  { speed: 9.7, phase: 1.9, wobble: 3.1 },
  { speed: 6.3, phase: 4.2, wobble: 1.7 },
  { speed: 8.6, phase: 2.6, wobble: 2.9 },
];

type Picture = CanvasImageSource;

const now = () => performance.now() / 1000;
const ease = (t: number) => t * t * (3 - 2 * t);

/** A square canvas and the texture it feeds. */
function layer(colorSpace: string, anisotropy: number) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2D canvas is unavailable');
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = anisotropy;
  texture.colorSpace = colorSpace;
  return { canvas, g, texture };
}

export class NowPlaying {
  /** The cover, or the icon fading to or from one. */
  private readonly cover: ReturnType<typeof layer>;
  /** The shade and the bars, on clear. */
  private readonly marks: ReturnType<typeof layer>;
  /** The block's own icon, as a picture to fade from and back to, and its own (lack of) marks. */
  private readonly home: Picture;
  private readonly bare: THREE.Texture;
  /** What is fading out, what is fading in, and when the fade began. */
  private from: Picture;
  private to: Picture;
  private fadeAt = -Infinity;
  /** The last crossfade has been drawn to its end, so the cover needs no redrawing. */
  private settled = false;
  /** How much the shade and the bars show, 0 to 1, eased toward 1 over a cover and 0 over the icon. */
  private over = 0;
  private wanted = '';
  private heard = false;
  /** Bar heights, eased toward where they are going, 0 to 1. */
  private levels = BARS.map(() => 0.2);
  private drawnAt = -Infinity;

  constructor(
    /** The block's icon uniform, and the icon it carries when nothing plays. */
    private readonly slot: { value: THREE.Texture },
    private readonly icon: THREE.Texture,
    /** The block's marks uniform, and what it carries when nothing plays. */
    private readonly overSlot: { value: THREE.Texture },
    anisotropy: number,
  ) {
    this.cover = layer(icon.colorSpace, anisotropy);
    this.marks = layer(icon.colorSpace, anisotropy);
    this.bare = overSlot.value;
    this.home = icon.image as Picture;
    this.from = this.to = this.home;
  }

  /** The track playing (its cover's URL) and whether it is heard; null when the radio is stopped. */
  set(thumb: string | null, heard: boolean) {
    this.heard = heard;
    const want = thumb ?? '';
    if (want === this.wanted) return;
    this.wanted = want;
    if (!thumb) return this.fadeTo(this.home);
    const img = new Image();
    img.decoding = 'async';
    img.src = thumb;
    img.decode().then(
      () => {
        if (this.wanted === thumb) this.fadeTo(img);
      },
      () => undefined,
    );
  }

  private fadeTo(picture: Picture) {
    if (picture === this.to) return;
    const { g, texture } = this.cover;
    if (this.slot.value !== texture) {
      // Taking over from the block's own texture: start from the icon as it shows now.
      g.drawImage(this.home, 0, 0, SIZE, SIZE);
      texture.needsUpdate = true;
      this.slot.value = texture;
      this.overSlot.value = this.marks.texture;
    }
    // A fade still under way starts the next one from wherever it has got to.
    this.from = now() - this.fadeAt < FADE ? this.snapshot() : this.to;
    this.to = picture;
    this.fadeAt = now();
    this.settled = false;
  }

  /** A copy of what the block shows right now, to fade from. */
  private snapshot(): Picture {
    const copy = document.createElement('canvas');
    copy.width = copy.height = SIZE;
    copy.getContext('2d')?.drawImage(this.cover.canvas, 0, 0);
    return copy;
  }

  /** Each frame. */
  update() {
    if (this.slot.value !== this.cover.texture) return;
    const t = now();
    if (t - this.drawnAt < 1 / FPS) return;
    const dt = Math.min(0.2, t - this.drawnAt);
    this.drawnAt = t;
    const p = ease(Math.min(1, (t - this.fadeAt) / FADE));
    const onCover = this.to !== this.home;
    this.over += ((onCover ? 1 : 0) - this.over) * Math.min(1, dt * 5);

    // Back on the icon with nothing left to fade: the block carries its own textures again.
    if (!onCover && p >= 1 && this.over < 0.01) {
      this.slot.value = this.icon;
      this.overSlot.value = this.bare;
      return;
    }

    if (!this.settled) {
      const { g, texture } = this.cover;
      g.globalAlpha = 1;
      g.drawImage(this.from, 0, 0, SIZE, SIZE);
      if (p > 0) {
        g.globalAlpha = p;
        g.drawImage(this.to, 0, 0, SIZE, SIZE);
        g.globalAlpha = 1;
      }
      texture.needsUpdate = true;
      this.settled = p >= 1;
    }

    const { g, texture } = this.marks;
    g.clearRect(0, 0, SIZE, SIZE);
    // A shade up from the bottom, so the bars read on any cover, or any video.
    g.globalAlpha = this.over;
    const shade = g.createLinearGradient(0, SIZE * 0.45, 0, SIZE);
    shade.addColorStop(0, 'rgba(0, 0, 0, 0)');
    shade.addColorStop(1, 'rgba(0, 0, 0, 0.6)');
    g.fillStyle = shade;
    g.fillRect(0, 0, SIZE, SIZE);

    const w = SIZE * 0.055;
    const gap = SIZE * 0.04;
    const tall = SIZE * 0.26;
    const base = SIZE * 0.86;
    const left = (SIZE - (BARS.length * w + (BARS.length - 1) * gap)) / 2;
    g.fillStyle = '#fff';
    g.shadowColor = 'rgba(0, 0, 0, 0.45)';
    g.shadowBlur = SIZE * 0.025;
    BARS.forEach((bar, i) => {
      const target = this.heard
        ? 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * bar.speed + bar.phase)) * (0.65 + 0.35 * Math.sin(t * bar.wobble + i))
        : 0.18;
      this.levels[i] += (target - this.levels[i]) * Math.min(1, dt * 14);
      const h = Math.max(w, tall * this.levels[i]);
      g.beginPath();
      g.roundRect(left + i * (w + gap), base - h, w, h, w / 2);
      g.fill();
    });
    g.shadowColor = 'transparent';
    g.globalAlpha = 1;
    texture.needsUpdate = true;
  }

  dispose() {
    this.slot.value = this.icon;
    this.overSlot.value = this.bare;
    this.cover.texture.dispose();
    this.marks.texture.dispose();
  }
}
