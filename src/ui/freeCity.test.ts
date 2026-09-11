// @vitest-environment jsdom
//
// The map, the city list and the gazetteer gave two different answers to "who holds this town".
// Measured on seed 1 at year 500: all four free realms still held their own seats in the simulation
// and the gazetteer said so ("500년까지 서 있다", seat named), while the map and the city list showed
// the empire around them — because both draw from ownership snapped to whole provinces, and a five-
// cell realm never wins a province. The free-city markers this layer already drew were invisible for
// the same reason: their anchor was computed from the array that had just erased them.
//
// No mock here, deliberately. governmentLabels.test.ts constructs its forms to exercise the wiring;
// this file asserts the thing a reader actually gets, on a real seed at a real year.
import { describe, it, expect, afterEach } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";
import { createApp } from "./app";
import { generateWorld } from "../engine/world";
import { simulateHistory } from "../engine/history";

afterEach(() => {
  try { localStorage.removeItem("wm:lang"); } catch { /* private mode */ }
  location.hash = "";
});

describe("a free city is on the map it is standing on", () => {
  it("still holds its own seat in the record, or the rest of this is untested", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const history = simulateHistory(world, 1);
    const last = history.snapshots[history.snapshots.length - 1];
    const free = history.polities.filter((p) => p.free);
    expect(free.length).toBeGreaterThan(0);
    for (const p of free) expect(last.owner[p.capital], `${p.name} lost its seat`).toBe(p.id);
  });

  it("paints its ground and names itself, and the city list agrees", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    createApp(root, { ...DEFAULT_PARAMS, seed: 1 });
    await new Promise((r) => setTimeout(r, 0));

    // the political view is the one that paints who holds what; terrain draws no realm fills at all,
    // so a free city is correctly absent there
    const political = [...root.querySelectorAll<HTMLButtonElement>(".view-toggle button")]
      .find((b) => b.textContent === "Political")!;
    expect(political, "no political view button").toBeTruthy();
    political.click();
    await new Promise((r) => setTimeout(r, 0));

    // scrub to the end, where every free city has been declared
    const slider = root.querySelector(".timeline-slider") as HTMLInputElement;
    slider.value = slider.max;
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    const banners = [...root.querySelectorAll(".free-city-label")].map((t) => t.textContent!.trim());
    expect(banners.length, "a map with four free cities drew none").toBeGreaterThan(0);

    const fills = root.querySelectorAll(".territory.free-city");
    expect(fills.length, "no free city has any ground painted").toBeGreaterThan(0);

    // The banner on the map is the bare name (the map's own typography and its legend say what kind
    // of place it is); the list spells the kind out, because that column has neither.
    const listed = [...root.querySelectorAll(".city-list-realm")].map((e) => e.textContent!.trim());
    const namesOne = (cell: string) => banners.some((b) => cell === b || cell.startsWith(b + " "));
    expect(listed.some(namesOne),
      `the list names no free city; it says ${[...new Set(listed)].slice(0, 6).join(", ")}`).toBe(true);
    expect(listed.filter(namesOne).every((c) => c.endsWith(" Free City")),
      `a free city in the list is not called one: ${listed.filter(namesOne).join(", ")}`).toBe(true);
    root.remove();
  });
});
