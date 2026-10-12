// A world's fingerprint: a short code over what the world IS, for checking that two browsers made the same one.
//
// No world is stored anywhere. Every browser computes it from its number and settings, and the computation
// leans on Math.sin, Math.cos, Math.atan2 and the like, whose last digits the language leaves to each
// browser's engine — so a world made in one browser is only PROBABLY the world made in another. The
// fingerprint is how a reader (or a test) finds out: open the same link in both and compare two codes.
//
// It folds what a reader sees, not every float the generator passed through: the ground's kinds, the
// realms, peoples and provinces cell by cell, every town (where, what it is called, what it is), the roads
// and sea routes, the rivers and their names, every name on the map, and the five centuries — their
// events and who held each cell at each step. Two worlds with the same fingerprint draw the same map and
// tell the same history; a last-digit difference that moves nothing a reader can see does not count.
import type { World } from "../types/world";
import type { History } from "./historySim";
import type { CityLayout } from "./city";

const FNV = 2166136261;
const fold = (h: number, v: number) => Math.imul(h ^ v, 16777619) >>> 0;
function foldText(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) h = fold(h, s.charCodeAt(i));
  return fold(h, 0x1f);
}
function foldNumbers(h: number, xs: ArrayLike<number>): number {
  for (let i = 0; i < xs.length; i++) h = fold(h, xs[i] | 0);
  return fold(h, 0x1e);
}
const code = (h: number) => {
  const x = (h >>> 0).toString(16).toUpperCase().padStart(8, "0");
  return `${x.slice(0, 4)}-${x.slice(4)}`;
};

export function worldFingerprint(world: World, history: History): string {
  let h = FNV;
  h = foldText(h, world.name);
  for (const a of [world.terrain, world.biome, world.polityOf, world.provinceOf, world.cultureOf]) h = foldNumbers(h, a);
  for (const r of world.regions) h = foldText(h, r.name);
  for (const p of world.polities) h = foldText(h, `${p.id}:${p.name}`);
  for (const c of world.cultures) h = foldText(h, c.name);
  for (const c of world.cities) h = foldText(h, `${c.id}:${c.cell}:${c.name}:${c.size}:${c.isCapital ? 1 : 0}:${c.coastal ? 1 : 0}:${c.river ? 1 : 0}`);
  for (const r of world.roads) { h = fold(h, r.a); h = fold(h, r.b); h = foldNumbers(h, r.cells); }
  for (const s of world.seaRoutes ?? []) { h = fold(h, s.a); h = fold(h, s.b); }
  for (const r of world.rivers) { h = foldText(h, r.name); h = fold(h, r.path.length); }
  h = fold(h, world.riverNet.length);
  for (const p of history.polities) h = foldText(h, `${p.id}:${p.name}:${p.capital}:${p.foundedYear}:${p.endedYear ?? "-"}:${p.free ? 1 : 0}`);
  for (const e of history.events) h = foldText(h, `${e.year}:${e.type}:${e.polityId}:${e.otherId ?? "-"}:${e.cell ?? "-"}:${e.name ?? "-"}:${(e.intoIds ?? []).join(",")}`);
  for (const s of history.snapshots) { h = fold(h, s.year); h = foldNumbers(h, s.owner); }
  for (const f of history.cityFoundings) { h = fold(h, f.cityId); h = fold(h, f.year); }
  for (const z of history.economicZones) h = foldText(h, `${z.cell}:${z.name}`);
  return code(h);
}

/**
 * A town plate's fingerprint: its whole plan, every coordinate to a hundredth of a unit (a plate is some
 * 460 units across, so finer than any line it draws) — again so a last digit that moves nothing does not
 * count, and anything that moves a line does.
 */
export function plateFingerprint(layout: CityLayout): string {
  const text = JSON.stringify(layout, (_k, v) => (typeof v === "number" && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v));
  return code(foldText(FNV, text));
}
