// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { renderWorld } from "./svgWorldRenderer";
import { politicalBorders } from "../engine/borders";
import { segPath } from "./svgPaths";
import { snapOwnersToProvinces } from "./provinceLayer";

describe("renderWorld biomes", () => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
  const svg = renderWorld(world);
  it("renders a province view: province layer, no nation labels, biomes muted", () => {
    const pv = renderWorld(world, "province");
    expect(pv.querySelectorAll(".political-slot .province").length).toBe(1);
    expect(pv.querySelectorAll(".province .province-border").length).toBe(1);
    expect(pv.querySelectorAll(".province .province-fill").length).toBeGreaterThan(1);
    expect(pv.querySelectorAll(".province .nation-border").length).toBe(1);      // bold country borders
    expect(pv.querySelectorAll(".province circle.province-seat").length).toBeGreaterThan(1); // a city per province
    expect(pv.querySelectorAll(".nation-labels").length).toBe(0);         // not the political view
    expect(pv.querySelector(".biomes")?.getAttribute("opacity")).toBe("0.6"); // muted like political/culture
  });
  it("fills cells by biome (several biome paths, no political region fills)", () => {
    expect(svg.querySelectorAll(".biomes path.biome").length).toBeGreaterThan(1);
    expect(svg.querySelectorAll(".regions").length).toBe(0);
    expect(svg.querySelectorAll(".mountains").length).toBe(0);
  });
  it("terrain view (default): borders only, no territory fills, biome legend shown", () => {
    expect(svg.getAttribute("class")).toContain("view-terrain");
    expect(svg.querySelectorAll("path.coastline").length).toBe(1);
    expect(svg.querySelectorAll(".political-slot").length).toBe(1);
    expect(svg.querySelectorAll(".political-slot .territory").length).toBe(0);
    expect(svg.querySelectorAll("path.border").length).toBe(1);
    expect(svg.querySelectorAll(".biome-legend .legend-item").length).toBeGreaterThan(0);
  });
  it("keeps a clickable marker per city (capitals as stars, towns as dots)", () => {
    expect(svg.querySelectorAll(".markers [data-city]").length).toBe(world.cities.length);
    const capitals = world.cities.filter((c) => c.isCapital).length;
    expect(svg.querySelectorAll(".marker-capital").length).toBe(capitals);
    expect(svg.querySelectorAll(".marker-town").length).toBe(world.cities.length - capitals);
  });
  it("draws coastal waterlines under the biome fills (antique figure-ground)", () => {
    // stacked, fading blue bands, and they must render before the biomes so the land half is occluded
    const paths = svg.querySelectorAll(".waterlines path");
    expect(paths.length).toBeGreaterThanOrEqual(2);
    const kids = [...svg.children].map((c) => c.getAttribute("class"));
    expect(kids.indexOf("waterlines")).toBeLessThan(kids.indexOf("biomes"));
  });
  it("draws a decorative map frame and a compass rose (parchment theme)", () => {
    expect(svg.querySelectorAll(".map-frame").length).toBe(1);
    expect(svg.querySelectorAll(".compass").length).toBe(1);
    expect(svg.querySelector(".compass-n")?.textContent).toBe("N");
  });
  it("renders the world name as a title and geographic region labels (atlas depth)", () => {
    expect(svg.querySelector(".world-name-text")?.textContent).toBe(world.name);
    expect(svg.querySelectorAll(".region-labels .region-label").length).toBeGreaterThan(0);
    // geography names show in the political view too
    const pol = renderWorld(world, "political");
    expect(pol.querySelectorAll(".region-label").length).toBeGreaterThan(0);
    expect(pol.querySelector(".world-name-text")?.textContent).toBe(world.name);
  });
  it("draws an economic-zone marker per zone cell when given some", () => {
    const zones = [world.cities[0].cell, world.cities[1].cell];
    const withZones = renderWorld(world, "terrain", zones);
    expect(withZones.querySelectorAll(".econ-zones .econ-zone").length).toBe(2);
    // the gold badge must not intercept the city-marker click underneath it
    expect((withZones.querySelector(".econ-zones") as SVGElement).getAttribute("style")).toContain("pointer-events:none");
    expect(svg.querySelectorAll(".econ-zone").length).toBe(0); // none without zones
  });
});

describe("renderWorld political view", () => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
  const svg = renderWorld(world, "political");
  it("fills nations, labels them, and shows a nation legend", () => {
    expect(svg.getAttribute("class")).toContain("view-political");
    expect(svg.querySelectorAll(".political-slot .territory").length).toBeGreaterThan(1);
    expect(svg.querySelectorAll(".nation-label").length).toBeGreaterThan(0);
    expect(svg.querySelectorAll(".nation-legend").length).toBe(1);
  });
  it("is self-contained for export: biomes muted inline, no biome legend", () => {
    expect(svg.querySelector(".biomes")?.getAttribute("opacity")).toBe("0.6");
    expect(svg.querySelectorAll(".biome-legend").length).toBe(0);
  });
  it("snaps nation borders to province edges in political & terrain views (whole-province ownership)", () => {
    const snapped = snapOwnersToProvinces(world.grid.count, world.provinceOf, world.provinces, world.polityOf);
    const expected = segPath(politicalBorders(world.grid, snapped));
    const cellBased = segPath(politicalBorders(world.grid, world.polityOf));
    expect(expected).not.toBe(cellBased); // provinces straddle raw polity edges, so snapping actually moves the border
    for (const view of ["political", "terrain"] as const) {
      const d = renderWorld(world, view).querySelector("path.border")?.getAttribute("d");
      expect(d).toBe(expected);
    }
  });
});

