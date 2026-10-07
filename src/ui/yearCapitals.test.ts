// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";
import { generateWorld } from "../engine/world";
import { simulateHistory } from "../engine/history";
import { snapOwnersToProvinces } from "./provinceLayer";

// The files are caught at the download (jsdom has no canvas to draw a PNG with)
const saved: { name: string; blob: Blob }[] = [];
vi.mock("./export", async (original) => ({
  ...(await original<typeof import("./export")>()),
  svgToPngBlob: vi.fn(async () => new Blob()),
  downloadBlob: vi.fn((name: string, blob: Blob) => { saved.push({ name, blob }); }),
}));
const { createApp } = await import("./app");

afterEach(() => { location.hash = ""; saved.length = 0; document.body.replaceChildren(); localStorage.clear(); });

// The map's stars, a town's tooltip and the town list said, at every year, what the year-zero world said:
// measured on the live page over 12 worlds, at year 500 a star still stood on 52 of the 96 first capitals
// though another realm held them, and the tooltip named the wrong realm for 196 of 336 towns — while the
// list beside it, which follows the year, named the right one.
const params = { ...DEFAULT_PARAMS, seed: 2 };
const { world } = generateWorld(params);
const history = simulateHistory(world, params.seed);
const last = history.snapshots.length - 1;

// a realm stands from its founding year to the year it fell, not including that one (historySim ends a
// realm in the year its capital is taken and records the year's map after)
const seatsIn = (year: number) => new Set(history.polities
  .filter((p) => p.foundedYear <= year && (p.endedYear === null || p.endedYear > year))
  .map((p) => p.capital));
const freeRealms = new Set(history.polities.filter((p) => p.free).map((p) => p.id));
const holderIn = (yearIndex: number, cell: number) => snapOwnersToProvinces(world.grid.count, world.provinceOf,
  world.provinces, history.snapshots[yearIndex].owner, freeRealms)[cell];

function openAt(yearIndex: number) {
  localStorage.setItem("wm:lang", "en");
  const root = document.createElement("div");
  document.body.appendChild(root);
  createApp(root, params);
  const slider = root.querySelector(".timeline-slider") as HTMLInputElement;
  slider.value = String(yearIndex);
  slider.dispatchEvent(new Event("input", { bubbles: true }));
  return root;
}
const shown = (el: Element | null) => el !== null && (el as SVGElement).style.display !== "none";

describe("the capitals are the year's capitals", () => {
  it("draws a star on the seat of every realm standing in the scrubbed year, and on no other town", () => {
    for (const yearIndex of [0, 25, last]) {
      const root = openAt(yearIndex);
      const seats = seatsIn(history.snapshots[yearIndex].year);
      let checked = 0;
      for (const c of world.cities) {
        if (!shown(root.querySelector(`.markers .marker-hit[data-city="${c.id}"]`))) continue;
        const star = shown(root.querySelector(`.markers .marker-capital[data-city="${c.id}"]`));
        const dot = shown(root.querySelector(`.markers .marker-town[data-city="${c.id}"]`));
        expect(star, `year index ${yearIndex}: ${c.name} star`).toBe(seats.has(c.cell));
        expect(dot, `year index ${yearIndex}: ${c.name} dot`).toBe(!seats.has(c.cell));
        checked++;
      }
      expect(checked, `year index ${yearIndex}: no town was drawn`).toBeGreaterThan(5);
    }
    // ...and the claim is not vacuous: by the last year a first capital has fallen
    const fallen = world.cities.filter((c) => c.isCapital && !seatsIn(history.snapshots[last].year).has(c.cell));
    expect(fallen.length, "seed 2 lost no capital — the test proves nothing").toBeGreaterThan(0);
  });

  it("says, on hover, which realm holds a town in the scrubbed year and whether it is that realm's seat", () => {
    const root = openAt(last);
    const seats = seatsIn(history.snapshots[last].year);
    let checked = 0;
    for (const c of world.cities) {
      const hit = root.querySelector(`.markers .marker-hit[data-city="${c.id}"]`);
      if (!shown(hit)) continue;
      const tip = hit!.querySelector("title")?.textContent ?? "";
      expect(hit!.getAttribute("aria-label"), `${c.name}: the label and the tooltip disagree`).toBe(tip);
      const o = holderIn(last, c.cell);
      if (o >= 0) expect(tip, `${c.name}: "${tip}" does not name ${history.polities[o].name}`).toContain(` · ${history.polities[o].name}`);
      expect(tip.includes("(capital)"), `${c.name}: "${tip}"`).toBe(seats.has(c.cell));
      // the mark under the pointer says the same as the target over it
      const mark = root.querySelector(`.markers .marker-capital[data-city="${c.id}"], .markers .marker-town[data-city="${c.id}"]`);
      expect(mark?.querySelector("title")?.textContent, `${c.name}: the mark's own tooltip`).toBe(tip);
      checked++;
    }
    expect(checked).toBe(world.cities.length);
  });

  it("sets a town's name as a capital's in the year it is one, and as a town's when it is not", () => {
    const root = openAt(last);
    const seats = seatsIn(history.snapshots[last].year);
    for (const c of world.cities) {
      const label = root.querySelector(`.markers .city-label[data-city="${c.id}"]`)!;
      expect(label.classList.contains("city-capital"), `${c.name}`).toBe(seats.has(c.cell));
      expect(label.classList.contains("city-town"), `${c.name}`).toBe(!seats.has(c.cell));
    }
  });

  it("puts the year's capitals at the head of the town list", () => {
    const root = openAt(last);
    const seats = seatsIn(history.snapshots[last].year);
    const rows = [...root.querySelectorAll<HTMLLIElement>(".city-list li")].filter((li) => !li.hidden)
      .map((li) => li.querySelector(".city-list-item")!);
    expect(rows.length).toBe(world.cities.length);
    const capitalNow = rows.map((b) => seats.has(world.cities.find((c) => c.id === Number(b.getAttribute("data-city")))!.cell));
    rows.forEach((b, k) => expect(b.classList.contains("is-capital"), `row ${k}`).toBe(capitalNow[k]));
    // every capital of the year before every other town
    const firstTown = capitalNow.indexOf(false);
    expect(capitalNow.slice(firstTown === -1 ? capitalNow.length : firstTown).every((x) => !x)).toBe(true);
  });

  it("writes the year's capitals into an exported map", async () => {
    const root = openAt(last);
    ([...root.querySelectorAll<HTMLButtonElement>(".export-group > button")].find((b) => b.textContent === "SVG")!).click();
    for (let k = 0; k < 400 && saved.length === 0; k++) await new Promise((r) => setTimeout(r, 5));
    const file = await new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsText(saved[0].blob); });
    const doc = new DOMParser().parseFromString(file, "image/svg+xml");
    const stars = new Set([...doc.querySelectorAll(".marker-capital")].map((e) => Number(e.getAttribute("data-city"))));
    const seats = seatsIn(history.snapshots[last].year);
    const expected = new Set(world.cities.filter((c) => seats.has(c.cell)).map((c) => c.id));
    expect([...stars].sort((a, b) => a - b)).toEqual([...expected].sort((a, b) => a - b));
  }, 20000);
});
