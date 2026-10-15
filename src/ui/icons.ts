/**
 * The page's icons, drawn in its own ink.
 *
 * The bar used to carry three kinds of sign at once: colour emoji (🎲 📜 🏠 🗺 🗓), text glyphs (⬇ ✎ ▶ ⏸ ✕ ←)
 * and one drawn SVG (the chain). Each OS draws an emoji its own way — in a headless window the front page's
 * 🗺 came out a white silhouette, on Windows Chrome in colour — and beside a parchment page set in Cinzel and
 * Gowun Batang a colour emoji reads as a chat app's (design review 2026-10-15, item 5). So every sign is the
 * same thing now: a 16-unit line drawing in `currentColor` at the chain's own stroke, 1.6, which takes the
 * colour of whatever it stands in (the primary button's cream, a muted caption's brown) and never changes
 * with the reader's machine.
 *
 * Inline, not a sprite: a dozen icons of one or two paths each cost less than the `<use>` plumbing, and an
 * inline drawing travels anywhere the markup is cloned.
 */
export type IconName =
  | "home" | "back" | "die" | "download" | "link" | "book" | "pencil" | "close"
  | "play" | "pause" | "map" | "calendar";

const NS = "http://www.w3.org/2000/svg";
const STROKE = 1.6;

/** each icon: its strokes (paths in a 16x16 box), and what is filled rather than drawn */
const DRAWN: Record<IconName, { stroke?: string[]; fill?: string[]; circles?: [number, number, number][] }> = {
  home: { stroke: ["M2.5 8.5 8 3.2l5.5 5.3", "M4 7.2V13h8V7.2"] },
  back: { stroke: ["M13 8H3.5", "M7.5 4 3.5 8l4 4"] },
  die: { stroke: ["M4.5 2.5h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z"], circles: [[5.3, 5.3, 1.1], [8, 8, 1.1], [10.7, 10.7, 1.1]] },
  download: { stroke: ["M8 2.5v8", "M4.5 7 8 10.5 11.5 7", "M3 13.5h10"] },
  // two pills along one diagonal, each through the other's end (the chain the bar already had)
  link: { stroke: ["M6.9 11.9 5.2 13.6a2.3 2.3 0 0 1-3.2-3.2l3.3-3.3a2.3 2.3 0 0 1 3.2 0", "M9.1 4.1l1.7-1.7a2.3 2.3 0 0 1 3.2 3.2L10.7 8.9a2.3 2.3 0 0 1-3.2 0"] },
  book: { stroke: ["M3.5 3.5a1 1 0 0 1 1-1h8v9.5h-8a1.5 1.5 0 0 0-1 .4z", "M3.5 12.3a1.5 1.5 0 0 0 1.5 1.5h7.5v-2"] },
  pencil: { stroke: ["M3 13l1-3.5L11.5 2l2.5 2.5L6.5 12z", "M9.6 3.9l2.5 2.5"] },
  close: { stroke: ["M4 4l8 8", "M12 4l-8 8"] },
  play: { fill: ["M4.5 2.8 13.2 8l-8.7 5.2z"] },
  pause: { fill: ["M4 3h2.6v10H4z", "M9.4 3H12v10H9.4z"] },
  map: { stroke: ["M2.5 4.2 6.5 2.6l3 1.4 4-1.6v9.4l-4 1.6-3-1.4-4 1.6z", "M6.5 2.6v9.4", "M9.5 4v9.4"] },
  calendar: { stroke: ["M2.5 4.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z", "M2.5 7.2h11", "M5.5 2v3", "M10.5 2v3"] },
};

/**
 * One icon, as an inline svg: a decoration (`aria-hidden`), since the control it stands in names itself
 * by its words or its `aria-label`. `size` is its box in CSS pixels; 15 is the chain's, which sat level
 * with the bar's words.
 */
export function icon(name: IconName, size = 15): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", `icon icon-${name}`);
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const d = DRAWN[name];
  for (const p of d.stroke ?? []) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", p);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", String(STROKE));
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
  }
  for (const p of d.fill ?? []) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", p);
    path.setAttribute("fill", "currentColor");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
  }
  for (const [cx, cy, r] of d.circles ?? []) {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", String(cx));
    c.setAttribute("cy", String(cy));
    c.setAttribute("r", String(r));
    c.setAttribute("fill", "currentColor");
    svg.appendChild(c);
  }
  return svg;
}

/** every name this module draws, for the test that draws them all */
export const ICON_NAMES = Object.keys(DRAWN) as IconName[];

/**
 * A control's content: its icon, then its words (or the icon alone). Replaces what the control held, so a
 * language switch can call it again; the words go in their own span so a test can read them without the
 * icon's markup in the way.
 */
export function sign(el: HTMLElement, name: IconName, words?: string): void {
  el.replaceChildren(icon(name));
  if (words !== undefined && words !== "") {
    const w = document.createElement("span");
    w.className = "icon-words";
    w.textContent = words;
    el.appendChild(w);
  }
}
