// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { renderWorld, OVERLAY_BIOME_OPACITY } from "./svgWorldRenderer";
import { politicalBorders } from "../engine/borders";
import { segPath } from "./svgPaths";
import { snapOwnersToProvinces } from "./provinceLayer";
import { displayBiomes } from "./displayBiome";
import { OCEAN } from "../engine/terrain";
import { BIOME_COLORS } from "../engine/biome";
import { LEGEND_ROW, LEGEND_TEXT, LEGEND_SWATCH } from "./renderer";

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
    // three things per city carry the id now — the mark, its hit target, and its name — so the
    // property is one city per id, not one element per city
    const ids = new Set([...svg.querySelectorAll(".markers [data-city]")].map((e) => e.getAttribute("data-city")));
    expect(ids.size).toBe(world.cities.length);
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

// deconflictLabels reserves the space under `.legend` so a name is not left "visible" while an
// opaque panel covers it. Only the biome legend carried that class, so the nation and culture
// legends — the same panel, in the views where they replace it — quietly went on covering names.
describe("renderWorld legends all claim their space", () => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
  it("marks every legend as a legend, in every view that draws one", () => {
    for (const [view, sel] of [["terrain", ".biome-legend"], ["political", ".nation-legend"],
                               ["culture", ".culture-legend"]] as const) {
      const el = renderWorld(world, view).querySelector(sel);
      expect(el, `${view} view draws ${sel}`).not.toBeNull();
      expect(el!.classList.contains("legend"), `${sel} is reserved space`).toBe(true);
    }
  });
});

// Only one legend is ever drawn — biomes in terrain, nations in political, cultures in culture — so
// they can all live in the same corner, and the key stops wandering as the reader switches views.
// It also gets them out from under the zoom controls, an HTML overlay pinned bottom-right: measured
// in a browser, all three buttons sat on top of the nation legend, covering the right 30px of every
// nation's name.
describe("renderWorld legend placement", () => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
  it("anchors every legend to the same corner, clear of the bottom-right controls", () => {
    for (const [view, sel] of [["terrain", ".biome-legend"], ["political", ".nation-legend"],
                               ["culture", ".culture-legend"]] as const) {
      const svg = renderWorld(world, view);
      const panel = svg.querySelector(`${sel} .legend-panel rect`)!;
      const right = Number(panel.getAttribute("x")) + Number(panel.getAttribute("width"));
      expect(right, `${sel} stays out of the right half`).toBeLessThan(world.grid.width / 2);
    }
  });
});

// The fills and the mountain glyphs must read the SAME biomes, or a range gets hatched over a
// colour that no longer says mountain. Counting subpaths is exact: cellPath emits one "M" per cell.
describe("renderWorld draws the smoothed biomes, not the raw ones", () => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
  const svg = renderWorld(world);
  const cellsPerBiome = (b: ArrayLike<number>) => {
    const m = new Map<number, number>();
    for (let c = 0; c < world.grid.count; c++) {
      if (b[c] === OCEAN) continue;              // the ocean is the background rect, never a fill
      m.set(b[c], (m.get(b[c]) ?? 0) + 1);
    }
    return [...m].sort((x, y) => x[0] - y[0]);
  };
  it("fills exactly the cells the display pass assigns", () => {
    const drawn = [...svg.querySelectorAll(".biomes path.biome")]
      .map((p) => [Number(p.getAttribute("data-biome")), (p.getAttribute("d")!.match(/M/g) ?? []).length] as [number, number])
      .sort((x, y) => x[0] - y[0]);
    expect(drawn).toEqual(cellsPerBiome(displayBiomes(world.grid, world.biome)));
    expect(drawn).not.toEqual(cellsPerBiome(world.biome));   // and the smoothing actually did something
  });
});

