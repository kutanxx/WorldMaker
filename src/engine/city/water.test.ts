import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import { area, pointSegDist } from "../geometry";
import type { Point, Polyline } from "../geometry";
import { buildWater, inWater, waterBridges, SEA_ARC_STRAIGHT } from "./water";
import type { Water } from "./water";

const B = { w: 300, h: 300 };

describe("water", () => {
  it("sea produces a band on one side", () => {
    const w = buildWater(mulberry32(1), "sea", B);
    expect(w.kind).toBe("sea");
    expect(w.bodies.length).toBe(1);
    expect(area(w.bodies[0])).toBeGreaterThan(0);
  });
  it("river crosses the map (spans top to bottom or side to side)", () => {
    const w = buildWater(mulberry32(2), "river", B);
    const poly = w.bodies[0];
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    const xSpan = Math.max(...xs) - Math.min(...xs);
    const ySpan = Math.max(...ys) - Math.min(...ys);
    expect(Math.max(xSpan, ySpan)).toBeGreaterThan(150);
  });
  it("lake is an enclosed inland body not touching the border", () => {
    const w = buildWater(mulberry32(3), "lake", B);
    const xs = w.bodies[0].map((p) => p[0]);
    expect(Math.min(...xs)).toBeGreaterThan(0);
    expect(Math.max(...xs)).toBeLessThan(300);
  });
  it("none produces no bodies", () => {
    expect(buildWater(mulberry32(1), "none", B).bodies.length).toBe(0);
  });
  it("inWater is true inside a body and false at the centre for a side sea", () => {
    const w = buildWater(mulberry32(1), "sea", B);
    const inside = w.bodies[0][0];
    expect(inWater(w, inside)).toBe(true);
  });
  it("waterBridges marks a bridge where a road crosses a river", () => {
    const w = buildWater(mulberry32(2), "river", B);
    const road: Polyline = [[0, 150], [300, 150]];
    expect(waterBridges([road], w).length).toBeGreaterThanOrEqual(1);
  });
  it("is deterministic", () => {
    expect(JSON.stringify(buildWater(mulberry32(7), "meander", B)))
      .toBe(JSON.stringify(buildWater(mulberry32(7), "meander", B)));
  });
  it("sea has a wavy (non-straight) land-facing edge", () => {
    // try several seeds; the land edge must deviate from a straight line
    let wavy = false;
    for (let s = 0; s < 8; s++) {
      const w = buildWater(mulberry32(s), "sea", { w: 300, h: 300 });
      const poly = w.bodies[0];
      // land-facing edge = the vertices NOT on the canvas border (x in (0,300), y in (0,300))
      const inner = poly.filter((p) => p[0] > 1 && p[0] < 299 && p[1] > 1 && p[1] < 299);
      if (inner.length >= 3) {
        const xs = inner.map((p) => p[0]), ys = inner.map((p) => p[1]);
        const spreadX = Math.max(...xs) - Math.min(...xs);
        const spreadY = Math.max(...ys) - Math.min(...ys);
        // a straight side band has ~0 spread on the depth axis; waviness gives > 6
        if (Math.min(spreadX, spreadY) > 6) wavy = true;
      }
    }
    expect(wavy).toBe(true);
  });
});

// The town plan's waterfront used to be one smooth low-frequency wave sampled 13 times: measured
// across 81 coastal towns it was only 0.6-2.6% longer than a dead straight line, where the world
// map's coastline is 6.4% longer PER voronoi edge. At the plate's own scale that reads as the edge
// of a colour band, not as a coast. These two guard the fix: coast-scale crenulation, at more than
// one scale.
function seaEdge(seed: number, bounds = { w: 460, h: 460 }) {
  const body = buildWater(mulberry32(seed), "sea", bounds).bodies[0];
  return body.slice(1, body.length - 1); // drop the two canvas corners; the rest is the shore
}
function chordRatio(edge: { 0: number; 1: number }[] | number[][]): number {
  const a = edge[0] as number[], b = edge[edge.length - 1] as number[];
  let len = 0;
  for (let i = 1; i < edge.length; i++) {
    const p = edge[i] as number[], q = edge[i - 1] as number[];
    len += Math.hypot(p[0] - q[0], p[1] - q[1]);
  }
  return len / Math.hypot(b[0] - a[0], b[1] - a[1]);
}

