// @vitest-environment jsdom
import { describe, it } from "vitest";
import { generateWorld } from "../../engine/world";
import { DEFAULT_PARAMS } from "../../types/world";
import { renderWorld } from "../svgWorldRenderer";

describe("probe", () => {
  it("times each view", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 834932 });
    for (const view of ["terrain", "political", "culture", "province"] as const) {
      const t0 = Date.now();
      const svg = renderWorld(world, view, [], "ko");
      const ms = Date.now() - t0;
      const d = [...svg.querySelectorAll("path")].reduce((n, p) => n + (p.getAttribute("d")?.length ?? 0), 0);
      console.log(`${view}: ${ms}ms | ${svg.querySelectorAll("path").length} paths | ${Math.round(d / 1024)}KB path data`);
    }
  }, 120000);
});
