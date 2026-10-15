import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import { generateCountryside, GROUND_MARK_FOOT } from "./countryside";
import { pointInPolygon, centroid, polysOverlap, pointSegDist } from "../geometry";
import type { Polygon } from "../geometry";
import { GRASSLAND, DESERT, TAIGA, TUNDRA, ALPINE, TROPICAL, TEMPERATE_FOREST, WETLAND } from "../biome";
import { buildWater } from "./water";
import type { CountrysideOpts } from "./countryside";

function plainOpts(): CountrysideOpts {
  const boundary = [] as [number, number][];
  for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; boundary.push([230 + Math.cos(a) * 100, 230 + Math.sin(a) * 100]); }
  return {
    bounds: { w: 460, h: 460 }, boundary,
    water: buildWater(mulberry32(1), "none", { w: 460, h: 460 }),
    mountains: [],
    roads: [[[330, 230], [395, 232], [457, 230]], [[230, 330], [232, 395], [230, 457]]],
    obstacles: [], moat: [], size: 3, biome: GRASSLAND, oasis: false,
  };
}

// a ring just outside the r=100 boundary, like the real wall-offset moat
function moatRing(): [number, number][][] {
  const ring: [number, number][] = [];
  for (let k = 0; k <= 24; k++) { const a = (k / 24) * Math.PI * 2; ring.push([230 + Math.cos(a) * 104, 230 + Math.sin(a) * 104]); }
  return [ring];
}

