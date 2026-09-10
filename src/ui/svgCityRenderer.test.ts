// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateCityLayout, cityContext } from "../engine/city";
import { renderCity } from "./svgCityRenderer";
import { GRASSLAND, WETLAND, TAIGA, ALPINE, DESERT } from "../engine/biome";
import { pointInPolygon } from "../engine/geometry";
import type { Polygon } from "../engine/geometry";
import type { CityMarker } from "../types/world";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";

// the renderer anchors a stilt at the building's vertex-mean; replicate it so the test can
// predict exactly which buildings sit over water.
function vavg(p: Polygon): [number, number] {
  let x = 0, y = 0;
  for (const [px, py] of p) { x += px; y += py; }
  return [x / p.length, y / p.length];
}

const marker: CityMarker = {
  id: 1, cell: 0, x: 0, y: 0, name: "Testburg",
  polityId: 0, isCapital: true, size: 5, coastal: true, elevation: 0.4, biome: 4, river: false,
};

describe("renderCity organic", () => {
  it("clips content to the boundary and draws wall segments + roads + buildings", () => {
    const layout = generateCityLayout(cityContext(marker), 7);
    const svg = renderCity(layout);
    expect(svg.querySelectorAll("clipPath").length).toBe(1);
    expect(svg.querySelectorAll(".boundary").length).toBe(1);
    expect(svg.querySelectorAll(".wall-seg").length).toBe(layout.wall ? layout.wall.segments.length : 0);
    expect(svg.querySelectorAll(".road-main").length).toBe(layout.mainRoads.length);
    expect(svg.querySelectorAll(".road-minor").length).toBe(layout.minorRoads.length);
    expect(svg.querySelectorAll(".building").length).toBeGreaterThan(0);
  });
  it("colour-codes districts: buildings take several distinct hues + a district legend", () => {
    const layout = generateCityLayout(cityContext(marker), 7);
    const svg = renderCity(layout);
    const fills = new Set([...svg.querySelectorAll(".building")].map((b) => (b.getAttribute("fill") || "").toLowerCase()));
    expect(fills.size).toBeGreaterThan(2); // districts read apart, not one cream mass
    const legend = [...svg.querySelectorAll(".legend text")].map((t) => t.textContent);
    expect(legend).toContain("Slums"); // the legend names the districts, not just "Buildings"
  });
  it("puts the district legend in a right-hand strip outside the map (never covering the city)", () => {
    const layout = generateCityLayout(cityContext(marker), 7);
    const svg = renderCity(layout);
    const vbW = Number((svg.getAttribute("viewBox") || "0 0 0 0").split(" ")[2]);
    expect(vbW).toBeGreaterThan(layout.bounds.w); // widened by a legend strip
    // every legend swatch sits at x >= the map width (in the strip, not over the city)
    const swatches = [...svg.querySelectorAll(".legend .legend-item")];
    expect(swatches.length).toBeGreaterThan(0);
    for (const s of swatches) expect(Number(s.getAttribute("x"))).toBeGreaterThanOrEqual(layout.bounds.w);
  });
  it("tints the ground and uses timber walls (incl. wood-toned gates/towers) for a forest city", () => {
    const layout = generateCityLayout(cityContext({ ...marker, coastal: false, elevation: 0.5, biome: 3 }), 7);
    const svg = renderCity(layout);
    expect(svg.querySelector(".boundary")?.getAttribute("fill")).toBe("#e3e7d0");
    expect(svg.querySelector(".wall-seg")?.getAttribute("stroke")).toBe("#6b4f34");
    // gates/towers follow the wall material instead of staying stone grey
    if (svg.querySelector(".tower")) expect(svg.querySelector(".tower")?.getAttribute("fill")).toBe("#9c7a52");
    if (svg.querySelector(".gate")) expect(svg.querySelector(".gate")?.getAttribute("fill")).toBe("#7a5a38");
  });
  it("keeps stone-grey gates for a non-timber city", () => {
    const layout = generateCityLayout(cityContext({ ...marker, coastal: false, elevation: 0.4, biome: GRASSLAND }), 9);
    const svg = renderCity(layout);
    expect(layout.features.wallMaterial).toBe("stone");
    if (svg.querySelector(".gate")) expect(svg.querySelector(".gate")?.getAttribute("fill")).toBe("#9a9a9a");
  });
  it("draws a tree glyph per forest tree", () => {
    const layout = generateCityLayout(cityContext({ ...marker, coastal: false, elevation: 0.5, biome: 3 }), 7);
    const svg = renderCity(layout);
    expect(svg.querySelectorAll(".tree").length).toBe(layout.features.trees.length);
    expect(svg.querySelectorAll(".tree").length).toBeGreaterThan(0);
  });
  it("draws palms around a desert oasis", () => {
    const layout = generateCityLayout(cityContext({ ...marker, coastal: false, elevation: 0.5, biome: 5 }), 7);
    const svg = renderCity(layout);
    expect(layout.features.oasis).not.toBeNull();
    expect(svg.querySelectorAll(".palm").length).toBeGreaterThan(0);
  });
  it("draws stilts ONLY under marsh buildings that sit over the water", () => {
    const layout = generateCityLayout(cityContext({ ...marker, coastal: false, elevation: 0.5, biome: 7 }), 7);
    const svg = renderCity(layout);
    expect(layout.features.onStilts).toBe(true);
    const overWater = layout.wards
      .flatMap((wd) => wd.buildings)
      .filter((b) => layout.water.bodies.some((body) => pointInPolygon(vavg(b), body))).length;
    expect(svg.querySelectorAll(".stilt").length).toBe(overWater);
    expect(svg.querySelectorAll(".stilt").length).toBeGreaterThan(0); // seed 7 marsh has houses over the meander
  });
  it("draws extramural suburbs outside the boundary clip", () => {
    const layout = generateCityLayout(cityContext({ ...marker, coastal: false, elevation: 0.5, biome: 4, size: 4 }), 7);
    const svg = renderCity(layout);
    const env = svg.querySelector(".environs");
    expect(env).not.toBeNull();
    expect(env!.closest("[clip-path]")).toBeNull(); // NOT inside the boundary clip
    expect(svg.querySelectorAll(".environs .suburb").length).toBe(layout.suburbs.length);
    expect(svg.querySelectorAll(".environs .suburb-road").length).toBe(layout.suburbRoads.length);
    expect(svg.querySelectorAll(".environs .outwork").length).toBe(layout.outworks.length);
  });
  it("renders mountain masses with cliffs + hachures for a mountain city (none for plains)", () => {
    let mtn = null;
    for (let s = 1; s <= 40 && !mtn; s++) {
      const l = generateCityLayout(cityContext({ ...marker, coastal: false, elevation: 0.9, biome: 4 }), s);
      if (l.mountains.length > 0) mtn = l;
    }
    expect(mtn).not.toBeNull();
    const svg = renderCity(mtn!);
    expect(svg.querySelectorAll(".mountains .mountain").length).toBe(mtn!.mountains.length);
    expect(svg.querySelectorAll(".mountains .cliff").length).toBe(mtn!.mountains.length);
    expect(svg.querySelectorAll(".mountains .hachure").length).toBeGreaterThan(0);

    const plains = renderCity(generateCityLayout(cityContext({ ...marker, coastal: false, elevation: 0.4, biome: 4 }), 9));
    expect(plains.querySelectorAll(".mountains").length).toBe(0);
  });
  it("renders a harbor (breakwater, lighthouse, piers, boats) for a coastal city; none inland", () => {
    const layout = generateCityLayout(cityContext({ ...marker, coastal: true }), 5);
    expect(layout.harbor).not.toBeNull();
    const svg = renderCity(layout);
    expect(svg.querySelectorAll(".harbor .breakwater").length).toBe(1);
    expect(svg.querySelectorAll(".harbor .quay").length).toBe(1);
    expect(svg.querySelectorAll(".harbor .lighthouse").length).toBe(1);
    expect(svg.querySelectorAll(".harbor .pier").length).toBe(layout.harbor!.piers.length);
    expect(svg.querySelectorAll(".harbor .boat").length).toBe(layout.harbor!.boats.length);

    const inland = renderCity(generateCityLayout(cityContext({ ...marker, coastal: false, elevation: 0.4, biome: 4 }), 9));
    expect(inland.querySelectorAll(".harbor").length).toBe(0);
  });
  it("renders the countryside in the unclipped environs layer", () => {
    const layout = generateCityLayout({ id: 7, name: "Test", size: 3, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 1);
    const svg = renderCity(layout, "en");
    const env = svg.querySelector(".environs")!;
    expect(env.getAttribute("clip-path")).toBeNull();
    expect(env.querySelectorAll(".field").length).toBe(layout.countryside.fields.length);
    expect(env.querySelectorAll(".pasture").length).toBe(layout.countryside.pastures.length);
    expect(env.querySelectorAll(".farm-barn").length).toBe(layout.countryside.farmsteads.length);
    expect(env.querySelectorAll(".wood-tree").length).toBe(layout.countryside.woods.length);
    expect(env.querySelectorAll(".village-green").length).toBe(layout.countryside.villages.length);
    // each nucleated village draws an approach lane (the street that makes it read as a village)
    expect(env.querySelectorAll(".village-lane").length).toBe(layout.countryside.villages.length);
  });
  it("draws roads on top of buildings (streets never buried under a block)", () => {
    const layout = generateCityLayout({ id: 7, name: "T", size: 4, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 1);
    const svg = renderCity(layout, "en");
    const clipped = svg.querySelector("g[clip-path]")!;
    const kids = [...clipped.children];
    const idxOf = (cls: string) => kids.reduce((acc, k, idx) => (k.classList.contains(cls) ? idx : acc), -1);
    const firstIdxOf = (cls: string) => kids.findIndex((k) => k.classList.contains(cls));
    const lastBuilding = idxOf("building");
    const firstRoad = firstIdxOf("road-main-casing");
    expect(lastBuilding).toBeGreaterThanOrEqual(0);
    expect(firstRoad).toBeGreaterThan(lastBuilding); // roads come after buildings in DOM → drawn on top
  });
  it("draws the castle as a donjon: inner wall, towers, keep with shadow, inner tower and 4 corner turrets", () => {
    const layout = generateCityLayout({ id: 7, name: "T", size: 4, coastal: false, isCapital: true, elevation: 0.4, biome: GRASSLAND }, 1);
    const svg = renderCity(layout, "en");
    expect(svg.querySelector(".castle-wall")).not.toBeNull();
    expect(svg.querySelector(".castle-keep")).not.toBeNull();
    expect(svg.querySelector(".castle-keep-shadow")).not.toBeNull();
    expect(svg.querySelector(".castle-keep-inner")).not.toBeNull();
    expect(svg.querySelectorAll(".castle-turret").length).toBe(4);
    // Towers stand at intervals along the wall, so there is no longer one per corner: a Voronoi
    // ward bunches its vertices wherever a neighbour crowds it, and a tower on each put five
    // shoulder to shoulder down one side and three along the whole of the other.
    const towers = [...svg.querySelectorAll(".castle-tower")]
      .map((e) => [Number(e.getAttribute("cx")), Number(e.getAttribute("cy"))] as [number, number]);
    expect(towers.length).toBeGreaterThan(2);
    expect(towers.length).toBeLessThanOrEqual(layout.castle!.towers.length);
    const gap = 6 * layout.castle!.scale;
    for (let i = 0; i < towers.length; i++) for (let j = i + 1; j < towers.length; j++) {
      expect(Math.hypot(towers[i][0] - towers[j][0], towers[i][1] - towers[j][1])).toBeGreaterThanOrEqual(gap - 1e-6);
    }
    for (const t of towers) expect(layout.castle!.towers.some((v) => v[0] === t[0] && v[1] === t[1])).toBe(true);
  });
  // a town with no seated lord has no castle at all: the branch existed but was unreachable while
  // every town was given one, so this pins that the plate simply omits the donjon rather than
  // drawing an empty enclosure.
  it("draws no castle at all in a town that seats no lord", () => {
    const layout = generateCityLayout({ id: 7, name: "T", size: 1, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 1);
    expect(layout.castle).toBeNull();
    const svg = renderCity(layout, "en");
    for (const c of [".castle-wall", ".castle-keep", ".castle-keep-shadow", ".castle-keep-inner", ".castle-turret", ".castle-tower"]) {
      expect(svg.querySelectorAll(c).length).toBe(0);
    }
  });
  it("renders a parish-church steeple per parishChurches entry", () => {
    const layout = generateCityLayout({ id: 7, name: "T", size: 3, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 1);
    const svg = renderCity(layout, "en");
    expect(svg.querySelectorAll(".parish-church").length).toBe(layout.parishChurches.length);
  });
  it("renders market cross, well and inns", () => {
    const layout = generateCityLayout({ id: 7, name: "T", size: 4, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 2);
    const svg = renderCity(layout, "en");
    expect(svg.querySelectorAll(".market-cross").length).toBe(layout.marketCross ? 1 : 0);
    expect(svg.querySelectorAll(".well").length).toBe(layout.well ? 1 : 0);
    expect(svg.querySelectorAll(".inn").length).toBe(layout.inns.length);
  });
  it("renders barbican towers and walls", () => {
    const layout = generateCityLayout({ id: 7, name: "T", size: 4, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 1);
    const svg = renderCity(layout, "en");
    expect(svg.querySelectorAll(".barbican").length).toBe(layout.barbicans.length * 2);
    expect(svg.querySelectorAll(".barbican-wall").length).toBe(layout.barbicans.length * 2);
  });
  it("re-draws the river channel ON TOP of the city ground (clipped) so it flows through the town", () => {
    const layout = generateCityLayout({ id: 7, name: "T", size: 4, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND, river: true }, 1);
    expect(["bridgeTown", "meanderDefense"]).toContain(layout.archetype.id);
    const svg = renderCity(layout, "en");
    const clipped = svg.querySelector("g[clip-path]")!;
    // the water is re-painted inside the boundary group, above the opaque ground fill (bottom pass
    // alone is hidden inside the walls → the river looked like a band painted behind the city)
    expect(clipped.querySelectorAll(".water").length).toBeGreaterThan(0);
  });
  // This used to assert the opposite — that a marsh city gets NO water re-drawn, so its stilt
  // houses stay visible. The houses were never at risk: the re-draw goes under them. What the
  // assertion actually bought was a marsh town with no water in it at all, on the one archetype
  // whose whole idea is a town standing in a marsh. The property worth holding is the one the old
  // test was reaching for: the water is there, AND the houses are on top of it.
  it("re-draws water over a marsh city too, with the stilt houses still on top of it", () => {
    const layout = generateCityLayout(cityContext({ ...marker, coastal: false, elevation: 0.5, biome: 7 }), 7);
    expect(layout.features.onStilts).toBe(true);
    const svg = renderCity(layout);
    const clipped = svg.querySelector("g[clip-path]")!;
    expect(clipped.querySelectorAll(".water").length).toBeGreaterThan(0);
    const kids = [...clipped.children].map((c) => c.getAttribute("class") || "");
    expect(kids.lastIndexOf("water")).toBeLessThan(kids.indexOf("building"));
  });
  it("renders a workshop per riverside trade", () => {
    let layout = generateCityLayout({ id: 7, name: "T", size: 4, coastal: true, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 1);
    for (let s = 2; s <= 20 && !layout.riversideTrades.length; s++) layout = generateCityLayout({ id: 7, name: "T", size: 4, coastal: true, isCapital: false, elevation: 0.4, biome: GRASSLAND }, s);
    const svg = renderCity(layout, "en");
    expect(svg.querySelectorAll(".riverside-trade").length).toBe(layout.riversideTrades.length);
  });
  it("orients the watermill house toward the water (a rotate transform, not axis-aligned)", () => {
    // a coastal city places its outwork by the water → a watermill (rect house), not a windmill
    let layout = generateCityLayout(cityContext({ ...marker, coastal: true }), 5);
    for (let s = 6; s <= 25 && layout.outworks[0]?.type !== "watermill"; s++) layout = generateCityLayout(cityContext({ ...marker, coastal: true }), s);
    expect(layout.outworks[0]?.type).toBe("watermill");
    const svg = renderCity(layout);
    const house = svg.querySelector("rect.outwork") as SVGElement;
    expect(house).not.toBeNull();
    expect(house.getAttribute("transform") || "").toContain("rotate(");
  });
  it("renders a leper house + fairground outside the walls when generated", () => {
    const layout = generateCityLayout({ id: 7, name: "T", size: 4, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 1);
    const svg = renderCity(layout, "en");
    expect(svg.querySelectorAll(".leper-house").length).toBe(layout.leperHouse ? 1 : 0);
    expect(svg.querySelectorAll(".fairground").length).toBe(layout.fairground ? 1 : 0);
    if (layout.fairground) {
      expect(svg.querySelectorAll(".fairground .fair-stall").length).toBe(layout.fairground.stalls.length);
      // both live in the unclipped environs (outside the boundary), like the other landmarks
      expect(svg.querySelector(".fairground")!.closest("[clip-path]")).toBeNull();
    }
  });
  it("has no leper house or fairground for a tiny hamlet (size 1)", () => {
    const layout = generateCityLayout({ id: 7, name: "T", size: 1, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 1);
    expect(layout.leperHouse).toBeNull(); // size < 2
    expect(layout.fairground).toBeNull(); // size < 3
  });
});

// The city plan is a plate from the same atlas as the world map, and until now it did not look like
// one: no border, no north, a plain 13px name, and the one white-card legend left behind when the
// world's three were put into cartouches.
describe("renderCity wears the same atlas chrome as the world", () => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
  const layout = generateCityLayout(cityContext(world.cities[0]), 1);
  const svg = renderCity(layout, "en");

  it("is bordered and oriented, like every other map this project draws", () => {
    expect(svg.querySelectorAll(".map-frame").length).toBe(1);
    expect(svg.querySelectorAll(".compass").length).toBe(1);
    expect(svg.querySelector(".compass-n")?.textContent).toBe("N");
  });

  it("draws the frame and compass last, so nothing is drawn over them", () => {
    const kids = [...svg.children].map((c) => c.getAttribute("class"));
    expect(kids[kids.length - 1]).toBe("map-frame");
    expect(kids.indexOf("compass")).toBeGreaterThan(kids.indexOf("legend"));
  });

  it("puts its key in the same cartouche the world's legends sit in", () => {
    const panel = svg.querySelector(".legend .legend-panel");
    expect(panel).not.toBeNull();
    expect(panel!.querySelectorAll("rect").length).toBe(2);   // the double rule
    expect(panel!.querySelectorAll("circle").length).toBe(4); // and a dot at each corner
  });

  it("names the town the way the world names itself: bigger, haloed, ruled", () => {
    const t = svg.querySelector(".city-name-text")!;
    expect(t.textContent).toBe(layout.name);
    expect(Number(t.getAttribute("font-size"))).toBeGreaterThan(13);
    expect(t.getAttribute("paint-order")).toBe("stroke");
    expect(svg.querySelector(".city-name line")).not.toBeNull();
  });

  it("halos a ward's name with paint-order instead of drawing the word twice", () => {
    const wards = [...svg.querySelectorAll(".ward-label")];
    expect(wards.length).toBeGreaterThan(0);
    for (const w of wards) expect(w.getAttribute("paint-order")).toBe("stroke");
    // the old way put two texts at the same spot; there should be exactly one per label now
    const seen = new Set(wards.map((w) => `${w.getAttribute("x")},${w.getAttribute("y")}`));
    expect(seen.size).toBe(wards.length);
  });
});

// The marsh town is the one kind of settlement defined by its water — measured, 95% of the area
// inside Dhaa's walls is river — and it was the one kind that never drew any. The channel is laid
// down at the bottom of the z-order and the opaque ground fill covers it, so it is the re-draw over
// the ground that makes a river show through a town; marsh was skipped from that re-draw to keep its
// stilt houses above the water. But the re-draw goes UNDER the buildings, so it already does that.
// The result was a river that stopped at the wall and picked up again on the far side, and stilt
// houses standing on dry ground.
describe("renderCity draws the water inside a marsh town", () => {
  const marsh = generateCityLayout(
    { id: 3, name: "Marshtown", size: 4, coastal: false, isCapital: false, elevation: 0.3, biome: WETLAND },
    99,
  );
  const svg = renderCity(marsh, "en");
  const classesInOrder = () => {
    const out: string[] = [];
    const walk = (n: Element) => { for (const c of n.children) { out.push(c.getAttribute("class") || ""); walk(c); } };
    walk(svg);
    return out;
  };

  it("is the archetype this is about", () => {
    expect(marsh.features.onStilts).toBe(true);
    expect(marsh.water.bodies.length).toBeGreaterThan(0);
  });

  it("draws the channel again over the ground, as every other river town gets", () => {
    // more water polygons than the single pass at the bottom of the stack
    const waters = svg.querySelectorAll(".water").length;
    expect(waters).toBeGreaterThan(marsh.water.bodies.length);
  });

  it("keeps the houses on top of it, which is what standing on stilts looks like", () => {
    const order = classesInOrder();
    const lastWater = order.lastIndexOf("water");
    const firstBuilding = order.indexOf("building");
    expect(lastWater).toBeGreaterThan(-1);
    expect(firstBuilding).toBeGreaterThan(-1);
    expect(lastWater).toBeLessThan(firstBuilding);
  });

  it("still puts a stilt under each house that stands in the water", () => {
    expect(svg.querySelectorAll(".stilt").length).toBeGreaterThan(0);
  });
});

describe("the town plan's district key", () => {
  it("says what it is a key to", () => {
    const layout = generateCityLayout(cityContext(marker), 7);
    const svg = renderCity(layout, "en");
    expect(svg.querySelector(".legend .legend-title")?.textContent).toBe("Districts");
  });
});

// The mass ran out to the edge of the plate but the hachures only ever hugged its crest, so on a
// spur town nearly half the plate was a single flat #a99e8c shape carrying 15 tick marks. Measured:
// 45.8% of the plate, 15 hachures. The world map answers the same question with a glyph per alpine
// cell; the town plan needs the same idea inside the mass, not only along its rim.
describe("mountain masses are drawn as ground, not as grey paper", () => {
  const area = (poly: number[][]) => {
    let a = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    return Math.abs(a) / 2;
  };
  it("carries hachures through the body of the mass, in proportion to its size", () => {
    let mtn = null;
    for (let s = 1; s <= 40 && !mtn; s++) {
      const l = generateCityLayout(cityContext({ ...marker, coastal: false, elevation: 0.9, biome: 4 }), s);
      if (l.mountains.length) mtn = l;
    }
    expect(mtn).not.toBeNull();
    const svg = renderCity(mtn!, "en");
    const hachures = svg.querySelectorAll(".hachure").length;
    const rock = mtn!.mountains.reduce((a, m) => a + area(m.polygon), 0);
    // one stroke per 400 square units is far below what a hachure field gives and far above a rim
    expect(hachures).toBeGreaterThan(rock / 400);
  });
});

// The plate was made to read as a page from the same atlas as the world map -- its own frame,
// compass, cartouche legend and titled heading. Its NAME was the one part still set in the body
// face: the world map's title is Cinzel and a town's was whatever the page inherited, which is the
// same face an ordinary region label wears. It carries the family as an attribute rather than
// through the stylesheet so it survives the export, which takes no CSS with it.
describe("the town plate's name", () => {
  it("is set in the atlas's display face, and says so in the file", () => {
    const svg = renderCity(generateCityLayout(cityContext(marker), 7), "en");
    const title = svg.querySelector(".city-name-text");
    expect(title).not.toBeNull();
    expect(title!.getAttribute("font-family") ?? "").toMatch(/Cinzel/);
  });
});

// A crossing is a built structure, and it was drawn in the colours of the thing it carries. The
// causeway over the moat was #c2b189 on #e6dcc8 — the road palette with the numbers filed off, a
// measured CIE76 distance of 4.2 from the suburb road, which is no distance at all. Nothing in the
// legend named a bridge either, so a reader had nothing to match the line to.
const lab = (h: string): [number, number, number] => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const Y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const Z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
};
const deltaE = (a: string, b: string) => {
  const [l1, a1, b1] = lab(a), [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
};

describe("a bridge is not painted as a piece of road", () => {
  const ROADS = [".road-main", ".road-main-casing", ".road-minor", ".road-minor-casing", ".suburb-road", ".village-lane"];
  const CROSSINGS = [".bridge", ".bridge-deck", ".gate-bridge", ".gate-bridge-top"];
  const strokes = (svg: SVGSVGElement, sel: string[]) =>
    sel.flatMap((s) => [...svg.querySelectorAll(s)].map((e) => e.getAttribute("stroke")!)).filter(Boolean);

  it("keeps every crossing colour perceptually clear of every road colour", () => {
    for (const seed of [1, 3, 5]) {
      const world = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
      for (const city of world.cities) {
        const layout = generateCityLayout(cityContext(city), seed);
        const svg = renderCity(layout, "en");
        const roads = new Set(strokes(svg, ROADS));
        for (const c of new Set(strokes(svg, CROSSINGS))) {
          for (const r of roads) {
            expect(deltaE(c, r), `${c} vs road ${r} in ${city.name}`).toBeGreaterThan(12);
          }
        }
      }
    }
  });

  it("names the bridge in the district key, so the line means something", () => {
    const layout = generateCityLayout({ id: 7, name: "T", size: 4, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND, river: true }, 1);
    const svg = renderCity(layout, "en");
    const labels = [...svg.querySelectorAll(".legend text")].map((t) => t.textContent);
    expect(labels).toContain("Bridge");
    expect([...svg.querySelectorAll(".legend .legend-item")].map((r) => r.getAttribute("fill")))
      .toContain(svg.querySelector(".bridge-deck")!.getAttribute("stroke"));
  });
});

// The furniture of a castle was drawn at constant size, so a size-6 royal seat wore the same
// turrets, wall towers and gate as a size-3 market town, and at this scale the furniture is what
// the eye reads. It is all in units of the donjon now, and a great seat gets parts a lesser one
// has not: an outer curtain around a bailey, and a gatehouse in place of a doorway.
describe("a capital's castle is drawn as a great one", () => {
  const town = (size: number, isCapital: boolean) =>
    renderCity(generateCityLayout({ id: 7, name: "T", size, coastal: false, isCapital, elevation: 0.4, biome: GRASSLAND }, 3), "en");
  const radius = (svg: SVGSVGElement, sel: string) => {
    const el = svg.querySelector(sel);
    return el ? Number(el.getAttribute("r")) : 0;
  };

  it("draws the towers of a great seat larger than a market town's", () => {
    const great = town(6, true), lesser = town(3, false);
    expect(great.querySelector(".castle-tower"), "the capital must have a castle at all").not.toBeNull();
    for (const sel of [".castle-tower", ".castle-turret"]) {
      expect(radius(great, sel), sel).toBeGreaterThan(radius(lesser, sel) * 1.25);
    }
    // the gate is a passage through masonry now, drawn as a block rather than a dot
    const gateW = (svg: SVGSVGElement) => Number(svg.querySelector(".castle-gate")!.getAttribute("width"));
    expect(gateW(great)).toBeGreaterThan(gateW(lesser) * 1.25);
  });

  it("gives the great seat an outer curtain and a gatehouse, and the market town neither", () => {
    const great = town(6, true), lesser = town(3, false);
    expect(great.querySelectorAll(".castle-outer-wall").length).toBeGreaterThan(0);
    expect(great.querySelectorAll(".castle-gatehouse").length).toBe(2);
    expect(lesser.querySelectorAll(".castle-outer-wall").length).toBe(0);
    expect(lesser.querySelectorAll(".castle-gatehouse").length).toBe(0);
  });
});

// "It still doesn't feel like a castle." It didn't: the strongest fortification on the plate was
// drawn as its faintest line. The town's own wall is a 4.0 stroke with a 1.0 highlight and r2.6
// drum towers in warm masonry; the lord's enceinte inside it was a 1.6 hairline with r2.1 grey
// discs and a gate that was a 1.1 dot, so the castle receded instead of dominating.
describe("the castle is the heaviest masonry on the plate", () => {
  const plate = (size: number, isCapital: boolean) =>
    renderCity(generateCityLayout({ id: 7, name: "T", size, coastal: false, isCapital, elevation: 0.4, biome: GRASSLAND }, 3), "en");
  const w = (svg: SVGSVGElement, sel: string) => Number(svg.querySelector(sel)?.getAttribute("stroke-width") ?? 0);
  const r = (svg: SVGSVGElement, sel: string) => Number(svg.querySelector(sel)?.getAttribute("r") ?? 0);

  it("builds the lord's wall no lighter than the town's, and his towers no smaller", () => {
    for (const [size, cap] of [[6, true], [3, false]] as const) {
      const svg = plate(size, cap);
      expect(w(svg, ".castle-wall"), `size ${size} enceinte`).toBeGreaterThanOrEqual(w(svg, ".wall-seg"));
      expect(r(svg, ".castle-tower"), `size ${size} tower`).toBeGreaterThanOrEqual(r(svg, ".tower"));
    }
  });

  it("draws the gatehouse as a building, not two dots", () => {
    const great = plate(6, true);
    expect(great.querySelector(".castle-gatehouse-block")).not.toBeNull();
    expect(plate(3, false).querySelector(".castle-gatehouse-block")).toBeNull();
  });
});

// The countryside generator lays out an abbey and its cloister, a cemetery, a gallows, a leper
// house, a fairground with bunting, inns with signs, barbicans, a market cross, a well, windmills
// and watermills, hamlets with greens and ponds, farmsteads — well over a hundred pieces on a
// single plate. Not one of them carried a name: an outside review counted `<title>` elements in a
// city SVG and got zero, so the gallows read as a bent line and the abbey as a lozenge. Nothing
// here needs to be invented; it needs a label.
describe("the plate names what it draws", () => {
  const withFeatures = () => {
    for (let seed = 1; seed <= 12; seed++) {
      const world = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
      for (const c of world.cities) {
        const l = generateCityLayout(cityContext(c), seed);
        if (l.abbey && l.cemetery && l.gallows && l.inns.length && l.countryside.villages.length) return l;
      }
    }
    throw new Error("no city in twelve seeds has the usual spread of landmarks");
  };

  it("names every landmark outside the walls", () => {
    const l = withFeatures();
    const svg = renderCity(l, "en");
    const titles = [...svg.querySelectorAll("title")].map((t) => t.textContent);
    for (const [present, name] of [
      [!!l.abbey, "Abbey"], [!!l.cemetery, "Cemetery"], [!!l.gallows, "Gallows"],
      [!!l.leperHouse, "Leper house"], [!!l.fairground, "Fairground"],
      [l.inns.length > 0, "Inn"], [!!l.marketCross, "Market cross"], [!!l.well, "Well"],
      [l.countryside.villages.length > 0, "Hamlet"],
      [l.countryside.farmsteads.length > 0, "Farmstead"],
      [l.countryside.orchards.length > 0, "Orchard"],
    ] as [boolean, string][]) {
      if (present) expect(titles, `${name} is drawn but not named`).toContain(name);
    }
    // one name per mill, per hamlet, per inn — not one for the lot
    expect(titles.filter((x) => x === "Inn").length).toBe(l.inns.length);
    expect(titles.filter((x) => x === "Hamlet").length).toBe(l.countryside.villages.length);
  });

  it("names every district, including the ones too small to carry a label on the map", () => {
    const l = withFeatures();
    const svg = renderCity(l, "en");
    const named = [...svg.querySelectorAll(".ward")].map((w) => w.querySelector("title")?.textContent);
    expect(named.length).toBeGreaterThan(4);
    expect(named.filter((n) => !n), "a district with no name").toEqual([]);
    expect(named).toContain("Market Square");
  });

  it("names them in the reader's language", () => {
    const l = withFeatures();
    const titles = [...renderCity(l, "ko").querySelectorAll("title")].map((t) => t.textContent);
    expect(titles).toContain("수도원");
    expect(titles).toContain("시장 광장");
  });
});

describe("the plate says what it is", () => {
  it("names itself at the root, where a reader's software looks", () => {
    const layout = generateCityLayout({ id: 7, name: "Sah", size: 4, coastal: false, isCapital: true, elevation: 0.4, biome: GRASSLAND }, 3);
    const svg = renderCity(layout, "en");
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.querySelector(":scope > title")?.textContent ?? "").toContain("Sah");
    expect(svg.querySelector(":scope > desc")?.textContent ?? "").not.toBe("");
  });

  // I1: the city plate was the one Korean surface with no guard on its own name — `townName` feeds
  // the root <title> AND the on-plate name text, and deleting `properName(` from either call site
  // left the whole 800-test suite green while a Korean reader opened a town titled "Testburg" over
  // a Hangul legend. Mirrors svgWorldRenderer.test.ts's "draws every map name in the language it
  // was asked for", scoped to the two sites that test does not reach (it is the WORLD map's guard).
  it("names the plate's own title and heading in the reader's language", () => {
    const layout = generateCityLayout(cityContext(marker), 7);
    const hasLatin = (s: string) => /[A-Za-z]/.test(s);
    for (const lang of ["en", "ko"] as const) {
      const svg = renderCity(layout, lang);
      const rootTitle = svg.querySelector(":scope > title")?.textContent ?? "";
      const nameText = svg.querySelector(".city-name-text")?.textContent ?? "";
      expect(rootTitle, `${lang}: root title is empty`).not.toBe("");
      expect(nameText, `${lang}: .city-name-text is empty`).not.toBe("");
      if (lang === "ko") {
        expect(hasLatin(rootTitle), `title "${rootTitle}" has a Latin letter on the Korean plate`).toBe(false);
        expect(hasLatin(nameText), `name "${nameText}" has a Latin letter on the Korean plate`).toBe(false);
      } else {
        // asserted in English too, so this proves the language switch does something rather than
        // that the generated name happens to be Hangul-free either way
        expect(hasLatin(rootTitle), `title "${rootTitle}" has no Latin letter in English`).toBe(true);
        expect(hasLatin(nameText), `name "${nameText}" has no Latin letter in English`).toBe(true);
      }
    }
  });
});

// The countryside branched on biome in its COUNTS from the start and never in its picture: a taiga
// plate and a jungle plate drew the same round green tree, the same furlong strips and the same
// farmstead. These check the plate actually SHOWS what `countryside.vocabulary` decided — the
// engine choosing a word means nothing if the drawing still says the old one.
describe("the plate draws the country's own vocabulary", () => {
  const plate = (biome: number, seed = 7) => {
    const m: CityMarker = { ...marker, biome, size: 5, coastal: false, river: false };
    return renderCity(generateCityLayout(cityContext(m), seed));
  };

  it("gives a taiga conifers where the plains keep their round crowns", () => {
    const taiga = plate(TAIGA), plains = plate(GRASSLAND);
    expect(taiga.querySelectorAll(".tree-conifer").length).toBeGreaterThan(0);
    expect(taiga.querySelectorAll("circle.wood-tree").length).toBe(0);
    expect(plains.querySelectorAll("circle.wood-tree").length).toBeGreaterThan(0);
    expect(plains.querySelectorAll(".tree-conifer").length).toBe(0);
  });

  it("gives a desert palms, and no round tree anywhere on the plate", () => {
    const svg = plate(DESERT);
    expect(svg.querySelectorAll(".tree-palm").length).toBeGreaterThan(0);
    expect(svg.querySelectorAll("circle.wood-tree, circle.orchard-tree").length).toBe(0);
  });

  it("holds an alpine field up on terrace lips rather than scratching furrows in it", () => {
    const alpine = plate(ALPINE), plains = plate(GRASSLAND);
    expect(alpine.querySelectorAll(".terrace-lip").length).toBeGreaterThan(0);
    expect(alpine.querySelectorAll(".furrow").length).toBe(0);
    expect(plains.querySelectorAll(".furrow").length).toBeGreaterThan(0);
    expect(plains.querySelectorAll(".terrace-lip").length).toBe(0);
  });

  // seed 7's inland desert happens to place no farm building at all (its two fields leave no
  // corner with room); seed 11's puts up two, which is what this needs to look at.
  it("names the desert's roadside building a caravanserai, and draws its court inside it", () => {
    const svg = plate(DESERT, 11);
    const serais = svg.querySelectorAll(".caravanserai");
    expect(serais.length).toBeGreaterThan(0);
    for (const s of serais) {
      expect(s.querySelector("title")!.textContent).toBe("Caravanserai");
      expect(s.querySelector(".serai-court")).not.toBeNull();
      expect(s.querySelector(".serai-range")).not.toBeNull();
    }
    expect(svg.querySelectorAll(".farmstead").length).toBe(0);
  });
});
