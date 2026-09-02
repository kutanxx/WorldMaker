import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { simulateHistory } from "./history";
import { worldToGazetteer } from "./gazetteer";

describe("worldToGazetteer", () => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
  const history = simulateHistory(world, 1);
  const md = worldToGazetteer(world, history);
  // Foundings are rendered as one grouped line, so "an event appears verbatim" has to be checked
  // against an event that is not folded — otherwise the assertion tests the grouping, not the
  // chronicle.
  const ungrouped = history.events.find((e) => e.type !== "found")!;

  it("opens with the world title and carries every section header", () => {
    const title = world.name.charAt(0).toUpperCase() + world.name.slice(1);
    expect(md.startsWith(`# ${title}`)).toBe(true);
    for (const h of ["## The Land", "## Peoples", "## Realms", "## Chronicle"]) expect(md).toContain(h);
  });
  it("names regions, peoples, realms and includes a chronicle event", () => {
    expect(md).toContain(world.regions[0].name);
    expect(md).toContain(world.cultures[0].name);
    expect(md).toContain(`### ${world.polities[0].name}`);
    expect(md).toContain(ungrouped.text);
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
  it("lists named rivers under The Land", () => {
    expect(world.rivers.length).toBeGreaterThan(0); // sanity for seed 1
    expect(md).toContain("### Rivers");
    expect(md).toContain(world.rivers[0].name);
  });
  it("omits the Rivers block when there are none", () => {
    const dry = { ...world, rivers: [] };
    expect(worldToGazetteer(dry, history)).not.toContain("### Rivers");
  });

  const ko = worldToGazetteer(world, history, "ko");

  it("follows the language it is asked for, headers and prose alike", () => {
    for (const h of ["## 땅", "## 민족", "## 나라", "## 연대기"]) expect(ko).toContain(h);
    for (const h of ["## The Land", "## Peoples", "## Realms"]) expect(ko).not.toContain(h);
    // The chronicle events are generated in Korean by the simulation, so a Korean document is now
    // one language throughout — which is the whole point of taking a `lang` at all.
    expect(ko).toContain(ungrouped.text);
  });

  it("picks the Korean object particle by the final consonant, not a placeholder", () => {
    // 중앙 ends in a consonant and takes 을; 남부/동부/서부 end in a vowel and take 를. The old code
    // emitted the literal string "을(를)", which no reader would accept.
    expect(ko).not.toContain("을(를)");
    expect(ko).not.toMatch(/중앙를|남부을|동부을|서부을/);
  });

  it("does not describe every feature with the same sentence", () => {
    // Each of these was previously one fixed sentence repeated verbatim for every item, which is
    // what made the document read as a form rather than as a description.
    const ports = ko.split("\n").filter((l) => l.startsWith("- **") && l.includes("자유도시"));
    if (ports.length > 1) expect(new Set(ports.map((l) => l.replace(/\*\*.+?\*\*/, ""))).size).toBeGreaterThan(1);
    const rivers = ko.slice(ko.indexOf("### 강")).split("\n").filter((l) => l.startsWith("- **"));
    expect(rivers.length).toBeGreaterThan(2);
    expect(new Set(rivers.map((l) => l.replace(/\*\*.+?\*\*/, ""))).size).toBeGreaterThan(1);
  });

  it("spreads the compass over the landmass instead of calling everything the centre", () => {
    // Directions used to be measured against the whole canvas; because this generator rings the map
    // with ocean, almost every feature fell in the middle third of both axes and was reported as
    // "the heart of the world". Against the land's own bounding box the word means something, so a
    // world of a dozen regions must name more than one direction.
    const land = ko.slice(ko.indexOf("## 땅"), ko.indexOf("## 민족"));
    const dirs = new Set([...land.matchAll(/세계 (중앙|북부|남부|동부|서부|북동부|북서부|남동부|남서부)/g)].map((m) => m[1]));
    expect(world.regions.length).toBeGreaterThan(5);   // or the assertion below proves nothing
    expect(dirs.size).toBeGreaterThan(2);
  });

  it("still reads as English when asked, and stays deterministic in both", () => {
    expect(worldToGazetteer(world, history, "en")).toBe(worldToGazetteer(world, history, "en"));
    expect(worldToGazetteer(world, history, "ko")).toBe(ko);
    expect(worldToGazetteer(world, history, "en")).toContain("## The Land");
  });
});