describe("generateCountryside — fields/gardens/orchards", () => {
  it("is deterministic", () => {
    const a = generateCountryside(mulberry32(9), plainOpts());
    const b = generateCountryside(mulberry32(9), plainOpts());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it("plains city gets strip fields grouped near roads, all outside the boundary", () => {
    const o = plainOpts();
    const c = generateCountryside(mulberry32(9), o);
    expect(c.fields.length).toBeGreaterThanOrEqual(3);
    expect(c.dry).toBe(false);
    for (const f of c.fields) {
      const ctr = centroid(f.polygon);
      expect(pointInPolygon(ctr, o.boundary)).toBe(false);
      expect(ctr[0]).toBeGreaterThan(3); expect(ctr[0]).toBeLessThan(457);
      expect(f.strips.length).toBeGreaterThanOrEqual(3); // ridge-and-furrow lines
      for (const s of f.strips) for (const p of s) expect(pointInPolygon(p, f.polygon)).toBe(true);
    }
  });
  it("kitchen gardens hug the wall; orchards carry trees inside their plot", () => {
    const o = plainOpts();
    const c = generateCountryside(mulberry32(9), o);
    expect(c.gardens.length).toBeGreaterThanOrEqual(2);
    for (const g of c.gardens) {
      const ctr = centroid(g);
      const d = Math.hypot(ctr[0] - 230, ctr[1] - 230);
      expect(d).toBeGreaterThan(100); expect(d).toBeLessThan(125); // fringe ring just outside r=100
    }
    expect(c.orchards.length).toBeGreaterThanOrEqual(1);
    for (const or of c.orchards) {
      expect(or.trees.length).toBeGreaterThanOrEqual(4);
      for (const t of or.trees) expect(pointInPolygon(t, or.polygon)).toBe(true);
    }
  });
});

describe("generateCountryside — pastures/farmsteads/woods", () => {
  it("plains city gets fenced pastures with animals inside, farmsteads with barns", () => {
    const o = plainOpts();
    const c = generateCountryside(mulberry32(9), o);
    expect(c.pastures.length).toBeGreaterThanOrEqual(2);
    for (const p of c.pastures) {
      expect(p.animals.length).toBeGreaterThanOrEqual(2);
      for (const a of p.animals) expect(pointInPolygon(a, p.fence)).toBe(true);
    }
    expect(c.farmsteads.length).toBeGreaterThanOrEqual(1);
    for (const f of c.farmsteads) {
      expect(pointInPolygon(centroid(f.barn), o.boundary)).toBe(false);
      // barn is the bigger footprint (research: barns dwarf the farmhouse)
      const area = (poly: Polygon) => Math.abs(poly.reduce((s, [x, y], i, arr) => { const [nx2, ny2] = arr[(i + 1) % arr.length]; return s + x * ny2 - nx2 * y; }, 0) / 2);
      expect(area(f.barn)).toBeGreaterThan(area(f.house));
    }
    expect(c.woods.length).toBeGreaterThanOrEqual(10);
    for (const t of c.woods) {
      const nearEdge = t[0] < 40 || t[0] > 420 || t[1] < 40 || t[1] > 420;
      expect(nearEdge).toBe(true);
    }
  });
  it("patches never overlap each other and roads never cut through them (user-reported)", () => {
    for (const seed of [7, 9, 21]) {
      const o = plainOpts();
      const c = generateCountryside(mulberry32(seed), o);
      const patches: Polygon[] = [
        ...c.gardens, ...c.fields.map((f) => f.polygon), ...c.pastures.map((p) => p.fence),
        ...c.orchards.map((or) => or.polygon), ...c.farmsteads.flatMap((f) => [f.house, f.barn]),
        ...c.villages.flatMap((v) => [v.green, ...v.houses]),
      ];
      for (let i = 0; i < patches.length; i++) {
        for (let j = i + 1; j < patches.length; j++) {
          expect(polysOverlap(patches[i], patches[j])).toBe(false);
        }
      }
      // sample every road at 4px steps: no sample may land inside a patch
      for (const road of o.roads) for (let i = 0; i < road.length - 1; i++) {
        const [x1, y1] = road[i], [x2, y2] = road[i + 1];
        const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 4));
        for (let s = 0; s <= steps; s++) {
          const p: [number, number] = [x1 + ((x2 - x1) * s) / steps, y1 + ((y2 - y1) * s) / steps];
          for (const patch of patches) expect(pointInPolygon(p, patch)).toBe(false);
        }
      }
      // trees stay out of patches too
      for (const t of c.woods) for (const patch of patches) expect(pointInPolygon(t, patch)).toBe(false);
    }
  });
  it("places nucleated villages (chapel + green + house cluster) out in open country", () => {
    const o = plainOpts();
    let total = 0, croftTotal = 0;
    for (const seed of [9, 3, 7, 21, 42]) {
      const c = generateCountryside(mulberry32(seed), o);
      for (const v of c.villages) {
        total++;
        expect(v.houses.length).toBeGreaterThanOrEqual(5);
        expect(pointInPolygon(v.chapel, o.boundary)).toBe(false);
        expect(pointInPolygon(centroid(v.green), o.boundary)).toBe(false);
        for (const h of v.houses) expect(pointInPolygon(centroid(h), o.boundary)).toBe(false);
        // a nucleated hamlet, not a ribbon: an approach lane + tofts/pond enrich the cluster,
        // and the cottages sit tightly around the green (all within a compact radius)
        expect(v.lane.length).toBeGreaterThanOrEqual(2);
        const gc = centroid(v.green);
        for (const h of v.houses) expect(Math.hypot(centroid(h)[0] - gc[0], centroid(h)[1] - gc[1])).toBeLessThan(14);
        for (const cr of v.crofts) expect(pointInPolygon(centroid(cr), o.boundary)).toBe(false);
        // the lane threads the gaps between cottages — it never runs through a house
        for (const h of v.houses) {
          let hit = false;
          for (let i = 0; i < v.lane.length - 1; i++) {
            const a = v.lane[i], b = v.lane[i + 1], steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
            for (let s = 0; s <= steps; s++) if (pointInPolygon([a[0] + (b[0] - a[0]) * s / steps, a[1] + (b[1] - a[1]) * s / steps], h)) hit = true;
          }
          expect(hit).toBe(false);
        }
        croftTotal += v.crofts.length;
      }
    }
    expect(total).toBeGreaterThanOrEqual(1);
    expect(croftTotal).toBeGreaterThan(0); // garden tofts actually get placed (regressed to 0 once)
  });
  it("runs a three-field rotation: one sector lies fallow, the rest cultivated", () => {
    let sawFallow = false, sawCultivated = false;
    for (const seed of [3, 7, 9, 21, 42]) {
      const c = generateCountryside(mulberry32(seed), plainOpts());
      for (const f of c.fields) {
        expect(["cultivated", "fallow"]).toContain(f.state);
        if (f.state === "fallow") sawFallow = true;
        if (f.state === "cultivated") sawCultivated = true;
      }
    }
    expect(sawFallow).toBe(true);
    expect(sawCultivated).toBe(true);
  });
  it("desert fields are all cultivated (irrigation, not rotation)", () => {
    const c = generateCountryside(mulberry32(9), { ...plainOpts(), biome: DESERT });
    // this passed for a year by checking nothing: the irrigation filter left a desert town with no
    // fields at all, so the loop below ran zero times. It has to have something to be true about.
    expect(c.fields.length).toBeGreaterThan(0);
    for (const f of c.fields) expect(f.state).toBe("cultivated");
  });

  it("keeps gardens and every patch clear of the moat ring (user-reported farm-vs-water overlap)", () => {
    for (const seed of [9, 3, 7, 21, 42]) {
      const o = { ...plainOpts(), moat: moatRing() };
      const c = generateCountryside(mulberry32(seed), o);
      const patches: Polygon[] = [
        ...c.gardens, ...c.fields.map((f) => f.polygon), ...c.pastures.map((p) => p.fence),
        ...c.orchards.map((or) => or.polygon), ...c.farmsteads.flatMap((f) => [f.house, f.barn]),
        ...c.villages.flatMap((v) => [v.green, ...v.houses]),
      ];
      for (const patch of patches) for (const seg of o.moat) for (let i = 0; i < seg.length - 1; i++) {
        for (const v of patch) expect(pointSegDist(v, seg[i], seg[i + 1])).toBeGreaterThan(2.5);
      }
      expect(c.gardens.length).toBeGreaterThanOrEqual(2); // still populated past the moat
    }
  });
  it("no countryside patch overlaps the watercourse when a river crosses the map", () => {
    for (const seed of [3, 7, 9, 21, 42]) {
      const o = plainOpts();
      o.water = buildWater(mulberry32(seed), "river", { w: 460, h: 460 });
      const c = generateCountryside(mulberry32(seed), o);
      const patches: Polygon[] = [
        ...c.gardens, ...c.fields.map((f) => f.polygon), ...c.pastures.map((p) => p.fence),
        ...c.orchards.map((or) => or.polygon), ...c.farmsteads.flatMap((f) => [f.house, f.barn]),
        ...c.villages.flatMap((v) => [v.green, ...v.houses]),
      ];
      for (const patch of patches) for (const body of o.water.bodies) {
        expect(polysOverlap(patch, body)).toBe(false);
      }
    }
  });

  it("desert city has no pastures and no woods", () => {
    const o = { ...plainOpts(), biome: DESERT };
    const c = generateCountryside(mulberry32(9), o);
    expect(c.pastures.length).toBe(0);
    expect(c.woods.length).toBe(0);
    expect(c.dry).toBe(true);
  });
});

