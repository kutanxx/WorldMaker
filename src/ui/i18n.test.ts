import { describe, it, expect } from "vitest";
import { t, WARD_NAME, biomeName, playDelta, playDefeatCause } from "./i18n";
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

describe("play delta + defeat cause", () => {
  it("formats gains and losses, both languages", () => {
    expect(playDelta("en", 180, 8, 114)).toBe("Year 180: +8 −114 tiles");
    expect(playDelta("ko", 180, 8, 114)).toBe("180년: +8 −114 칸");
  });
  it("omits a zero side and marks a still decade", () => {
    expect(playDelta("en", 50, 3, 0)).toBe("Year 50: +3 tiles");
    expect(playDelta("en", 50, 0, 0)).toBe("Year 50: no change");
    expect(playDelta("ko", 50, 0, 0)).toBe("50년: 변동 없음");
  });
  it("formats the defeat cause", () => {
    expect(playDefeatCause("en", "Skarnhrok")).toBe("Conquered by Skarnhrok.");
    expect(playDefeatCause("ko", "Skarnhrok")).toBe("Skarnhrok에게 정복당함.");
  });
});
