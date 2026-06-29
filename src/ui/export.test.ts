// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";
import { generateWorld } from "../engine/world";
import { worldToJSON } from "./export";

describe("export", () => {
  it("serializes a world to parseable JSON", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, cellCount: 200, width: 200, height: 200 });
    const parsed = JSON.parse(worldToJSON(world));
    expect(parsed.params.seed).toBe(DEFAULT_PARAMS.seed);
    expect(parsed.cities.length).toBe(world.cities.length);
  });
});