describe("renderWorld culture view", () => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
  it("mounts a culture layer with fills + a culture legend (not the political layer)", () => {
    const svg = renderWorld(world, "culture");
    expect(svg.getAttribute("class")).toContain("view-culture");
    expect(svg.querySelectorAll(".culture .culture-area").length).toBeGreaterThan(1);
    expect(svg.querySelectorAll(".culture-legend .legend-item").length).toBeGreaterThan(0);
    expect(svg.querySelectorAll(".political-slot .territory").length).toBe(0);
    expect(svg.querySelector(".biomes")?.getAttribute("opacity")).toBe("0.6");
  });
});

describe("renderWorld rivers", () => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
  it("draws the river network and named river labels", () => {
    const svg = renderWorld(world);
    expect(svg.querySelectorAll(".rivers .river").length).toBeGreaterThan(0);
    expect(svg.querySelectorAll(".river-labels .river-label").length).toBeGreaterThan(0);
  });
  it("shows rivers in political and culture views too (geography is view-independent)", () => {
    for (const view of ["political", "culture"] as const) {
      const svg = renderWorld(world, view);
      expect(svg.querySelectorAll(".rivers .river").length).toBeGreaterThan(0);
    }
  });
  it("rotates river labels to follow the water's course", () => {
    const svg = renderWorld(world);
    const labels = [...svg.querySelectorAll(".river-labels .river-label")];
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) expect(l.getAttribute("transform")).toMatch(/^rotate\(/);
  });
});

describe("renderWorld label hierarchy (cartographic conventions)", () => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
  const svg = renderWorld(world);
  it("sets land-area labels upright + UPPERCASE, seas italic + blue", () => {
    const land = svg.querySelector(".region-land");
    expect(land).toBeTruthy();
    expect(land?.getAttribute("font-style")).toBe("normal");
    expect(land?.textContent).toBe(land?.textContent?.toUpperCase());
    const sea = svg.querySelector(".region-sea");
    if (sea) {
      expect(sea.getAttribute("font-style")).toBe("italic");
      expect(sea.getAttribute("fill")).toBe("#3f5d78");
    }
  });
  it("promotes capital labels (larger, bold) over towns (smaller, muted)", () => {
    const cap = svg.querySelector(".city-capital");
    const town = svg.querySelector(".city-town");
    expect(cap).toBeTruthy();
    expect(town).toBeTruthy();
    expect(Number(cap?.getAttribute("font-size"))).toBeGreaterThan(Number(town?.getAttribute("font-size")));
    expect(cap?.getAttribute("font-weight")).toBe("600");
    expect(town?.getAttribute("font-weight")).toBe("400");
  });
});

describe("renderWorld type hierarchy", () => {
  // Size is a map's first signal of what kind of thing a word names. The three classes used to
  // overlap — regions 9.4-16.0, cities 8.5-10.5, rivers 9.4-10.4 — so a word in the 9.4-10.5 band
  // gave the reader no way to tell a mountain range from a village. The bands are separated in the
  // order an atlas uses: the land's own features largest, settlements smallest, since a town's
  // prominence comes from its marker rather than from its type.
  const worlds = [1, 3, 7].map((seed) => renderWorld(generateWorld({ ...DEFAULT_PARAMS, seed }).world));
  const sizes = (svg: SVGSVGElement, sel: string) =>
    [...svg.querySelectorAll(sel)].map((e) => Number(e.getAttribute("font-size"))).filter(Number.isFinite);

  it("never lets a region name be set smaller than a settlement or a river name", () => {
    for (const svg of worlds) {
      const reg = sizes(svg, ".region-label"), city = sizes(svg, ".city-label"), riv = sizes(svg, ".river-label");
      expect(reg.length).toBeGreaterThan(0);
      expect(city.length).toBeGreaterThan(0);
      expect(Math.min(...reg)).toBeGreaterThan(Math.max(...city));
      if (riv.length) expect(Math.min(...reg)).toBeGreaterThan(Math.max(...riv));
    }
  });

  it("still scales a region's name with how much land it covers", () => {
    // A flat size would separate the bands too, and say nothing about the map. The largest region
    // must actually read larger than the smallest.
    for (const svg of worlds) {
      const reg = sizes(svg, ".region-label");
      expect(Math.max(...reg)).toBeGreaterThan(Math.min(...reg) + 2);
    }
  });

  it("keeps a capital's name larger than a town's", () => {
    for (const svg of worlds) {
      const cap = sizes(svg, ".city-capital"), town = sizes(svg, ".city-town");
      if (!cap.length || !town.length) continue;
      expect(Math.min(...cap)).toBeGreaterThan(Math.max(...town));
    }
  });
});

