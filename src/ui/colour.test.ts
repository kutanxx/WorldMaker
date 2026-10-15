import { describe, it, expect } from "vitest";
import { hexToRgb, rgbToHex, over, lighter } from "./colour";

describe("colour arithmetic", () => {
  it("reads and writes hex", () => {
    expect(hexToRgb("#d6cf9b")).toEqual([214, 207, 155]);
    expect(rgbToHex(214, 207, 155)).toBe("#d6cf9b");
    expect(rgbToHex(255.4, -3, 0.5), "rounded and clamped").toBe("#ff0001");
  });
  it("lays one colour over another as the browser composites a translucent fill", () => {
    expect(over("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(over("#d6cf9b", "#f3ead2", 0.6), "grassland at the overlay views' 0.6 over the parchment").toBe("#e2dab1");
    expect(over("#3f6f8f", "#e2dab1", 0.58), "a realm's blue at 0.58 over that ground").toBe("#839c9d");
    expect(over("#b5432f", "#ffffff", 1)).toBe("#b5432f");
    expect(over("#b5432f", "#ffffff", 0)).toBe("#ffffff");
  });
  it("lightens toward white by a share of the way", () => {
    expect(lighter("#b5432f", 0)).toBe("#b5432f");
    expect(lighter("#000000", 0.5)).toBe("#808080");
    expect(lighter("#b5432f", 1)).toBe("#ffffff");
  });
});
