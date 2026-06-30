import { createNoise2D } from "simplex-noise";
import type { Rng } from "../rng";

export type Vec = [number, number];

export interface BasisField {
  kind: "grid" | "radial";
  center: Vec;
  size: number;
  decay: number;
  theta: number;
}

export interface TensorField {
  sample(p: Vec): { a: number; b: number };
  major(p: Vec): Vec;
  minor(p: Vec): Vec;
}

function decayWeight(p: Vec, c: Vec, size: number): number {
  const d = Math.hypot(p[0] - c[0], p[1] - c[1]);
  return Math.exp(-(d * d) / (2 * size * size));
}

export function makeTensorField(rng: Rng, fields: BasisField[], noiseAmp = 0.15): TensorField {
  const noise = createNoise2D(rng);
  const sample = (p: Vec) => {
    let a = 0, b = 0;
    for (const f of fields) {
      const w = decayWeight(p, f.center, f.size) * f.decay;
      let ta: number, tb: number;
      if (f.kind === "grid") {
        ta = Math.cos(2 * f.theta);
        tb = Math.sin(2 * f.theta);
      } else {
        const x = p[0] - f.center[0], y = p[1] - f.center[1];
        const m = Math.hypot(x, y) || 1;
        ta = (y * y - x * x) / (m * m);
        tb = (-2 * x * y) / (m * m);
      }
      a += ta * w;
      b += tb * w;
    }
    let ang = 0.5 * Math.atan2(b, a) + noise(p[0] * 0.01, p[1] * 0.01) * noiseAmp;
    const r = Math.hypot(a, b) || 1;
    return { a: r * Math.cos(2 * ang), b: r * Math.sin(2 * ang) };
  };
  return {
    sample,
    major(p) {
      const t = sample(p);
      const ang = 0.5 * Math.atan2(t.b, t.a);
      return [Math.cos(ang), Math.sin(ang)];
    },
    minor(p) {
      const m = this.major(p);
      return [-m[1], m[0]];
    },
  };
}
