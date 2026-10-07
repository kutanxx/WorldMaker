import { describe, it, expect } from "vitest";
import { readRecent, rememberWorld, forgetWorld, clearRecent, whenSaid, RECENT_KEEP, type RecentWorld } from "./recentWorlds";

// A world and the names a reader gave it live in its link and nowhere else: renamed, then closed without the
// link copied, the names were gone (audit, 2026-10-08). The research behind this list: browser storage is a
// safety net, not the save, and says so (Azgaar, Excalidraw); one line per world, never one slot overwritten
// (Excalidraw's and Azgaar's worst losses); a short list, newest first, each line removable (VS Code).
const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, raw: m };
};
const world = (key: string, at: number, count = 2): RecentWorld =>
  ({ key, url: `map.html#${key}&names=abc`, name: `World ${key}`, count, at });

describe("the worlds a reader named", () => {
  it("are kept newest first, one line to a world", () => {
    const s = store();
    rememberWorld(world("a", 1), s);
    rememberWorld(world("b", 2), s);
    rememberWorld({ ...world("a", 3), count: 5 }, s);
    expect(readRecent(s).map((w) => [w.key, w.count])).toEqual([["a", 5], ["b", 2]]);
  });

  it(`keeps the ${RECENT_KEEP} newest`, () => {
    const s = store();
    for (let i = 0; i < RECENT_KEEP + 3; i++) rememberWorld(world(`w${i}`, i), s);
    const kept = readRecent(s);
    expect(kept.length).toBe(RECENT_KEEP);
    expect(kept[0].key).toBe(`w${RECENT_KEEP + 2}`);
    expect(kept.some((w) => w.key === "w0")).toBe(false);
  });

  it("lets a world whose names were all given back leave the list", () => {
    const s = store();
    rememberWorld(world("a", 1), s);
    rememberWorld({ ...world("a", 2), count: 0 }, s);
    expect(readRecent(s)).toEqual([]);
  });

  it("forgets one world, or all of them, when asked", () => {
    const s = store();
    rememberWorld(world("a", 1), s);
    rememberWorld(world("b", 2), s);
    forgetWorld("a", s);
    expect(readRecent(s).map((w) => w.key)).toEqual(["b"]);
    clearRecent(s);
    expect(readRecent(s)).toEqual([]);
  });

  it("reads nothing it did not write: a broken value, a stranger's shape, a link that is not a world's", () => {
    const s = store();
    for (const bad of ["{", "\"x\"", "[1,2]", JSON.stringify([{ key: "a", url: "javascript:alert(1)", name: "x", count: 1, at: 1 }]),
      JSON.stringify([{ key: "a", url: "https://elsewhere.example/map.html#a", name: "x", count: 1, at: 1 }])]) {
      s.setItem("wm:recent:v1", bad);
      expect(readRecent(s), bad).toEqual([]);
    }
  });

  it("does without a storage that throws (a private window, blocked site data)", () => {
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(() => rememberWorld(world("a", 1), broken)).not.toThrow();
    expect(readRecent(broken)).toEqual([]);
  });
});

describe("when a world was named, said the way a reader says it", () => {
  const day = 86_400_000;
  const now = new Date("2026-10-08T15:00:00+09:00").getTime();
  it("in Korean", () => {
    expect(whenSaid(now - 3_600_000, now, "ko")).toBe("오늘");
    expect(whenSaid(now - day, now, "ko")).toBe("어제");
    expect(whenSaid(now - 3 * day, now, "ko")).toBe("3일 전");
  });
  it("in English", () => {
    expect(whenSaid(now - 3_600_000, now, "en")).toBe("today");
    expect(whenSaid(now - day, now, "en")).toBe("yesterday");
    expect(whenSaid(now - 3 * day, now, "en")).toBe("3 days ago");
  });
});
