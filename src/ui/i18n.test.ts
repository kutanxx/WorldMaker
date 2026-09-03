import { describe, it, expect } from "vitest";
import { t, WARD_NAME, biomeName } from "./i18n";
import { TEMPERATE_FOREST } from "../engine/biome";

describe("i18n", () => {
  it("localises UI strings for both languages", () => {
    expect(t("en", "generate")).toBe("Generate");
    expect(t("ko", "generate")).toBe("생성");
    expect(t("en", "compassN")).toBe("N");
    expect(t("ko", "compassN")).toBe("북");
  });
  it("falls back to the key for an unknown string", () => {
    expect(t("ko", "nope")).toBe("nope");
  });
  it("names every district in both languages (resolves plaza vs market)", () => {
    for (const wt of ["plaza", "market", "guildhall", "cathedral", "castle", "merchant", "patriciate", "craftsmen", "slum", "military", "park", "harbor"] as const) {
      expect(WARD_NAME.en[wt]).toBeTruthy();
      expect(WARD_NAME.ko[wt]).toBeTruthy();
    }
    expect(WARD_NAME.en.plaza).toBe("Market Square"); // the open square
    expect(WARD_NAME.en.market).toBe("Market");       // the commercial stalls (distinct)
  });
  it("localises biome names", () => {
    expect(biomeName("en", TEMPERATE_FOREST)).toBe("Forest");
    expect(biomeName("ko", TEMPERATE_FOREST)).toBe("숲");
  });
});