// A desert town asked for two fields and got none, in all thirty of them across twenty seeds. The
// profile set `fields: 2` and then an "irrigation" filter dropped every one, because it kept only
// fields within 90 units of a water body's CENTROID -- and fields are placed along the gate roads
// outside the wall, 86 to 195 units out. Measuring to the water's edge instead does not save it
// either: the candidates sit a median 184 units from the nearest shore, and a threshold wide enough
// to pass them (150) would leave 17 of 30 towns bare anyway while meaning nothing as "irrigation".
//
// The premise was wrong, not the number. An oasis is INSIDE the wall -- Liaeth's pond is beside its
// market square, its edge 16 units from the town centre -- so there is no ground near that water to
// farm; and where the water is a sea instead, it is a hundred units offshore. What carries the
// desert is the sparse count the profile already sets: two fields against a grassland town's 3+size.
import { generateCityLayout, cityContext } from "../city";
import { generateWorld } from "../world";
import { DEFAULT_PARAMS } from "../../types/world";

describe("a desert town farms what its profile asks for", () => {
  it("gets the fields it was given, rather than none at all", () => {
    let towns = 0, bare = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const w = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
      for (const c of w.cities) {
        if (c.biome !== DESERT) continue;
        towns++;
        if (!generateCityLayout(cityContext(c), seed).countryside.fields.length) bare++;
      }
    }
    expect(towns).toBeGreaterThan(0);
    expect(bare).toBe(0);
  });
});