// The free-port badge is the one mark on the map with no halo, and gold on a tan or green biome has
// almost no value contrast: #e0a83a measured 1.13:1 against grassland and 1.15:1 against wetland,
// where a graphical mark wants 3:1. A gold body can never win that on parchment either — so the
// shape is carried by its outline, and a halo lifts it off the darker biomes.
describe("renderWorld free-port badge", () => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
  const svg = renderWorld(world, "terrain", [world.cities[0].cell, world.cities[1].cell]);
  const lin = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  it("carries a parchment halo, like every name on the map", () => {
    const halo = svg.querySelector(".econ-zone-halo");
    expect(halo).not.toBeNull();
    expect(halo!.getAttribute("stroke")).toBe("#f3ead2");
    expect(Number(halo!.getAttribute("stroke-width")))
      .toBeGreaterThan(Number(svg.querySelector(".econ-zone")!.getAttribute("stroke-width")));
  });

  it("draws the halo under the badge, not over it", () => {
    const g = svg.querySelector(".econ-zones")!;
    const kids = [...g.children].map((c) => c.getAttribute("class"));
    expect(kids.indexOf("econ-zone-halo")).toBeLessThan(kids.indexOf("econ-zone"));
  });

  // No single colour can clear 3:1 against both the palest tundra and the darkest taiga — which is
  // exactly why every name on this map is haloed. So the badge reads if, on each biome, EITHER its
  // outline or its halo separates from what is underneath: the dark outline carries it on the pale
  // biomes, the parchment halo on the dark ones.
  it("reads on every biome the map paints, by outline or by halo", () => {
    const outline = svg.querySelector(".econ-zone")!.getAttribute("stroke")!;
    const halo = svg.querySelector(".econ-zone-halo")!.getAttribute("stroke")!;
    expect(ratio(outline, halo)).toBeGreaterThanOrEqual(3);   // and the outline reads on its own halo
    for (const [bm, colour] of Object.entries(BIOME_COLORS)) {
      const best = Math.max(ratio(outline, colour as string), ratio(halo, colour as string));
      expect(best, `biome ${bm} (${colour})`).toBeGreaterThanOrEqual(3);
    }
  });
});

// Four keys on this map, none of which said what it was a key to.
describe("every legend says what it is a key to", () => {
  const w = generateWorld({ ...DEFAULT_PARAMS, seed: 3, width: 300, height: 300, cellCount: 400, townCount: 6 }).world;
  it("titles the terrain view's legend with the thing its swatches name", () => {
    const svg = renderWorld(w, "terrain", [], "en");
    expect(svg.querySelector(".biome-legend .legend-title")?.textContent).toBe("Terrain");
  });
  it("titles the political view's legend", () => {
    const svg = renderWorld(w, "political", [], "en");
    expect(svg.querySelector(".nation-legend .legend-title")?.textContent).toBe("Realms");
  });
  it("speaks the reader's language", () => {
    const svg = renderWorld(w, "terrain", [], "ko");
    expect(svg.querySelector(".biome-legend .legend-title")?.textContent).toBe("지형");
  });
});

// A city marker is a 4-pixel dot with a click handler and nothing else: no name, no hint that it
// leads anywhere. At the default zoom the labels are all withheld too (deconflict holds
// .city-capital back to 1.5x and .city-town to 2.6x), so a first-time reader sees anonymous specks
// over a map whose best feature is behind them.
describe("a city marker says what it is", () => {
  it("names every marker, and says which nation holds it", () => {
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 5 }).world;
    const svg = renderWorld(world);
    const markers = [...svg.querySelectorAll(".marker-town, .marker-capital")];
    expect(markers.length).toBe(world.cities.length);
    for (const m of markers) {
      const id = Number(m.getAttribute("data-city"));
      const city = world.cities.find((c) => c.id === id)!;
      const title = m.querySelector("title")?.textContent ?? "";
      expect(title, `marker ${id} has no name`).toContain(city.name);
    }
    // at least one of them names its nation too (an unclaimed town may have none)
    expect(markers.some((m) => (m.querySelector("title")?.textContent ?? "").includes("·"))).toBe(true);
  });
});

