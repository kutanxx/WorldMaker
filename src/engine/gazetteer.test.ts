import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { simulateHistory } from "./history";
import { worldToGazetteer } from "./gazetteer";
import { eventText } from "./eventText";

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
    expect(md).toContain(eventText(ungrouped, history.polities, "en"));
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
    expect(ko).toContain(eventText(ungrouped, history.polities, "ko"));
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

  it("tells the moments the simulation lived through but never recorded", () => {
    // The 51 territory snapshots were read by nobody: the chronicle carried 31-44 events across five
    // centuries, more than half its recorded moments silent. Peaks, sudden losses and changes of the
    // greatest realm all already happened and are now told.
    const chron = ko.slice(ko.indexOf("## 연대기"));
    const lines = chron.split("\n").filter((l) => l.startsWith("- "));
    const recorded = history.events.filter((e) => e.type !== "found").length + 1;  // +1 grouped founding
    expect(lines.length).toBeGreaterThan(recorded);
    expect(chron).toContain("최대 판도에 이르다");
  });

  it("says a realm fell rather than that it lost 100% of itself", () => {
    // A destroyed realm used to be reported as a percentage, which is arithmetic where the chronicle
    // wants an ending.
    expect(ko).not.toContain("영토의 100%를 잃다");
  });

  it("keeps the chronicle in year order however entries were derived", () => {
    const years = [...ko.slice(ko.indexOf("## 연대기")).matchAll(/^- (\d+)년/gm)].map((m) => Number(m[1]));
    expect(years.length).toBeGreaterThan(10);
    for (let i = 1; i < years.length; i++) expect(years[i]).toBeGreaterThanOrEqual(years[i - 1]);
  });

  it("gives every century a line, so a quiet one still says what the world looked like", () => {
    // Measured across seven seeds, the opening century carried 17-21 entries and later ones dropped
    // to one or none — the simulation reaches equilibrium and stops emitting events. A century in
    // which the borders held is still information; it just had to be said.
    const chron = ko.slice(ko.indexOf("## 연대기"));
    const centuries = [...chron.matchAll(/^### (\d+)년대/gm)].map((m) => Number(m[1]) / 100);
    expect(centuries.length).toBeGreaterThan(3);
    for (const c of centuries) {
      const body = chron.slice(chron.indexOf(`### ${c * 100}년대`));
      const nextHeader = body.indexOf("### ", 4);
      const section = nextHeader > 0 ? body.slice(0, nextHeader) : body;
      expect((section.match(/^- /gm) ?? []).length).toBeGreaterThan(0);
    }
    expect(chron).toContain("년 현재 —");
  });

  it("names the people who ruled, not only the realms", () => {
    // The chronicle recorded realms conquering realms and never once named a person, which is why it
    // read as a campaign log. Rulers are invented — nothing in the simulation models one — but they
    // are drawn from the phonetics of the people their seat stands among and are derived off the
    // world's own rng, so they cannot move a single cell on the map.
    expect(ko).toContain("역대 군주 —");
    expect(ko).toMatch(/\d+대 .+ 즉위/);
    expect(ko).toContain("치세)");
  });

  it("mentions the peoples a realm came to rule", () => {
    // Every world generates five cultures and the chronicle never mentioned one of them, though a
    // realm reaching over a second people's land sits in `cultureOf` crossed with the snapshots.
    expect(ko).toContain("민족의 땅을 다스리게 되다");
  });

  it("does not repeat one realm's name twice in a year for the same kind of turn", () => {
    // A single conquest can reach two peoples at once; that is one line, not two identical ones.
    const lines = (ko.slice(ko.indexOf("## 연대기")).match(/^- .*민족의 땅.*$/gm) ?? []);
    const keys = lines.map((l) => l.replace(/—.*$/, "").trim());
    expect(new Set(keys).size).toBe(keys.length);
  });

  for (const s of [1, 2, 3]) {
    it(`writes an English document with no Korean left in it (seed ${s})`, () => {
      const { world: w } = generateWorld({ ...DEFAULT_PARAMS, seed: s });
      const h = simulateHistory(w, s);
      const en = worldToGazetteer(w, h, "en");
      const hangul = en.match(/[가-힣]/g) ?? [];
      expect(hangul).toEqual([]);          // shows the offending characters when it fails
    });
  }

  it("still writes the Korean document in Korean", () => {
    const kr = worldToGazetteer(world, history, "ko");
    // Seed 1 groups its 8 foundings into one "N개 나라가 서다" line, so "건국" itself doesn't
    // appear; "자유무역항 지정" (the free-port namings) is unconditional and Korean-only.
    expect(kr).toContain("자유무역항 지정");
    expect(kr).toContain("## 연대기");
  });
});

// The chronicle is about to gain a second consumer: the on-screen panel, which until now drew only
// the simulation's raw events and so told the reader less than half the history the download did.
// Sharing one assembler between the two is the fix, and this is the lock that proves the move was
// faithful — the exported document must come out byte-identical, in both languages, on every seed.
// It is a characterization test, not a red-green step: it passes before the extraction and has to
// keep passing after it.
describe("exported chronicle is byte-stable across the shared-assembler move", () => {
  const fold = (h: number, v: number) => (Math.imul(h ^ v, 16777619) >>> 0);
  const fnv = (s: string) => { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) h = fold(h, s.charCodeAt(i)); return h >>> 0; };
  // The chronicle section only: the rest of the document is not what this move touches, and pinning
  // it too would make every unrelated wording change fail here.
  const chronicleOf = (md: string, marker: string) => {
    const i = md.indexOf(marker);
    return i < 0 ? "" : md.slice(i);
  };
  // Every re-pin below is deliberate, and each one names what it was allowed to move. The rule
  // this lock exists to enforce: a change may only shift what it claims to shift.
  //   1. The year-zero century standing was dropped (it repeated the founding line a sentence
  //      later). Exactly one line left each seed: 122/120/96 to 121/119/95.
  //   2. "2th of Syalyear" became "2nd". ENGLISH hashes only — the counts held and so did the
  //      Korean, which writes `2대` and never had the bug.
  //   3. The chronicle gained the world's natural history (plague, fire, flood, winter, famine),
  //      and then those lines were fixed to stop striking one town twice and to stop letting the
  //      commonest kind take the world. Added lines only, 4-7 a seed: 121/119/95 to 128/123/99.
  //      The simulation's own `events` anchor in history.test.ts did not move through ANY of this,
  //      which is what proves a chronicle grew and a world did not.
  const pins: Record<number, { en: number; ko: number; lines: number }> = {
    1: { en: 1628513111, ko: 3818046477, lines: 128 },
    2: { en: 3362919798, ko: 1241450364, lines: 123 },
    3: { en: 1663392122, ko: 2554326478, lines:  99 },
  };
  for (const seed of [1, 2, 3]) {
    it(`reproduces the pinned chronicle for seed ${seed}`, () => {
      const { world: w } = generateWorld({ ...DEFAULT_PARAMS, seed });
      const h = simulateHistory(w, seed);
      const en = chronicleOf(worldToGazetteer(w, h, "en"), "## Chronicle");
      const ko = chronicleOf(worldToGazetteer(w, h, "ko"), "## 연대기");
      expect(en.split("\n").filter((l) => l.startsWith("- ")).length).toBe(pins[seed].lines);
      expect(fnv(en)).toBe(pins[seed].en);
      expect(fnv(ko)).toBe(pins[seed].ko);
    });
  }
});
