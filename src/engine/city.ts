import { mulberry32, deriveSeed } from "./rng";
import type { CityMarker } from "../types/world";

export interface District {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "market" | "residential" | "keep";
}

export interface CityLayout {
  cityId: number;
  name: string;
  wall: [number, number][];
  river: [number, number][] | null;
  districts: District[];
}

export interface CityContext {
  id: number;
  name: string;
  size: number;
  coastal: boolean;
  isCapital: boolean;
}

export function cityContext(c: CityMarker): CityContext {
  return { id: c.id, name: c.name, size: c.size, coastal: c.coastal, isCapital: c.isCapital };
}

export function generateCityLayout(ctx: CityContext, worldSeed: number): CityLayout {
  const rng = mulberry32(deriveSeed(worldSeed, ctx.id));
  const cx = 150, cy = 150;
  const R = 50 + ctx.size * 8;

  const sides = 10 + (ctx.isCapital ? 4 : 0);
  // wall is an open ring of vertices; the SVG renderer closes it (polygon)
  const wall: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const r = R * (0.85 + rng() * 0.3);
    wall.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }

  const jitter = (m: number) => (rng() - 0.5) * m;
  const river: [number, number][] | null = ctx.coastal
    ? [
        [cx - R * 1.5 + jitter(20), cy + 25 + jitter(30)],
        [cx + jitter(30), cy + 8 + jitter(20)],
        [cx + R * 1.5 + jitter(20), cy - 12 + jitter(30)],
      ]
    : null;

  const districts: District[] = [];
  const blocks = 4 + ctx.size;
  for (let i = 0; i < blocks; i++) {
    const a = rng() * Math.PI * 2;
    const rr = rng() * R * 0.7;
    const w = 14 + rng() * 16;
    const h = 14 + rng() * 16;
    const kind: District["kind"] =
      i === 0 && ctx.isCapital ? "keep" : rng() < 0.3 ? "market" : "residential";
    districts.push({ x: cx + Math.cos(a) * rr - w / 2, y: cy + Math.sin(a) * rr - h / 2, w, h, kind });
  }

  return { cityId: ctx.id, name: ctx.name, wall, river, districts };
}
