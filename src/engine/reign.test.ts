import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { initPlaySim, playTurn } from "./playSim";
import { applyIntervention, foundCityTargets } from "./intervention";
import { reignChronicle } from "./reign";

function playedState(turns: number) {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 7 });
  const counts = new Map<number, number>();
  for (const o of world.polityOf) if (o >= 0) counts.set(o, (counts.get(o) ?? 0) + 1);
  const largest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const s = initPlaySim(world, 7, largest, "internal");
  const site = foundCityTargets(s)[0];
  applyIntervention(s, { type: "foundCity", cell: site.cell });
  for (let t = 0; t < turns; t++) {
    const r = playTurn(s, null);
    if (r.finished) break;
  }
  return { s, world };
}

describe("reignChronicle", () => {
  it("titles the reign with the nation and world name, and reports the stats line", () => {
    const { s, world } = playedState(10);
    const md = reignChronicle(s, world.name, "ko");
    const nation = s.polities[s.playerPolity].name;
    expect(md).toContain(`# ${nation}`);
    expect(md).toContain(world.name);
    expect(md).toMatch(/최대 \d+셀/);
    expect(md).toMatch(/도시 \d+\/\d+/);
  });

  it("includes the player's founded city and player-involved events, with decade deltas", () => {
    const { s, world } = playedState(20);
    const md = reignChronicle(s, world.name, "ko");
    const founded = s.events.find((e) => e.type === "newCity" && e.polityId === s.playerPolity)!;
    expect(md).toContain(founded.text);
    expect(md).toMatch(/\d+년: [+−]/); // at least one gain/loss decade line
  });

  it("excludes events between third parties (not the player's story)", () => {
    const { s, world } = playedState(30);
    const other = s.events.find(
      (e) => e.year > 0 && e.polityId !== s.playerPolity && e.otherId !== s.playerPolity && e.polityId >= 0,
    );
    if (!other) return; // seed-dependent; usually present
    const md = reignChronicle(s, world.name, "ko");
    expect(md).not.toContain(other.text);
  });

  it("reports survival at year 500 or the fall, in EN too", () => {
    const { s, world } = playedState(50);
    const md = reignChronicle(s, world.name, "en");
    expect(/survived|fell/.test(md)).toBe(true);
  });
});
