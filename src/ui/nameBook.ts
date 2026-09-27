import type { World } from "../types/world";
import type { History } from "../engine/history";
import { ownName } from "../engine/hangul";

/**
 * The reader's own names for a world's places.
 *
 * "No way to rename" was the complaint about map generators the research met most often (Perilous
 * Shores, the city and village generators' comments), and a novelist names their own world. Chosen from
 * a demo the reader could click: names are changed on the map itself, and kept in the link.
 *
 * Keys are short, since they ride in the address: `w` the world, `t<id>` a town, `r<id>` a realm, `c<i>`
 * a people, `g<i>` a region (land or sea), `v<i>` a river, `p<id>` a province.
 */
export type NameBook = Record<string, string>;

/** how long a name may be, in characters */
export const NAME_MAX = 40;
const KEY = /^(?:w|[trcgvp]\d+)$/;
const ORDER = "wtrcgvp";
const byKey = (a: string, b: string) =>
  ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]) || Number(a.slice(1) || 0) - Number(b.slice(1) || 0);

/**
 * The book as it goes into the address: base64url of its JSON in UTF-8 — nothing a hash has to escape,
 * and a Hangul syllable costs 4 characters where percent-encoding spends 9 (world 1 renamed throughout,
 * 173 names, came to 2.6 KB against 6.1). "" for an empty book, so an untouched world's address is as it was.
 */
export function encodeNames(book: NameBook): string {
  const keys = Object.keys(book).filter((k) => KEY.test(k) && book[k]).sort(byKey);
  if (!keys.length) return "";
  const bytes = new TextEncoder().encode(JSON.stringify(Object.fromEntries(keys.map((k) => [k, book[k]]))));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** ...and back. Anything that is not a book reads as an empty one: an address is typed by people. */
export function decodeNames(code: string): NameBook {
  try {
    const b64 = code.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const raw: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    if (!raw || typeof raw !== "object") return {};
    const out: NameBook = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!KEY.test(k) || typeof v !== "string") continue;
      const name = Array.from(v.trim()).slice(0, NAME_MAX).join("");   // by character, not by UTF-16 unit
      if (name) out[k] = name;
    }
    return out;
  } catch {
    return {};
  }
}

/** Every name `applyNames` can change, as the world was generated — what an empty book gives back. */
export interface GeneratedNames {
  world: string;
  towns: string[];
  realms: Map<number, string>;
  record: string[];
  peoples: string[];
  regions: string[];
  rivers: string[];
  provinces: string[];
  zones: string[];
  events: (string | undefined)[];
}

export function generatedNames(world: World, history: History): GeneratedNames {
  return {
    world: world.name,
    towns: world.cities.map((c) => c.name),
    realms: new Map(world.polities.map((p) => [p.id, p.name])),
    record: history.polities.map((p) => p.name),
    peoples: world.cultures.map((c) => c.name),
    regions: world.regions.map((r) => r.name),
    rivers: world.rivers.map((r) => r.name),
    provinces: world.provinces.map((p) => p.name),
    zones: history.economicZones.map((z) => z.name),
    events: history.events.map((e) => e.name),
  };
}

/**
 * Write the book INTO the world and its record, so every place that draws or writes a name — the map
 * in every view and year, its keys, the town list, the plates, the chronicle, the gazetteer, the files —
 * draws the reader's. A town's or a realm's or a people's name carries the mark that keeps it as typed
 * (hangul.ts `ownName`); a region, river, province or the world is a composite with parts, and takes a
 * `custom` label (and its English `name`) instead. What is named after a town follows it: a free port,
 * and the chronicle's founding of it, by the town's cell. An empty book gives back `generated` exactly.
 */
export function applyNames(world: World, history: History, generated: GeneratedNames, book: NameBook): void {
  const own = (key: string, was: string) => (book[key] ? ownName(book[key]) : was);
  world.name = book.w ?? generated.world;
  world.cities.forEach((c, i) => { c.name = own(`t${c.id}`, generated.towns[i]); });
  for (const p of world.polities) p.name = own(`r${p.id}`, generated.realms.get(p.id) ?? p.name);
  history.polities.forEach((p, i) => { p.name = own(`r${i}`, generated.record[i]); });
  world.cultures.forEach((c, i) => { c.name = own(`c${i}`, generated.peoples[i]); });
  const place = (kind: string, items: { name: string; label: { custom?: string } }[], was: string[], idOf: (i: number) => number) =>
    items.forEach((it, i) => {
      const mine = book[`${kind}${idOf(i)}`];
      if (mine) { it.label.custom = mine; it.name = mine; } else { delete it.label.custom; it.name = was[i]; }
    });
  place("g", world.regions, generated.regions, (i) => i);
  place("v", world.rivers, generated.rivers, (i) => i);
  place("p", world.provinces, generated.provinces, (i) => world.provinces[i].id);
  const townAt = new Map(world.cities.map((c) => [c.cell, c.id]));
  const townName = (cell: number | undefined, was: string) => {
    const id = cell === undefined ? undefined : townAt.get(cell);
    return id === undefined ? was : own(`t${id}`, was);
  };
  history.economicZones.forEach((z, k) => { z.name = townName(z.cell, generated.zones[k]); });
  history.events.forEach((e, k) => {
    const was = generated.events[k];
    if (was !== undefined && (e.type === "newCity" || e.type === "staple")) e.name = townName(e.cell, was);
  });
}