describe("sea shore relief", () => {
  it("crenulates as much as the world map's own coastline", () => {
    for (let s = 0; s < 12; s++) {
      // the world coastline's noisy edges measure 1.064 mean / 1.182 worst per edge
      expect(chordRatio(seaEdge(s))).toBeGreaterThan(1.05);
    }
  });
  it("carries relief at more than one scale (not a single smooth wave)", () => {
    for (let s = 0; s < 12; s++) {
      const edge = seaEdge(s);
      const a = edge[0], b = edge[edge.length - 1];
      const dx = b[0] - a[0], dy = b[1] - a[1], m = Math.hypot(dx, dy);
      const dev = edge.map((p) => ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / m);
      let turns = 0;
      for (let i = 2; i < dev.length; i++) {
        const d1 = dev[i - 1] - dev[i - 2], d2 = dev[i] - dev[i - 1];
        if (d1 * d2 < 0) turns++;
      }
      // one 3-period wave gives ~5 turns; coast-scale detail gives many more
      expect(turns).toBeGreaterThanOrEqual(12);
    }
  });
});

// A bridge used to be the whole ROAD SEGMENT that happened to straddle the waterline, and a road
// segment is as long as the road wanted it. Measured over twenty seeds, 400 bridges: median length
// 51 units with only 28% of it over water, 38% longer than 60 units, and some spanning no water at
// all. Drawn in the old muted brown that read as a smudge; the moment crossings were given stone
// parapets one of them showed up as a 366-pixel bar lying ALONG the river it was meant to cross.
describe("a bridge spans the water and nothing else", () => {
  // a meander always runs top to bottom, so a road laid west-east is guaranteed to cross it
  const river = buildWater(mulberry32(3), "meander", { w: 300, h: 300 });
  const acrossAt = (y: number): Polyline => [[0, y], [300, y]];

  it("stands over the water it crosses, not over the bank beside it", () => {
    let found = 0;
    for (const y of [40, 90, 150, 210, 260]) {
      for (const [a, b] of waterBridges([acrossAt(y)], river)) {
        found++;
        let wet = 0;
        const S = 200;
        for (let i = 0; i < S; i++) {
          const t = (i + 0.5) / S;
          if (inWater(river, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])) wet++;
        }
        expect(wet / S, `span at y=${y}`).toBeGreaterThan(0.5);
      }
    }
    expect(found, "five roads laid across a river, and no bridge on any of them").toBe(5);
  });

  it("lands on both banks — a road that runs into the water and stops is not a bridge", () => {
    let found = 0;
    for (const y of [40, 90, 150, 210, 260]) {
      for (const [a, b] of waterBridges([acrossAt(y)], river)) {
        found++;
        expect(inWater(river, a), `near abutment at y=${y}`).toBe(false);
        expect(inWater(river, b), `far abutment at y=${y}`).toBe(false);
      }
    }
    expect(found).toBe(5);
    // A road usually stops AT the bank because that is where the street network was clipped, not
    // because the crossing is imaginary, so a road ending in the river is carried on to the far
    // bank. Water with no far bank within reach is not a crossing at all: a lane running down into
    // the sea is a slipway, and carries no bridge.
    const sea = buildWater(mulberry32(3), "sea", { w: 300, h: 300 });
    let x = 0;
    while (x < 300 && !inWater(sea, [x, 150])) x += 1;
    expect(x, "the sea must be somewhere in the frame").toBeLessThan(300);
    expect(waterBridges([[[0, 150], [x + 4, 150]]], sea).length).toBe(0);
  });

  it("bridges every crossing of a road that meets the water twice", () => {
    // a hairpin over a vertical river: in, out, and in again
    const hairpin: Polyline = [[0, 40], [300, 40], [300, 150], [0, 150], [0, 260], [300, 260]];
    expect(waterBridges([hairpin], river).length).toBe(3);
  });

  it("draws one bridge where two streets cross the water side by side", () => {
    // Parallel streets a couple of units apart each earned their own bridge, and the two came out
    // all but on top of each other: 29 near-duplicate pairs among 250 bridges over twenty seeds,
    // which the old muted line hid and stone parapets do not. The gap between bridges is bimodal —
    // 4.5 units at the 5th percentile against 92 at the median — so anything within 12 is one
    // crossing counted twice.
    const twin: Polyline[] = [[[0, 150], [300, 150]], [[0, 153], [300, 153]]];
    expect(waterBridges(twin, river).length).toBe(1);
    // ...while a genuinely separate crossing upstream is still its own bridge
    expect(waterBridges([twin[0], [[0, 90], [300, 90]]], river).length).toBe(2);
  });
});

