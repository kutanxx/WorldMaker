/**
 * How much of the window's height the page spends around a drawing — measured, not declared.
 *
 * The world map and the city plan are both sized by the height the window has left over: the map's
 * measure is `(100vh - chrome) * 10/7`, the plan's cap `(100vh - chrome) * 494/460`. The chrome was
 * a number — 290 for the map, 230 for the plan — measured once, at 1440x900, with a mouse and a
 * one-row toolbar. Measured since, it was wrong everywhere else: the Korean toolbar wraps to two
 * rows on a 1366x650 laptop window and the English one at 1366x768, and a tablet's 44px controls
 * add 24px — each time the card ran 11-25px past the window and the chronicle's line was cut, and on
 * a tablet in landscape the city plan lost its bottom 60px. So the page measures what it actually
 * spends and hands that to the stylesheet (`--chrome`, `--plate-chrome` on #app); the numbers stay
 * in the stylesheet as the fallback, for the moment before anything has been measured.
 */

/** Room left under the card, so its bottom edge never sits flush with the window's. */
export const CHROME_AIR = 12;

/**
 * Everything above the drawing's top edge — from the top of the page, not of the window — plus what
 * counts below it, plus air. What counts below is the rest of the card by default (the world map:
 * its scrubber and the chronicle's line must be on screen with it); the plan passes its card's own
 * bottom edge instead, because its facts and key may run on under it where the window is tall.
 * `null` for a drawing that has not been laid out (jsdom, or not mounted yet).
 */
export function measureChrome(
  drawing: Element, card: Element, scrollY: number = window.scrollY, below?: number,
): number | null {
  const d = drawing.getBoundingClientRect();
  if (!(d.height > 0)) return null;
  const under = below ?? card.getBoundingClientRect().bottom - d.bottom;
  return Math.ceil(d.top + scrollY + under + CHROME_AIR);
}

/**
 * Set `prop` on `host` to what `measure` finds, and measure again until it holds. The drawing's size
 * follows the variable, the toolbar's width follows the drawing's, and a toolbar that wraps is
 * taller — so one pass can change what the next one measures. A narrower page never unwraps a
 * toolbar, so this settles in a pass or two; `passes` bounds it regardless. `floor` keeps the
 * variable at or over a number other arithmetic depends on (the plan's side column, layout.test).
 */
export function fitChrome(
  host: HTMLElement, prop: string, measure: () => number | null, passes = 3, floor = 0,
): void {
  for (let i = 0; i < passes; i++) {
    const found = measure();
    if (found === null) return;
    const v = Math.max(floor, found);
    const now = parseFloat(host.style.getPropertyValue(prop));
    if (Math.abs(v - now) < 1) return;
    host.style.setProperty(prop, `${v}px`);
  }
}
