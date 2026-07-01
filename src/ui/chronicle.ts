import type { History } from "../engine/history";

export function renderChronicle(history: History): HTMLElement {
  const root = document.createElement("div");
  root.className = "chronicle";
  const title = document.createElement("h3");
  title.textContent = `연대기 (0–${history.years}년)`;
  root.appendChild(title);
  const list = document.createElement("ol");
  list.className = "chronicle-list";
  let lastCentury = -1;
  for (const e of history.events) {
    const century = Math.floor(e.year / 100);
    if (century !== lastCentury) {
      lastCentury = century;
      const h = document.createElement("li");
      h.className = "chronicle-era";
      h.textContent = `${century * 100}년대`;
      list.appendChild(h);
    }
    const row = document.createElement("li");
    row.className = `chronicle-event evt-${e.type}`;
    row.dataset.year = String(e.year);
    row.textContent = e.text;
    list.appendChild(row);
  }
  root.appendChild(list);
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
  if (lastCurrent && typeof lastCurrent.scrollIntoView === "function") {
    lastCurrent.scrollIntoView({ block: "nearest" });
  }
}
