import { describe, it, expect } from "vitest";
import { generateCityLayout, cityContext } from "./city";
import { centroid, area, pointInPolygon, polysOverlap, polygonSelfIntersects, pointSegDist, bbox, segmentsIntersect, clipToConvex } from "./geometry";
import { inWater, overlapsWater } from "./city/water";
import { inMountains } from "./city/mountain";
import { GRASSLAND, WETLAND } from "./biome";
import type { CityMarker } from "../types/world";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";

const base: CityMarker = {
  id: 2, cell: 0, x: 0, y: 0, name: "Testburg",
  polityId: 0, isCapital: true, size: 4, coastal: false, elevation: 0.5, biome: 4, river: false,
};

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
  it("shows a river in the drilldown when a world river runs through the city cell (world<->city coupling)", () => {
    const withRiver = generateCityLayout({ id: 7, name: "T", size: 4, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND, river: true }, 1);
    // a river cell yields one of the two river kinds — crossed by bridges, or wrapped by a loop of it
    expect(["bridgeTown", "meanderDefense"]).toContain(withRiver.archetype.id);
    expect(["river", "loop"]).toContain(withRiver.water.kind);
    expect(withRiver.water.bodies.length).toBeGreaterThan(0);
    // a river town is defended by the river, not a separate moat ring, and its river is crossed —
    // the banks of a town it runs through, or the road out of a town it wraps
    expect(withRiver.moat).toBeNull();
    expect(withRiver.water.bridges.length).toBeGreaterThanOrEqual(1);
    // every bridge is the continuation of a road across the river — an abutment sits ON the road
    // (a floating bridge line that didn't meet any road read as "just a line", user-reported).
    // This used to demand a road VERTEX at each end, which held only while a bridge WAS a whole road
    // segment; now it spans the crossing itself, so it starts anywhere along the road and its far
    // end lands on whatever the road reaches next — the chord across a bend in the street.
    const roads = [...withRiver.mainRoads, ...withRiver.minorRoads, ...withRiver.suburbRoads];
    const toRoad = (p: [number, number]) => {
      let best = Infinity;
      for (const r of roads) for (let k = 0; k < r.length - 1; k++) best = Math.min(best, pointSegDist(p, r[k], r[k + 1]));
      return best;
    };
    for (const [a, b] of withRiver.water.bridges) expect(Math.min(toRoad(a), toRoad(b))).toBeLessThan(0.01);
    // the same inland cell WITHOUT a world river is a dry-market town, not a river town
    const noRiver = generateCityLayout({ id: 7, name: "T", size: 4, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND, river: false }, 1);
    expect(noRiver.archetype.id).not.toBe("bridgeTown");
  });
  it("keeps minor-road midpoints and building centroids out of water (main streets may be bridged)", () => {
    const l = generateCityLayout(cityContext({ ...base, coastal: true }), 8);
    // minor streets whose MIDPOINT falls in water are dropped (block-centric: no bridge budget
    // for them); an endpoint shared with an adjoining ward node may still graze water — the
    // midpoint sample is the actual contract (see "block-centric streets" describe below).
    // main streets are allowed to cross — those crossings get a bridge (water.bridges) instead.
    for (const r of l.minorRoads) {
      const m: [number, number] = [(r[0][0] + r[1][0]) / 2, (r[0][1] + r[1][1]) / 2];
      expect(inWater(l.water, m)).toBe(false);
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

describe("block-centric streets", () => {
  const segMid = (s: [number, number][]) => [(s[0][0] + s[1][0]) / 2, (s[0][1] + s[1][1]) / 2] as [number, number];
  it("streets are ward edges, gates connect to a main road, and buildings never sit on a street", () => {
    for (const s of [1, 5, 9]) {
      const l = generateCityLayout({ id: 7, name: "T", size: 4, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, s);
      // every gate has a main-road point on it (stub start)
      for (const g of l.wall!.gates) {
        expect(l.mainRoads.some((r) => r.some((p) => Math.hypot(p[0] - g[0], p[1] - g[1]) < 1))).toBe(true);
      }
      // no building centroid sits on a minor street midpoint's block gap (sample: no minor street
      // midpoint falls inside any building polygon — the inset guarantees the gap)
      const buildings = l.wards.flatMap((w) => w.buildings);
      for (const st of l.minorRoads) {
        const m = segMid(st as [number, number][]);
        expect(buildings.some((b) => pointInPolygon(m, b))).toBe(false);
      }
      // no MINOR street runs through water
      for (const st of l.minorRoads) expect(inWater(l.water, segMid(st as [number, number][]))).toBe(false);
    }
  });
  it("is deterministic", () => {
    const ctx = { id: 3, name: "T", size: 4, coastal: true, isCapital: false, elevation: 0.4, biome: GRASSLAND };
    expect(JSON.stringify(generateCityLayout(ctx, 4))).toBe(JSON.stringify(generateCityLayout(ctx, 4)));
  });
  it("keeps building corners a visible gap off the ward-edge streets (edge-offset inset)", () => {
    const segDist = (p: [number, number], a: [number, number], b: [number, number]) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
      return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    };
    for (const s of [1, 3, 5, 7, 9]) {
      const l = generateCityLayout({ id: 7, name: "T", size: 4, coastal: true, isCapital: false, elevation: 0.4, biome: GRASSLAND }, s);
      // measure clearance to the ward-edge streets only (minor + main graph edges), NOT the gate/
      // fallback stubs which legitimately cut toward gates/centre
      const streets = l.minorRoads.filter((r) => r.length === 2);
      let minClear = Infinity;
      for (const w of l.wards) for (const b of w.buildings) for (const v of b) {
        for (const r of streets) minClear = Math.min(minClear, segDist(v, r[0] as [number, number], r[1] as [number, number]));
      }
      // was ~0.05 with the radial inset — roads painted over buildings. Threshold relaxed slightly
      // from 1.2 → 1.1: the insetConvex final bowtie/degenerate guard (see geometry.ts) now falls
      // back to the radial inset for a handful of wards where the mitered+nudged offset would
      // otherwise self-intersect, which trades a little clearance for guaranteed non-bowtie buildings.
      expect(minClear).toBeGreaterThan(1.1);

    }
  });
  it("never draws a main street fully across open water", () => {
    for (const s of [2, 4, 6, 8]) {
      const l = generateCityLayout({ id: 7, name: "T", size: 4, coastal: true, isCapital: false, elevation: 0.4, biome: GRASSLAND }, s);
      for (const r of l.mainRoads) if (r.length === 2) {
        expect(inWater(l.water, r[0]) && inWater(l.water, r[1])).toBe(false);
      }
    }
  });
  it("never produces a self-intersecting (bowtie) building", () => {
    for (const s of [1, 3, 5, 7, 9]) {
      const l = generateCityLayout({ id: 7, name: "T", size: 4, coastal: true, isCapital: false, elevation: 0.4, biome: GRASSLAND }, s);
      for (const w of l.wards) for (const b of w.buildings) {
        expect(polygonSelfIntersects(b)).toBe(false);
      }
    }
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
      // clearance is to the moat CENTERLINE; the moat renders as a 5px-wide stroke (2.5 half), so a
      // patch must clear that half plus a visible gap. 2.5 (bare half) left patches abutting the blue.
      for (const patch of patches) for (const seg of l.moat) for (let i = 0; i < seg.length - 1; i++) {
        for (const v of patch) if (dist(v, seg[i], seg[i + 1]) < 5) offenders.push(`seed ${s}`);
      }
    }
    expect(offenders).toEqual([]);
  });
  it("no intramural building overlaps a harbor wharf (user-reported building overlap, coastal sweep)", () => {
    let sawWharves = false;
    const offenders: string[] = [];
    for (let s = 1; s <= 30; s++) {
      const l = generateCityLayout({ id: 2, name: "T", size: 3 + (s % 3), coastal: true, isCapital: false, elevation: 0.4, biome: GRASSLAND }, s);
      const wharves = l.harbor?.wharves ?? [];
      if (!wharves.length) continue;
      sawWharves = true;
      const buildings = l.wards.flatMap((w) => w.buildings);
      for (const wf of wharves) for (const b of buildings) if (polysOverlap(wf, b)) offenders.push(`seed ${s}`);
    }
    expect(sawWharves).toBe(true); // the sweep actually exercised coastal harbors
    expect(offenders).toEqual([]);
  });
  it("no road runs through an intramural building (user-reported road-through-building, seed sweep)", () => {
    const through = (line: [number, number][], poly: [number, number][]) => {
      const si = (a: [number, number], b: [number, number], c: [number, number], d: [number, number]) => {
        const o = (p: [number, number], q: [number, number], r: [number, number]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
        return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
      };
      for (let i = 0; i < line.length - 1; i++) {
        const a = line[i], b = line[i + 1];
        const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
        for (let s = 0; s <= steps; s++) if (pointInPolygon([a[0] + (b[0] - a[0]) * s / steps, a[1] + (b[1] - a[1]) * s / steps], poly)) return true;
        for (let j = 0; j < poly.length; j++) if (si(a, b, poly[j], poly[(j + 1) % poly.length])) return true;
      }
      return false;
    };
    const offenders: string[] = [];
    for (let s = 1; s <= 30; s++) {
      const l = generateCityLayout({ id: 2, name: "T", size: 2 + (s % 4), coastal: s % 2 === 0, isCapital: false, elevation: 0.4, biome: GRASSLAND }, s);
      const buildings = l.wards.flatMap((w) => w.buildings);
      for (const r of [...l.mainRoads, ...l.minorRoads]) for (const b of buildings) if (through(r, b)) { offenders.push(`seed ${s}`); break; }
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
  // this used to assert that EVERY city has a castle, which pinned the old universal-castle rule
  // rather than the thing it names. What it protects is the castle's fabric: wherever a lord is
  // seated, the seat is a walled enclosure with a keep, standing in a ward of its own.
  it("gives a seated lord an inner wall, towers and a keep, in a castle ward", () => {
    for (const size of [1, 3, 5]) {
      const layout = generateCityLayout({ id: 7, name: "T", size, coastal: false, isCapital: true, elevation: 0.4, biome: GRASSLAND }, 1);
      expect(layout.castle).not.toBeNull();
      expect(layout.castle!.innerWall.length).toBeGreaterThan(2);
      expect(layout.castle!.towers.length).toBe(layout.castle!.innerWall.length);
      expect(layout.castle!.keep.length).toBeGreaterThan(2);
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
    const plaza = l.wards.find((w) => w.type === "plaza")!;
    expect(plaza).toBeDefined();
    expect(l.marketCross).not.toBeNull();
    expect(l.well).not.toBeNull();
    // on the square's open ground, not on a road crossing it (it stood at the square's centroid,
    // which put the cross or the well on a road through it on four plates of twelve worlds)
    const roads = [...l.mainRoads, ...l.minorRoads];
    const toRoad = (p: [number, number]) => { let d = Infinity; for (const r of roads) for (let k = 0; k < r.length - 1; k++) d = Math.min(d, pointSegDist(p, r[k], r[k + 1])); return d; };
    for (const p of [l.marketCross!, l.well!]) {
      expect(pointInPolygon(p, plaza.polygon) && pointInPolygon(p, l.boundary)).toBe(true);
      expect(inWater(l.water, p)).toBe(false);
      expect(toRoad(p)).toBeGreaterThan(2.5);
    }
    // ...and near its middle
    const c = centroid(plaza.polygon);
    expect(Math.hypot(l.marketCross![0] - c[0], l.marketCross![1] - c[1])).toBeLessThan(20);
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

describe("inn/barbican separation", () => {
  it("keeps inns clear of barbican towers at the principal gate", () => {
    for (const s of [1, 2, 3]) {
      const l = generateCityLayout({ id: 7, name: "T", size: 4, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, s);
      for (const inn of l.inns) for (const b of l.barbicans) for (const t of b.towers) {
        expect(Math.hypot(inn[0] - t[0], inn[1] - t[1])).toBeGreaterThan(5);
      }
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

// Which quarters get their name on the plan. Measured across eight cities: the civic landmarks are
// always singular — one plaza, one cathedral, one guildhall, one castle — while the living quarters
// repeat, craftsmen up to thirteen times and slums up to eight. Naming every ward would print the
// same word down the length of a city; naming only the five landmarks left the market, the merchant
// quarter and the harbour unnamed even where the city had exactly one of each.
describe("city labels name what is singular", () => {
  const build = (seed: number, pick: (c: CityMarker) => boolean = () => true) => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
    const marker = world.cities.filter(pick)[0];
    return generateCityLayout(cityContext(marker), seed);
  };

  it("never names a kind of quarter the city has more than one of", () => {
    for (const seed of [1, 7, 42]) {
      const L = build(seed, (c) => c.isCapital);
      const counts = new Map<string, number>();
      for (const w of L.wards) counts.set(w.type, (counts.get(w.type) ?? 0) + 1);
      for (const l of L.labels) {
        expect(counts.get(l.type), `seed ${seed}: ${l.type} appears ${counts.get(l.type)} times`).toBe(1);
      }
      // and no label is printed twice
      expect(new Set(L.labels.map((l) => l.type)).size).toBe(L.labels.length);
    }
  });

  it("always names the civic landmarks, whatever their size", () => {
    const L = build(1, (c) => c.isCapital);
    const present = new Set(L.wards.map((w) => w.type));
    for (const t of ["plaza", "castle", "cathedral", "guildhall"]) {
      if (present.has(t as never)) {
        expect(L.labels.some((l) => l.type === t), `${t} is a landmark and should be named`).toBe(true);
      }
    }
  });

  it("names the market too, which is one place in a city and was left off", () => {
    const L = build(1, (c) => c.isCapital);
    const markets = L.wards.filter((w) => w.type === "market").length;
    expect(markets).toBe(1);                                   // the measurement this rests on
    expect(L.labels.some((l) => l.type === "market")).toBe(true);
  });

  it("puts more names on the plan than the old five-type list did", () => {
    const L = build(1, (c) => c.isCapital);
    expect(L.labels.length).toBeGreaterThan(4);
  });
});

// A castle in all 28 towns of a world told the reader nothing: measured across 10 seeds every one
// of 280 towns had one, small hamlets included. The castle now marks a LORD'S SEAT — the realm's
// capital, the fortress that is itself a castle, and a minority of market towns — so its presence
// on the plate carries information again.
describe("the lord's castle", () => {
  const town = (over: Partial<typeof base>) => cityContext({ ...base, ...over });
  it("stands in the capital of the realm", () => {
    for (let s = 1; s <= 12; s++) {
      expect(generateCityLayout(town({ isCapital: true, size: 4 }), s).castle).not.toBeNull();
    }
  });
  it("is absent from a hamlet — walls alone do not seat a lord", () => {
    for (let s = 1; s <= 12; s++) {
      for (const size of [1, 2]) {
        expect(generateCityLayout(town({ isCapital: false, size }), s).castle).toBeNull();
      }
    }
  });
  it("seats a lord in some market towns and not others", () => {
    let seated = 0, unseated = 0;
    for (let s = 1; s <= 40; s++) {
      if (generateCityLayout(town({ isCapital: false, size: 3 }), s).castle) seated++;
      else unseated++;
    }
    expect(seated).toBeGreaterThan(4);
    expect(unseated).toBeGreaterThan(4);
  });
  it("always holds the hilltop fortress, which is a castle before it is a town", () => {
    // the high ground picks among its four kinds of town by a stream of its own: find the worlds
    // in which this one is the fortress, rather than naming seeds that depend on that stream
    let forts = 0;
    for (let s = 1; s <= 60; s++) {
      const l = generateCityLayout(town({ isCapital: false, size: 2, elevation: 0.85 }), s);
      if (l.archetype.id !== "hilltopFortress") continue;
      forts++;
      expect(l.castle, `seed ${s}`).not.toBeNull();
    }
    expect(forts, "no hilltop fortress in sixty worlds").toBeGreaterThan(5);
  });
});

// A town's whole internal organisation comes from where the ward points are dropped: they are
// Voronoi'd into wards, and the shared cell edges ARE the streets. Those points were uniform random
// in a disc for every kind of town, so every plan came out the same wheel of wedges -- and the
// archetype's `streetField`, which names four kinds of plan, was read in exactly one place, to
// stretch the OUTLINE of a linear town. Measured across ten seeds, all eleven archetypes scored a
// median 43-58% on the test below, the grid one among them at 50%.
//
// Fold every street direction into 0..90 degrees and the two families of a grid plan land on each
// other, so a grid piles up on one heading while an organic plan spreads: uniform directions score
// 33%, today's towns score about 50%, and a real grid should be far above both.
function gridness(l: { mainRoads: [number, number][][]; minorRoads: [number, number][][] }): number {
  const dirs: number[] = [];
  for (const r of [...l.mainRoads, ...l.minorRoads]) {
    for (let i = 0; i < r.length - 1; i++) {
      const dx = r[i + 1][0] - r[i][0], dy = r[i + 1][1] - r[i][1];
      if (Math.hypot(dx, dy) > 1) dirs.push(((Math.atan2(dy, dx) * 180) / Math.PI + 180) % 90);
    }
  }
  let best = 0;
  for (let h = 0; h < 90; h += 2) {
    const n = dirs.filter((d) => { const x = Math.abs(d - h); return Math.min(x, 90 - x) <= 15; }).length;
    best = Math.max(best, n / dirs.length);
  }
  return best;
}

describe("a market town on the plains is laid out on a grid", () => {
  it("meets its streets at right angles, unlike the organic towns beside it", () => {
    const grid: number[] = [], organic: number[] = [];
    for (let seed = 1; seed <= 10; seed++) {
      const w = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
      for (const c of w.cities) {
        const l = generateCityLayout(cityContext(c), seed);
        if (l.archetype.streetField === "grid") grid.push(gridness(l));
        else if (l.archetype.streetField === "organic") organic.push(gridness(l));
      }
    }
    expect(grid.length).toBeGreaterThan(10);
    expect(organic.length).toBeGreaterThan(10);
    const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    // measured: 0.71 for the grid towns against 0.48 for the organic ones. Before the lattice they
    // were 0.50 and 0.48 -- a two-point gap, which is what "the field named nothing" looked like.
    expect(med(grid)).toBeGreaterThan(0.62);
    expect(med(grid) - med(organic)).toBeGreaterThan(0.15);
  });
});

// The other two thirds of the same finding. `streetField` names four plans; grid became one, and
// radial and linear still named nothing. Measured over twelve seeds before this: a wheel score
// (mean |cos 2t| of each street against the radius -- 1.0 for spokes and rings, 0.64 for directions
// that ignore the centre) of 0.71 for the radial archetypes against organic's 0.66, and a ward-cloud
// aspect (spread along its own principal axis over the spread across it) of 1.17 for the linear ones
// against organic's 1.22 -- the linear towns were, if anything, rounder than the rest.
function wheelScore(l: ReturnType<typeof generateCityLayout>): number {
  let sum = 0, n = 0;
  for (const r of [...l.mainRoads, ...l.minorRoads]) {
    for (let i = 0; i < r.length - 1; i++) {
      const dx = r[i + 1][0] - r[i][0], dy = r[i + 1][1] - r[i][1];
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;
      const mx = (r[i][0] + r[i + 1][0]) / 2 - 230, my = (r[i][1] + r[i + 1][1]) / 2 - 230;
      const rl = Math.hypot(mx, my) || 1;
      const cos = (dx * mx + dy * my) / (len * rl);
      sum += Math.abs(2 * cos * cos - 1);
      n++;
    }
  }
  return n > 5 ? sum / n : NaN;
}
// A town strung along one thing has its streets in parallel bands: fold every direction into 0..180
// and nearly all the street LENGTH falls in one window. Uniform directions give 22%, a grid splits
// between two families 90 apart and reaches about 51%, and a spine town should be far past both.
// (The first metric tried here was the spread of the ward centroids, which measured nothing: a
// Voronoi cell fills the space it is clipped to, so points in a narrow band still make cells that
// reach the rim, and the cloud of centroids stayed as round as ever.)
function banding(l: ReturnType<typeof generateCityLayout>): number {
  const segs: [number, number][] = [];
  for (const r of [...l.mainRoads, ...l.minorRoads]) {
    for (let i = 0; i < r.length - 1; i++) {
      const dx = r[i + 1][0] - r[i][0], dy = r[i + 1][1] - r[i][1];
      const len = Math.hypot(dx, dy);
      if (len > 1) segs.push([((Math.atan2(dy, dx) * 180) / Math.PI + 180) % 180, len]);
    }
  }
  if (segs.length < 6) return NaN;
  const total = segs.reduce((a, sg) => a + sg[1], 0);
  let best = 0;
  for (let h = 0; h < 180; h += 2) {
    let acc = 0;
    for (const [d, len] of segs) { const x = Math.abs(d - h); if (Math.min(x, 180 - x) <= 20) acc += len; }
    best = Math.max(best, acc / total);
  }
  return best;
}
describe("the high fortress is a wheel, the river town a spine", () => {
  const gather = () => {
    const by = new Map<string, { wheel: number[]; band: number[] }>();
    for (let seed = 1; seed <= 12; seed++) {
      const w = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
      for (const c of w.cities) {
        const l = generateCityLayout(cityContext(c), seed);
        const e = by.get(l.archetype.streetField) ?? { wheel: [], band: [] };
        const s = wheelScore(l);
        if (!Number.isNaN(s)) e.wheel.push(s);
        const b = banding(l);
        if (!Number.isNaN(b)) e.band.push(b);
        by.set(l.archetype.streetField, e);
      }
    }
    return by;
  };
  const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  it("gives a radial town spokes and rings", () => {
    const by = gather();
    expect(med(by.get("radial")!.wheel)).toBeGreaterThan(0.85); // measured: 0.92, and 0.71 before
    expect(med(by.get("radial")!.wheel)).toBeGreaterThan(med(by.get("organic")!.wheel) + 0.15);
  });
  it("strings a linear town along one axis", () => {
    const by = gather();
    // measured: 0.74 against organic's 0.39. Before, the linear towns measured 0.39 too.
    expect(med(by.get("linear")!.band)).toBeGreaterThan(0.6);
    expect(med(by.get("linear")!.band) - med(by.get("organic")!.band)).toBeGreaterThan(0.2);
  });
});

// The lord's castle used to be sited by a rule that knew about the SEA (bias the wall pick away
// from the harbour side) and nothing else, so a river, a lake or a marsh under the town was
// invisible to it. Measured over 30 seeds: 12 of 333 castles had a part standing in open water —
// the enceinte crossing a river in all twelve, a corner tower in eight, and in five the castle
// GATE opened onto the water. Water is drawn before the castle, so every one of those rendered as
// a keep afloat.
describe("the lord's castle stands on dry land", () => {
  const layouts = () => {
    const out: { name: string; seed: number; layout: ReturnType<typeof generateCityLayout> }[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      const w = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
      for (const c of w.cities) out.push({ name: c.name, seed, layout: generateCityLayout(cityContext(c), seed) });
    }
    return out;
  };

  it("puts no part of a castle in the water of a town that has dry ground to spare", () => {
    for (const { name, seed, layout } of layouts()) {
      const ca = layout.castle;
      // a stilt town stands over its marsh by design: there is no dry ward to move to
      if (!ca || layout.archetype.onStilts) continue;
      const wet = (poly: [number, number][]) => layout.water.bodies.some((b) => polysOverlap(poly, b));
      const where = `${name} (seed ${seed}, ${layout.archetype.id})`;
      expect(wet(ca.innerWall), `enceinte of ${where}`).toBe(false);
      expect(wet(ca.keep), `keep of ${where}`).toBe(false);
      expect(ca.towers.some((p) => inWater(layout.water, p)), `a tower of ${where}`).toBe(false);
      expect(ca.annexes.some(wet), `an annex of ${where}`).toBe(false);
      expect(inWater(layout.water, ca.gate), `the gate of ${where}`).toBe(false);
    }
  });
});

// ★ A castle is built inside the town it guards. It used to be built from its whole Voronoi cell —
// which is cut by a disc, not by the wall, and stood a median 29% outside the town — and was then
// drawn through a clip to the wall: over 12 worlds 102 of 125 enceintes were cut open, 51 keeps
// lost corners (two entirely), and in 90 castles the town wall ran straight through the yard. The
// ward is cut to the town first now, and where it meets the town's outline the castle's wall IS
// the town wall.
describe("the castle stands inside the town it guards", () => {
  const castles = (() => {
    let memo: { where: string; l: ReturnType<typeof generateCityLayout> }[] | null = null;
    return () => {
      if (memo) return memo;
      memo = [];
      for (let seed = 1; seed <= 12; seed++) {
        const w = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
        for (const c of w.cities) {
          const l = generateCityLayout(cityContext(c), seed);
          if (l.castle) memo.push({ where: `${c.name} (seed ${seed}, ${l.archetype.id})`, l });
        }
      }
      return memo;
    };
  })();
  const edgeDist = (p: [number, number], poly: [number, number][]) => {
    let d = Infinity;
    for (let i = 0; i < poly.length; i++) d = Math.min(d, pointSegDist(p, poly[i], poly[(i + 1) % poly.length]));
    return d;
  };
  // inside the town, or on its outline: where the castle's wall is the town's
  const inTown = (p: [number, number], l: ReturnType<typeof generateCityLayout>) =>
    pointInPolygon(p, l.boundary) || edgeDist(p, l.boundary) <= 0.5;

  it("builds no part of a castle beyond the town wall", () => {
    expect(castles().length, "no castles in twelve worlds").toBeGreaterThan(100);
    for (const { where, l } of castles()) {
      const ca = l.castle!;
      const parts: [string, [number, number][]][] = [["enceinte", ca.innerWall], ["keep", ca.keep], ...ca.annexes.map((a, i) => [`hall ${i}`, a] as [string, [number, number][]])];
      if (ca.outerWall) parts.push(["outer curtain", ca.outerWall]);
      for (const [what, poly] of parts) for (const p of poly) expect(inTown(p, l), `${what} of ${where}`).toBe(true);
      expect(inTown(ca.gate, l), `gate of ${where}`).toBe(true);
    }
  });

  it("keeps the town wall out of the castle's yard", () => {
    for (const { where, l } of castles()) {
      const ca = l.castle!;
      for (const s of l.wall!.segments) for (let i = 0; i < s.length - 1; i++) {
        for (let k = 0; k <= 10; k++) {
          const p: [number, number] = [s[i][0] + ((s[i + 1][0] - s[i][0]) * k) / 10, s[i][1] + ((s[i + 1][1] - s[i][1]) * k) / 10];
          const deep = pointInPolygon(p, ca.innerWall) && edgeDist(p, ca.innerWall) > 3;
          expect(deep, `the town wall crosses the yard of ${where}`).toBe(false);
        }
      }
    }
  });

  it("stands the donjon clear of its own rampart", () => {
    for (const { where, l } of castles()) {
      for (const p of l.castle!.keep) {
        expect(pointInPolygon(p, l.castle!.innerWall), `keep of ${where}`).toBe(true);
        expect(edgeDist(p, l.castle!.innerWall), `keep of ${where}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  // measured before this: 71 of 96 great seats had the curtain and the enceinte under six units
  // apart — two walls drawn nearly on top of each other, not a castle with a bailey
  it("gives a great seat a bailey you could muster in, on the town side", () => {
    let great = 0;
    for (const { where, l } of castles()) {
      const ca = l.castle!;
      if (!ca.outerWall) continue;
      great++;
      const townSide = (a: [number, number], b: [number, number]) => edgeDist([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], l.boundary) > 0.5;
      const ow = ca.outerWall;
      for (let i = 0; i < ca.innerWall.length; i++) {
        const a = ca.innerWall[i], b = ca.innerWall[(i + 1) % ca.innerWall.length];
        if (!townSide(a, b)) continue;
        const m: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        let gap = Infinity;
        for (let j = 0; j < ow.length; j++) if (townSide(ow[j], ow[(j + 1) % ow.length])) gap = Math.min(gap, pointSegDist(m, ow[j], ow[(j + 1) % ow.length]));
        // the rings are parallel offsets 8 apart; a short edge where the town's outline cuts both
        // can sit a little nearer its neighbour's counterpart (7.5 at worst over twelve worlds)
        expect(gap, `bailey of ${where}`).toBeGreaterThanOrEqual(7);
      }
    }
    expect(great, "no great seat with a curtain in twelve worlds").toBeGreaterThan(40);
  });

  it("stands no town-wall tower beside a castle tower on the stretch they share", () => {
    for (const { where, l } of castles()) {
      const ca = l.castle!;
      const rings = [ca.innerWall, ...(ca.outerWall ? [ca.outerWall] : [])];
      for (const t of l.wall!.towers) for (const r of rings) expect(edgeDist(t, r), `a doubled tower at ${where}`).toBeGreaterThanOrEqual(2);
    }
  });

  // The plan names each ward at its own centre, and a castle's centre is its donjon — so the word
  // "Castle" was printed straight across the keep; then it was walked out of the yard until it had
  // just left the enceinte, which stood it ON the wall of all 125 castles.
  it("puts the castle's name on the castle's own ground, never on its donjon", () => {
    for (const { where, l } of castles()) {
      const lab = l.labels.find((x) => x.type === "castle");
      if (!lab) continue;
      const ward = l.wards.find((x) => x.type === "castle")!;
      expect(pointInPolygon([lab.x, lab.y], ward.polygon) && inTown([lab.x, lab.y], l), `name of ${where}`).toBe(true);
      // the name's middle, and a Korean name's width either side of it, stand off the donjon
      for (const dx of [-7, 0, 7]) expect(pointInPolygon([lab.x + dx, lab.y - 1.5], l.castle!.keep), `name on the keep of ${where}`).toBe(false);
    }
  });
});

// The ward mesh is the town: streets are the edges wards share, blocks are what wards enclose. So
// a hole in the mesh is a hole in the city — blank ground inside the wall, and streets that stop
// dead against it. The mesh was a Voronoi diagram clipped to a disc of radius*1.15 and then had
// cells DELETED from it wherever a site fell outside the wall or in the water, which takes the
// ground inside the wall that the same cell covered. Measured over twelve seeds: the wards covered
// a median 87.8% of the walled area, a tenth of towns under 65%, the worst 32%.
describe("the ward mesh covers the town it is a mesh of", () => {
  it("leaves no ground inside the wall without a ward on it", () => {
    let worst = 1, worstName = "";
    for (let seed = 1; seed <= 6; seed++) {
      const world = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
      for (const c of world.cities) {
        const l = generateCityLayout(cityContext(c), seed);
        if (!l.boundary) continue;
        const b = bbox(l.boundary);
        let inside = 0, covered = 0;
        for (let x = b.minX; x <= b.maxX; x += 4) for (let y = b.minY; y <= b.maxY; y += 4) {
          const p: [number, number] = [x, y];
          if (!pointInPolygon(p, l.boundary)) continue;
          inside++;
          if (l.wards.some((w) => pointInPolygon(p, w.polygon))) covered++;
        }
        if (inside > 20 && covered / inside < worst) { worst = covered / inside; worstName = `${c.name} (seed ${seed})`; }
      }
    }
    expect(worst, `worst covered town: ${worstName}`).toBeGreaterThan(0.95);
  });

  it("does not leave streets stopping dead in the middle of a town", () => {
    const key = (p: [number, number]) => `${Math.round(p[0] * 4)},${Math.round(p[1] * 4)}`;
    let nodes = 0, stranded = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const world = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
      for (const c of world.cities) {
        const l = generateCityLayout(cityContext(c), seed);
        if (!l.boundary) continue;
        const deg = new Map<string, number>(), at = new Map<string, [number, number]>();
        for (const r of [...l.mainRoads, ...l.minorRoads]) for (let i = 0; i < r.length - 1; i++) {
          const a = r[i] as [number, number], b = r[i + 1] as [number, number];
          const ka = key(a), kb = key(b);
          if (ka === kb) continue;
          deg.set(ka, (deg.get(ka) ?? 0) + 1); deg.set(kb, (deg.get(kb) ?? 0) + 1);
          at.set(ka, a); at.set(kb, b);
        }
        // A street END is not the same as a street stopping dead. Main roads are stitched into runs
        // and their corners eased, so a main road no longer shares an exact vertex with the minor
        // streets that meet it — it passes through them. What matters is whether the end MEETS
        // another street at all, which is a distance, not an identity.
        const meetsAnother = (p: [number, number], k: string) => {
          for (const r of [...l.mainRoads, ...l.minorRoads]) for (let i = 0; i < r.length - 1; i++) {
            if (key(r[i] as [number, number]) === k || key(r[i + 1] as [number, number]) === k) continue;
            if (pointSegDist(p, r[i], r[i + 1]) < 3) return true;
          }
          return false;
        };
        for (const [k, d] of deg) {
          const p = at.get(k)!;
          if (!pointInPolygon(p, l.boundary)) continue;   // beyond the wall, and clipped away
          let toWall = Infinity;
          for (let i = 0; i < l.boundary.length; i++) {
            toWall = Math.min(toWall, pointSegDist(p, l.boundary[i], l.boundary[(i + 1) % l.boundary.length]));
          }
          if (toWall < 10) continue;                       // a street ending AT the wall is a street
          nodes++;
          if (d === 1 && !meetsAnother(p, k)) stranded++;
        }
      }
    }
    expect(nodes).toBeGreaterThan(500);
    expect(stranded / nodes, `${stranded} of ${nodes} street ends strand inside the town`).toBeLessThan(0.05);
  });
});

// The plate's north is the world's north — it draws a compass saying so — but its sea was placed
// by `randInt(rng, 0, 3)`, owing nothing to the world outside. An outside review found a town on
// the EAST coast of its continent with the sea, and its harbour, drawn to the WEST.
describe("a coastal plate faces the way the world faces", () => {
  it("draws the sea on the side the world put it", () => {
    let checked = 0, worstDeg = 0, worstName = "";
    for (let seed = 1; seed <= 8; seed++) {
      const world = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
      for (const c of world.cities) {
        const l = generateCityLayout(cityContext(c), seed);
        if (l.water.kind !== "sea" || c.seaBearing === undefined) continue;
        checked++;
        // the AREA centroid, not the mean of the vertices: the shore carries a couple of hundred
        // sample points and the open-water side four, so a vertex mean is dragged onto the beach
        let ax = 0, ay = 0, aw = 0;
        for (const b of l.water.bodies) { const c2 = centroid(b), w2 = Math.abs(area(b)); ax += c2[0] * w2; ay += c2[1] * w2; aw += w2; }
        const drawn = Math.atan2(ay / aw - l.bounds.h / 2, ax / aw - l.bounds.w / 2);
        let d = Math.abs(drawn - c.seaBearing) % (Math.PI * 2);
        if (d > Math.PI) d = Math.PI * 2 - d;
        const deg = (d * 180) / Math.PI;
        if (deg > worstDeg) { worstDeg = deg; worstName = `${c.name} (seed ${seed})`; }
      }
    }
    expect(checked, "no coastal plate in eight seeds").toBeGreaterThan(10);
    expect(worstDeg, `worst: ${worstName}`).toBeLessThan(25);
  });
  // ⚠ Two instruments in a row lied about this, and both lied the same way — by measuring a point
  // instead of the district.
  //
  // First it measured the harbour's BEARING from the middle of the plate against the world's sea
  // bearing, which says nothing when the sea has taken a bite out of one side: every ward is then
  // on the LAND side of it, so the ward nearest the water can sit a long way round the compass and
  // still be the right ward.
  //
  // Then it measured the CENTROID of the harbour ward, and the centroid of a waterfront ward that
  // runs back from the quay sits inland by half the ward's depth. On twelve seeds it read a median
  // 25.5 units and a worst 144, and called the town of Tuisdiar (seed 7) a 47-unit defect when the
  // ward's own edge was 3 units from the water and 1 from the drawn quay. The backlog carried
  // "docks 144 units inland" as a live defect on the strength of it; the real count of towns whose
  // docks could not reach the water was two.
  //
  // What a reader sees is the DISTRICT against the water, so the measure is the ward's own edge.
  it("puts the docks on the water", () => {
    const ds: number[] = [];
    const landlocked: string[] = [];
    const edgeToWater = (poly: [number, number][], bodies: [number, number][][]) => {
      let d = Infinity;
      for (const p of poly) for (const b of bodies) for (let i = 0; i < b.length; i++) d = Math.min(d, pointSegDist(p, b[i], b[(i + 1) % b.length]));
      return d;
    };
    // mostly UNDER the water — the same ward the zoning refuses to make a quayside of, because it
    // has no quayside to stand on (city.ts: isDrowned)
    const isDrowned = (poly: [number, number][], l: { water: { bodies: [number, number][][] } }) => {
      const pts = [...poly, centroid(poly)];
      return pts.filter((p) => l.water.bodies.some((b) => pointInPolygon(p, b))).length / pts.length > 0.6;
    };
    for (let seed = 1; seed <= 8; seed++) {
      const world = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
      for (const c of world.cities) {
        const l = generateCityLayout(cityContext(c), seed);
        const h = l.wards.find((w) => w.type === "harbor");
        if (!h || !l.water.bodies.length) continue;
        // the SEA: a port where a river reaches the sea draws the river too, and the docks face the sea
        const sea = [l.water.bodies[0]];
        const d = edgeToWater(h.polygon, sea);
        ds.push(d);
        // The rule, not the percentile: the docks take the ward nearest the water, ahead of the
        // plaza, the cathedral and the guildhall. A town whose wards all stand back from the water
        // still has a harbour set back — that is the town's geography, not a zoning defect — but
        // NO ward may be nearer the water than the one carrying the docks.
        let bestOther = Infinity;
        for (const w of l.wards) {
          if (w === h || isDrowned(w.polygon, l)) continue;
          bestOther = Math.min(bestOther, edgeToWater(w.polygon, sea));
        }
        if (d > bestOther + 0.5) landlocked.push(`${c.name} (seed ${seed}): docks ${d.toFixed(0)} from the water, another ward ${bestOther.toFixed(0)}`);
      }
    }
    ds.sort((a, b) => a - b);
    expect(ds.length, "no harbour in eight seeds").toBeGreaterThan(20);
    expect(landlocked).toEqual([]);
    const median = ds[Math.floor(ds.length / 2)], p90 = ds[Math.floor(ds.length * 0.9)];
    expect(median, `median dock stands ${median.toFixed(1)} units from the water`).toBeLessThan(8);
    expect(p90, `p90 dock stands ${p90.toFixed(0)} units from the water`).toBeLessThan(30);
  });

  // ⚠ A district named Harbour is not a harbour. `makeHarbor` probes 36 units outward from each
  // wall edge to find the sea, and 18 of 139 port towns over 12 seeds had their wall 26–48 units
  // back from the water — so their plates carried the harbour DISTRICT and its label with no quay,
  // no breakwater, no piers and no boats, under a header calling the place a port town. The cause
  // was upstream of the docks: `buildWater` drew the waterline from its own rng and knew nothing
  // about how big the town was, so on a small plate it laid the sea down beyond the fields.
  it("draws the docks of every town whose plate calls it a port", () => {
    const dockless: string[] = [];
    let ports = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const world = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
      for (const c of world.cities) {
        const l = generateCityLayout(cityContext(c), seed);
        if (!l.wards.some((w) => w.type === "harbor") || l.water.kind !== "sea" || !l.water.bodies.length) continue;
        ports++;
        if (!l.harbor) dockless.push(`${c.name} (seed ${seed})`);
      }
    }
    expect(ports, "no port town in eight seeds").toBeGreaterThan(20);
    expect(dockless).toEqual([]);
  });
});

// Two things an outside review found in the districts. In one town the water covered the Guildhall
// ward whole and the label stayed on it, so the map read as a lake named Guildhall. And the parks:
// a rim ward is a park about one time in five, which is fine on average — median 7.8% of the walled
// area — but the tail is not: p90 26%, worst 50.5%. A medieval walled town is not half parkland.
// A gateless town loses everything that hangs off a gate: no main streets inside, no highway out,
// and no villages in its countryside. The gate candidates are the ward-mesh street nodes, and
// `extractStreets` returns the edges BETWEEN cells, so the outermost node sits one ward deep inside
// the wall — 11 of 336 towns over 12 seeds had no node within the 15-unit snap of any wall run and
// came out with no gate at all. They were the towns whose wall is cut by water (river, meander,
// lake) plus two whose mountains take a side.
describe("every walled town has a way in", () => {
  it("gives a gate to towns whose streets all stop short of the wall", () => {
    const gateless: string[] = [];
    const roadless: string[] = [];
    let walled = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const world = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
      for (const c of world.cities) {
        const l = generateCityLayout(cityContext(c), seed);
        if (!l.wall) continue;
        walled++;
        if (l.wall.gates.length === 0) gateless.push(`${c.name} (seed ${seed})`);
        // ...and a gate is worth having because a road leaves by it. The one exception measured is
        // a town whose every gate opens onto its own water — 8 of 806 gates over 12 seeds are wet,
        // and exactly one town has no dry one; the road rule is right to refuse a highway into the
        // river, so this is a count, not an absolute.
        if (l.suburbRoads.length === 0) roadless.push(`${c.name} (seed ${seed})`);
      }
    }
    expect(walled, "no walled town in eight seeds").toBeGreaterThan(100);
    expect(gateless).toEqual([]);
    expect(roadless.length, `no highway out of: ${roadless.join(", ")}`).toBeLessThanOrEqual(1);
  });
});

describe("the districts are places a town would have", () => {
  const layouts = function* () {
    for (let seed = 1; seed <= 8; seed++) {
      const world = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
      for (const c of world.cities) yield { c, seed, l: generateCityLayout(cityContext(c), seed) };
    }
  };
  // The rule is about the NAME, not the ward. A harbour is mostly water by definition and keeps
  // its name — on the quayside. A ward the lake swallowed has no quayside, and goes unnamed.
  it("never floats a district name on open water", () => {
    const floating: string[] = [];
    let checked = 0;
    for (const { c, seed, l } of layouts()) {
      for (const lb of l.labels) {
        checked++;
        if (inWater(l.water, [lb.x, lb.y])) floating.push(`${lb.type} of ${c.name} (seed ${seed})`);
      }
    }
    expect(checked).toBeGreaterThan(200);
    expect(floating).toEqual([]);
  });

  // ★ A ward is a Voronoi cell cut by a DISC, and the town's wall is not a disc: the plate clips the
  // outer wards to the wall, but their names were placed at the middle of the UNclipped cell. Measured
  // over 12 worlds, 69 names in 60 towns stood on the wall or outside it — barracks and harbours
  // mostly on the wall line, a few cathedrals and craftsmen 10-19 units out in the fields.
  it("names every district inside the town it is a district of", () => {
    const outside: string[] = [];
    let checked = 0;
    for (const { c, seed, l } of layouts()) {
      for (const lb of l.labels) {
        checked++;
        if (!pointInPolygon([lb.x, lb.y], l.boundary)) outside.push(`${lb.type} of ${c.name} (seed ${seed})`);
      }
    }
    expect(checked).toBeGreaterThan(200);
    expect(outside).toEqual([]);
  });

  // Measured on the ward as the plate draws it — its part inside the town — not on its whole cell: a
  // port's quarter whose cell runs out into the sea is a dry district in the town, and is named.
  it("leaves a swallowed district unnamed rather than naming the lake", () => {
    let drowned = 0, named = 0;
    for (const { l } of layouts()) {
      for (const w of l.wards) {
        if (w.type === "harbor") continue;
        const cut = clipToConvex(l.boundary as [number, number][], w.polygon as [number, number][]);
        if (cut.length < 3) continue;
        const b = bbox(cut);
        let n = 0, dry = 0;
        for (let y = b.minY; y <= b.maxY; y += 1.5) for (let x = b.minX; x <= b.maxX; x += 1.5) {
          if (!pointInPolygon([x, y], cut)) continue;
          n++;
          if (!inWater(l.water, [x, y])) dry++;
        }
        if (!n || dry / n >= 0.15) continue;
        drowned++;
        if (l.labels.some((lb) => pointInPolygon([lb.x, lb.y], w.polygon))) named++;
      }
    }
    expect(drowned, "no ward is that far under in eight seeds").toBeGreaterThan(0);
    expect(named).toBe(0);
  });

  it("keeps the parkland to a share a walled town would spare", () => {
    let worst = 0, worstName = "";
    for (const { c, seed, l } of layouts()) {
      if (!l.boundary) continue;
      const inside = Math.abs(area(l.boundary));
      const park = l.wards.filter((w) => w.type === "park").reduce((t, w) => t + Math.abs(area(w.polygon)), 0);
      if (park / inside > worst) { worst = park / inside; worstName = `${c.name} (seed ${seed})`; }
    }
    expect(worst, `worst: ${worstName} at ${(worst * 100).toFixed(0)}%`).toBeLessThan(0.2);
  });
});

// ★ The houses. Measured over twelve worlds before this: a house tested by its centre alone stood
// with corners in the river on 109 plates, half under a main road (drawn 4.6 wide, tested by its
// centre line) on 150, and cut by the town wall's line on every one; and the lots were cut on the
// page's grid, so a median 54% of houses stood more than 15 degrees askew of their street.
describe("the houses of a town", () => {
  const towns = (() => {
    let memo: { where: string; l: ReturnType<typeof generateCityLayout> }[] | null = null;
    return () => {
      if (memo) return memo;
      memo = [];
      for (let seed = 1; seed <= 12; seed++) {
        const w = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
        for (const c of w.cities) memo.push({ where: `${c.name} (seed ${seed}, ${c.id})`, l: generateCityLayout(cityContext(c), seed) });
      }
      return memo;
    };
  })();
  const edgeDist = (p: [number, number], poly: [number, number][]) => {
    let d = Infinity;
    for (let i = 0; i < poly.length; i++) d = Math.min(d, pointSegDist(p, poly[i], poly[(i + 1) % poly.length]));
    return d;
  };

  it("stands no house in the water, bar a marsh town's stilt houses", () => {
    let houses = 0;
    for (const { where, l } of towns()) {
      if (l.archetype.onStilts) continue;
      for (const w of l.wards) for (const b of w.buildings) {
        houses++;
        expect(b.some((p) => inWater(l.water, p)), `a house in the water at ${where}`).toBe(false);
      }
    }
    expect(houses).toBeGreaterThan(10000);
  });

  it("keeps every house inside the wall and off its line", () => {
    for (const { where, l } of towns()) for (const w of l.wards) for (const b of w.buildings) for (const p of b) {
      expect(pointInPolygon(p, l.boundary) && edgeDist(p, l.boundary) >= 2.6, `a house on the wall at ${where}`).toBe(true);
    }
  });

  it("keeps every house clear of the roads as they are drawn", () => {
    const clearOf = (b: [number, number][], roads: [number, number][][], clear: number) => {
      for (const r of roads) for (let i = 0; i < r.length - 1; i++) {
        if (pointInPolygon(r[i], b)) return false;
        for (let j = 0; j < b.length; j++) {
          const p = b[j], q = b[(j + 1) % b.length];
          if (segmentsIntersect(r[i], r[i + 1], p, q) || pointSegDist(p, r[i], r[i + 1]) < clear
            || pointSegDist(r[i], p, q) < clear || pointSegDist(r[i + 1], p, q) < clear) return false;
        }
      }
      return true;
    };
    for (const { where, l } of towns()) for (const w of l.wards) for (const b of w.buildings) {
      // a main road is drawn 4.6 wide, a street 2.6
      expect(clearOf(b, l.mainRoads, 2.3), `a house under a main road at ${where}`).toBe(true);
      expect(clearOf(b, l.minorRoads, 1.3), `a house on a street at ${where}`).toBe(true);
    }
  });

  it("stands its houses square to their streets", () => {
    const shares: number[] = [];
    for (const { l } of towns()) {
      let square = 0, all = 0;
      for (const w of l.wards) for (const b of w.buildings) {
        let le = 0, ang = 0;
        for (let i = 0; i < b.length; i++) { const p = b[i], q = b[(i + 1) % b.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]); if (len > le) { le = len; ang = Math.atan2(q[1] - p[1], q[0] - p[0]); } }
        const c = centroid(b);
        let nd = Infinity, street = 0;
        for (let i = 0; i < w.polygon.length; i++) { const p = w.polygon[i], q = w.polygon[(i + 1) % w.polygon.length], d = pointSegDist(c, p, q); if (d < nd) { nd = d; street = Math.atan2(q[1] - p[1], q[0] - p[0]); } }
        let d = Math.abs(ang - street) % (Math.PI / 2); d = Math.min(d, Math.PI / 2 - d);
        all++; if (d <= (15 * Math.PI) / 180) square++;
      }
      if (all) shares.push(square / all);
    }
    shares.sort((a, b) => a - b);
    expect(shares[Math.floor(shares.length / 2)], "the median town's share of houses square to their street").toBeGreaterThan(0.6);
  });

  it("builds a cathedral ward round its church and a guild ward round its hall", () => {
    let wards = 0, built = 0;
    for (const { where, l } of towns()) {
      for (const kind of ["cathedral", "guildhall"] as const) {
        if (!l.wards.some((w) => w.type === kind)) continue;
        wards++;
        const m = l.landmarks.find((x) => x.kind === kind);
        if (!m) continue;
        built++;
        const ward = l.wards.find((w) => w.type === kind)!;
        for (const p of m.outline) {
          expect(pointInPolygon(p, ward.polygon) && pointInPolygon(p, l.boundary), `the ${kind} of ${where} outside its ward`).toBe(true);
          expect(inWater(l.water, p), `the ${kind} of ${where} in the water`).toBe(false);
        }
        for (const b of ward.buildings) expect(polysOverlap(b, m.outline), `a house on the ${kind} of ${where}`).toBe(false);
      }
    }
    expect(built / wards, `${built} of ${wards}`).toBeGreaterThan(0.85);
  });

  it("plants its parks with trees", () => {
    let parks = 0, planted = 0;
    for (const { l } of towns()) {
      for (const w of l.wards) {
        if (w.type !== "park" || l.archetype.oasis) continue;
        parks++;
        if (l.parkTrees.some((t) => pointInPolygon(t, w.polygon))) planted++;
      }
    }
    expect(parks).toBeGreaterThan(30);
    expect(planted / parks).toBeGreaterThan(0.8);
  });
});

// ★ Water in a town. Over twelve worlds before this: a river was drawn north-south or east-west on a
// coin toss (30 of 57 river towns more than 45 degrees off the river the world map draws through
// them); a town "in the river's bend" was cut in two by a wave rather than wrapped in a loop; a plains
// town's lake sat inside its walls; streets ran IN the channel and their bridges lay lengthwise in it
// (91 pairs under 25 apart, up to 115 long); 39 bridges stood over the river outside the town with no
// road to either end; and 11 roads out of a gate crossed the river on no bridge at all.
describe("water in a town", () => {
  const towns = (() => {
    let memo: { where: string; c: CityMarker; l: ReturnType<typeof generateCityLayout> }[] | null = null;
    return () => {
      if (memo) return memo;
      memo = [];
      for (let seed = 1; seed <= 12; seed++) {
        const w = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
        for (const c of w.cities) memo.push({ where: `${c.name} (seed ${seed}, ${c.id})`, c, l: generateCityLayout(cityContext(c), seed) });
      }
      return memo;
    };
  })();
  const segDist = (p: [number, number], r: [number, number][]) => {
    let d = Infinity;
    for (let i = 0; i < r.length - 1; i++) d = Math.min(d, pointSegDist(p, r[i], r[i + 1]));
    return d;
  };

  it("runs a river town's river the way the world's river runs", () => {
    let n = 0;
    for (const { where, c, l } of towns()) {
      if (c.riverBearing === undefined || (l.water.kind !== "river" && l.water.kind !== "meander")) continue;
      n++;
      // the long axis of the channel as drawn
      const b = l.water.bodies[0];
      let mx = 0, my = 0; for (const p of b) { mx += p[0]; my += p[1]; } mx /= b.length; my /= b.length;
      let sxx = 0, syy = 0, sxy = 0; for (const p of b) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
      const axis = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      let d = Math.abs(axis - c.riverBearing) % Math.PI; d = Math.min(d, Math.PI - d);
      expect((d * 180) / Math.PI, `the river of ${where}`).toBeLessThan(30);
    }
    expect(n).toBeGreaterThan(20);
  });

  // A town is wrapped in a loop of its river where the world's river turns sharply at it — it was a coin
  // toss, and 7 of the 17 loop towns stood where their river rises; the loop swings the way the world's
  // river turns; and where the river rises at the town, the plate's rises there too instead of running
  // in from the edge of the plate.
  it("puts a town in its river's bend where the world's river turns, and raises the river where it rises", () => {
    let rises = 0, bends = 0;
    for (const { where, c, l } of towns()) {
      if (!c.river || c.coastal || c.biome === WETLAND) continue;
      const bend = !c.riverRises && Math.abs(c.riverTurn!) >= Math.PI / 4;
      expect(l.archetype.id, `the form of ${where}`).toBe(bend ? "meanderDefense" : "bridgeTown");
      const f = c.riverBearing!;
      const along = (p: [number, number]) => (p[0] - 230) * Math.cos(f) + (p[1] - 230) * Math.sin(f);
      if (c.riverRises) {
        rises++;
        const reach = Math.max(...l.boundary.map((p) => Math.hypot(p[0] - 230, p[1] - 230)));
        const head = Math.min(...l.water.bodies.flatMap((b) => b.map((p) => along(p as [number, number]))));
        expect(head, `the river of ${where} runs in from the edge of the plate`).toBeGreaterThan(-reach);
      }
      if (bend) {
        bends++;
        const right = (p: [number, number]) => -(p[0] - 230) * Math.sin(f) + (p[1] - 230) * Math.cos(f);
        const edge = l.water.bodies[0].filter((p) => p[0] < 0.5 || p[0] > 459.5 || p[1] < 0.5 || p[1] > 459.5);
        const side = edge.reduce((t, p) => t + right(p as [number, number]), 0) / edge.length;
        expect(Math.sign(side), `the loop of ${where} swings against the world's turn`).toBe(Math.sign(c.riverTurn!));
      }
    }
    expect(rises).toBeGreaterThan(10);
    expect(bends).toBeGreaterThan(6);
  });

  // ...and it runs as wide as the world map draws it: a stream, a river or a great river. Every river on
  // a plate was the one width, a great river's town and a stream's alike.
  it("runs a river town's river as wide as the world map draws it", () => {
    const bySize: number[][] = [[], [], []];
    for (const { where, c, l } of towns()) {
      // (where it rises its spring is wider than its stream, as it should be)
      if (!c.river || c.coastal || c.riverRises || l.archetype.id !== "bridgeTown") continue;
      const b = l.water.bodies[0] as [number, number][];
      const edge = (p: [number, number]) => { let d = Infinity; for (let i = 0; i < b.length; i++) d = Math.min(d, pointSegDist(p, b[i], b[(i + 1) % b.length])); return d; };
      let m = 0;
      for (let x = 0; x <= 460; x += 3) for (let y = 0; y <= 460; y += 3) if (inWater(l.water, [x, y])) m = Math.max(m, edge([x, y]));
      expect(m, `the river of ${where}`).toBeGreaterThan(0);
      bySize[c.riverSize!].push(m);
    }
    const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
    for (const a of bySize) expect(a.length).toBeGreaterThan(2);
    expect(median(bySize[1])).toBeGreaterThan(median(bySize[0]) * 1.4);
    expect(median(bySize[2])).toBeGreaterThan(median(bySize[1]) * 1.2);
  });

  // 22 of the 80 river towns of twelve worlds stand where the world's river reaches the sea, and
  // their plates drew the sea with no river in it at all
  it("draws the river of a port where the world's river reaches the sea, and keeps its harbour on the sea", () => {
    let n = 0;
    for (const { where, c, l } of towns()) {
      if (!c.coastal || !c.river || c.riverBearing === undefined) continue;
      n++;
      expect(l.water.bodies.length, `the river of ${where}`).toBeGreaterThanOrEqual(2);
      const b = l.water.bodies[1];
      let mx = 0, my = 0; for (const p of b) { mx += p[0]; my += p[1]; } mx /= b.length; my /= b.length;
      let sxx = 0, syy = 0, sxy = 0; for (const p of b) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
      let d = Math.abs(0.5 * Math.atan2(2 * sxy, sxx - syy) - c.riverBearing) % Math.PI; d = Math.min(d, Math.PI - d);
      expect((d * 180) / Math.PI, `the river of ${where}`).toBeLessThan(30);
      // the harbour's quay faces the sea, not the river running into it
      if (l.harbor) {
        const q = l.harbor.quay[Math.floor(l.harbor.quay.length / 2)];
        const toBody = (poly: [number, number][]) => { let dd = Infinity; for (let i = 0; i < poly.length; i++) dd = Math.min(dd, pointSegDist(q, poly[i], poly[(i + 1) % poly.length])); return dd; };
        expect(toBody(l.water.bodies[0] as [number, number][]), `the quay of ${where}`).toBeLessThan(40);
      }
    }
    expect(n).toBeGreaterThan(15);
  });

  it("wraps a town in the river's bend on most sides", () => {
    let n = 0;
    for (const { where, l } of towns()) {
      if (l.archetype.id !== "meanderDefense") continue;
      n++;
      const reach = Math.max(...l.boundary.map((p) => Math.hypot(p[0] - 230, p[1] - 230)));
      let met = 0;
      for (let k = 0; k < 36; k++) {
        const a = (k / 36) * Math.PI * 2;
        for (let r = reach * 0.9; r < 230; r += 2) if (inWater(l.water, [230 + Math.cos(a) * r, 230 + Math.sin(a) * r])) { met++; break; }
      }
      expect(met / 36, `the bend round ${where}`).toBeGreaterThan(0.6);
    }
    expect(n).toBeGreaterThan(5);
  });

  it("sets a plains town's lake beside it, not in it", () => {
    let n = 0;
    for (const { where, l } of towns()) {
      if (l.water.kind !== "lake") continue;
      n++;
      const lake = l.water.bodies[0], bb = bbox(lake);
      let wet = 0, walled = 0;
      for (let y = bb.minY; y < bb.maxY; y += 2) for (let x = bb.minX; x < bb.maxX; x += 2) {
        if (!pointInPolygon([x, y], lake)) continue;
        wet++;
        if (pointInPolygon([x, y], l.boundary)) walled++;
      }
      expect(walled / wet, `the lake inside ${where}`).toBeLessThan(0.2);
    }
    expect(n).toBeGreaterThan(20);
  });

  it("draws a bridge only where a drawn road crosses the water", () => {
    for (const { where, l } of towns()) for (const [a, b] of l.water.bridges) {
      const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const onRoadOut = l.suburbRoads.some((r) => segDist(mid, r as [number, number][]) < 2);
      expect(pointInPolygon(mid, l.boundary) || onRoadOut, `a bridge with no road at ${where}`).toBe(true);
    }
  });

  it("crosses the water square, one bridge to a crossing", () => {
    let bridges = 0;
    for (const { where, c, l } of towns()) {
      const br = l.water.bridges;
      bridges += br.length;
      // (a bridge laid along the river ran up to 115; a great river is 1.4 times as wide as a river)
      const along = c.riverSize === 2 ? 70 : 50;
      for (const [a, b] of br) expect(Math.hypot(b[0] - a[0], b[1] - a[1]), `a bridge along the river at ${where}`).toBeLessThan(along);
      for (let i = 0; i < br.length; i++) for (let j = i + 1; j < br.length; j++) {
        const m1 = [(br[i][0][0] + br[i][1][0]) / 2, (br[i][0][1] + br[i][1][1]) / 2], m2 = [(br[j][0][0] + br[j][1][0]) / 2, (br[j][0][1] + br[j][1][1]) / 2];
        expect(Math.hypot(m1[0] - m2[0], m1[1] - m2[1]), `two bridges on one crossing at ${where}`).toBeGreaterThan(25);
      }
    }
    expect(bridges).toBeGreaterThan(60);
  });

  it("bridges every road out of a gate that crosses the water", () => {
    for (const { where, l } of towns()) for (const r of l.suburbRoads) {
      let wet = false;
      for (let i = 0; i < r.length - 1 && !wet; i++) for (let k = 1; k < 20; k++) {
        const p: [number, number] = [r[i][0] + ((r[i + 1][0] - r[i][0]) * k) / 20, r[i][1] + ((r[i + 1][1] - r[i][1]) * k) / 20];
        if (inWater(l.water, p)) { wet = true; break; }
      }
      if (!wet) continue;
      const bridged = l.water.bridges.some(([a, b]) => segDist(a, r as [number, number][]) < 3 && segDist(b, r as [number, number][]) < 3);
      expect(bridged, `a road over the water with no bridge at ${where}`).toBe(true);
    }
  });
});

// The smaller things a plate put in the wrong place, measured over twelve worlds before this: some
// two hundred hamlets, farms, gallows, cemeteries, abbeys and mills under the town's name, the
// compass or the scale; 128 of 139 breakwaters lying over the beach (12 lighthouses on land); 101
// harbour names standing more than 30 from the water; 52 parish churches in the river and 18 on a
// street; 55 gates at the end of a wall beside the water and 99 with no road out of them.
describe("everything a plate draws stands where it belongs", () => {
  const towns = (() => {
    let memo: { where: string; l: ReturnType<typeof generateCityLayout> }[] | null = null;
    return () => {
      if (memo) return memo;
      memo = [];
      for (let seed = 1; seed <= 12; seed++) {
        const w = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
        for (const c of w.cities) memo.push({ where: `${c.name} (seed ${seed}, ${c.id})`, l: generateCityLayout(cityContext(c), seed) });
      }
      return memo;
    };
  })();
  const edgeDist = (p: [number, number], poly: [number, number][]) => {
    let d = Infinity;
    for (let i = 0; i < poly.length; i++) d = Math.min(d, pointSegDist(p, poly[i], poly[(i + 1) % poly.length]));
    return d;
  };

  it("keeps the country clear of the plate's own name, compass and scale", () => {
    let things = 0;
    for (const { where, l } of towns()) {
      const title = (p: [number, number]) => p[1] < 44 && Math.abs(p[0] - 230) < 55;          // the name's tablet
      const compass = (p: [number, number]) => Math.hypot(p[0] - 428, p[1] - 425) < 22;        // the compass's disc
      const scale = (p: [number, number]) => p[0] > 17 && p[0] < 113 && p[1] > 428;            // the scale's tablet
      const cs = l.countryside;
      const at: [string, [number, number]][] = [
        ...cs.villages.map((v) => ["a hamlet", v.chapel] as [string, [number, number]]),
        ...cs.farmsteads.map((f) => ["a farm", centroid(f.house)] as [string, [number, number]]),
        ...(l.abbey ? [["the abbey", l.abbey.at] as [string, [number, number]]] : []),
        ...(l.cemetery ? [["the cemetery", l.cemetery.at] as [string, [number, number]]] : []),
        ...(l.gallows ? [["the gallows", l.gallows] as [string, [number, number]]] : []),
        ...(l.leperHouse ? [["the lazar house", l.leperHouse.at] as [string, [number, number]]] : []),
        ...(l.fairground ? [["the fair", l.fairground.at] as [string, [number, number]]] : []),
        ...l.outworks.map((o) => ["a mill", o.at] as [string, [number, number]]),
        ...l.inns.map((p) => ["an inn", p] as [string, [number, number]]),
      ];
      for (const [what, p] of at) {
        things++;
        expect(title(p) || compass(p) || scale(p), `${what} under the plate's furniture at ${where}`).toBe(false);
      }
    }
    expect(things).toBeGreaterThan(2000);
  });

  it("starts a harbour's breakwater at the shore and stands it in the water", () => {
    let harbours = 0;
    for (const { where, l } of towns()) {
      const h = l.harbor;
      if (!h) continue;
      harbours++;
      expect(inWater(l.water, h.lighthouse), `the lighthouse of ${where}`).toBe(true);
      const bw = h.breakwater;
      for (let i = 0; i < bw.length - 1; i++) for (let k = 1; k <= 10; k++) {
        const p: [number, number] = [bw[i][0] + ((bw[i + 1][0] - bw[i][0]) * k) / 10, bw[i][1] + ((bw[i + 1][1] - bw[i][1]) * k) / 10];
        expect(inWater(l.water, p), `the breakwater of ${where} over dry land`).toBe(true);
      }
    }
    expect(harbours).toBeGreaterThan(100);
  });

  it("names a port on its quayside", () => {
    for (const { where, l } of towns()) {
      const lab = l.labels.find((x) => x.type === "harbor");
      if (!lab || !l.water.bodies.length) continue;
      let d = Infinity;
      for (const b of l.water.bodies) d = Math.min(d, edgeDist([lab.x, lab.y], b as [number, number][]));
      expect(d, `the harbour's name at ${where}`).toBeLessThan(36);
    }
  });

  it("stands every parish church on dry ground in the town", () => {
    let churches = 0;
    for (const { where, l } of towns()) for (const p of l.parishChurches) {
      churches++;
      expect(pointInPolygon(p, l.boundary) && !inWater(l.water, p), `a parish church at ${where}`).toBe(true);
    }
    expect(churches).toBeGreaterThan(900);
  });

  it("leads a road out of every gate, and puts no gate at the end of a wall beside the water", () => {
    let gates = 0, wetEnds = 0;
    for (const { where, l } of towns()) {
      if (!l.wall) continue;
      for (const g of l.wall.gates) {
        gates++;
        expect(l.suburbRoads.some((r) => Math.hypot(r[0][0] - g[0], r[0][1] - g[1]) < 0.5), `a gate to nowhere at ${where}`).toBe(true);
        if (l.wall.seaGates.some((e) => Math.hypot(e[0] - g[0], e[1] - g[1]) < 10)) wetEnds++;
      }
    }
    expect(gates).toBeGreaterThan(600);
    // a town whose only way out is there keeps it (one of twelve worlds' 336)
    expect(wetEnds).toBeLessThanOrEqual(2);
  });

  // ---- nothing a plate draws lies on anything else, as it is drawn (the widths are the renderer's)
  type P = [number, number];
  // how near a polygon comes to a line (0 where the line enters or crosses it)
  const nearLine = (poly: P[], line: P[]) => {
    let d = Infinity;
    for (let i = 0; i + 1 < line.length; i++) {
      if (pointInPolygon(line[i], poly) || pointInPolygon(line[i + 1], poly)) return 0;
      for (let j = 0; j < poly.length; j++) {
        const a = poly[j], b = poly[(j + 1) % poly.length];
        if (segmentsIntersect(line[i], line[i + 1], a, b)) return 0;
        d = Math.min(d, pointSegDist(a, line[i], line[i + 1]), pointSegDist(line[i], a, b), pointSegDist(line[i + 1], a, b));
      }
    }
    return d;
  };
  const disc = (c: P, r: number): P[] => Array.from({ length: 12 }, (_, i) => [c[0] + Math.cos((i / 12) * Math.PI * 2) * r, c[1] + Math.sin((i / 12) * Math.PI * 2) * r] as P);
  const box = (c: P, hw: number, hh: number): P[] => [[c[0] - hw, c[1] - hh], [c[0] + hw, c[1] - hh], [c[0] + hw, c[1] + hh], [c[0] - hw, c[1] + hh]];

  it("keeps a castle's walls off every street drawn round it", () => {
    let castles = 0;
    for (const { where, l } of towns()) {
      const ca = l.castle;
      if (!ca) continue;
      castles++;
      // a main street is drawn 4.6 wide and a lane 2.6; the enceinte 4.4 and the outer curtain 3.4
      for (const [ring, half] of [[ca.innerWall, 2.2], ...(ca.outerWall ? [[ca.outerWall, 1.7]] : [])] as [P[], number][]) {
        for (const r of l.mainRoads) expect(nearLine(ring, r as P[]), `a main street on the castle's wall at ${where}`).toBeGreaterThanOrEqual(2.3 + half);
        for (const r of l.minorRoads) expect(nearLine(ring, r as P[]), `a lane on the castle's wall at ${where}`).toBeGreaterThanOrEqual(1.3 + half);
      }
    }
    expect(castles).toBeGreaterThan(100);
  });

  // A town gate is drawn as a 6-wide block square to the plate, its corners rounded by 1 and its
  // outline 1 wide: a 4-wide core grown by 1.5. How far a point stands from that core:
  const offGateCore = (p: P, g: P) => Math.hypot(Math.max(Math.abs(p[0] - g[0]) - 2, 0), Math.max(Math.abs(p[1] - g[1]) - 2, 0));

  it("opens no town gate into a castle, and stands no castle tower on one", () => {
    for (const { where, l } of towns()) {
      const ca = l.castle;
      if (!ca || !l.wall) continue;
      const TS = Math.pow(ca.scale, 0.7);
      for (const g of l.wall.gates) for (const ring of [ca.innerWall, ...(ca.outerWall ? [ca.outerWall] : [])] as P[][]) {
        expect(pointInPolygon(g, ring), `a town gate inside the castle at ${where}`).toBe(false);
        // a castle tower is drawn 2.8 across the radius in the castle's units, with a 0.9 outline
        for (const t of ring) expect(offGateCore(t, g), `a castle tower on a town gate at ${where}`).toBeGreaterThanOrEqual(1.5 + 2.8 * TS + 0.45);
      }
    }
  });

  it("keeps the quay's warehouses off the castle", () => {
    for (const { where, l } of towns()) {
      if (!l.castle || !l.harbor) continue;
      const walls = (l.castle.outerWall ?? l.castle.innerWall) as P[];
      for (const wf of l.harbor.wharves) expect(polysOverlap(wf as P[], walls), `a warehouse on the castle at ${where}`).toBe(false);
    }
  });

  it("stands the gate hamlet's houses on dry ground, off the rock and clear of the barbican", () => {
    let houses = 0;
    for (const { where, l } of towns()) {
      const towers = l.barbicans.flatMap((b) => b.towers.map((t) => disc(t as P, 2.6)));
      for (const h of l.suburbs as P[][]) {
        houses++;
        expect(overlapsWater(l.water, h), `a gate house in the water at ${where}`).toBe(false);
        expect(h.some((q) => inMountains(l.mountains, q)), `a gate house on the rock at ${where}`).toBe(false);
        expect(towers.some((t) => polysOverlap(h, t)), `a gate house under the barbican at ${where}`).toBe(false);
      }
    }
    expect(houses).toBeGreaterThan(1000);
  });

  it("stands a farm's buildings off the road out of town", () => {
    let farms = 0;
    for (const { where, l } of towns()) for (const f of l.countryside.farmsteads) {
      farms++;
      // the road is drawn 1.6 wide
      for (const b of [f.house, f.barn] as P[][]) for (const r of l.suburbRoads) expect(nearLine(b, r as P[]), `a farm building on the road at ${where}`).toBeGreaterThanOrEqual(0.8);
    }
    expect(farms).toBeGreaterThan(300);
  });

  it("stands what is built out in the country on ground of its own", () => {
    let things = 0;
    for (const { where, l } of towns()) {
      // each as big as it is drawn
      const built: [string, P[]][] = [];
      if (l.abbey) built.push(["the abbey", disc(l.abbey.at as P, 8.5)]);
      if (l.cemetery) built.push(["the cemetery", box(l.cemetery.at as P, 6, 6.5)]);
      if (l.leperHouse) built.push(["the lazar house", disc(l.leperHouse.at as P, 7.8)]);
      if (l.fairground) built.push(["the fair", disc(l.fairground.at as P, 9)]);
      if (l.gallows) built.push(["the gallows", box([l.gallows[0] + 2.5, l.gallows[1] - 1], 3, 5)]);
      for (const o of l.outworks) built.push([`a ${o.type}`, disc(o.at as P, o.type === "windmill" ? 4 : 3.2)]);
      for (const p of l.inns) built.push(["an inn", box([p[0] + 1.4, p[1] - 0.3], 4.4, 2.8)]);
      for (const t of l.riversideTrades) built.push([`a ${t.kind}`, box(t.at as P, 2, 1.6)]);
      const cs = l.countryside;
      const ground: [string, P[]][] = [
        ...cs.fields.map((f) => ["a field", f.polygon] as [string, P[]]),
        ...cs.pastures.map((p) => ["a pasture", p.fence] as [string, P[]]),
        ...cs.orchards.map((o) => ["an orchard", o.polygon] as [string, P[]]),
        ...cs.gardens.map((g) => ["a garden", g] as [string, P[]]),
        ...cs.villages.flatMap((v) => [["a hamlet's green", v.green] as [string, P[]], ...v.houses.map((h) => ["a cottage", h] as [string, P[]])]),
        ...cs.farmsteads.flatMap((f) => [["a farmhouse", f.house] as [string, P[]], ["a barn", f.barn] as [string, P[]]]),
        ...(l.suburbs as P[][]).map((h) => ["a gate house", h] as [string, P[]]),
      ];
      for (let i = 0; i < built.length; i++) {
        things++;
        const [what, fp] = built[i];
        for (const [on, g] of ground) expect(polysOverlap(fp, g), `${what} on ${on} at ${where}`).toBe(false);
        for (const r of l.suburbRoads) expect(nearLine(fp, r as P[]), `${what} on a road out of town at ${where}`).toBeGreaterThanOrEqual(0.8);
        for (let j = i + 1; j < built.length; j++) expect(polysOverlap(fp, built[j][1]), `${what} on ${built[j][0]} at ${where}`).toBe(false);
      }
    }
    expect(things).toBeGreaterThan(2000);
  });

  it("keeps the trees and the parish steeples off the great buildings, the square and the castle", () => {
    for (const { where, l } of towns()) {
      const great = l.landmarks.map((m) => m.outline as P[]);
      const plaza = l.wards.find((w) => w.type === "plaza")?.polygon as P[] | undefined;
      const castle = l.castle ? (l.castle.outerWall ?? l.castle.innerWall) as P[] : null;
      for (const t of l.features.trees as P[]) {
        for (const g of great) expect(pointInPolygon(t, g) || edgeDist(t, g) < 2.2, `a tree on a great building at ${where}`).toBe(false);
        if (plaza) expect(pointInPolygon(t, plaza), `a tree on the market square at ${where}`).toBe(false);
        if (castle) expect(pointInPolygon(t, castle), `a tree in the castle at ${where}`).toBe(false);
      }
      for (const p of l.parishChurches as P[]) {
        for (const g of great) expect(pointInPolygon(p, g) || edgeDist(p, g) < 3, `a steeple on a great building at ${where}`).toBe(false);
        // the steeple is drawn 6 tall; a street's centre line stays off it
        for (const r of [...l.mainRoads, ...l.minorRoads] as P[][]) for (let i = 0; i + 1 < r.length; i++)
          expect(pointSegDist(p, r[i], r[i + 1]), `a steeple in the street at ${where}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("stands no wall tower on a gate, nor runs its outline into the gate's", () => {
    let near = 0;
    for (const { where, l } of towns()) {
      if (!l.wall) continue;
      // a tower is a disc of 2.6 with a 0.8 outline
      for (const g of l.wall.gates) for (const t of l.wall.towers) {
        const d = offGateCore(t as P, g as P);
        if (d < 8) near++;
        expect(d, `a tower on a gate at ${where}`).toBeGreaterThanOrEqual(1.5 + 3.0);
      }
    }
    expect(near, "towers still flank the gates they clear").toBeGreaterThan(100);
  });

  // ---- a port stands on its water. Its shore used to run a strand BEYOND the town's nominal reach
  // while the wall wanders inside it: 82 of 139 ports touched their sea nowhere, the quay stood a
  // median 14 off the water, and the piers ran a median 60% of their length over the beach.
  const portsOf = () => towns().filter(({ l }) => l.harbor && l.water.kind === "sea");
  const seaGap = (p: P, sea: P[]) => (pointInPolygon(p, sea) ? 0 : edgeDist(p, sea));

  it("brings a port down to its water: the quay on the shore, the warehouses on the quay", () => {
    let ports = 0;
    for (const { where, l } of portsOf()) {
      ports++;
      const sea = l.water.bodies[0] as P[];
      expect(l.boundary.some((p) => seaGap(p as P, sea) < 3), `a port that touches its sea nowhere: ${where}`).toBe(true);
      const q = l.harbor!.quay as P[];
      const gaps: number[] = [];
      for (let i = 0; i + 1 < q.length; i++) for (let t = 0; t <= 4; t++) gaps.push(seaGap([q[i][0] + ((q[i + 1][0] - q[i][0]) * t) / 4, q[i][1] + ((q[i + 1][1] - q[i][1]) * t) / 4], sea));
      gaps.sort((a, b) => a - b);
      expect(gaps[gaps.length >> 1], `a quay off the water at ${where}`).toBeLessThanOrEqual(4);
      for (const wf of l.harbor!.wharves) expect(Math.min(...wf.map((p) => seaGap(p as P, sea))), `a warehouse off the water at ${where}`).toBeLessThanOrEqual(1.5);
    }
    expect(ports).toBeGreaterThan(120);
  });

  it("runs a pier from the quay over no more than its bank, and keeps the harbour's pieces apart", () => {
    for (const { where, l } of portsOf()) {
      const H = l.harbor!;
      const sea = { ...l.water, bodies: l.water.bodies.slice(0, 1) };
      for (const pr of H.piers as P[][]) {
        let dry = 0;
        for (let i = 0; i + 1 < pr.length; i++) {
          const n = Math.max(1, Math.ceil(Math.hypot(pr[i + 1][0] - pr[i][0], pr[i + 1][1] - pr[i][1])));
          for (let k = 0; k < n; k++) if (!inWater(sea, [pr[i][0] + ((pr[i + 1][0] - pr[i][0]) * k) / n, pr[i][1] + ((pr[i + 1][1] - pr[i][1]) * k) / n])) dry++;
        }
        expect(dry, `a pier run over the beach at ${where}`).toBeLessThanOrEqual(10);
        expect(nearLine(H.breakwater as P[], pr) >= 3.5 || nearLine(pr, H.breakwater as P[]) >= 3.5, `a pier on the mole at ${where}`).toBe(true);
      }
      const runs = [...H.piers, H.breakwater] as P[][];
      for (const wf of H.wharves as P[][]) for (const r of runs) expect(nearLine(wf, r), `a warehouse on a pier or the mole at ${where}`).toBeGreaterThanOrEqual(1.2);
      for (const bt of H.boats) {
        for (const r of runs) for (let i = 0; i + 1 < r.length; i++) expect(pointSegDist(bt.at as P, r[i], r[i + 1]), `a boat on a pier or the mole at ${where}`).toBeGreaterThanOrEqual(1.8);
        expect(H.wharves.some((wf) => pointInPolygon(bt.at as P, wf as P[])), `a boat in a warehouse at ${where}`).toBe(false);
      }
    }
  });

  it("walls every stretch of a town that stands on dry ground", () => {
    for (const { where, l } of towns()) {
      if (!l.wall) continue;
      const walled = new Set<string>();
      for (const seg of l.wall.segments) for (let i = 0; i + 1 < seg.length; i++) {
        walled.add(`${seg[i][0].toFixed(3)},${seg[i][1].toFixed(3)}>${seg[i + 1][0].toFixed(3)},${seg[i + 1][1].toFixed(3)}`);
        walled.add(`${seg[i + 1][0].toFixed(3)},${seg[i + 1][1].toFixed(3)}>${seg[i][0].toFixed(3)},${seg[i][1].toFixed(3)}`);
      }
      const B = l.boundary as P[];
      for (let i = 0; i < B.length; i++) {
        const a = B[i], b = B[(i + 1) % B.length];
        if (walled.has(`${a[0].toFixed(3)},${a[1].toFixed(3)}>${b[0].toFixed(3)},${b[1].toFixed(3)}`)) continue;
        const m: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const toWater = Math.min(...l.water.bodies.map((w) => seaGap(m, w as P[])));
        const onRock = inMountains(l.mountains, [m[0] + (m[0] - 230) * 0.06, m[1] + (m[1] - 230) * 0.06]);
        expect(toWater <= 8 || onRock, `an unwalled stretch of dry ground at ${where}`).toBe(true);
      }
    }
  });

  it("builds every town of its country, whatever form its site gave it", () => {
    const wooded = new Set([2, 3, 6]);   // taiga, temperate forest, tropical
    let ports = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const w = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
      for (const c of w.cities) {
        const l = towns().find((t) => t.where === `${c.name} (seed ${seed}, ${c.id})`)!.l;
        const where = `${c.name} (seed ${seed}, ${c.id})`;
        if (c.coastal) ports++;
        expect(l.features.wallMaterial, `the wall of ${where}`).toBe(wooded.has(c.biome) || c.biome === 7 ? "timber" : "stone");
        if (wooded.has(c.biome)) expect(l.features.trees.length, `no trees in ${where}`).toBeGreaterThan(0);
        if (c.biome === 5) expect(l.parkTrees, `a green park in the desert at ${where}`).toEqual([]);
      }
    }
    expect(ports).toBeGreaterThan(120);
  });

  it("raises the world's mountains on the plate, on the side the world has them", () => {
    const off = (a: number, b: number) => { let d = Math.abs(a - b) % (2 * Math.PI); if (d > Math.PI) d = 2 * Math.PI - d; return d; };
    let beside = 0, drawn = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const w = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
      for (const c of w.cities) {
        const where = `${c.name} (seed ${seed}, ${c.id})`;
        const l = towns().find((t) => t.where === where)!.l;
        for (const m of l.mountains) expect(overlapsWater(l.water, m.polygon), `a mountain on the water at ${where}`).toBe(false);
        if (c.mountainBearing === undefined) continue;
        beside++;
        if (!l.mountains.length) continue;   // a river's loop can run through the whole of their arc
        drawn++;
        if (c.relief && !c.river) continue;  // built to the ground it stands on: the next test
        const facing = l.mountains.map((m) => {
          let x = 0, y = 0;
          for (const p of m.innerEdge) { x += p[0] - 230; y += p[1] - 230; }
          return Math.atan2(y, x);
        });
        expect(Math.min(...facing.map((f) => off(f, c.mountainBearing!))), `mountains turned away from the world's at ${where}`).toBeLessThan(Math.PI / 3);
      }
    }
    expect(beside).toBeGreaterThan(40);
    expect(drawn / beside, "towns at the foot of the world's mountains that draw them").toBeGreaterThan(0.95);
  });

  // ...and a town in the mountains is built to the form of the ground it stands on (see relief.ts): a
  // hill fortress on a summit, its broad shoulder the way its ridge runs on; a town in a valley between
  // its two walls, running along it; a spur town hung off one ridge behind it; a hillside town below
  // the rise. Its form was a draw of dice and its high ground pointed wherever the draw fell: 8 of the
  // 28 dry mountain towns of twelve worlds drew the form their ground has.
  it("builds a town in the mountains to the form of the ground it stands on", () => {
    const off = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    const axisOff = (a: number, b: number) => Math.min(off(a, b), off(a, b + Math.PI));
    const forms = { summit: "hilltopFortress", valley: "valleyPass", spur: "spur", slope: "hillside" } as const;
    const facing = (m: { innerEdge: P[] }) => { let x = 0, y = 0; for (const p of m.innerEdge) { x += p[0] - 230; y += p[1] - 230; } return Math.atan2(y, x); };
    const extent = (b: P[], a: number) => { const t = b.map((p) => (p[0] - 230) * Math.cos(a) + (p[1] - 230) * Math.sin(a)); return Math.max(...t) - Math.min(...t); };
    const seen = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const w = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
      for (const c of w.cities) {
        if (!c.relief || c.river || c.coastal) continue;
        const where = `${c.name} (seed ${seed}, ${c.id})`;
        const l = towns().find((t) => t.where === where)!.l;
        const rb = c.reliefBearing!, f = l.mountains.map(facing), B = l.boundary as P[];
        seen.add(c.relief);
        expect(l.archetype.id, `the form of ${where}`).toBe(forms[c.relief]);
        if (c.relief === "valley") {
          expect(f.length, `the walls of ${where}`).toBe(2);
          for (const a of f) expect(axisOff(a, rb), `a wall of ${where} off its valley's side`).toBeLessThan(Math.PI / 6);
          expect(off(f[0], f[1]), `both walls of ${where} on one side`).toBeGreaterThan((5 * Math.PI) / 6);
          expect(extent(B, rb + Math.PI / 2), `${where} across its valley`).toBeGreaterThan(extent(B, rb) * 1.1);
        } else {
          expect(f.length, `the high ground of ${where}`).toBe(1);
          expect(off(f[0], rb), `the high ground of ${where} turned from its ground`).toBeLessThan(Math.PI / 6);
        }
      }
    }
    expect(seen).toEqual(new Set(["summit", "valley", "spur", "slope"]));
  });

  it("spaces the towers along a wall", () => {
    for (const { where, l } of towns()) {
      if (!l.wall) continue;
      const t = l.wall.towers;
      for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) {
        const d = Math.hypot(t[i][0] - t[j][0], t[i][1] - t[j][1]);
        if (d > 1e-6) expect(d, `two towers shoulder to shoulder at ${where}`).toBeGreaterThan(6);
      }
    }
  });
});

// A plate's numbers were keyed by (world seed XOR town id), so world 2's town 4 drew what world 3's
// town 5 drew, and when the two were the same kind and size of town they were the same drawing
// under another name — 16 of the 336 plates of worlds 1-12, 105 of 1,120 over worlds 1-40.
describe("a town in one world is not a copy of a town in another", () => {
  it("draws a different plan for the towns the old key paired up", () => {
    const towns: { key: number; kind: string; size: number; where: string; wall: string }[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      const w = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
      for (const c of w.cities) {
        const l = generateCityLayout(cityContext(c), seed);
        towns.push({ key: seed ^ c.id, kind: l.archetype.id, size: c.size, where: `${c.name} (seed ${seed})`, wall: JSON.stringify(l.boundary) });
      }
    }
    let pairs = 0;
    for (let i = 0; i < towns.length; i++) for (let j = i + 1; j < towns.length; j++) {
      const a = towns[i], b = towns[j];
      if (a.key !== b.key || a.kind !== b.kind || a.size !== b.size) continue;
      pairs++;
      expect(a.wall === b.wall, `${a.where} and ${b.where} are one town`).toBe(false);
    }
    expect(pairs, "no pair of towns the old key would have made twins").toBeGreaterThan(10);
  });
});

// ★ A lock on the plates themselves, byte for byte. Nothing pinned a city layout (the world and the
// history have golden hashes; a plate had only "is deterministic"), so a change meant only to make
// the generator FASTER could have moved a building and nobody would know. Opening a capital's
// plate took 274ms of the 293 its screen cost (measured in the page, 2026-09-24) — a mid-range
// phone runs that about four times slower — and 62% of the generator's time was one filter.
// Whatever speeds it up must reproduce these exactly. Two whole worlds, every kind of town.
//
// Re-pinned 2026-09-24 for the castle built inside its town: exactly the 125 towns (of 12 worlds'
// 336) that seat a lord moved — the castle, the ward it stands in, the zoning that follows from it,
// the town's towers on the stretch the castle took, and, since the castle now draws from a stream
// of its own, the country around those towns. The other 211 plates hashed byte for byte the same.
//
// Re-pinned again the same day for the plate key (see plateSeed): EVERY plate moved, by design — a
// town's streams were keyed by (world seed XOR town id), which made towns of neighbouring worlds
// each other's copies. Nothing outside the plate reads those streams; the world is untouched.
//
// And again for the houses: every plate moved — the lots are cut along their streets now, from a
// stream of their own (so the main stream, and with it the country round every town, moved once more).
//
// And for the water: every river, loop, lake, marsh and oasis town and 103 of 139 ports moved (the
// water comes out of the street network; the river runs the world's way; the bend wraps its town; the
// lake stands beside it), and 4 mountain towns whose road out turned off the cliff. The other 116 held.
//
// And for everything else in its place: every plate moved — the country now keeps clear of the name,
// the compass and the scale (every plate's rejection sampling moved), and gates, the breakwater, the
// harbour's name, the parish churches and the market cross and well were set where they belong.
//
// And for speed: the water, the town's outline and the open-spot search answer the same through a grid
// (proved over all 336 plates of twelve worlds); what moved is only what was made coarser on purpose —
// the 17 meander towns' loop (its corners cut three times, not four) and the name of 116 of 122
// castles (its spot sought on a 2-unit grid, not 1.5). The other 200 plates hold.
//
// And for the river mouths: the 22 ports where the world's river reaches the sea draw it now, and a lot
// the shore runs through is cut again into waterfront plots — 69 plates moved (35 river towns, 31 ports,
// a lake town and 2 oasis towns); 267 hold.
//
// And for nothing lying on anything else: every plate moved — each thing drawn out in the country has
// a footprint the size it is drawn and the country is laid round them (every plate's rejection sampling
// moved), the gate hamlet makes way for the barbican and keeps out of the water, and a castle stands
// off the streets as they are drawn, on a ward no town gate opens into (122 castles).
//
// And for the towers beside a gate, measured to the gate block as drawn rather than to its middle:
// exactly the 52 plates where a tower stood on a gate's corner or ran its outline into it moved (a
// tower went); the other 284 hashed byte for byte the same.
//
// And for the ports: every one of the 139 moved — the town comes down to its water, the harbour is laid
// out on the quay (piers in the mole's basin, warehouses clear of them), and the landward side is walled
// — and 42 other plates, where a gate house stood on a later gate's road (and the country round it
// moved with it), a waterfront plot stood on the wall line, or a district mostly water was named.
//
// And for the country a town is built of (textureOf): exactly the 211 towns whose texture differed from
// their biome's moved — 123 ports and 44 river towns out of forest, marsh, desert and tundra, and 44
// tundra, alpine and hill towns whose ground was the grassland's; the forest, marsh and oasis towns,
// which always wore their biome, and the grassland towns hashed byte for byte the same.
//
// And for the world's mountains (mountainBearing/Share, onMountain): exactly the 52 towns with mountain
// cells beside them moved — 14 flat plains towns the world draws in its mountains take a mountain form,
// a mountain town a world river runs through (12:3) is drawn as its river crossing (with its mountains
// round it), and 37 towns at the foot of the range have its foothills, or their masses turned the way
// the world's mountains lie. The other 284 hashed byte for byte the same.
//
// And for the lie of the land in the mountains (relief.ts): exactly the 26 dry mountain towns whose form
// or high ground moved — 16 take the form of the ground they stand on (a summit's hill fortress, a
// valley's pass, a spur, a slope's hillside) and 10 turned theirs to it (a valley town running along its
// valley, a spur town out along its one ridge, a summit's shoulder and a slope's rise where the ground
// rises). Seed 1 has none of them. The other 310 hashed byte for byte the same.
//
// And for what the world's river does at a town (riverTurn, riverRises): exactly 44 river towns moved —
// 8 bridge towns where the world's river turns 45 degrees or more are wrapped in a loop of it, and 16
// loop towns are bridge towns (7 where the river rises, 9 on a straight reach); 20 towns where it rises
// have it rise there (11 bridge towns, a marsh and 8 ports). Every loop swings the way the world's river
// turns: the one loop town that stays one (2:10) already did. The other 292 hashed byte for byte the same.
//
// And for how big the world draws a river (riverSize): exactly the 46 towns on a stream or a great river
// moved — 22 inland towns and 11 ports on a stream, 9 inland towns and 4 ports on a great river, their
// rivers narrower or wider — one of them (6:16) now leading its one gate out where a road can leave. The
// 34 towns on a river of the middle size, and every other plate, hashed byte for byte the same.
describe("a plate is the same plate, byte for byte", () => {
  const fold = (h: number, c: number) => Math.imul(h ^ c, 16777619) >>> 0;
  const fnv = (s: string) => { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) h = fold(h, s.charCodeAt(i)); return h >>> 0; };
  const worldHash = (seed: number) => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
    let h = 2166136261 >>> 0, n = 0;
    for (const c of world.cities) { h = fold(h, fnv(JSON.stringify(generateCityLayout(cityContext(c), seed)))); n++; }
    return { h, n };
  };
  it("draws seed 1's twenty-eight towns exactly as it did", () => {
    expect(worldHash(1)).toEqual({ h: 1901003033, n: 28 });
  });
  it("draws seed 12's twenty-eight towns exactly as it did", () => {
    expect(worldHash(12)).toEqual({ h: 46323080, n: 28 });
  });
});
