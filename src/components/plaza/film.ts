// The Music block while a track plays: the track's own video, in the glass where the cover was.
// YouTube plays in a frame from another site, so its pictures can't be drawn into the scene.
// Instead the radio's one player is laid just behind the canvas, fitted each frame by a CSS matrix
// to the block's picture as the camera sees it, and the glass leaves the canvas clear over it
// (cubes.ts). It is the player the music comes from, so picture and sound never drift apart, and
// it moves in the same frame as the block. The centre of the video fills the square picture.
import * as THREE from 'three';
import * as radio from '../../scripts/music/engine';
import { PICTURE, type Cubes } from './cubes';
import { smoothstep } from './util';

/** Seconds a video plays before it shows, so its first frames and YouTube's title stay unseen. */
const SETTLE = 0.6;
const FADE_IN = 0.6;
const FADE_OUT = 0.3;
/** The video fills a little past the picture, so the glass's slight bend never reaches its edge. */
const OVERSCAN = 1.04;

const _m = new THREE.Matrix4();
const _screen = new THREE.Matrix4();
const _n = new THREE.Vector3();
const _to = new THREE.Vector3();

export class Film {
  /** How far the video shows, 0 to 1, before easing. */
  private level = 0;
  /** When the player began showing the track's video (seconds), Infinity while it isn't. */
  private since = Infinity;
  private staged = false;
  /** The player's own pixels onto the picture's plane through the middle of the block. */
  private readonly fit: THREE.Matrix4;
  private readonly at = { left: 0, top: 0 };

  constructor(
    private readonly cubes: Cubes,
    private readonly index: number,
    private readonly root: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
  ) {
    const { width, height } = radio.FRAME;
    const k = (2 * PICTURE * OVERSCAN) / height;
    // Its z column is never used (the frame is flat) but keeps the matrix invertible, as CSS needs.
    this.fit = new THREE.Matrix4().set(k, 0, 0, (-width / 2) * k, 0, -k, 0, (height / 2) * k, 0, 0, 1, 0, 0, 0, 0, 1);
    this.measure();
  }

  /** Where the canvas sits on the page; after a resize. */
  measure() {
    const r = this.canvas.getBoundingClientRect();
    this.at.left = r.left;
    this.at.top = r.top;
  }

  /** The video is showing, or fading. */
  get shown() {
    return this.level > 0;
  }

  /** Each step. `on`: the plaza is up, with its blocks out. */
  tick(dt: number, on: boolean) {
    const t = performance.now() / 1000;
    if (!(on && radio.showing())) this.since = Infinity;
    else if (this.since === Infinity) this.since = t;
    const want = t - this.since >= SETTLE;
    this.level = want ? Math.min(1, this.level + dt / FADE_IN) : Math.max(0, this.level - dt / FADE_OUT);
  }

  /**
   * Each frame, once the scene is drawn and before the glass is: lays the player under the picture.
   * Returns whether it is there, in which case the canvas must be opaque everywhere else.
   */
  place(camera: THREE.Camera, w: number, h: number): boolean {
    const mesh = this.cubes.items[this.index]?.mesh;
    if (!mesh?.visible || this.level <= 0) return this.release();
    mesh.updateMatrixWorld();
    // Edge on, there is no picture to see through the face, only the fold round the rim.
    _n.setFromMatrixColumn(mesh.matrixWorld, 2).normalize();
    _to.setFromMatrixPosition(mesh.matrixWorld).sub(camera.position).normalize();
    const amount = smoothstep(0, 1, this.level) * smoothstep(0.12, 0.3, Math.abs(_n.dot(_to)));
    if (amount <= 0) return this.release();

    const { left, top } = this.at;
    _screen.set(w / 2, 0, 0, w / 2 + left, 0, -h / 2, 0, h / 2 + top, 0, 0, 0, 0, 0, 0, 0, 1);
    _m.multiplyMatrices(_screen, camera.projectionMatrix).multiply(camera.matrixWorldInverse).multiply(mesh.matrixWorld).multiply(this.fit);
    const e = _m.elements;
    // Flat on the screen: depth out is nothing, which also keeps the matrix invertible.
    e[2] = e[6] = e[14] = 0;
    e[10] = 1;
    // Every corner in front of the lens.
    const { width, height } = radio.FRAME;
    for (const [x, y] of [
      [0, 0],
      [width, 0],
      [0, height],
      [width, height],
    ]) {
      if (e[3] * x + e[7] * y + e[15] <= 0.01) return this.release();
    }
    if (!radio.stage(`matrix3d(${Array.from(e, (v) => +v.toFixed(6)).join(',')})`)) return this.release();
    if (!this.staged) {
      this.staged = true;
      this.root.dataset.film = '';
    }
    this.cubes.film(this.index, amount);
    return true;
  }

  /** Puts the player back out of sight and the picture back in the glass. */
  release(): false {
    if (this.staged) {
      this.staged = false;
      radio.stage(null);
      delete this.root.dataset.film;
    }
    this.cubes.film(this.index, 0);
    return false;
  }

  /** Off at once, as the plaza goes to sleep. */
  stop() {
    this.level = 0;
    this.since = Infinity;
    this.release();
  }
}