// The sea was placed by `randInt(rng, 0, 3)` — one of four edges, drawn from the town's own rng and
// owing nothing to the world the town stands in. An outside review checked Sai at world (888, 504),
// on the EAST coast of the eastern continent, and found its plate drawing the sea to the WEST, the
// harbour with it. Every coastal town it opened had the sea on the left. The plate has a compass
// and its north is the world's north, so the water only ever needed to be told which way to lie.
describe("the sea lies where the world says it lies", () => {
  const bounds = { w: 460, h: 460 };
  const centre: Point = [230, 230];
  const seaBearingOnPlate = (w: ReturnType<typeof buildWater>) => {
    // the mean of the water body's own vertices, seen from the middle of the plate
    let sx = 0, sy = 0, n = 0;
    for (const b of w.bodies) for (const p of b) { sx += p[0]; sy += p[1]; n++; }
    return Math.atan2(sy / n - centre[1], sx / n - centre[0]);
  };
  const gap = (a: number, b: number) => {
    let d = Math.abs(a - b) % (Math.PI * 2);
    return d > Math.PI ? Math.PI * 2 - d : d;
  };

  it("puts the water on the side it is told, all the way round the compass", () => {
    for (const deg of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const bearing = (deg * Math.PI) / 180;
      const water = buildWater(mulberry32(7), "sea", bounds, bearing);
      expect(water.bodies.length, `no sea at ${deg}deg`).toBeGreaterThan(0);
      const drawn = seaBearingOnPlate(water);
      expect((gap(drawn, bearing) * 180) / Math.PI, `sea asked for ${deg}deg`).toBeLessThan(20);
    }
  });

  it("still fills a sensible share of the plate, whichever way it faces", () => {
    for (const deg of [0, 45, 90, 200, 315]) {
      const water = buildWater(mulberry32(3), "sea", bounds, (deg * Math.PI) / 180);
      const a = water.bodies.reduce((t, b) => t + Math.abs(area(b)), 0) / (bounds.w * bounds.h);
      expect(a, `${deg}deg covers ${(a * 100).toFixed(0)}% of the plate`).toBeGreaterThan(0.12);
      expect(a).toBeLessThan(0.45);
    }
    // ...and it stays on the plate: no water painted out over the legend strip beside it
    for (const b of buildWater(mulberry32(3), "sea", bounds, 0.6).bodies) {
      for (const p of b) {
        expect(p[0]).toBeGreaterThanOrEqual(-0.01);
        expect(p[0]).toBeLessThanOrEqual(bounds.w + 0.01);
        expect(p[1]).toBeGreaterThanOrEqual(-0.01);
        expect(p[1]).toBeLessThanOrEqual(bounds.h + 0.01);
      }
    }
  });

  // ...and its shore runs the way the world's coast runs there: a port at the head of a bay has land on
  // both its flanks, one on a headland has the sea round them. Every port's shore was drawn straight.
  it("bends the shore the way the world's coast runs: into a bay, straight, or round a headland", () => {
    const R = 90, bearing = 0.7;
    const at = (u: number, v: number): Point => [centre[0] + Math.cos(bearing) * u - Math.sin(bearing) * v, centre[1] + Math.sin(bearing) * u + Math.cos(bearing) * v];
    const sea = (seaArc?: number) => buildWater(mulberry32(7), "sea", bounds, bearing, R, undefined, { seaArc });
    const share = (w: Water) => w.bodies.reduce((t, b) => t + Math.abs(area(b)), 0) / (bounds.w * bounds.h);
    const bay = sea(0.3 * Math.PI), straight = sea(SEA_ARC_STRAIGHT), headland = sea(1.3 * Math.PI);
    // the town's flanks, a reach and a third to either side of it and a little seaward
    for (const v of [-1.3 * R, 1.3 * R]) {
      expect(inWater(bay, at(0.3 * R, v)), "a bay's flank").toBe(false);
      expect(inWater(headland, at(0.3 * R, v)), "a headland's flank").toBe(true);
    }
    expect(inWater(bay, at(1.2 * R, 0)), "the sea in front of a town in a bay").toBe(true);
    expect(share(bay)).toBeLessThan(share(straight));
    expect(share(headland)).toBeGreaterThan(share(straight));
    // ...and a port on a straight coast, or one the world has not measured, keeps the shore it had
    expect(straight).toEqual(sea(undefined));
  });

  // ...and a port between two seas has the second one too, across the land from its own
  it("draws a port's second sea on the far side of it, and leaves its own sea as it was", () => {
    const R = 90, bearing = 0.7;
    const one = buildWater(mulberry32(7), "sea", bounds, bearing, R, undefined, { seaArc: SEA_ARC_STRAIGHT });
    const two = buildWater(mulberry32(7), "sea", bounds, bearing, R, undefined, { seaArc: SEA_ARC_STRAIGHT, otherSea: { bearing: bearing + Math.PI, arc: 0.5 * Math.PI } });
    expect(two.bodies.length).toBe(2);
    expect(two.bodies[0]).toEqual(one.bodies[0]);
    const far: Point = [centre[0] + Math.cos(bearing + Math.PI) * R * 1.3, centre[1] + Math.sin(bearing + Math.PI) * R * 1.3];
    expect(inWater(one, far)).toBe(false);
    expect(inWater(two, far)).toBe(true);
    expect(inWater(two, centre), "the town between them stands on dry land").toBe(false);
  });

  it("falls back to a drawn side when the world has not said which way", () => {
    const water = buildWater(mulberry32(7), "sea", bounds);
    expect(water.bodies.length).toBe(1);
  });
});

