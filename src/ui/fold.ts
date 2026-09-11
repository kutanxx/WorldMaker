/**
 * A section that folds away, for the panels that stand under the map on a narrow screen.
 *
 * On a phone the map is 321x225 and the town list and the chronicle under it came to 641px — the
 * two lists were 2.8 times the height of the thing they annotate, and everything but the map was
 * below the fold. Folding is what a narrow page does about that.
 *
 * The head IS the title. That is the whole idea: the key's old chip moved to the opposite corner
 * when it opened, so on a phone the control you pressed was gone from where you pressed it and a
 * second object had appeared somewhere else. A section that opens where its title is closes there
 * too.
 */
export interface Fold {
  section: HTMLElement;
  head: HTMLButtonElement;
  body: HTMLElement;
  setOpen(on: boolean): void;
  /** Wide windows show these sections outright; the head stands down to a plain heading. */
  setFoldable(on: boolean): void;
}

export interface FoldOpts {
  title: string;
  open: boolean;
  /** heading level the title carried before it became a button (the town list was h2, the chronicle h3) */
  level?: number;
  /** what is inside, for a head that is all the reader can see of the section */
  count?: number;
  onToggle?: (on: boolean) => void;
}

export function makeFold(opts: FoldOpts): Fold {
  const section = document.createElement("section");
  section.className = "fold";
  const head = document.createElement("button");
  head.type = "button";
  head.className = "fold-head";

  // A <button> may only contain phrasing content, so the heading is a role rather than an <h2>.
  // Losing the heading outright would take these panels off the list a screen reader navigates by.
  const title = document.createElement("span");
  title.className = "fold-title";
  title.setAttribute("role", "heading");
  title.setAttribute("aria-level", String(opts.level ?? 2));
  title.textContent = opts.title;
  head.appendChild(title);

  if (opts.count !== undefined) {
    const n = document.createElement("span");
    n.className = "fold-count";
    n.textContent = String(opts.count);
    head.appendChild(n);
  }
  const mark = document.createElement("span");
  mark.className = "fold-mark";
  mark.setAttribute("aria-hidden", "true");
  head.appendChild(mark);

  const body = document.createElement("div");
  body.className = "fold-body";
  section.append(head, body);

  let open = opts.open;
  let foldable = true;
  const paint = () => {
    const shown = open || !foldable;
    section.classList.toggle("is-open", shown);
    head.setAttribute("aria-expanded", String(shown));
  };
  paint();

  head.addEventListener("click", () => {
    open = !open;
    paint();
    opts.onToggle?.(open);
  });

  return {
    section, head, body,
    setOpen(on) { open = on; paint(); },
    setFoldable(on) { foldable = on; head.disabled = !on; paint(); },
  };
}

// Storage can throw outright in privacy mode, and a page that will not paint because a preference
// could not be read is a worse bug than a section in the wrong state. Same bargain the key's own
// preference has always made.
export function readFoldPref(key: string, dflt: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? dflt : v === "on";
  } catch { return dflt; }
}

export function writeFoldPref(key: string, on: boolean): void {
  try { localStorage.setItem(key, on ? "on" : "off"); } catch { /* privacy mode */ }
}