// The map's best feature — the city plans — was reachable only by hitting a dot. Measured on the
// live page: 28 markers with a hit box of 5px (8 for a capital), against a 24px minimum touch
// target; 0 of 28 names shown at the default zoom; 0 labels clickable; 0 focusable elements on the
// whole page, so a keyboard could not reach a city at all. The mark stays the size it is — that is
// a cartographic choice — and gains an invisible target around it.
describe("a city can be reached", () => {
  const world = () => generateWorld({ ...DEFAULT_PARAMS, seed: 5 }).world;

  // ⚠ This asked for a 13-unit target on EVERY city and got one, and that was the bug the reader
  // found: "몇몇 도시는 클릭이 안돼". A 28-unit target on a 1000-unit map is wider than the gap
  // between close neighbours — measured over 12 seeds, 9 of 336 towns in SIX of twelve worlds had
  // their own dot under the next city's target, the closest pair 9.0 units apart — and the city
  // drawn last took the click. So the target is still 13+ wherever there is room for one, and where
  // there is not it stops at half the distance to the neighbour rather than swallowing it.
  it("puts a target around every marker, big enough to hit and never over its neighbour", () => {
    const w = world();
    const svg = renderWorld(w);
    const hits = [...svg.querySelectorAll(".marker-hit")];
    expect(hits.length).toBe(w.cities.length);
    for (const h of hits) {
      const id = Number(h.getAttribute("data-city"));
      const c = w.cities.find((x) => x.id === id)!;
      const nearest = Math.min(...w.cities.filter((o) => o !== c).map((o) => Math.hypot(c.x - o.x, c.y - o.y)));
      const r = Number(h.getAttribute("r"));
      // the map is 1000 units wide and draws at roughly 900px, so ~0.9px per unit: a 24px target
      // needs a radius over 13 units, and that is what a town with room around it gets
      if (nearest >= 26) expect(r, `${c.name} has room but a ${r}-unit target`).toBeGreaterThanOrEqual(13);
      expect(r, `${c.name}'s target reaches its neighbour`).toBeLessThanOrEqual(nearest / 2 + 0.05);
      expect(r, `${c.name}'s target is too small to hit at all`).toBeGreaterThanOrEqual(4);
      expect(h.getAttribute("data-city"), "the target must carry the city it opens").not.toBeNull();
      expect(h.getAttribute("fill")).toBe("transparent");
    }
  });

  // The other half of the same bug: even a target that stops short leaves the dots of two close
  // towns inside one another's reach, and whoever is drawn last wins. Every target is laid down
  // first, so a mark the reader can SEE is never under another city's invisible one.
  it("draws every target under every mark, so a dot always opens its own city", () => {
    const w = world();
    const svg = renderWorld(w);
    const kids = [...svg.querySelectorAll(".markers > *")];
    const lastHit = kids.map((k) => k.classList.contains("marker-hit")).lastIndexOf(true);
    const firstMark = kids.findIndex((k) => k.classList.contains("marker-town") || k.classList.contains("marker-capital"));
    expect(lastHit, "no targets drawn").toBeGreaterThan(-1);
    expect(firstMark, "no marks drawn").toBeGreaterThan(-1);
    expect(firstMark, "a target is drawn on top of a mark").toBeGreaterThan(lastHit);
  });

  it("lets a keyboard reach a city, and says what it is reaching", () => {
    const w = world();
    const svg = renderWorld(w);
    const hits = [...svg.querySelectorAll(".marker-hit")];
    expect(hits.length, "no targets to check").toBe(w.cities.length);
    for (const h of hits) {
      expect(h.getAttribute("tabindex")).toBe("0");
      expect(h.getAttribute("role")).toBe("button");
      const id = Number(h.getAttribute("data-city"));
      expect(h.getAttribute("aria-label") ?? "").toContain(w.cities.find((c) => c.id === id)!.name);
    }
  });

  it("makes the name itself open the city, not just the dot beside it", () => {
    const w = world();
    const svg = renderWorld(w);
    const labels = [...svg.querySelectorAll(".city-label")];
    expect(labels.length).toBe(w.cities.length);
    for (const l of labels) expect(l.getAttribute("data-city")).not.toBeNull();
  });
});

