import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { simulateHistory } from "./history";
import { classifyGovernments } from "./government";

const worldOf = (seed: number) => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
  return { world, history: simulateHistory(world, seed) };
};

describe("forms of government", () => {
  const { world, history } = worldOf(1);
  const forms = classifyGovernments(world, history);

  it("gives every realm the world ever had exactly one form", () => {
    expect(forms.size).toBe(history.polities.length);
    for (const p of history.polities) {
      expect(["kingdom", "republic", "empire"]).toContain(forms.get(p.id)!.form);
    }
  });

  it("calls a realm that declared itself free a republic", () => {
    const free = history.polities.filter((p) => p.free);
    expect(free.length).toBeGreaterThan(0);           // or the claim is untested on this seed
    for (const p of free) expect(forms.get(p.id)!.form).toBe("republic");
  });

  it("dates an empire: the year it came to hold a second people, within its own life", () => {
    const empires = history.polities.filter((p) => forms.get(p.id)!.form === "empire");
    expect(empires.length).toBeGreaterThan(0);
    for (const p of empires) {
      const since = forms.get(p.id)!.since;
      expect(since).not.toBeNull();
      expect(since!).toBeGreaterThanOrEqual(p.foundedYear);
      expect(since!).toBeLessThanOrEqual(p.endedYear ?? history.years);
    }
  });

  it("dates nothing else — only an empire has a year it became one", () => {
    for (const p of history.polities) {
      if (forms.get(p.id)!.form === "empire") continue;
      expect(forms.get(p.id)!.since).toBeNull();
    }
  });

  it("does not crown a border accident: two peoples brushed by a small realm is not an empire", () => {
    // Seed 4's Narlyan touched two other peoples' land and held 87 tiles for forty years. Without a
    // floor under the size, the word "empire" would sit on that as readily as on the realm that
    // held a thousand tiles for five centuries, and stop meaning anything.
    const s4 = worldOf(4);
    const f4 = classifyGovernments(s4.world, s4.history);
    const narlyan = s4.history.polities.find((p) => p.name === "Narlyan");
    expect(narlyan).toBeDefined();
    expect(f4.get(narlyan!.id)!.form).toBe("kingdom");
  });

  it("keeps all three forms populated across five worlds — none of them a curiosity", () => {
    // The whole point of the feature is that the gazetteer stops reading as one realm repeated. If
    // any form is empty or nearly so, it has not earned the code.
    const tally = { kingdom: 0, republic: 0, empire: 0 };
    let total = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const { world: w, history: h } = worldOf(seed);
      for (const [, f] of classifyGovernments(w, h)) { tally[f.form]++; total++; }
    }
    expect(tally.republic / total).toBeGreaterThan(0.05);
    expect(tally.empire / total).toBeGreaterThan(0.05);
    expect(tally.kingdom / total).toBeGreaterThan(0.5);
  });
});