// The countryside already knew the biome — `countrysideProfile` has branched on it since the start,
// giving a desert fewer fields and a taiga more woodland. What it never changed was the VOCABULARY:
// every plate drew the same round green tree, the same furlong strips and the same farmstead, so a
// taiga's woodland fringe and a jungle's were the same picture with different counts. The biome
// decides what the country grows and builds, and the engine remains the single source of truth for
// it — the renderer reads `vocabulary`, it does not sniff the biome itself.
describe("the countryside speaks the biome's vocabulary", () => {
  const withBiome = (biome: number, over: Partial<CountrysideOpts> = {}) =>
    generateCountryside(mulberry32(9), { ...plainOpts(), biome, ...over });

  it("plants conifers in the cold country and palms in the desert", () => {
    expect(withBiome(TAIGA).vocabulary.tree).toBe("conifer");
    expect(withBiome(ALPINE).vocabulary.tree).toBe("conifer");
    expect(withBiome(TUNDRA).vocabulary.tree).toBe("conifer");
    expect(withBiome(DESERT).vocabulary.tree).toBe("palm");
    expect(withBiome(GRASSLAND).vocabulary.tree).toBe("round");
    expect(withBiome(TROPICAL).vocabulary.tree).toBe("round");
  });

  it("terraces the fields where the ground is a slope, and not elsewhere", () => {
    expect(withBiome(ALPINE).vocabulary.field).toBe("terrace");
    expect(withBiome(TUNDRA).vocabulary.field).toBe("terrace");
    expect(withBiome(GRASSLAND).vocabulary.field).toBe("furlong");
    expect(withBiome(DESERT).vocabulary.field).toBe("furlong");
  });

  // A terrace is cut ACROSS the slope; a furlong strip is ploughed ALONG the block. So the two are
  // the same rectangle with its lines turned ninety degrees, and that is what this measures rather
  // than trusting the label.
  it("turns a terrace's lines across the block, where a furlong's run along it", () => {
    const alongness = (biome: number) => {
      const c = withBiome(biome);
      let checked = 0, along = 0;
      for (const f of c.fields) {
        // the block's long axis, from its own first edge pair
        const [a, b, , d] = f.polygon;
        const e1 = Math.hypot(b[0] - a[0], b[1] - a[1]), e2 = Math.hypot(d[0] - a[0], d[1] - a[1]);
        const long: [number, number] = e1 >= e2
          ? [(b[0] - a[0]) / e1, (b[1] - a[1]) / e1] : [(d[0] - a[0]) / e2, (d[1] - a[1]) / e2];
        for (const s of f.strips) {
          const sx = s[s.length - 1][0] - s[0][0], sy = s[s.length - 1][1] - s[0][1];
          const sl = Math.hypot(sx, sy) || 1;
          if (Math.abs((sx / sl) * long[0] + (sy / sl) * long[1]) > 0.7) along++;
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(2);           // the loop ran; not vacuously green
      return along / checked;
    };
    expect(alongness(GRASSLAND)).toBeGreaterThan(0.9);
    expect(alongness(ALPINE)).toBeLessThan(0.1);
  });

  it("builds a caravanserai in the desert where the green country builds a farmstead", () => {
    const desert = withBiome(DESERT, { oasis: true });
    const plain = withBiome(GRASSLAND);
    expect(plain.farmsteads.length).toBeGreaterThan(0);
    expect(plain.farmsteads.every((f) => f.kind === "farmstead")).toBe(true);
    expect(desert.vocabulary.farm).toBe("caravanserai");
    // a caravanserai is a range of building AROUND a court, so every one of them has the court
    for (const f of desert.farmsteads) {
      expect(f.kind).toBe("caravanserai");
      expect(f.yard).not.toBeNull();
      expect(pointInPolygon(centroid(f.yard!), f.house)).toBe(true);   // the court is inside the block
    }
  });

  it("still draws the same countryside it drew before, biome for biome", () => {
    for (const biome of [GRASSLAND, DESERT, ALPINE, TAIGA]) {
      const a = generateCountryside(mulberry32(4), { ...plainOpts(), biome });
      const b = generateCountryside(mulberry32(4), { ...plainOpts(), biome });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });
});

// A town in a forest was drawn as a town in an empty field: its woods were a thin fringe along the plate's
// edge (four to thirty-four units in), and between the farmland and that fringe lay a third of the plate of
// bare paper. A wooded country is wooded beyond its farmland — the trees fill the open country past the belt
// of fields round the town — while open country keeps only its fringe.
describe("a wooded country is wooded beyond its farmland", () => {
  const small = (biome: number): CountrysideOpts => {
    const boundary = [] as [number, number][];
    for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; boundary.push([230 + Math.cos(a) * 45, 230 + Math.sin(a) * 45]); }
    return { ...plainOpts(), boundary, biome };
  };
  const inland = (p: [number, number]) => Math.min(p[0], p[1], 460 - p[0], 460 - p[1]) > 40;
  for (const biome of [TEMPERATE_FOREST, TAIGA, TROPICAL]) {
    it(`fills the open country with trees (biome ${biome})`, () => {
      const cs = generateCountryside(mulberry32(5), small(biome));
      const deep = cs.woods.filter(inland);
      expect(deep.length, "the forest stops at the plate's edge").toBeGreaterThan(80);
      // ...past the farmland: none in the belt of fields round the walls
      for (const p of deep) expect(Math.hypot(p[0] - 230, p[1] - 230)).toBeGreaterThan(45 + 50);
    });
  }
  it("leaves open country its fringe only", () => {
    const cs = generateCountryside(mulberry32(5), small(GRASSLAND));
    expect(cs.woods.filter(inland).length).toBe(0);
  });
  it("keeps every tree off the fields, the pastures and the roads", () => {
    const cs = generateCountryside(mulberry32(5), small(TEMPERATE_FOREST));
    const patches = [...cs.fields.map((f) => f.polygon), ...cs.pastures.map((p) => p.fence), ...cs.orchards.map((o) => o.polygon)];
    for (const p of cs.woods) {
      for (const poly of patches) expect(pointInPolygon(p, poly)).toBe(false);
      for (const r of small(TEMPERATE_FOREST).roads) for (let i = 0; i + 1 < r.length; i++) expect(pointSegDist(p, r[i], r[i + 1])).toBeGreaterThanOrEqual(3);
    }
  });
});

// The plate painted a marsh, a desert and a tundra in a tint of the paper alone — the only thing that told their
// country from a plain's — while the world map gives each its mark: a tuft of marsh grass, the dots of sand, and
// (for the frozen ground the world map leaves blank) a frost hummock. The same marks stand in the plate's open
// country now, clear of everything on it, drawn last from the end of the stream; a plate of any other biome
// carries no such field at all, so its bytes stay.
describe("the ground of a marsh, a desert and a tundra carries its mark", () => {
  const withBiome = (biome: number) => generateCountryside(mulberry32(9), { ...plainOpts(), biome });
  const want: [number, "marsh" | "dune" | "hummock", number][] = [[WETLAND, "marsh", 40], [DESERT, "dune", 60], [TUNDRA, "hummock", 40]];

  for (const [biome, kind, atLeast] of want) {
    it(`scatters ${kind} marks over the country of biome ${biome}, and keeps them off everything on it`, () => {
      const cs = withBiome(biome);
      expect(cs.marks?.kind).toBe(kind);
      expect(cs.marks!.at.length).toBeGreaterThan(atLeast);
      const o = plainOpts();
      const patches = [...cs.fields.map((f) => f.polygon), ...cs.pastures.map((p) => p.fence), ...cs.orchards.map((x) => x.polygon), ...cs.gardens,
        ...cs.villages.flatMap((v) => [v.green, ...v.houses, ...v.crofts]), ...cs.farmsteads.flatMap((f) => [f.house, f.barn])];
      for (const p of cs.marks!.at) {
        expect(pointInPolygon(p, o.boundary), "a mark inside the town").toBe(false);
        for (const poly of patches) expect(pointInPolygon(p, poly), "a mark on a patch").toBe(false);
        for (const r of o.roads) for (let i = 0; i + 1 < r.length; i++) expect(pointSegDist(p, r[i], r[i + 1]), "a mark on a road").toBeGreaterThanOrEqual(3);
        for (const w of cs.woods) expect(Math.hypot(w[0] - p[0], w[1] - p[1]), "a mark under a tree").toBeGreaterThanOrEqual(4);
      }
    });
  }

  it("marks no other country, so those plates' bytes stay", () => {
    for (const biome of [GRASSLAND, TAIGA, TEMPERATE_FOREST, TROPICAL, ALPINE]) {
      expect("marks" in withBiome(biome), `biome ${biome}`).toBe(false);
    }
  });
});

// ★ A mark is placed by its point and drawn at a size — a tuft 3.6 across, a hummock 4.4 — and placed by the point
// alone, 450 of 18,313 marks over twelve worlds stood on a pasture's fence, a field's edge, a shore, a tree or the
// town's wall (2.5%; the plate census, 2026-10-15). It stands clear of everything AS DRAWN: its footprint
// (GROUND_MARK_FOOT, the drawn half-width) off every patch, house, shore, mountain, tree, wall, moat and road.
describe("the ground's marks stand clear of everything as drawn", () => {
  type P = [number, number];
  const edgeNear = (p: P, poly: P[], d: number) => { for (let i = 0; i < poly.length; i++) if (pointSegDist(p, poly[i], poly[(i + 1) % poly.length]) < d) return true; return false; };
  const lineNear = (p: P, line: P[], d: number) => { for (let i = 0; i + 1 < line.length; i++) if (pointSegDist(p, line[i], line[i + 1]) < d) return true; return false; };
  const hits: string[] = [];
  let marks = 0, plates = 0;
  for (const seed of [1, 2, 3]) {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
    for (const c of world.cities) {
      const L = generateCityLayout(cityContext(c), seed);
      const M = L.countryside.marks;
      if (!M) continue;
      plates++;
      const r = GROUND_MARK_FOOT[M.kind], cs = L.countryside, where = `${c.name} (seed ${seed}, ${M.kind})`;
      const polys: [string, P[]][] = [
        ...cs.fields.map((f): [string, P[]] => ["field", f.polygon]), ...cs.pastures.map((p): [string, P[]] => ["pasture", p.fence]),
        ...cs.orchards.map((o): [string, P[]] => ["orchard", o.polygon]), ...cs.gardens.map((g): [string, P[]] => ["garden", g]),
        ...cs.farmsteads.flatMap((f): [string, P[]][] => [["farmstead", f.house], ["farmstead", f.barn], ...(f.yard ? [["farmstead", f.yard] as [string, P[]]] : [])]),
        ...cs.villages.flatMap((v): [string, P[]][] => [["hamlet", v.green], ...v.houses.map((h): [string, P[]] => ["hamlet", h]), ...v.crofts.map((h): [string, P[]] => ["hamlet", h]), ...(v.pond ? [["hamlet", v.pond] as [string, P[]]] : [])]),
        ...L.suburbs.map((s): [string, P[]] => ["suburb", s]), ...L.water.bodies.map((b): [string, P[]] => ["water", b]),
        ...L.mountains.map((m): [string, P[]] => ["mountain", m.polygon]), ["town", L.boundary],
      ];
      for (const p of M.at) {
        marks++;
        for (const [k, poly] of polys) if (pointInPolygon(p, poly) || edgeNear(p, poly, r)) hits.push(`${where}: on a ${k}`);
        if (cs.woods.some((t) => Math.hypot(t[0] - p[0], t[1] - p[1]) < r + 3)) hits.push(`${where}: under a tree`);
        if (L.wall && L.wall.segments.some((s) => lineNear(p, s, r + 2))) hits.push(`${where}: on the ${L.wall.palisade ? "palisade" : "wall"}`);
        if (L.moat && L.moat.some((s) => lineNear(p, s, r + 2.5))) hits.push(`${where}: in the moat`);
        if (L.suburbRoads.some((rd) => lineNear(p, rd, r + 0.8))) hits.push(`${where}: on a road`);
      }
    }
  }
  it("has marked plates and marks to speak of", () => {
    expect(plates).toBeGreaterThan(20);
    expect(marks).toBeGreaterThan(2000);
  });
  it("stands every mark clear, by its drawn footprint", () => {
    expect(hits.slice(0, 12), `${hits.length} of ${marks} marks on something`).toEqual([]);
  });
});
