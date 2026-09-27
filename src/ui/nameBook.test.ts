import { describe, it, expect } from "vitest";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { simulateHistory } from "../engine/history";
import { toHangul, properNoun, ownName, plainName, OWN_MARK } from "../engine/hangul";
import { featureLabel } from "../engine/featureLabel";
import { realmLabelKo, realmLabelEn, peopleLabelKo } from "../engine/nameSuffix";
import { polityLabeller } from "./properName";
import { encodeNames, decodeNames, generatedNames, applyNames, NAME_MAX, type NameBook } from "./nameBook";

// A reader's name is shown as it was typed, in both languages. The Korean page writes a generated
// name through a closed token alphabet, and typed Latin comes out of it broken: measured,
// "Winterfell" -> "w인테르펠르", "Quixby" -> "q우이x비". So a reader's name carries a mark the
// transliteration passes through, and the English helpers take off.
describe("a name the reader gave", () => {
  it("is written as typed, in both languages", () => {
    expect(toHangul("Winterfell")).not.toBe("Winterfell");   // (the reason for all this)
    for (const typed of ["Winterfell", "아르델", "Minas Tirith"]) {
      const mine = ownName(typed);
      expect(properNoun(true, mine)).toBe(typed);
      expect(properNoun(false, mine)).toBe(typed);
      expect(toHangul(mine)).toBe(typed);
      expect(plainName(mine)).toBe(typed);
    }
    expect(plainName("Kaag")).toBe("Kaag");
  });

  it("keeps a realm's form word and a people's 인, without the mark", () => {
    expect(realmLabelKo(ownName("아르델"), "kingdom")).toBe("아르델 왕국");
    expect(realmLabelEn(ownName("Ardel"), "empire")).toBe("Ardel Empire");
    expect(peopleLabelKo(ownName("하나"))).toBe("하나인");
    expect(polityLabeller("en")(0, ownName("Ardel"))).toBe("Ardel");
  });

  it("stands in for a place's whole name, parts and all", () => {
    const label = { pattern: "adj" as const, kind: 0, adj: "Blue", noun: "Deep" };
    expect(featureLabel({ ...label, custom: "은빛 바다" }, "ko")).toBe("은빛 바다");
    expect(featureLabel({ ...label, custom: "은빛 바다" }, "en")).toBe("은빛 바다");
    expect(featureLabel(label, "en")).toBe("the Blue Deep");
  });
});

// The names ride in the address, beside the world: the link is the save.
describe("the names in the address", () => {
  it("come back as they went, in any script", () => {
    const book: NameBook = { w: "새누리", t1: "Winterfell", r3: "아르델", g0: "은빛 바다 — Silver Sea", c2: "하나 🌙" };
    const code = encodeNames(book);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);   // nothing a hash would have to escape
    expect(decodeNames(code)).toEqual(book);
    expect(encodeNames({})).toBe("");
  });

  it("read nothing from what is not theirs, and hold a name to its length", () => {
    expect(decodeNames("")).toEqual({});
    expect(decodeNames("not base64 at all !!")).toEqual({});
    expect(decodeNames(encodeNames({ t1: "x".repeat(NAME_MAX + 20), bogus: "y", "t-2": "z" } as NameBook))).toEqual({ t1: "x".repeat(NAME_MAX) });
  });
});

// Written into the world and its record, so every place that draws a name draws the reader's —
// and taken out again the same way, to the byte.
describe("naming the world's places", () => {
  const params = { ...DEFAULT_PARAMS, seed: 1 };
  const world = generateWorld(params).world;
  const history = simulateHistory(world, 1);
  const before = JSON.stringify({ world, h: { polities: history.polities, events: history.events, economicZones: history.economicZones } });
  const generated = generatedNames(world, history);
  const port = history.economicZones.length ? world.cities.findIndex((c) => c.cell === history.economicZones[0].cell) : -1;
  const founded = history.events.find((e) => e.type === "newCity");
  const foundedTown = founded ? world.cities.findIndex((c) => c.cell === founded.cell) : -1;
  const book: NameBook = { w: "새누리", t1: "아르델", r0: "마바사", c0: "하나", g0: "은빛 바다", v0: "은하강", p0: "첫 영토" };
  if (port >= 0) book[`t${port}`] = "자유항";
  if (foundedTown >= 0) book[`t${foundedTown}`] = "새 마을";

  it("gives each place the reader's name, and what is named after a town follows it", () => {
    applyNames(world, history, generated, book);
    expect(world.name).toBe("새누리");
    expect(world.cities[1].name).toBe(ownName("아르델"));
    expect(world.polities.find((p) => p.id === 0)?.name).toBe(ownName("마바사"));
    expect(history.polities[0].name).toBe(ownName("마바사"));
    expect(world.cultures[0].name).toBe(ownName("하나"));
    expect([world.regions[0].label.custom, world.regions[0].name]).toEqual(["은빛 바다", "은빛 바다"]);
    expect([world.rivers[0].label.custom, world.rivers[0].name]).toEqual(["은하강", "은하강"]);
    expect([world.provinces[0].label.custom, world.provinces[0].name]).toEqual(["첫 영토", "첫 영토"]);
    expect(port, "world 1 has no free port to test").toBeGreaterThanOrEqual(0);
    expect(history.economicZones[0].name).toBe(ownName("자유항"));
    expect(foundedTown, "world 1 founds no town on the map").toBeGreaterThanOrEqual(0);
    expect(founded!.name).toBe(ownName("새 마을"));
  });

  it("gives every name back, to the byte, when the book is empty again", () => {
    applyNames(world, history, generated, {});
    expect(JSON.stringify({ world, h: { polities: history.polities, events: history.events, economicZones: history.economicZones } })).toBe(before);
    expect(OWN_MARK.length).toBe(1);
  });
});
