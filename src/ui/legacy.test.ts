import { describe, it, expect } from "vitest";
import { loadLegacy, recordReign, seedBestPeak, composeEpitaph, LEGACY_CAP, type LegacyEntry } from "./legacy";

function memStorage(): Pick<Storage, "getItem" | "setItem"> & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); } };
}
const entry = (over: Partial<Omit<LegacyEntry, "v" | "n">> = {}): Omit<LegacyEntry, "v" | "n"> => ({
  nation: "Glounman", kind: "endurance", cause: "", year: 500, peakCells: 300, citiesFounded: 2,
  epitaph: { code: "epiEndured", data: {} }, ...over,
});

describe("legacy storage", () => {
  it("roundtrips, numbers reigns, and counts past the cap", () => {
    const st = memStorage();
    for (let i = 0; i < LEGACY_CAP + 3; i++) recordReign(7, entry({ peakCells: i }), st);
    const got = loadLegacy(7, st);
    expect(got.length).toBe(LEGACY_CAP);          // capped rows
    expect(got[0].n).toBe(LEGACY_CAP + 3);        // counter survives the cap
    expect(got[0].peakCells).toBe(LEGACY_CAP + 2); // newest first
  });
  it("never throws: corrupt JSON reads [], quota-throwing writes are swallowed", () => {
    const st = memStorage();
    st.map.set("wm:legacy:7", "{not json");
    expect(loadLegacy(7, st)).toEqual([]);
    const boom: Pick<Storage, "getItem" | "setItem"> = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(() => recordReign(7, entry(), boom)).not.toThrow();
    expect(loadLegacy(7, null)).toEqual([]);       // no storage at all
  });
  it("seedBestPeak finds the record", () => {
    const st = memStorage();
    recordReign(7, entry({ peakCells: 100 }), st);
    recordReign(7, entry({ peakCells: 400 }), st);
    recordReign(7, entry({ peakCells: 250 }), st);
    expect(seedBestPeak(loadLegacy(7, st))).toBe(400);
  });
});

describe("composeEpitaph priority", () => {
  const hl = (code: string, name = "Nianthael") => ({ code, data: { name } });
  it("how it ended beats how it was lived", () => {
    expect(composeEpitaph("defeat", "Nianthael", [hl("hegemonVictory")]).code).toBe("epiFallen");
    expect(composeEpitaph("conquest", "", [hl("hegemonVictory")]).code).toBe("epiUnified");
  });
  it("hegemon victory > survived shadow > prophecy > golden age > endured", () => {
    expect(composeEpitaph("endurance", "", [hl("hegemonVictory")])).toEqual({ code: "epiSlewHegemon", data: { name: "Nianthael" } });
    expect(composeEpitaph("endurance", "", [hl("hegemonTribute")]).code).toBe("epiSurvivedShadow");
    expect(composeEpitaph("endurance", "", [{ code: "prophecyFulfilled", data: {} }]).code).toBe("epiProphecy");
    expect(composeEpitaph("prosperity", "", []).code).toBe("epiGoldenAge");
    expect(composeEpitaph("endurance", "", []).code).toBe("epiEndured");
  });
});