// The map is the page. To a screen reader it was an untitled graphic: the root <svg> had no role,
// no name and no description, so the whole thing announced as nothing at all.
describe("the map says what it is", () => {
  it("names itself and the view it is showing", () => {
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 5 }).world;
    for (const view of ["terrain", "political", "culture", "province"] as const) {
      const svg = renderWorld(world, view);
      expect(svg.getAttribute("role")).toBe("img");
      const title = svg.querySelector(":scope > title")?.textContent ?? "";
      expect(title, `${view} view is unnamed`).toContain(world.name);
      expect(svg.querySelector(":scope > desc")?.textContent ?? "", `${view} view undescribed`).not.toBe("");
    }
  });
});

// THE BROKEN TUNDRA in letters half an inch wide is the terrain view's own subject; over the
// political, culture and province views it is somebody else's, laid across the country and culture
// names those views exist to show. In the province view it was worse than clutter: region and
// province labels sat at the SAME deconflict priority, so which of the two survived a collision
// was a coin toss.
describe("a view's own subject comes first", () => {
  const world = () => generateWorld({ ...DEFAULT_PARAMS, seed: 5 }).world;

  it("keeps the land's names at full weight on the terrain view", () => {
    const svg = renderWorld(world(), "terrain");
    const labels = [...svg.querySelectorAll(".region-label")];
    expect(labels.length).toBeGreaterThan(5);
    for (const l of labels) expect(l.classList.contains("region-faint")).toBe(false);
  });

  it("stands them down on every view that is about something else", () => {
    for (const view of ["political", "culture", "province"] as const) {
      const svg = renderWorld(world(), view);
      const labels = [...svg.querySelectorAll(".region-label")];
      expect(labels.length, `${view} has no region labels to stand down`).toBeGreaterThan(5);
      for (const l of labels) {
        expect(l.classList.contains("region-faint"), `${view}`).toBe(true);
        expect(Number(l.getAttribute("fill-opacity") ?? 1), `${view}`).toBeLessThan(0.6);
      }
    }
  });
});

// Three of the four views carry a key; the province view, which is the one an outside review found
// hardest to read, carried none. Its colours cannot be listed — there are a hundred provinces and
// their hues are dealt against adjacency — but its LINES can: a thin one is a province, a heavy one
// is a country, and the dot is where the province is governed from.
describe("the province view explains itself", () => {
  it("carries a key for the two weights of border and the seat", () => {
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 5 }).world;
    const svg = renderWorld(world, "province");
    const legend = svg.querySelector(".legend");
    expect(legend, "the province view has no key at all").not.toBeNull();
    const words = [...legend!.querySelectorAll("text")].map((t) => t.textContent).join(" ");
    expect(words).toContain("Province");
    expect(words).toContain("Realm");
    expect(words).toContain("Seat");
  });
});

