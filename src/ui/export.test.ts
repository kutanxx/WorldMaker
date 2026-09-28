// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";
import { generateWorld } from "../engine/world";
import { worldToJSON, svgToPngBlob } from "./export";
import { simulateHistory } from "../engine/history";

// A file for print is a number of pixels chosen for the page — 3000 across is ten inches at 300dpi.
// The PNG was drawn at that size TIMES the screen's pixel ratio, so the same map came out 3000px wide on
// one computer and 4500 on a laptop at 150%: a file whose size depended on who pressed the button.
describe("a PNG is the size it is asked for", () => {
  it("draws exactly the pixels asked for, whatever the screen's pixel ratio", async () => {
    // jsdom has no canvas and loads no images: stand-ins for those two, the rest is the real function
    const drawnAt: [number, number][] = [];
    const saved = {
      image: globalThis.Image, getContext: HTMLCanvasElement.prototype.getContext, toBlob: HTMLCanvasElement.prototype.toBlob,
      url: URL.createObjectURL, revoke: URL.revokeObjectURL, dpr: Object.getOwnPropertyDescriptor(window, "devicePixelRatio"),
    };
    class Loaded { onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(_: string) { setTimeout(() => this.onload?.(), 0); } }
    globalThis.Image = Loaded as unknown as typeof Image;
    HTMLCanvasElement.prototype.getContext = (() => ({ scale() {}, drawImage() {} })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.toBlob = function (this: HTMLCanvasElement, cb: BlobCallback) { drawnAt.push([this.width, this.height]); cb(new Blob()); };
    URL.createObjectURL = (() => "blob:svg") as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
    Object.defineProperty(window, "devicePixelRatio", { value: 1.5, configurable: true });
    try {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
      await svgToPngBlob(svg, 3000, 2100);
      expect(drawnAt).toEqual([[3000, 2100]]);
    } finally {
      globalThis.Image = saved.image;
      HTMLCanvasElement.prototype.getContext = saved.getContext;
      HTMLCanvasElement.prototype.toBlob = saved.toBlob;
      URL.createObjectURL = saved.url; URL.revokeObjectURL = saved.revoke;
      if (saved.dpr) Object.defineProperty(window, "devicePixelRatio", saved.dpr);
      else delete (window as unknown as Record<string, unknown>).devicePixelRatio;
    }
  });
});

describe("export", () => {
  it("serializes a world to parseable JSON", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, cellCount: 200, width: 200, height: 200 });
    const parsed = JSON.parse(worldToJSON(world));
    expect(parsed.params.seed).toBe(DEFAULT_PARAMS.seed);
    expect(parsed.cities.length).toBe(world.cities.length);
  });
});

// The JSON was the world and nothing else: 1.45 MB of geography, cultures, provinces, rivers and
// the EIGHT realms of year zero, with no snapshots, no events, no rulers. Someone taking their
// world into their own tool lost five centuries without being told. The map export carries the
// scrubbed year and the gazetteer carries the whole chronicle; this is the machine-readable one and
// it has to carry the same history, or the three exports tell three different stories.
describe("the JSON carries the history, not just the world", () => {
  const build = (seed = 2) => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
    return { world, history: simulateHistory(world, seed) };
  };

  it("still serializes a bare world when no history is handed to it", () => {
    const { world } = build();
    const parsed = JSON.parse(worldToJSON(world));
    expect(parsed.cities.length).toBe(world.cities.length);
    expect(parsed.history).toBeUndefined();
  });

  it("carries every realm that ever stood, not the eight it began with", () => {
    const { world, history } = build();
    const parsed = JSON.parse(worldToJSON(world, history));
    expect(parsed.polities.length).toBe(8);                       // year zero, as the world knows it
    expect(parsed.history.polities.length).toBe(history.polities.length);
    expect(parsed.history.polities.length).toBeGreaterThan(8);
  });

  it("carries the territory of every recorded year, in full", () => {
    const { world, history } = build();
    const parsed = JSON.parse(worldToJSON(world, history));
    expect(parsed.history.snapshots.length).toBe(history.snapshots.length);
    const last = parsed.history.snapshots[parsed.history.snapshots.length - 1];
    expect(last.year).toBe(history.years);
    expect(last.owner.length).toBe(world.grid.count);
    // a consumer can rebuild the political map of any year from this alone
    expect(last.owner).toEqual([...history.snapshots[history.snapshots.length - 1].owner]);
  });

  it("carries the events, the free ports, the town foundings and the rulers", () => {
    const { world, history } = build();
    const parsed = JSON.parse(worldToJSON(world, history));
    expect(parsed.history.events.length).toBe(history.events.length);
    expect(parsed.history.economicZones.length).toBe(history.economicZones.length);
    expect(parsed.history.cityFoundings.length).toBe(history.cityFoundings.length);
    const reigns = parsed.history.dynasties;
    expect(Object.keys(reigns).length).toBe(history.polities.length);
    expect(reigns["0"][0]).toMatchObject({ name: expect.any(String), from: expect.any(Number), to: expect.any(Number) });
  });

  // The chronicle panel and the gazetteer both tell the world's natural history; a JSON that left it
  // out would be the third export telling a different story from the other two.
  it("carries the natural history, as data rather than as a sentence", () => {
    const { world, history } = build();
    const parsed = JSON.parse(worldToJSON(world, history));
    expect(parsed.history.naturalHistory.length).toBeGreaterThan(2);
    for (const e of parsed.history.naturalHistory) {
      expect(typeof e.year).toBe("number");
      expect(["plague", "fire", "flood", "winter", "famine"]).toContain(e.kind);
      expect(e.text, "a language-free export carries no rendered sentence").toBeUndefined();
    }
  });
});
