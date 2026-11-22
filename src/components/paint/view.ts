// Where Paint's canvas sits in its window, and how far in you are: the canvas's own 960 by 600 at a
// zoom `z` (CSS pixels per canvas pixel), its top left corner at `x`, `y` in the window. It opens
// fitted, and stays fitted as the window changes until you zoom or pan; then the middle stays put.
// The usual ways move it: pinch on a trackpad (or Ctrl or Cmd with the wheel) zooms at the pointer,
// scrolling pans, and Safari's own pinch gestures zoom too. main.ts adds dragging and touch, and
// draws the first time itself: the view only calls back for changes after it's made.
import { H, W } from './board';

export const MAX_ZOOM = 8;
const STEP = 1.25;

export interface View {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Fitted to the window, rather than zoomed or panned by hand. */
  readonly fitted: boolean;
  /** The canvas pixel under a point on screen. */
  toCanvas(clientX: number, clientY: number): { x: number; y: number };
  zoomAt(z: number, clientX?: number, clientY?: number): void;
  zoomStep(dir: 1 | -1): void;
  panBy(dx: number, dy: number): void;
  fit(): void;
  /** Actual size: one canvas pixel to a CSS pixel, centred. */
  actual(): void;
  destroy(): void;
}

export function mountView(el: HTMLElement, onChange: () => void): View {
  let x = 0;
  let y = 0;
  let z = 1;
  let fitted = true;
  /** Quiet until it's made, so the first fit doesn't call back into a view that isn't there yet. */
  let ready = false;
  let w = el.clientWidth;
  let h = el.clientHeight;

  const pad = () => (w < 600 ? 10 : 28);
  const fitZoom = () => Math.max(0.05, Math.min((w - pad() * 2) / W, (h - pad() * 2) / H));
  const minZoom = () => Math.min(fitZoom() * 0.5, 0.25);

  /** Keeps some of the canvas on screen however far it's pushed. */
  function clamp() {
    const keep = Math.min(80, (W * z) / 2, (H * z) / 2);
    x = Math.min(w - keep, Math.max(keep - W * z, x));
    y = Math.min(h - keep, Math.max(keep - H * z, y));
  }

  function fit() {
    z = fitZoom();
    x = (w - W * z) / 2;
    y = (h - H * z) / 2;
    fitted = true;
    if (ready) onChange();
  }

  function zoomAt(next: number, clientX?: number, clientY?: number) {
    const r = el.getBoundingClientRect();
    const cx = clientX === undefined ? w / 2 : clientX - r.left;
    const cy = clientY === undefined ? h / 2 : clientY - r.top;
    const nz = Math.min(MAX_ZOOM, Math.max(minZoom(), next));
    // The canvas pixel under the pointer stays under it.
    x = cx - ((cx - x) / z) * nz;
    y = cy - ((cy - y) / z) * nz;
    z = nz;
    fitted = false;
    clamp();
    onChange();
  }

  function panBy(dx: number, dy: number) {
    x += dx;
    y += dy;
    fitted = false;
    clamp();
    onChange();
  }

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    // Lines and pages, from a mouse wheel, as pixels.
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? h : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    if (e.ctrlKey || e.metaKey) zoomAt(z * Math.exp(-dy * 0.0022), e.clientX, e.clientY);
    else if (e.shiftKey && !dx) panBy(-dy, 0);
    else panBy(-dx, -dy);
  };
  el.addEventListener('wheel', onWheel, { passive: false });

  // Safari pinches with gesture events rather than the wheel.
  let gestureStart = 1;
  const onGestureStart = (e: Event) => {
    e.preventDefault();
    gestureStart = z;
  };
  const onGestureChange = (e: Event) => {
    e.preventDefault();
    const g = e as Event & { scale: number; clientX: number; clientY: number };
    zoomAt(gestureStart * g.scale, g.clientX, g.clientY);
  };
  el.addEventListener('gesturestart', onGestureStart);
  el.addEventListener('gesturechange', onGestureChange);

  const resize = new ResizeObserver(() => {
    const cx = (w / 2 - x) / z;
    const cy = (h / 2 - y) / z;
    w = el.clientWidth;
    h = el.clientHeight;
    if (fitted) return fit();
    x = w / 2 - cx * z;
    y = h / 2 - cy * z;
    clamp();
    onChange();
  });
  resize.observe(el);
  fit();
  ready = true;

  return {
    get x() {
      return x;
    },
    get y() {
      return y;
    },
    get z() {
      return z;
    },
    get fitted() {
      return fitted;
    },
    toCanvas(clientX, clientY) {
      const r = el.getBoundingClientRect();
      return { x: (clientX - r.left - x) / z, y: (clientY - r.top - y) / z };
    },
    zoomAt,
    zoomStep(dir) {
      zoomAt(dir > 0 ? z * STEP : z / STEP);
    },
    panBy,
    fit,
    actual() {
      zoomAt(1);
      x = (w - W) / 2;
      y = (h - H) / 2;
      clamp();
      onChange();
    },
    destroy() {
      resize.disconnect();
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
    },
  };
}