// The map is fitted to the page at roughly one user unit per CSS pixel, so a line drawn at 0.6
// units antialiases to a grey smear and the continent loses its silhouette. Cartographic practice
// asks for a spread of about 4:1 between the heaviest and lightest line, with the coast heaviest.
// Because zoom rewrites the viewBox, the weights only hold at every zoom if the strokes are pinned
// to the screen rather than to user space.
describe("renderWorld line weights (legible at the fitted view, stable under zoom)", () => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
  const svg = renderWorld(world);
  const w = (el: Element | null) => Number(el?.getAttribute("stroke-width"));
  const widths = (sel: string) => [...svg.querySelectorAll(sel)].map((e) => w(e));

  it("draws the coast as the heaviest line on the map", () => {
    const coast = w(svg.querySelector(".coastline"));
    expect(coast).toBeGreaterThanOrEqual(2);
    for (const sel of [".relief", ".river", ".nation-border"]) {
      for (const other of widths(sel)) expect(other).toBeLessThanOrEqual(coast);
    }
  });

  // Not a ratio band — a hand-tuned number would block a later legitimate retune. What matters is
  // that the three kinds of line are actually told apart, and that rivers keep their own three
  // tiers so a great river still outranks a stream.
  it("gives the coast, a great river and a border three distinct weights", () => {
    const coast = w(svg.querySelector(".coastline"));
    const river = Math.max(...widths(".river"));
    const border = Math.max(...widths(".nation-border"));
    expect(new Set([coast, river, border]).size).toBe(3);
    expect(new Set(widths(".river")).size).toBe(3);
  });

  it("leaves no line below one screen pixel at the fitted view", () => {
    for (const sel of [".coastline", ".river", ".nation-border"]) {
      for (const width of widths(sel)) expect(width).toBeGreaterThanOrEqual(0.9);
    }
  });

  // vector-effect is an ATTRIBUTE, not a stylesheet rule: the SVG and PNG exports carry no external
  // CSS, so a line pinned only in theme.css would come back hairline in an exported file.
  it("pins every map line to the screen so zooming does not fatten it", () => {
    for (const sel of [".coastline", ".relief", ".river"]) {
      const els = [...svg.querySelectorAll(sel)];
      expect(els.length).toBeGreaterThan(0);
      for (const el of els) expect(el.getAttribute("vector-effect")).toBe("non-scaling-stroke");
    }
  });
});

// The ocean is the largest single area on the page and it was the one colour that did not belong
// to the palette around it — a saturated sky blue against parchment. Pulling it toward the page
// also gives the coastal waterlines, which were laid down at 0.10-0.26 opacity, something they can
// actually be seen against.
describe("renderWorld sea and ink (the page's own palette)", () => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
  const svg = renderWorld(world);
  const chroma = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return Math.max(r, g, b) - Math.min(r, g, b);
  };

  it("keeps the sea calmer than the land it frames", () => {
    const sea = svg.querySelector("rect")!.getAttribute("fill")!;
    expect(chroma(sea)).toBeLessThanOrEqual(32);   // was 55: #a9c7e0
  });

  it("makes the coastal waterlines visible against it", () => {
    const ops = [...svg.querySelectorAll(".waterlines path")]
      .map((p) => Number(p.getAttribute("stroke-opacity")));
    expect(ops.length).toBe(3);                     // three echoing bands, widest faintest
    expect(Math.max(...ops)).toBeGreaterThanOrEqual(0.35);
    expect(ops).toEqual([...ops].sort((a, b) => a - b));
  });

  it("darkens a land region's name so the letters carry it, not the halo", () => {
    const land = svg.querySelector(".region-land")!.getAttribute("fill")!;
    const lum = [1, 3, 5].map((i) => parseInt(land.slice(i, i + 2), 16)).reduce((a, b) => a + b) / 3;
    expect(lum).toBeLessThanOrEqual(60);            // was 74: #5a4a34
  });
});

describe("renderWorld world title", () => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
  const svg = renderWorld(world);
  it("hangs the world's name clear of the decorative frame", () => {
    const t = svg.querySelector(".world-name-text")!;
    const y = Number(t.getAttribute("y"));
    const fs = Number(t.getAttribute("font-size"));
    // Measured in a browser: EB Garamond's cap-top lands ~0.98em above the baseline, and the frame's
    // inner rule sits at y=8. At the old y=30 the title's top cleared it by 0.4 units on every seed
    // — touching, and clipped once the letters had ascenders. Ask for real air.
    expect(y - fs * 0.98).toBeGreaterThanOrEqual(8 + 5);
  });
  it("keeps its rule under the name, not through it", () => {
    const t = svg.querySelector(".world-name-text")!;
    const rule = svg.querySelector(".world-name line")!;
    expect(Number(rule.getAttribute("y1"))).toBeGreaterThan(Number(t.getAttribute("y")));
  });
});