// A key nobody can read is a key nobody has. Measured on the live page the legend text rendered at
// 8.7 to 9.2 CSS pixels — and the panel it sat in was three quarters empty, so the smallness bought
// nothing. It was also three different sizes: 9 on the world, 8.5 on the province key, 7 on a city
// plate.
describe("the keys can be read", () => {
  const world = () => generateWorld({ ...DEFAULT_PARAMS, seed: 5 }).world;
  it("sets the world's keys at one size, big enough to read", () => {
    for (const view of ["terrain", "political", "culture", "province"] as const) {
      const svg = renderWorld(world(), view);
      const sizes = [...svg.querySelectorAll(".legend text")]
        .filter((t) => !t.classList.contains("legend-title"))
        .map((t) => Number(t.getAttribute("font-size")));
      expect(sizes.length, `${view} has no key`).toBeGreaterThan(0);
      expect(new Set(sizes).size, `${view} mixes sizes`).toBe(1);
      // the map is 1000 units drawn at roughly that many CSS pixels, so units are pixels
      expect(sizes[0], `${view} key text`).toBeGreaterThanOrEqual(11);
    }
  });
  it("keeps every label inside its panel, in both languages", () => {
    let checked = 0;
    for (const lang of ["en", "ko"] as const) {
      for (const view of ["terrain", "political", "culture", "province"] as const) {
        const svg = renderWorld(world(), view, [], lang);
        const panel = svg.querySelector(".legend .legend-panel rect") as SVGRectElement | null;
        if (!panel) continue;
        const right = Number(panel.getAttribute("x")) + Number(panel.getAttribute("width"));
        for (const t of svg.querySelectorAll(".legend text")) {
          checked++;
          // jsdom has no text metrics; approximate a generous per-character width
          const chars = (t.textContent ?? "").length;
          const size = Number(t.getAttribute("font-size"));
          const end = Number(t.getAttribute("x")) + chars * size * 0.62;
          expect(end, `${lang}/${view}: "${t.textContent}" runs past its panel`).toBeLessThan(right);
        }
      }
    }
    expect(checked, "no legend label was actually measured").toBeGreaterThan(30);
  });

  // The MAP is what this task is named for, and it is the one surface that had no automated guard:
  // the gazetteer got one the same day (gazetteer.test.ts, "no Latin left in it"), the map did not.
  // Four wiring sites hand a name to a <text> node — cultureLayer.ts, provinceLayer.ts,
  // svgWorldRenderer.ts's region/river/city/title labels, and politicalLayer.ts's nation labels —
  // and a regression at any one of them back to the raw English name would leave all 776 other tests
  // green. This reuses the lang x view loop already above rather than adding a second one.
  //
  // M2: the loop above read only <text> nodes, which left the root <title> (svgWorldRenderer.ts:67,
  // `worldNameIn`) and every city marker's tooltip (`markerTitle` at :234, on both the hit-circle and
  // the capital-star/town-dot) outside it — an SVG <title> carries no letters a <text> query can see.
  // Checking "text, title" together catches a regression at either kind of node with the one loop.
  it("draws every map name in the language it was asked for", () => {
    let mapTextChecked = 0;
    for (const lang of ["en", "ko"] as const) {
      for (const view of ["terrain", "political", "culture", "province"] as const) {
        const svg = renderWorld(world(), view, [], lang);
        for (const el of svg.querySelectorAll("text, title")) {
          if (el.closest(".legend")) continue;      // UI chrome headings, already localised on their own path
          if (el.closest(".scale-bar")) continue;    // "360 km" — an SI unit, kept in Latin by Korean map convention
          mapTextChecked++;
          const hasLatin = /[A-Za-z]/.test(el.textContent ?? "");
          if (lang === "ko") {
            expect(hasLatin, `${view}: "${el.textContent}" has a Latin letter on the Korean map`).toBe(false);
          } else {
            // asserted in English too, so the test proves the language switch does something rather
            // than that every generated name happens to be Hangul-free either way
            expect(hasLatin, `${view}: "${el.textContent}" has no Latin letter in English`).toBe(true);
          }
        }
      }
    }
    expect(mapTextChecked, "no map text was actually checked").toBeGreaterThan(30);
  });
});

