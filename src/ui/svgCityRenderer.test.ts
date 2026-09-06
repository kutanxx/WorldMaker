// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateCityLayout, cityContext } from "../engine/city";
import { renderCity } from "./svgCityRenderer";
import { GRASSLAND, WETLAND } from "../engine/biome";
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
    const layout = generateCityLayout({ id: 7, name: "T", size: 4, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 1);
    const svg = renderCity(layout, "en");
    expect(svg.querySelector(".castle-wall")).not.toBeNull();
    expect(svg.querySelector(".castle-keep")).not.toBeNull();
    expect(svg.querySelector(".castle-keep-shadow")).not.toBeNull();
    expect(svg.querySelector(".castle-keep-inner")).not.toBeNull();
    expect(svg.querySelectorAll(".castle-turret").length).toBe(4);
    expect(svg.querySelectorAll(".castle-tower").length).toBe(layout.castle!.towers.length);
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
    expect(layout.archetype.id).toBe("bridgeTown");
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
