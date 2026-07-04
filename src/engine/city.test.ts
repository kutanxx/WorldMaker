import { describe, it, expect } from "vitest";
import { generateCityLayout, cityContext } from "./city";
import { centroid, pointInPolygon, polysOverlap } from "./geometry";
import { inWater } from "./city/water";
import { inMountains } from "./city/mountain";
import { GRASSLAND } from "./biome";
import type { CityMarker } from "../types/world";

const base: CityMarker = {
  id: 2, cell: 0, x: 0, y: 0, name: "Testburg",
  polityId: 0, isCapital: true, size: 4, coastal: false, elevation: 0.5, biome: 4,
};

function curvaturePct(road: [number, number][]): number {
  if (road.length < 3) return 0;
  const a = road[0], b = road[road.length - 1];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  let m = 0;
  for (const p of road) {
    const d = Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len;
    if (d > m) m = d;
  }
  return (m / len) * 100;
}

describe("city organic", () => {
  it("is deterministic", () => {
    const ctx = cityContext(base);
    expect(JSON.stringify(generateCityLayout(ctx, 9))).toBe(JSON.stringify(generateCityLayout(ctx, 9)));
  });
  it("varies with the world seed", () => {
    const ctx = cityContext(base);
    expect(JSON.stringify(generateCityLayout(ctx, 1))).not.toBe(JSON.stringify(generateCityLayout(ctx, 2)));
  });
  it("places extramural landmarks (abbey/cemetery/gallows) outside the walls, on dry land", () => {
    const l = generateCityLayout(cityContext(base), 7); // size 4 → an abbey is placed
    expect(l.abbey).not.toBeNull();
    expect(l.cemetery).not.toBeNull();
    expect(l.gallows).not.toBeNull();
    expect(l.cemetery!.graves.length).toBeGreaterThan(0);
    for (const p of [l.abbey!.at, l.cemetery!.at, l.gallows!]) {
      expect(pointInPolygon(p, l.boundary)).toBe(false); // extramural: outside the town wall
      expect(inWater(l.water, p)).toBe(false);
      expect(inMountains(l.mountains, p)).toBe(false);
    }
  });
  it("exposes an irregular boundary polygon (radius varies)", () => {
    const l = generateCityLayout(cityContext(base), 5);
    const rs = l.boundary.map((p) => Math.hypot(p[0] - 230, p[1] - 230));
    expect(l.boundary.length).toBeGreaterThanOrEqual(16);
    expect(Math.max(...rs) / Math.min(...rs)).toBeGreaterThan(1.2);
  });
  it("has at least one genuinely curved main road across seeds", () => {
    let curved = false;
    for (let s = 1; s <= 6; s++) {
      const l = generateCityLayout(cityContext({ ...base, coastal: false }), s);
      if (l.mainRoads.some((r) => curvaturePct(r) > 12)) curved = true;
    }
    expect(curved).toBe(true);
  });
  it("a coastal city leaves the seaward wall open (sea gates present)", () => {
    const l = generateCityLayout(cityContext({ ...base, coastal: true }), 5);
    expect(l.wall).not.toBeNull();
    expect(l.wall!.seaGates.length).toBeGreaterThan(0);
  });
  it("gives a moated city one gate bridge per gate, each spanning the moat", () => {
    const l = generateCityLayout(cityContext({ ...base, coastal: true }), 5);
    expect(l.moat).not.toBeNull(); // coastalPort has a moat
    expect(l.gateBridges.length).toBe(l.wall!.gates.length);
    for (const br of l.gateBridges) {
      const len = Math.hypot(br[1][0] - br[0][0], br[1][1] - br[0][1]);
      expect(len).toBeGreaterThan(6); // crosses the ~6px moat band
    }
  });
  it("has no gate bridges when there is no moat", () => {
    const l = generateCityLayout(cityContext({ ...base, coastal: false, elevation: 0.85 }), 5);
    expect(l.moat).toBeNull(); // hilltopFortress has no moat
    expect(l.gateBridges.length).toBe(0);
  });
  it("keeps roads and building centroids inside the boundary and out of water", () => {
    const l = generateCityLayout(cityContext({ ...base, coastal: true }), 8);
    for (const r of [...l.mainRoads, ...l.minorRoads]) for (const p of r) {
      expect(inWater(l.water, p)).toBe(false);
    }
    for (const w of l.wards) for (const b of w.buildings) {
      expect(pointInPolygon(centroid(b), l.boundary)).toBe(true);
    }
  });
  it("always exposes features with archetype-derived defaults", () => {
    const plains = generateCityLayout(cityContext({ ...base, coastal: false, elevation: 0.5, biome: 4 }), 5);
    expect(plains.features.wallMaterial).toBe("stone");
    expect(plains.features.groundColor).toBe("#efe7d2");
    expect(plains.features.trees).toEqual([]);
    const forest = generateCityLayout(cityContext({ ...base, coastal: false, elevation: 0.5, biome: 3 }), 5);
    expect(forest.features.wallMaterial).toBe("timber");
    expect(forest.features.groundColor).toBe("#e3e7d0");
  });
  it("scatters trees on open ground for a forest city (none for plains)", () => {
    const forest = generateCityLayout(cityContext({ ...base, coastal: false, elevation: 0.5, biome: 3 }), 7);
    expect(forest.features.trees.length).toBeGreaterThan(0);
    for (const t of forest.features.trees) {
      expect(pointInPolygon(t, forest.boundary)).toBe(true);
      expect(inWater(forest.water, t)).toBe(false);
    }
    const plains = generateCityLayout(cityContext({ ...base, coastal: false, elevation: 0.5, biome: 4 }), 7);
    expect(plains.features.trees).toEqual([]);
  });
  it("gives a desert city a central oasis (water body) and no green parks", () => {
    const desert = generateCityLayout(cityContext({ ...base, coastal: false, elevation: 0.5, biome: 5 }), 7);
    expect(desert.features.oasis).not.toBeNull();
    expect(desert.parks.length).toBe(0);
    // the oasis was added to the water bodies (so buildings/roads avoid it via the water filter)
    const o = desert.features.oasis!;
    const hasOasisBody = desert.water.bodies.some((body) => {
      const c = centroid(body);
      return Math.hypot(c[0] - o.center[0], c[1] - o.center[1]) < 3;
    });
    expect(hasOasisBody).toBe(true);
    // buildings never sit in water (oasis included)
    for (const w of desert.wards) for (const b of w.buildings) {
      expect(inWater(desert.water, centroid(b))).toBe(false);
    }
  });
  it("builds extramural suburbs (houses + road) outside the wall for a roomy city", () => {
    const l = generateCityLayout(cityContext({ ...base, coastal: false, elevation: 0.5, biome: 4, size: 4 }), 7);
    expect(l.suburbs.length).toBeGreaterThan(0);
    expect(l.suburbRoads.length).toBeGreaterThan(0);
    for (const b of l.suburbs) {
      const c = centroid(b);
      expect(pointInPolygon(c, l.boundary)).toBe(false); // extramural
      expect(inWater(l.water, c)).toBe(false);
      expect(c[0]).toBeGreaterThan(0); expect(c[0]).toBeLessThan(460);
      expect(c[1]).toBeGreaterThan(0); expect(c[1]).toBeLessThan(460);
    }
  });
  it("places an outwork (mill) outside the boundary", () => {
    const l = generateCityLayout(cityContext({ ...base, coastal: false, elevation: 0.5, biome: 4, size: 4 }), 7);
    for (const o of l.outworks) {
      expect(["watermill", "windmill"]).toContain(o.type);
      expect(pointInPolygon(o.at, l.boundary)).toBe(false);
    }
  });
  it("lets a marsh city keep buildings over water (stilts)", () => {
    const marsh = generateCityLayout(cityContext({ ...base, coastal: false, elevation: 0.5, biome: 7 }), 7);
    expect(marsh.features.onStilts).toBe(true);
    const overWater = marsh.wards.flatMap((w) => w.buildings).filter((b) => inWater(marsh.water, centroid(b)));
    expect(overWater.length).toBeGreaterThan(0);
  });
});

