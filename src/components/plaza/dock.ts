// Docks the lobby's built-project and support links into the top-left icon row when the visitor
// clicks the home screen for the first time. Measures each icon before `data-waiting` flips,
// dissolves the text labels where they stood, then flies every icon across the sky on a GPU
// transform arc into its docked slot.

const REDUCED = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Captured {
  icon: HTMLElement;
  from: DOMRect;
}

/**
 * Call just before flipping `data-waiting` from 'true' to 'false'. Returns a function to call right
 * after the flip so each icon flies smoothly from its lobby spot into the top-left icon dock.
 */
export function captureLobbyDock(): () => void {
  if (REDUCED()) return () => {};
  const lobby = document.querySelector<HTMLElement>('[data-lobby]');
  const built = lobby?.querySelector<HTMLElement>('.is-built');
  if (!lobby || !built) return () => {};

  const icons = [...built.querySelectorAll<HTMLElement>('a > :is(.lobby-icon, .link-badge)')];
  if (!icons.length) return () => {};

  const captured: Captured[] = icons.map((icon) => ({ icon, from: icon.getBoundingClientRect() }));

  // Dissolve the retiring text labels and arrows right where they stood so they never jump.
  const narrow = matchMedia('(max-width: 879px)').matches;
  const ghosts: HTMLElement[] = [];
  for (const el of built.querySelectorAll<HTMLElement>('a > .lobby-label, a > .lobby-out')) {
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const style = getComputedStyle(el);
    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.setAttribute('aria-hidden', 'true');
    ghost.classList.add('lobby-ghost');
    Object.assign(ghost.style, {
      position: 'fixed',
      display: style.display,
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: '0',
      color: style.color,
      font: style.font,
      letterSpacing: style.letterSpacing,
      lineHeight: style.lineHeight,
      textAlign: style.textAlign,
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
    });
    ghosts.push(ghost);
  }

  return () => {
    for (const ghost of ghosts) {
      lobby.append(ghost);
      const drift = narrow ? 'translate3d(0, -6px, 0)' : 'translate3d(10px, 0, 0)';
      ghost
        .animate(
          [
            { opacity: 1, transform: 'translate3d(0, 0, 0)' },
            { opacity: 0, transform: drift },
          ],
          { duration: 190, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' },
        )
        .finished.finally(() => ghost.remove());
    }

    built.dataset.docking = '';
    const animations: Animation[] = [];

    captured.forEach(({ icon, from }, i) => {
      if (!from.width || !from.height) return;
      const to = icon.getBoundingClientRect();
      if (!to.width || !to.height) return;
      const dx = from.left + from.width / 2 - (to.left + to.width / 2);
      const dy = from.top + from.height / 2 - (to.top + to.height / 2);
      if (Math.hypot(dx, dy) < 2) return;
      const sx = from.width / to.width;
      const sy = from.height / to.height;
      // Gentle upward sky arc proportional to flight distance.
      const lift = Math.min(44, Math.hypot(dx, dy) * 0.075);
      const peak = Math.max(sx, sy, 1) * 1.12;
      const anim = icon.animate(
        [
          { transform: `translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy})` },
          { transform: `translate3d(${dx * 0.38}px, ${dy * 0.38 - lift}px, 0) scale(${peak})`, offset: 0.46 },
          { transform: 'translate3d(0, 0, 0) scale(1)' },
        ],
        {
          duration: 640,
          delay: i * 28,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          fill: 'backwards',
        },
      );
      animations.push(anim);
    });

    const settle = () => {
      delete built.dataset.docking;
    };
    if (!animations.length) settle();
    else Promise.allSettled(animations.map((a) => a.finished)).finally(settle);
  };
}
