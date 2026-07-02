import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { simulateHistory } from "./history";
import { worldToGazetteer } from "./gazetteer";

describe("worldToGazetteer", () => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
  const history = simulateHistory(world, 1);
  const md = worldToGazetteer(world, history);

  it("opens with the world title and carries every section header", () => {
    const title = world.name.charAt(0).toUpperCase() + world.name.slice(1);
    expect(md.startsWith(`# ${title}`)).toBe(true);
    for (const h of ["## The Land", "## Peoples", "## Realms", "## Chronicle"]) expect(md).toContain(h);
  });
  it("names regions, peoples, realms and includes a chronicle event", () => {
    expect(md).toContain(world.regions[0].name);
    expect(md).toContain(world.cultures[0].name);
    expect(md).toContain(`### ${world.polities[0].name}`);
    expect(md).toContain(history.events[0].text);
  });
  it("is deterministic", () => {
    expect(worldToGazetteer(world, history)).toBe(md);
  });
  it("handles empty regions / no economic zones without crashing", () => {
    const bare = { ...world, regions: [] };
    const h2 = { ...history, economicZones: [] };
    const out = worldToGazetteer(bare, h2);
    expect(out.startsWith("# ")).toBe(true);
    expect(out).not.toContain("## Free Ports");
  });
});
