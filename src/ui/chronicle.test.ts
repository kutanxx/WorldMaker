// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { simulateHistory } from "../engine/history";
import { renderChronicle, applyChronicleYear } from "./chronicle";

describe("renderChronicle", () => {
  it("renders one row per event with year + text", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const h = simulateHistory(world, 1);
    const el = renderChronicle(h);
    expect(el.querySelectorAll(".chronicle-event").length).toBe(h.events.length);
    expect(el.textContent).toContain("건국");
  });
  it("keeps era headers OUT of the <ol> (valid list markup: an <ol> holds only <li>)", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const h = simulateHistory(world, 1);
    const el = renderChronicle(h);
    const eras = el.querySelectorAll(".chronicle-era");
    expect(eras.length).toBeGreaterThan(0);
    for (const era of eras) expect(era.tagName.toLowerCase()).not.toBe("li"); // a header, not a list item
    // every list child is an event row (no header smuggled into the <ol>)
    for (const ol of el.querySelectorAll("ol.chronicle-list")) {
      for (const child of ol.children) expect(child.classList.contains("chronicle-event")).toBe(true);
    }
  });
});

describe("applyChronicleYear", () => {
  it("dims events after the current year and clears earlier ones", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const h = simulateHistory(world, 1);
    const el = renderChronicle(h);
    applyChronicleYear(el, 100);
    const rows = Array.from(el.querySelectorAll<HTMLElement>(".chronicle-event"));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.classList.contains("future")).toBe(Number(r.dataset.year) > 100);
    }
  });
});
