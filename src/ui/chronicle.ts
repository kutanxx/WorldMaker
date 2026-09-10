import type { World } from "../types/world";
import type { History } from "../engine/history";
import type { Lang } from "./i18n";
import { chronicleTitle, eraLabel } from "./i18n";
import { buildChronicle, isMoment } from "../engine/chronicleLines";

// The world is needed because the chronicle is not only the events the simulation recorded: most of
// it is mined out of the territory snapshots, and reading those means knowing whose land is whose.
// Until this took a world, the panel drew the raw events alone and told the reader less than half
// the history the downloaded gazetteer told (56/48/42 lines against 122/120/96 on seeds 1/2/3),
// with no ruler ever named. Both now come off `buildChronicle`.
/**
 * `onPick` is what makes a row a way INTO the map: the panel sits beside a moving map and every
 * row already knows its year, but nothing joined the two, so a reader who saw a conquest in 190 had
 * to hunt for 190 on a 500-year slider by feel. Optional, because the gazetteer builds this same
 * chronicle for a document, where there is nothing to jump to.
 */
export function renderChronicle(world: World, history: History, lang: Lang,
                                onPick?: (year: number) => void): HTMLElement {
  const root = document.createElement("div");
  root.className = "chronicle";
  const title = document.createElement("h3");
  title.textContent = chronicleTitle(lang, history.years);
  root.appendChild(title);
  // group events by century: each century is a header (a section divider, NOT a list item) followed
  // by its own <ol> of event rows — valid markup, since an <ol> may only contain <li> children.
  let lastCentury = -1;
  let list: HTMLOListElement | null = null;
  // Moments only. The gazetteer keeps the whole chronicle — it is a reference and you go to it
  // looking for a realm's king list — but this sits beside a moving map and gets glanced at, and
  // the full record runs 115 lines a world of which a third is accessions and a quarter is
  // territorial arithmetic. Half of it was crowding out the other half.
  for (const e of buildChronicle(world, history, lang).filter((l) => isMoment(l.kind))) {
    const century = Math.floor(e.year / 100);
    if (century !== lastCentury) {
      lastCentury = century;
      const h = document.createElement("div");
      h.className = "chronicle-era";
      h.textContent = eraLabel(lang, century * 100);
      root.appendChild(h);
      list = document.createElement("ol");
      list.className = "chronicle-list";
      root.appendChild(list);
    }
    const row = document.createElement("li");
    row.className = `chronicle-event evt-${e.kind}`;
    row.dataset.year = String(e.year);
    // A real <button>, not a click handler on the <li>. The row is a control — it moves the map to
    // the year it names — and a button is what gives it Enter, Space, a focus ring and a name a
    // screen reader will read, none of which a listener on a list item gets. The panel's own
    // machinery is untouched: `row.textContent` is still the sentence, so the future-greying and
    // the century grouping read exactly what they always read.
    const jump = document.createElement("button");
    jump.className = "chronicle-jump";
    jump.textContent = e.text;
    if (onPick) jump.addEventListener("click", () => onPick(e.year));
    row.appendChild(jump);
    list!.appendChild(row);
  }
  return root;
}

export function applyChronicleYear(root: HTMLElement, year: number): void {
  const rows = root.querySelectorAll<HTMLElement>(".chronicle-event");
  let lastCurrent: HTMLElement | null = null;
  for (const row of rows) {
    if (Number(row.dataset.year) > year) {
      row.classList.add("future");
    } else {
      row.classList.remove("future");
      lastCurrent = row;
    }
  }
  // keep the current row visible WITHIN the chronicle panel only — never scroll the window
  // (scrollIntoView would pull the whole page down to the panel on load / year change).
  if (lastCurrent && typeof root.getBoundingClientRect === "function") {
    const rowRect = lastCurrent.getBoundingClientRect();
    const boxRect = root.getBoundingClientRect();
    if (rowRect.top < boxRect.top || rowRect.bottom > boxRect.bottom) {
      root.scrollTop += rowRect.top - boxRect.top - (boxRect.height - rowRect.height) / 2;
    }
  }
}
