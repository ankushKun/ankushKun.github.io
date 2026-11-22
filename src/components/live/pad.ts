// The drawing pad the live apps share: the chat's Miiverse paper (320 by 120, black only) and the
// Guestbook's Swapnote note (320 by 240, three inks). Drawn with a pen of two widths or rubbed out
// with an eraser, hard edged one pixel at a time as the GamePad and the 3DS drew, and saved as a
// small PNG with no paper: just the strokes on transparency, so the page puts its own paper under
// them (the chat shows them black in the light and white in the dark). Pointer, touch and stylus all
// draw; pressure is ignored, as neither stylus had any.
export type Tool = 'pen' | 'thick' | 'eraser';

export interface Pad {
  /** True once something has been drawn since the last clear. */
  readonly dirty: boolean;
  setTool(tool: Tool): void;
  /** The pen's colour, as CSS. */
  setInk(ink: string): void;
  clear(): void;
  undo(): void;
  /** The drawing as a PNG data URL. */
  png(): string;
  /** Starts again from a drawing saved earlier (a PNG data URL), as something to keep drawing on. */
  load(src: string): Promise<void>;
  destroy(): void;
}

export function mountPad(canvas: HTMLCanvasElement, onChange: () => void, size: { width: number; height: number } = { width: 320, height: 120 }): Pad {
  const DRAW_W = (canvas.width = size.width);
  const DRAW_H = (canvas.height = size.height);
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  let tool: Tool = 'pen';
  let ink = '#000';
  let dirty = false;
  let last: { x: number; y: number } | null = null;
  const history: ImageData[] = [];

  const blank = () => g.clearRect(0, 0, DRAW_W, DRAW_H);
  blank();

  const at = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * DRAW_W, y: ((e.clientY - r.top) / r.height) * DRAW_H };
  };

  // Hard edged, one pixel at a time, as the GamePad drew: no smoothing, no grey.
  const dot = (x: number, y: number) => {
    const size = tool === 'pen' ? 2 : tool === 'thick' ? 5 : 12;
    const box = [Math.round(x - size / 2), Math.round(y - size / 2), size, size] as const;
    if (tool === 'eraser') return g.clearRect(...box);
    g.fillStyle = ink;
    g.fillRect(...box);
  };
  const line = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let i = 0; i <= steps; i++) dot(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
  };

  const down = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    history.push(g.getImageData(0, 0, DRAW_W, DRAW_H));
    if (history.length > 20) history.shift();
    last = at(e);
    dot(last.x, last.y);
    dirty = true;
    onChange();
  };
  const move = (e: PointerEvent) => {
    if (!last) return;
    for (const ev of e.getCoalescedEvents?.() ?? [e]) {
      const p = at(ev);
      line(last, p);
      last = p;
    }
  };
  const up = () => {
    last = null;
  };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  return {
    get dirty() {
      return dirty;
    },
    setTool(t) {
      tool = t;
    },
    setInk(c) {
      ink = c;
    },
    clear() {
      history.push(g.getImageData(0, 0, DRAW_W, DRAW_H));
      blank();
      dirty = false;
      onChange();
    },
    undo() {
      const prev = history.pop();
      if (prev) g.putImageData(prev, 0, 0);
      dirty = history.length > 0;
      onChange();
    },
    png() {
      return canvas.toDataURL('image/png');
    },
    async load(src) {
      const img = new Image();
      img.src = src;
      await img.decode();
      history.length = 0;
      blank();
      g.drawImage(img, 0, 0, DRAW_W, DRAW_H);
      dirty = true;
      onChange();
    },
    destroy() {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
    },
  };
}