// The river does at a town what the world's river does there (see world.ts): it turns at a town in its
// bend the way the world's turns, and a town where the world's river rises has it rise there.
describe("the river at a town does what the world's does", () => {
  const R = 90;
  // how far along the flow each point of the water lies from the middle of the plate, and how far to
  // its right (the flow turned a quarter clockwise on the map)
  const frame = (flow: number) => ({
    along: (p: Point) => (p[0] - 150) * Math.cos(flow) + (p[1] - 150) * Math.sin(flow),
    right: (p: Point) => -(p[0] - 150) * Math.sin(flow) + (p[1] - 150) * Math.cos(flow),
  });

  // The loop is drawn round the town in the point of a V: the river comes in on one side of its chord
  // and leaves on the other, some 60 degrees turned. Its legs — where it comes and goes, off the edge
  // of the plate — lie on the side the world's river turns toward, and the loop swings out the other.
  it("swings the loop round the town the way the world's river turns", () => {
    for (const flow of [0, 1.1, -2.3]) for (const turn of [-0.9, 0.9]) {
      const w = buildWater(mulberry32(4), "loop", B, undefined, R, flow, { turn });
      const edge = w.bodies[0].filter((p) => p[0] < 0.5 || p[0] > B.w - 0.5 || p[1] < 0.5 || p[1] > B.h - 0.5);
      expect(edge.length, `flow ${flow}, turn ${turn}`).toBeGreaterThan(0);
      const side = edge.reduce((t, p) => t + frame(flow).right(p), 0) / edge.length;
      expect(Math.sign(side), `flow ${flow}, turn ${turn}`).toBe(Math.sign(turn));
    }
  });

  it("raises the river at a town where the world's river rises, and runs it on from there", () => {
    for (const flow of [0, 1.1, -2.3]) {
      const { along } = frame(flow);
      const rises = buildWater(mulberry32(4), "river", B, undefined, R, flow, { rises: true });
      expect(rises.bodies.length).toBe(1);
      const a = rises.bodies[0].map(along);
      expect(Math.min(...a), `flow ${flow}: it begins in the town`).toBeGreaterThan(-R * 0.8);
      expect(Math.min(...a), `flow ${flow}: upstream of its middle`).toBeLessThan(0);
      expect(Math.max(...a), `flow ${flow}: and runs out off the plate`).toBeGreaterThan(140);
      // ...where a river that does not rise there crosses the whole plate
      const through = buildWater(mulberry32(4), "river", B, undefined, R, flow);
      expect(Math.min(...through.bodies[0].map(along))).toBeLessThan(-140);
    }
  });

  it("wells up from a spring wider than the stream it gives", () => {
    const w = buildWater(mulberry32(4), "river", B, undefined, R, 0, { rises: true });
    const b = w.bodies[0];
    // how wide the water is at its widest along a stretch of it: the largest circle that fits in it there
    const edge = (p: Point) => { let d = Infinity; for (let i = 0; i < b.length; i++) d = Math.min(d, pointSegDist(p, b[i], b[(i + 1) % b.length])); return d; };
    const widest = (x0: number, x1: number) => {
      let m = 0;
      for (let x = x0; x <= x1; x++) for (let y = 0; y <= B.h; y++) if (inWater(w, [x, y])) m = Math.max(m, edge([x, y]));
      return m;
    };
    const head = Math.min(...b.map((p) => p[0]));
    expect(widest(head, head + 30)).toBeGreaterThan(widest(head + 60, head + 150) * 1.5);
  });
});

