import { describe, it, expect } from "vitest";
import { reliefAt } from "./relief";
import { LAND, MOUNTAIN, OCEAN } from "./terrain";

// A 9 x 9 lattice, ten apart, each cell joined to the eight round it; the town stands in the middle
// and the ground round it is whatever `ground(dx, dy)` says, dy growing southward as on the map.
const N = 9, MID = 4, TOWN = MID * N + MID;
function lattice(ground: (dx: number, dy: number) => number, sea: (dx: number, dy: number) => boolean = () => false) {
  const points: number[] = [], neighbors: number[][] = [], heights: number[] = [], terrain: number[] = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    points.push(x * 10, y * 10);
    const ns: number[] = [];
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      if ((i || j) && x + i >= 0 && x + i < N && y + j >= 0 && y + j < N) ns.push((y + j) * N + x + i);
    }
    neighbors.push(ns);
    const h = ground(x - MID, y - MID);
    heights.push(h);
    terrain.push(sea(x - MID, y - MID) ? OCEAN : h > 0.55 ? MOUNTAIN : LAND);
  }
  return { grid: { points, neighbors }, heights, terrain };
}
const at = (w: ReturnType<typeof lattice>) => reliefAt(w.grid, w.heights, w.terrain, TOWN);
// the difference between two bearings, either way round
const off = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const DEG = Math.PI / 180;

describe("the lie of the land at a town in the mountains", () => {
  it("stands on a summit where nothing round it is higher, its ridge running on toward the highest ground", () => {
    // a ridge falling gently away east, steeply everywhere else
    const r = at(lattice((dx, dy) => (dx >= 0 ? 0.8 - 0.005 * dx - 0.03 * Math.abs(dy) : 0.8 - 0.03 * (Math.abs(dx) + Math.abs(dy)))));
    expect(r?.relief).toBe("summit");
    expect(off(r!.bearing, 0)).toBeLessThan(DEG);
  });

  it("stands in a valley between two walls, and its bearing is the line the walls stand on", () => {
    // the walls rise north and south; the floor runs east-west
    const r = at(lattice((_dx, dy) => 0.6 + 0.03 * Math.abs(dy)));
    expect(r?.relief).toBe("valley");
    expect(off(r!.bearing, Math.PI / 2) < DEG || off(r!.bearing, -Math.PI / 2) < DEG).toBe(true);
  });

  it("stands in a valley on a pass between two heights, the ground falling away along the road", () => {
    const r = at(lattice((dx, dy) => 0.6 + 0.03 * (Math.abs(dy) - Math.abs(dx))));
    expect(r?.relief).toBe("valley");
    expect(off(r!.bearing, Math.PI / 2) < DEG || off(r!.bearing, -Math.PI / 2) < DEG).toBe(true);
  });

  it("stands in a valley in a hollow with higher ground all round", () => {
    expect(at(lattice((dx, dy) => 0.6 + 0.02 * Math.max(Math.abs(dx), Math.abs(dy))))?.relief).toBe("valley");
  });

  it("stands on a spur where the high ground behind it is narrow and the ground falls away round the rest", () => {
    // a ridge coming down from the west, falling away to both flanks and ahead
    const r = at(lattice((dx, dy) => 0.6 - 0.02 * dx - 0.03 * Math.abs(dy)));
    expect(r?.relief).toBe("spur");
    expect(off(r!.bearing, Math.PI)).toBeLessThan(DEG);
  });

  it("stands on a slope where the ground rises across a broad front — a plane is a slope, not a spur", () => {
    const r = at(lattice((dx) => 0.6 - 0.02 * dx));
    expect(r?.relief).toBe("slope");
    expect(off(r!.bearing, Math.PI)).toBeLessThan(DEG);
  });

  it("reads the land only: the sea beside a town is no wall of a valley", () => {
    // the plane rising west, with the sea on the east — as high as a wall, were it counted
    const r = at(lattice((dx) => (dx >= 2 ? 0.9 : 0.6 - 0.02 * dx), (dx) => dx >= 2));
    expect(r?.relief).toBe("slope");
  });

  it("says nothing of a town that is not in the mountains", () => {
    expect(at(lattice((dx) => 0.5 - 0.02 * dx))).toBeUndefined();
  });
});
