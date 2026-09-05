import type { History } from "../engine/history";
import type { Lang } from "./i18n";
import { chronicleTitle, eraLabel } from "./i18n";
import { eventText } from "../engine/eventText";

export function renderChronicle(history: History, lang: Lang): HTMLElement {
  const root = document.createElement("div");
  root.className = "chronicle";
  const title = document.createElement("h3");
  title.textContent = chronicleTitle(lang, history.years);
  root.appendChild(title);
  // group events by century: each century is a header (a section divider, NOT a list item) followed
  // by its own <ol> of event rows — valid markup, since an <ol> may only contain <li> children.
  let lastCentury = -1;
  let list: HTMLOListElement | null = null;
  for (const e of history.events) {
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
    row.className = `chronicle-event evt-${e.type}`;
    row.dataset.year = String(e.year);
    row.textContent = eventText(e, history.polities, lang);
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