// One product, two legends, two sizes. Measured at 1920x945 on the live page: the world map draws
// its 1000-unit viewBox at 993px (x0.993) while the city plate draws its 568 at 883 (x1.554), so
// the plate's key came out 28% larger in type and 25% larger in swatch than the world map's — 14.0
// CSS px against 10.9, 12.4 against 9.9 — although the world map is the one a reader spends their
// time on. The world legend's units are raised to land on the plate's rendered size; the plate,
// which is the one that reads correctly, is left alone as the reference.
//
// The drift had a structure: `LEGEND_ROW` was raised to 15 with the comment "taller type needs the
// room" and NOTHING USED IT — all four world legends wrote their own `14`. This is the test that
// makes them share one row.
describe("the map's legends are one size, not four", () => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
  const views = [["terrain", ".biome-legend"], ["political", ".nation-legend"],
                 ["culture", ".culture-legend"], ["province", ".legend"]] as const;

  for (const [view, sel] of views) {
    it(`${view}: rows sit one LEGEND_ROW apart and the type is LEGEND_TEXT`, () => {
      const svg = renderWorld(world, view);
      const legend = svg.querySelector(sel);
      expect(legend, `${view} draws no legend`).not.toBeNull();
      // The rows are read off the WORDS, because the province key marks its rows with rules and a
      // dot rather than with colour swatches — every legend has one line of type per row.
      const rows = Array.from(legend!.querySelectorAll("text")).slice(1); // [0] is the heading
      expect(rows.length, `${view} has no keyed rows`).toBeGreaterThan(1);
      for (let i = 1; i < rows.length; i++) {
        const step = Number(rows[i].getAttribute("y")) - Number(rows[i - 1].getAttribute("y"));
        expect(step, `${view} row ${i}`).toBe(LEGEND_ROW);
      }
      for (const t of rows) expect(Number(t.getAttribute("font-size"))).toBe(LEGEND_TEXT);
      // where a row IS a colour swatch, the swatch is the shared size too
      for (const r of Array.from(legend!.querySelectorAll("rect.legend-item"))) {
        expect(Number(r.getAttribute("width"))).toBe(LEGEND_SWATCH);
      }
    });
  }

  it("keeps the world key at the size the city plate already reads at", () => {
    // The plate sets its key in 9 units and renders at x1.554 = 14.0 CSS px. The world map renders
    // at x0.993, so it needs 14 units to land in the same place. This is a floor: the number may
    // rise if the map ever renders smaller, but it must never quietly fall back to 11.
    expect(LEGEND_TEXT).toBeGreaterThanOrEqual(14);
    expect(LEGEND_ROW).toBeGreaterThanOrEqual(17);
    expect(LEGEND_SWATCH).toBeGreaterThanOrEqual(12);
  });
});

// The complaint this answers: a range was a flat grey area, so the map read as paper with colours
// on it. Shading is what an atlas puts in that place. It is drawn in every view — a range has bulk
// whoever owns it — and muted with the fills under an overlay so the nation colours still dominate.
describe("the ranges carry bulk", () => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 3 });
  it("shades the mountains in the terrain view", () => {
    const svg = renderWorld(world, "terrain", [], "en");
    const shades = svg.querySelectorAll(".relief-shade .shade");
    expect(shades.length).toBeGreaterThan(2);
    // ...and it is shadow, not a wash: every band is the same ink at its own weight
    const inks = new Set(Array.from(shades).map((s) => s.getAttribute("fill")));
    expect(inks.size).toBe(1);
    const weights = Array.from(shades).map((s) => Number(s.getAttribute("fill-opacity")));
    expect(Math.max(...weights)).toBeGreaterThan(0.1);
    expect(Math.max(...weights)).toBeLessThanOrEqual(0.45);
  });

  it("mutes the shading with the fills under an overlay view", () => {
    const terrain = renderWorld(world, "terrain", [], "en").querySelector(".relief-shade");
    const political = renderWorld(world, "political", [], "en").querySelector(".relief-shade");
    expect(terrain!.getAttribute("opacity")).toBeNull();
    expect(political!.getAttribute("opacity")).toBe(String(OVERLAY_BIOME_OPACITY));
  });
});
