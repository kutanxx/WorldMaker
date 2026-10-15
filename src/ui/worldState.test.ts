import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";
import { makeWorldState, setNames, sameWorld, worldHash, namesPart, unfoundedAt, townsIn, plateOf, cityOrder, fileStem } from "./worldState";
import { encodeParams, initialParams, initialNames } from "./urlState";
import { worldNameIn } from "../engine/featureLabel";
import { properName } from "./properName";

// The pieces of createApp that answer from the world alone, out of the closure where app.test could only
// reach them through the DOM (design review 2026-10-15: app.ts 1,760 lines, 74 inner functions).
describe("the world's state", () => {
  const ws = makeWorldState({ ...DEFAULT_PARAMS, seed: 1 }, null, {});

  it("is the same world the app showed: world 1, its record, one colouring", () => {
    expect(worldNameIn(ws.generated.world, "ko")).toBe("소덴드");
    expect(ws.history.snapshots.length).toBeGreaterThan(10);
    expect(ws.colorOf(0)).toMatch(/^#[0-9a-f]{6}$/);
    expect(ws.freeRealms.size, "world 1 has free cities").toBeGreaterThan(0);
  });

  it("keeps the world's name in its address only while the name still describes the whole world", () => {
    const named = makeWorldState({ ...DEFAULT_PARAMS, seed: 1 }, "Avalon", {});
    expect(worldHash(named)).toBe("seed=Avalon");
    const tuned = makeWorldState({ ...DEFAULT_PARAMS, seed: 1, seaLevel: 0.4 }, "Avalon", {});
    expect(worldHash(tuned)).toBe(encodeParams(tuned.params).slice(1));
    expect(worldHash(ws)).toBe(encodeParams(ws.params).slice(1));
    expect(sameWorld(initialParams("#" + worldHash(ws)), ws.params)).toBe(true);
  });

  it("writes the reader's names into the world and after the address, and reads them back", () => {
    const s = makeWorldState({ ...DEFAULT_PARAMS, seed: 1 }, null, {});
    expect(namesPart(s)).toBe("");
    setNames(s, { w: "아발론" });
    expect(worldNameIn(s.generated.world, "ko")).toBe("아발론");
    expect(namesPart(s)).toMatch(/^&names=/);
    expect(initialNames("#" + worldHash(s) + namesPart(s))).toEqual({ w: "아발론" });
  });

  it("knows which towns are not founded yet, none by the chronicle's end", () => {
    const first = unfoundedAt(ws, 0), last = unfoundedAt(ws, ws.history.snapshots.length - 1);
    expect(first.size).toBeGreaterThan(0);
    expect(last.size).toBe(0);
    for (const c of ws.generated.world.cities) if (c.isCapital) expect(first.has(c.id), "a capital held back").toBe(false);
  });

  it("answers for a year: the seats standing then, and each town's realm in the reader's language", () => {
    const towns = townsIn(ws, 0, "ko");
    const capitals = ws.generated.world.cities.filter((c) => c.isCapital);
    expect(capitals.every((c) => towns.at(c).seat)).toBe(true);
    expect(towns.at(capitals[0]).realm).toMatch(/[가-힣]/);
  });

  it("lays a plate out under the town's born name and titles it with the reader's", () => {
    const s = makeWorldState({ ...DEFAULT_PARAMS, seed: 1 }, null, {});
    const town = s.generated.world.cities[0];
    const before = plateOf(s, town);
    setNames(s, { t0: "Winterfell" });
    const after = plateOf(s, s.generated.world.cities[0]);
    expect(properName("en", after.name), "the title is the reader's (under its mark, which the name helpers take off)").toBe("Winterfell");
    expect(JSON.stringify({ ...after, name: "" })).toBe(JSON.stringify({ ...before, name: "" }));
  });

  it("orders capitals first, then by size, then by the name as it is read", () => {
    const seat = (id: number) => id === 2;
    const a = { id: 1, size: 5, name: "Zed" }, b = { id: 2, size: 1, name: "Aa" }, c = { id: 3, size: 5, name: "Bee" };
    const sorted = [a, b, c].sort((x, y) => cityOrder("en", x as never, y as never, seat)).map((m) => m.id);
    expect(sorted).toEqual([2, 3, 1]);
  });

  it("names a file from the world's name and what tells it from the world's other files", () => {
    expect(fileStem(["소덴드", false, "정치", null, "350년"])).toBe("소덴드_정치_350년");
    expect(fileStem([" a b ", "c/d"])).toBe("a_b_c_d");
    expect(fileStem([])).toBe("world");
  });
});