describe("canvas 460", () => {
  it("uses a 460x460 canvas with the city centred", () => {
    const layout = generateCityLayout({ id: 7, name: "Test", size: 3, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 1);
    expect(layout.bounds).toEqual({ w: 460, h: 460 });
    // boundary stays a centred island: every vertex well inside the canvas
    for (const [x, y] of layout.boundary) {
      expect(x).toBeGreaterThan(60); expect(x).toBeLessThan(400);
      expect(y).toBeGreaterThan(60); expect(y).toBeLessThan(400);
    }
  });
});

describe("gate roads reach the countryside", () => {
  it("extends every usable gate road to the canvas edge", () => {
    const layout = generateCityLayout({ id: 7, name: "Test", size: 3, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 1);
    expect(layout.suburbRoads.length).toBeGreaterThanOrEqual(2);
    for (const road of layout.suburbRoads) {
      const [ex, ey] = road[road.length - 1];
      const nearEdge = ex < 12 || ex > 448 || ey < 12 || ey > 448;
      expect(nearEdge).toBe(true);
      expect(road.length).toBeGreaterThanOrEqual(3); // gate, bend, edge
    }
    expect(layout.suburbs.length).toBeGreaterThanOrEqual(8); // denser faubourg
  });
  it("suburb houses and countryside patches stay clear of every gate road (user-reported overlap)", () => {
    for (const seed of [1, 5, 12]) {
      const layout = generateCityLayout({ id: 7, name: "Test", size: 3, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, seed);
      const cs = layout.countryside;
      const patches = [
        ...cs.gardens, ...cs.fields.map((f) => f.polygon), ...cs.pastures.map((p) => p.fence),
        ...cs.orchards.map((or) => or.polygon), ...cs.farmsteads.flatMap((f) => [f.house, f.barn]),
      ];
      for (const road of layout.suburbRoads) for (let i = 0; i < road.length - 1; i++) {
        const [x1, y1] = road[i], [x2, y2] = road[i + 1];
        const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 4));
        for (let s = 0; s <= steps; s++) {
          const p: [number, number] = [x1 + ((x2 - x1) * s) / steps, y1 + ((y2 - y1) * s) / steps];
          for (const b of layout.suburbs) expect(pointInPolygon(p, b)).toBe(false);
          for (const patch of patches) expect(pointInPolygon(p, patch)).toBe(false);
        }
      }
    }
  });
});

describe("countryside vs water", () => {
  it("no field/pasture/orchard/garden/village/farmstead overlaps a water body (seed sweep)", () => {
    const offenders: string[] = [];
    for (let s = 1; s <= 30; s++) {
      for (const [coastal, elevation] of [[true, 0.4], [false, 0.4], [false, 0.5]] as const) {
        const l = generateCityLayout({ id: 7, name: "T", size: 3 + (s % 3), coastal, isCapital: false, elevation, biome: GRASSLAND }, s);
        if (!l.water.bodies.length) continue;
        const cs = l.countryside;
        const patches = [
          ...cs.gardens, ...cs.fields.map((f) => f.polygon), ...cs.pastures.map((p) => p.fence),
          ...cs.orchards.map((o) => o.polygon), ...cs.farmsteads.flatMap((f) => [f.house, f.barn]),
          ...cs.villages.flatMap((v) => [v.green, ...v.houses]),
        ];
        for (const patch of patches) for (const body of l.water.bodies) {
          if (polysOverlap(patch, body)) offenders.push(`seed ${s} coastal=${coastal} el=${elevation}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
  it("no field/pasture/garden/orchard sits on the wall moat (seed sweep)", () => {
    const dist = (p: [number, number], a: [number, number], b: [number, number]) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
      return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    };
    const offenders: string[] = [];
    for (let s = 1; s <= 30; s++) {
      const l = generateCityLayout({ id: 7, name: "T", size: 3 + (s % 3), coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, s);
      if (!l.moat) continue;
      const cs = l.countryside;
      const patches = [
        ...cs.gardens, ...cs.fields.map((f) => f.polygon), ...cs.pastures.map((p) => p.fence),
        ...cs.orchards.map((o) => o.polygon),
      ];
      for (const patch of patches) for (const seg of l.moat) for (let i = 0; i < seg.length - 1; i++) {
        for (const v of patch) if (dist(v, seg[i], seg[i + 1]) < 2.5) offenders.push(`seed ${s}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("seigneurial mills", () => {
  it("a watermill sits on dry land with a mill-race reaching the watercourse", () => {
    let found: { water: ReturnType<typeof generateCityLayout>["water"]; race: [ [number, number], [number, number] ]; at: [number, number] } | null = null;
    for (let s = 1; s <= 40 && !found; s++) {
      for (const size of [2, 3, 4]) {
        const l = generateCityLayout({ id: 7, name: "T", size, coastal: true, isCapital: false, elevation: 0.4, biome: GRASSLAND }, s);
        const wm = l.outworks.find((o) => o.type === "watermill" && o.race);
        if (wm && wm.race) { found = { water: l.water, race: wm.race, at: wm.at }; break; }
      }
    }
    expect(found).not.toBeNull();
    expect(inWater(found!.water, found!.race[1])).toBe(true); // the race reaches the water
    expect(inWater(found!.water, found!.at)).toBe(false);     // the mill building is on dry land
  });
});

describe("city mountain (Phase 2)", () => {
  const mtn = { ...base, id: 5, coastal: false, elevation: 0.9, biome: 4 };
  // some high-elevation cities pick a mountain-mass archetype (hillside/spur/valleyPass); find one
  function firstMountainLayout() {
    for (let s = 1; s <= 40; s++) {
      const l = generateCityLayout(cityContext({ ...mtn }), s);
      if (l.mountains.length > 0) return l;
    }
    return null;
  }
  it("produces mountain masses for some high-elevation cities", () => {
    const l = firstMountainLayout();
    expect(l).not.toBeNull();
    expect(l!.mountains.length).toBeGreaterThan(0);
  });
  it("opens the wall on the cliff side and keeps buildings/suburbs off the mountain", () => {
    const l = firstMountainLayout()!;
    const totalWallVerts = (l.wall?.segments ?? []).reduce((n, s) => n + s.length, 0);
    expect(totalWallVerts).toBeLessThan(l.boundary.length + 1); // not a full ring — cliff side is open
    for (const w of l.wards) for (const b of w.buildings) {
      expect(inMountains(l.mountains, centroid(b))).toBe(false);
    }
    for (const b of l.suburbs) expect(inMountains(l.mountains, centroid(b))).toBe(false);
  });
  it("plains cities have no mountains", () => {
    const l = generateCityLayout(cityContext({ ...base, coastal: false, elevation: 0.4, biome: 4 }), 9);
    expect(l.mountains).toEqual([]);
  });
});

describe("city harbor (Phase 3)", () => {
  it("gives a coastal city a harbor (breakwater + boats + quay)", () => {
    const l = generateCityLayout(cityContext({ ...base, coastal: true }), 5);
    expect(l.harbor).not.toBeNull();
    expect(l.harbor!.breakwater.length).toBeGreaterThanOrEqual(2);
    expect(l.harbor!.boats.length).toBeGreaterThanOrEqual(1);
    expect(l.harbor!.quay.length).toBeGreaterThanOrEqual(2);
  });
  it("keeps a city to a few main gates (not one at every road)", () => {
    const l = generateCityLayout(cityContext({ ...base, coastal: false, size: 6, biome: 4 }), 5);
    expect(l.wall!.gates.length).toBeLessThanOrEqual(2 + Math.floor(6 / 3)); // maxGates = 4
  });
  it("has no harbor for an inland city", () => {
    const l = generateCityLayout(cityContext({ ...base, coastal: false, elevation: 0.4, biome: 4 }), 5);
    expect(l.harbor).toBeNull();
  });
  it("never runs gate bridges, suburb roads, or the moat into the sea", () => {
    for (const s of [3, 5, 7, 8, 11, 14]) {
      const l = generateCityLayout(cityContext({ ...base, coastal: true }), s);
      for (const br of l.gateBridges) for (const p of br) {
        expect(inWater(l.water, p)).toBe(false);
      }
      for (const r of l.suburbRoads) for (const p of r) {
        expect(inWater(l.water, p)).toBe(false);
      }
      for (const seg of l.moat ?? []) for (const p of seg) {
        expect(inWater(l.water, p)).toBe(false);
      }
    }
  });
  it("attaches a countryside outside the walls", () => {
    const layout = generateCityLayout({ id: 7, name: "Test", size: 3, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 1);
    const cs = layout.countryside;
    expect(cs.fields.length).toBeGreaterThanOrEqual(2);
    expect(cs.pastures.length).toBeGreaterThanOrEqual(1);
    for (const f of cs.fields) expect(pointInPolygon(centroid(f.polygon), layout.boundary)).toBe(false);
    for (const p of cs.pastures) expect(pointInPolygon(centroid(p.fence), layout.boundary)).toBe(false);
  });
  it("every city has a lord's castle with an inner wall and keep", () => {
    for (const size of [1, 3, 5]) {
      const layout = generateCityLayout({ id: 7, name: "T", size, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 1);
      expect(layout.castle).not.toBeNull();
      expect(layout.wards.some((w2) => w2.type === "castle")).toBe(true);
    }
  });
});

describe("parish churches", () => {
  it("scatters 1+size churches across non-civic wards, all inside the walls", () => {
    const l = generateCityLayout({ id: 7, name: "T", size: 3, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 1);
    const eligible = l.wards.filter((w) => !["cathedral", "castle", "plaza", "harbor"].includes(w.type)).length;
    expect(l.parishChurches.length).toBe(Math.min(1 + 3, eligible));
    for (const p of l.parishChurches) expect(pointInPolygon(p, l.boundary)).toBe(true);
  });
});

describe("market square + inns", () => {
  it("puts the market cross on the plaza and inns outside the gate", () => {
    const l = generateCityLayout({ id: 7, name: "T", size: 4, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 2);
    const plaza = l.wards.find((w) => w.type === "plaza");
    expect(l.marketCross).not.toBeNull();
    if (plaza) { const c = centroid(plaza.polygon); expect(Math.hypot(l.marketCross![0] - c[0], l.marketCross![1] - c[1])).toBeLessThan(0.01); }
    expect(l.well).not.toBeNull();
    expect(l.inns.length).toBeGreaterThanOrEqual(1);
    for (const p of l.inns) expect(pointInPolygon(p, l.boundary)).toBe(false);
  });
});

describe("barbican", () => {
  it("builds a forward gate-work at the principal (non-water) gate, outside the wall", () => {
    const l = generateCityLayout({ id: 7, name: "T", size: 4, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 1);
    expect(l.barbicans.length).toBeGreaterThanOrEqual(1);
    for (const b of l.barbicans) {
      expect(pointInPolygon(b.at, l.boundary)).toBe(false);
      expect(inWater(l.water, b.at)).toBe(false);
      expect(b.towers.length).toBe(2);
      expect(b.walls.length).toBe(2);
    }
  });
});

describe("waterside trades", () => {
  it("puts tanners/dyers by the water outside the walls, none inland-dry", () => {
    const nearWater = (w: ReturnType<typeof generateCityLayout>["water"], p: [number, number]) =>
      inWater(w, [p[0] + 5, p[1]]) || inWater(w, [p[0] - 5, p[1]]) || inWater(w, [p[0], p[1] + 5]) || inWater(w, [p[0], p[1] - 5]);
    let coastalHit = false;
    for (let s = 1; s <= 20 && !coastalHit; s++) {
      const l = generateCityLayout({ id: 7, name: "T", size: 4, coastal: true, isCapital: false, elevation: 0.4, biome: GRASSLAND }, s);
      if (l.riversideTrades.length) {
        coastalHit = true;
        for (const t of l.riversideTrades) {
          expect(pointInPolygon(t.at, l.boundary)).toBe(false);
          expect(nearWater(l.water, t.at)).toBe(true);
        }
      }
    }
    expect(coastalHit).toBe(true);
    // inland dry (elevation<0.7, non-coastal, no water archetype) → empty
    const dry = generateCityLayout({ id: 7, name: "T", size: 3, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 9);
    if (!dry.water.bodies.length) expect(dry.riversideTrades.length).toBe(0);
  });
});
