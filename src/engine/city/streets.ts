import type { Vec, TensorField } from "./tensorField";
import type { Polyline } from "../geometry";

export interface StreetOpts {
  dsep: number;
  dtest: number;
  step: number;
  maxLength: number;
  bounds: { w: number; h: number };
  useMinor: boolean;
}

class SpatialIndex {
  private cell: number;
  private map = new Map<string, Vec[]>();
  constructor(cell: number) { this.cell = cell; }
  private key(x: number, y: number) { return Math.floor(x / this.cell) + "," + Math.floor(y / this.cell); }
  add(p: Vec) {
    const k = this.key(p[0], p[1]);
    const a = this.map.get(k);
    if (a) a.push(p); else this.map.set(k, [p]);
  }
  near(p: Vec, d: number): boolean {
    const cx = Math.floor(p[0] / this.cell), cy = Math.floor(p[1] / this.cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const a = this.map.get((cx + dx) + "," + (cy + dy));
      if (!a) continue;
      for (const q of a) if (Math.hypot(q[0] - p[0], q[1] - p[1]) < d) return true;
    }
    return false;
  }
}

function rk4(field: TensorField, p: Vec, useMinor: boolean, step: number, prev: Vec | null): Vec {
  const dir = (q: Vec): Vec => {
    let v = useMinor ? field.minor(q) : field.major(q);
    if (prev && v[0] * prev[0] + v[1] * prev[1] < 0) v = [-v[0], -v[1]];
    return v;
  };
  const k1 = dir(p);
  const k2 = dir([p[0] + (k1[0] * step) / 2, p[1] + (k1[1] * step) / 2]);
  const k3 = dir([p[0] + (k2[0] * step) / 2, p[1] + (k2[1] * step) / 2]);
  const k4 = dir([p[0] + k3[0] * step, p[1] + k3[1] * step]);
  const vx = (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) / 6;
  const vy = (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) / 6;
  const m = Math.hypot(vx, vy) || 1;
  return [vx / m, vy / m];
}

function traceDir(
  field: TensorField, start: Vec, opts: StreetOpts, stop: (p: Vec) => boolean,
  index: SpatialIndex, sign: number
): Vec[] {
  const pts: Vec[] = [];
  let p: Vec = [start[0], start[1]];
  let prev: Vec | null = null;
  for (let i = 0; i < opts.maxLength; i++) {
    if (p[0] < 0 || p[1] < 0 || p[0] > opts.bounds.w || p[1] > opts.bounds.h) break;
    if (stop(p)) break;
    if (pts.length > 2 && index.near(p, opts.dtest)) break;
    pts.push([p[0], p[1]]);
    let d = rk4(field, p, opts.useMinor, opts.step, prev);
    d = [d[0] * sign, d[1] * sign];
    prev = d;
    p = [p[0] + d[0] * opts.step, p[1] + d[1] * opts.step];
  }
  return pts;
}

function traceStreamline(
  field: TensorField, seed: Vec, opts: StreetOpts, stop: (p: Vec) => boolean, index: SpatialIndex
): Polyline {
  const fwd = traceDir(field, seed, opts, stop, index, 1);
  const bwd = traceDir(field, seed, opts, stop, index, -1);
  bwd.reverse();
  return bwd.slice(0, -1).concat(fwd);
}

export function generateStreets(
  field: TensorField, opts: StreetOpts, stop: (p: Vec) => boolean, seeds: Vec[]
): Polyline[] {
  const index = new SpatialIndex(opts.dsep);
  const streets: Polyline[] = [];
  const queue: Vec[] = seeds.map((s) => [s[0], s[1]] as Vec);
  let guard = 0;
  const seedStride = Math.max(1, Math.round(opts.dsep / opts.step));
  while (queue.length > 0 && guard < 4000) {
    guard++;
    const seed = queue.shift()!;
    if (seed[0] < 0 || seed[1] < 0 || seed[0] > opts.bounds.w || seed[1] > opts.bounds.h) continue;
    if (stop(seed) || index.near(seed, opts.dsep)) continue;
    const line = traceStreamline(field, seed, opts, stop, index);
    if (line.length < 3) continue;
    for (const p of line) index.add(p);
    streets.push(line);
    for (let i = 0; i < line.length; i += seedStride) {
      const p = line[i];
      const perp = opts.useMinor ? field.major(p) : field.minor(p);
      queue.push([p[0] + perp[0] * opts.dsep, p[1] + perp[1] * opts.dsep]);
      queue.push([p[0] - perp[0] * opts.dsep, p[1] - perp[1] * opts.dsep]);
    }
  }
  return streets;
}
