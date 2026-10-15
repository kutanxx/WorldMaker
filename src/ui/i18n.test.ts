import { describe, it, expect } from "vitest";
import { t, WARD_NAME, wardName, biomeName, featureName } from "./i18n";
import { TEMPERATE_FOREST } from "../engine/biome";
import { TABLE } from "../engine/city/archetypes";

const WARD_TYPES = ["plaza", "market", "guildhall", "cathedral", "castle", "merchant", "patriciate", "craftsmen", "slum", "military", "park", "harbor"] as const;

describe("i18n", () => {
  it("localises UI strings for both languages", () => {
    // the seed box's button opens the world of that number ("생성" beside "새 세계" read as a second way to
    // make a world — plainWords.test)
    expect(t("en", "generate")).toBe("Open");
    expect(t("ko", "generate")).toBe("열기");
    expect(t("en", "compassN")).toBe("N");
    expect(t("ko", "compassN")).toBe("북");
  });
  it("falls back to the key for an unknown string", () => {
    expect(t("ko", "nope")).toBe("nope");
  });
  it("names every district in both languages (resolves plaza vs market)", () => {
    for (const wt of WARD_TYPES) {
      expect(WARD_NAME.en[wt]).toBeTruthy();
      expect(WARD_NAME.ko[wt]).toBeTruthy();
    }
    expect(WARD_NAME.en.plaza).toBe("Market Square"); // the open square
    expect(WARD_NAME.en.market).toBe("Market");       // the commercial stalls (distinct)
  });
  // A hamlet (city.ts HAMLET_SIZE) has a green and houses, and its plate said "Market Square" and "Craftsmen"
  // of them — a city's quarters, on a plan of 150–400 people (plate review, 2026-10-15).
  it("calls a hamlet's quarters a green and houses, and a town's what they were", () => {
    expect(wardName("en", "plaza", true)).toBe("Village Green");
    expect(wardName("ko", "plaza", true)).toBe("마을 광장");
    expect(wardName("en", "craftsmen", true)).toBe("Houses");
    expect(wardName("ko", "craftsmen", true)).toBe("집");
    for (const lang of ["en", "ko"] as const) {
      // the rest of a hamlet's quarters keep their names...
      for (const wt of ["park", "harbor"] as const) expect(wardName(lang, wt, true)).toBe(WARD_NAME[lang][wt]);
      // ...and a town's are untouched, every one
      for (const wt of WARD_TYPES) expect(wardName(lang, wt), `${lang} ${wt}`).toBe(WARD_NAME[lang][wt]);
    }
  });
  it("describes a hamlet of every kind as a hamlet, in both languages, and a town as it did", () => {
    for (const id of Object.keys(TABLE)) {
      const en = t("en", `hamletKind_${id}`), ko = t("ko", `hamletKind_${id}`);
      expect(en, id).not.toMatch(/^hamletKind_/);     // an untranslated key
      expect(ko, id).not.toMatch(/^hamletKind_/);
      expect(en, `${id}: ${en}`).toMatch(/hamlet/);
      expect(en, `${id}: ${en}`).not.toMatch(/town|city|fortress|market/i);
      expect(ko, `${id}: ${ko}`).toMatch(/마을|어촌/);
      expect(ko, `${id}: ${ko}`).not.toMatch(/도시|요새|장터/);
      expect(t("en", `kind_${id}`), id).not.toMatch(/hamlet/);
      expect(t("ko", `kind_${id}`), id).not.toMatch(/마을|어촌/);
    }
  });
  // ...and a village (size 2, palisaded — village.test.ts) as a village, with its fence named
  it("describes a village of every kind as a village, in both languages, and names its palisade", () => {
    for (const id of Object.keys(TABLE)) {
      const en = t("en", `villageKind_${id}`), ko = t("ko", `villageKind_${id}`);
      expect(en, id).not.toMatch(/^villageKind_/);
      expect(ko, id).not.toMatch(/^villageKind_/);
      expect(en, `${id}: ${en}`).toMatch(/village/);
      expect(en, `${id}: ${en}`).not.toMatch(/town|city|market|hamlet/i);
      expect(ko, `${id}: ${ko}`).toMatch(/마을|어촌/);
      expect(ko, `${id}: ${ko}`).not.toMatch(/도시|장터/);
    }
    expect(featureName("en", "palisade" as never)).toBe("Palisade");
    expect(featureName("ko", "palisade" as never)).toBe("목책");
  });
  it("localises biome names", () => {
    expect(biomeName("en", TEMPERATE_FOREST)).toBe("Forest");
    expect(biomeName("ko", TEMPERATE_FOREST)).toBe("숲");
  });
});
