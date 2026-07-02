import type { World } from "../types/world";
import type { History } from "./history";
import {
  OCEAN, TUNDRA, TAIGA, TEMPERATE_FOREST, GRASSLAND, DESERT, TROPICAL, WETLAND, ALPINE,
} from "./biome";

const BIOME_PHRASE: Record<number, string> = {
  [OCEAN]: "open sea",
  [TUNDRA]: "frozen tundra",
  [TAIGA]: "northern pinewoods",
  [TEMPERATE_FOREST]: "green forest",
  [GRASSLAND]: "rolling plains",
  [DESERT]: "arid desert",
  [TROPICAL]: "dense jungle",
  [WETLAND]: "fenland marsh",
  [ALPINE]: "high mountains",
};

function compass(cx: number, cy: number, w: number, h: number): string {
  const ns = cy < h / 3 ? "north" : cy > (2 * h) / 3 ? "south" : "";
  const ew = cx < w / 3 ? "west" : cx > (2 * w) / 3 ? "east" : "";
  const dir = ns + ew;
  return dir === "" ? "heart of the world" : `${dir}`;
}

export function worldToGazetteer(world: World, history: History): string {
  const { grid } = world;
  const title = world.name.charAt(0).toUpperCase() + world.name.slice(1); // "the Pale Dominion" → "The …"
  const L: string[] = [];
  L.push(`# ${title}`, "");
  L.push(`${title} is a world of ${world.polities.length} realms and ${world.cultures.length} peoples.`, "");

  // The Land — named geographic regions
  L.push("## The Land", "");
  for (const r of world.regions) {
    const phrase = BIOME_PHRASE[r.kind] ?? "wild country";
    L.push(`- **${r.name}** — ${phrase} in the ${compass(r.centroid[0], r.centroid[1], grid.width, grid.height)}.`);
  }
  L.push("");

  // Peoples — cultures, described by where they dwell
  L.push("## Peoples", "");
  const agg = world.cultures.map(() => ({ sx: 0, sy: 0, n: 0, biome: new Map<number, number>() }));
  for (let i = 0; i < grid.count; i++) {
    const c = world.cultureOf[i];
    if (c < 0 || !agg[c]) continue;
    const a = agg[c];
    a.sx += grid.points[i * 2]; a.sy += grid.points[i * 2 + 1]; a.n++;
    const b = world.biome[i];
    a.biome.set(b, (a.biome.get(b) ?? 0) + 1);
  }
  world.cultures.forEach((cult, i) => {
    const a = agg[i];
    if (!a || a.n === 0) { L.push(`- **${cult.name}** — a scattered people.`); return; }
    let dom = OCEAN, dn = -1;
    for (const [b, cnt] of a.biome) if (b !== OCEAN && cnt > dn) { dn = cnt; dom = b; }
    L.push(`- **${cult.name}** — a people of the ${BIOME_PHRASE[dom] ?? "wild country"} in the ${compass(a.sx / a.n, a.sy / a.n, grid.width, grid.height)}.`);
  });
  L.push("");

  // Realms — the year-0 realms, their seats and towns
  L.push("## Realms", "");
  const byPolity = new Map<number, { capital?: string; towns: string[] }>();
  for (const city of world.cities) {
    const e = byPolity.get(city.polityId) ?? { towns: [] };
    if (city.isCapital) e.capital = city.name; else e.towns.push(city.name);
    byPolity.set(city.polityId, e);
  }
  for (const p of world.polities) {
    const e = byPolity.get(p.id) ?? { towns: [] };
    L.push(`### ${p.name}`);
    const seat = e.capital ? `Seated at **${e.capital}**` : "A realm without a fixed seat";
    L.push(e.towns.length ? `${seat}, with the towns of ${e.towns.join(", ")}.` : `${seat}.`, "");
  }

  // Free Ports — economic zones
  if (history.economicZones.length) {
    L.push("## Free Ports", "");
    for (const z of history.economicZones) L.push(`- **${z.name}** — a free port and staple of trade.`);
    L.push("");
  }

  // Chronicle — the forward history, by century
  L.push("## Chronicle (Years 0–500)", "");
  let lastCentury = -1;
  for (const ev of history.events) {
    const century = Math.floor(ev.year / 100);
    if (century !== lastCentury) { lastCentury = century; L.push("", `### ${century * 100}s`); }
    L.push(`- ${ev.text}`);
  }

  return L.join("\n") + "\n";
}
