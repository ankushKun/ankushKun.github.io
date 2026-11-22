// Little sounds, made on the spot: a tick when the pointer comes to rest on something you can
// press, a chime when you press it, a softer one going back, a buzz for what can't be opened yet.
// Browsers only allow sound after a first touch or key, so nothing plays before that. M mutes them
// along with the music (src/scripts/music/engine.ts).
type Sound = 'tick' | 'select' | 'back' | 'flip' | 'nope';

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let muted = false;

function wake() {
  if (typeof AudioContext === 'undefined') return;
  if (!ctx) {
    ctx = new AudioContext();
    out = ctx.createGain();
    out.gain.value = 0.55;
    out.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
}
for (const type of ['pointerdown', 'keydown'] as const) addEventListener(type, wake, { passive: true });

function tone(freq: number, seconds: number, type: OscillatorType, gain: number, glide?: number, delay = 0) {
  if (!ctx || !out || ctx.state !== 'running' || muted) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (glide) osc.frequency.exponentialRampToValueAtTime(glide, t + seconds);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(gain, t + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  osc.connect(env).connect(out);
  osc.start(t);
  osc.stop(t + seconds + 0.02);
}

export function play(sound: Sound) {
  const wobble = 1 + (Math.random() - 0.5) * 0.06;
  switch (sound) {
    case 'tick':
      return tone(2200 * wobble, 0.04, 'sine', 0.05, 1800 * wobble);
    case 'select':
      tone(784, 0.1, 'triangle', 0.07, 1046);
      return tone(1568, 0.14, 'sine', 0.045, undefined, 0.055);
    case 'back':
      tone(1046, 0.09, 'triangle', 0.06, 698);
      return tone(523, 0.12, 'sine', 0.04, undefined, 0.05);
    case 'flip':
      return tone(660 * wobble, 0.12, 'sine', 0.05, 990 * wobble);
    case 'nope':
      tone(220, 0.12, 'square', 0.025);
      return tone(175, 0.16, 'square', 0.025, undefined, 0.09);
  }
}

// Anything marked data-sfx ticks when pointed at and chimes when pressed; a back button sighs.
let over: Element | null = null;
let lastTick = 0;
document.addEventListener(
  'pointerover',
  (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = e.target instanceof Element ? e.target.closest('[data-sfx]') : null;
    if (el === over) return;
    over = el;
    const now = performance.now();
    if (el && now - lastTick > 45) {
      lastTick = now;
      play('tick');
    }
  },
  { passive: true },
);
document.addEventListener('click', (e) => {
  const el = e.target instanceof Element ? e.target.closest('[data-sfx]') : null;
  if (!el) return;
  const kind = el.getAttribute('data-sfx');
  play(kind === 'back' || el.hasAttribute('data-back') ? 'back' : kind === 'nope' ? 'nope' : 'select');
});

addEventListener('keydown', (e) => {
  if (e.key !== 'm' && e.key !== 'M') return;
  if (e.metaKey || e.ctrlKey || e.altKey || (e.target instanceof HTMLElement && e.target.closest('input, textarea, [contenteditable]'))) return;
  muted = !muted;
});
