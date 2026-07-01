// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { simulateHistory } from "../engine/history";
import { renderChronicle } from "./chronicle";

describe("renderChronicle", () => {
  it("renders one row per event with year + text", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const h = simulateHistory(world, 1);
    const el = renderChronicle(h);
    expect(el.querySelectorAll(".chronicle-event").length).toBe(h.events.length);
    expect(el.textContent).toContain("건국");
  });
});