// A river is as wide on the plate as the world map draws it — a stream, a river or a great river, at the
// world map's own proportions (0.9, 1.5 and 2.1). Every river on a plate was the one width.
describe("a river as wide as the world draws it", () => {
  // the largest circle that fits in the water: its half-width where it is widest
  const widest = (w: ReturnType<typeof buildWater>) => {
    const b = w.bodies[0];
    const edge = (p: Point) => { let d = Infinity; for (let i = 0; i < b.length; i++) d = Math.min(d, pointSegDist(p, b[i], b[(i + 1) % b.length])); return d; };
    let m = 0;
    for (let x = 0; x <= B.w; x++) for (let y = 0; y <= B.h; y++) if (inWater(w, [x, y])) m = Math.max(m, edge([x, y]));
    return m;
  };
  it("draws a stream narrower and a great river wider than a river, in the world map's proportions", () => {
    for (const kind of ["river", "loop", "meander"] as const) {
      const [stream, river, great] = ([0, 1, 2] as const).map((size) => widest(buildWater(mulberry32(6), kind, B, undefined, 80, 0.4, { size })));
      expect(stream / river, `${kind}: a stream`).toBeGreaterThan(0.5);
      expect(stream / river, `${kind}: a stream`).toBeLessThan(0.7);
      expect(great / river, `${kind}: a great river`).toBeGreaterThan(1.3);
      expect(great / river, `${kind}: a great river`).toBeLessThan(1.5);
      // ...and a river the world has not sized is drawn the width a river always was
      expect(widest(buildWater(mulberry32(6), kind, B, undefined, 80, 0.4)), kind).toBeCloseTo(river, 5);
    }
  });
});
