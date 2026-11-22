// Where the chat's sheets open and what they grow out of. Every sheet grows from the button that
// opened it: its transform-origin is that button's centre, worked out from the edges the sheet is
// placed by (left or right, top or bottom), so it is right from the first frame, before the sheet
// has a size to measure.

/** Points a sheet's transform-origin at the centre of `from`, from its inline left/right/top/bottom. */
export function growFrom(sheet: HTMLElement, from: Element) {
  const b = from.getBoundingClientRect();
  const cx = b.left + b.width / 2;
  const cy = b.top + b.height / 2;
  const px = (v: string) => parseFloat(v);
  const s = sheet.style;
  const x = s.left ? `${cx - px(s.left)}px` : s.right ? `calc(100% - ${innerWidth - px(s.right) - cx}px)` : '50%';
  const y = s.top ? `${cy - px(s.top)}px` : s.bottom ? `calc(100% + ${cy - (innerHeight - px(s.bottom))}px)` : '50%';
  s.transformOrigin = `${x} ${y}`;
}

/**
 * Opens just above the input bar, on the side of its buttons, at most `max` wide, growing out of
 * `from`. On a phone the bar is narrow, so a sheet takes the screen's width.
 */
export function placeAbove(sheet: HTMLElement, bar: HTMLElement, max: number, from: Element) {
  const box = bar.getBoundingClientRect();
  const screen = (bar.closest('.chat') ?? bar).getBoundingClientRect();
  const narrow = box.width < 480;
  const width = narrow ? screen.width - 20 : Math.min(box.width, max);
  sheet.style.bottom = `${innerHeight - box.top + 10}px`;
  sheet.style.left = `${narrow ? screen.left + 10 : box.right - width}px`;
  sheet.style.width = `${width}px`;
  growFrom(sheet, from);
}
