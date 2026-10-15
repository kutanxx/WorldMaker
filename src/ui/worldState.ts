/**
 * The world the page is showing, and what is derived from it once per world.
 *
 * `createApp` held all of this as a dozen `let`s in one closure (app.ts was 1,760 lines, 74 inner functions
 * — design review 2026-10-15). Everything that depends only on the world and its record is here, as one
 * record built by `makeWorldState` and rebuilt by it when a dial moves, and the questions the screens ask
 * of it are pure functions of that record: which towns stand in a year, who holds them, the address the
 * world is kept at, a plate's plan, a file's name. Nothing here touches the document.
 */
import type { WorldParams, GeneratedWorld, CityMarker } from "../types/world";
import { DEFAULT_PARAMS } from "../types/world";
import { generateWorld } from "../engine/world";
import { simulateHistory, standingSeats } from "../engine/history";
import { assignNationColors, nationColor } from "./nationPalette";
import { classifyGovernments, type GovernmentForm } from "../engine/government";
import { applyNames, encodeNames, generatedNames, type NameBook, type GeneratedNames } from "./nameBook";
import { generateCityLayout, cityContext, type CityLayout } from "../engine/city";
import { snapOwnersToProvinces } from "./provinceLayer";
import { polityLabeller, properName } from "./properName";
import { encodeParams } from "./urlState";
import type { TownYear } from "./svgWorldRenderer";
import type { Lang } from "./i18n";

export type History = ReturnType<typeof simulateHistory>;

/** whether two sets of parameters make the same world */
export function sameWorld(a: WorldParams, b: WorldParams): boolean {
  return (Object.keys(DEFAULT_PARAMS) as (keyof WorldParams)[]).every((k) => a[k] === b[k]);
}

export interface WorldState {
  params: WorldParams;
  /** what the reader called this world, when they arrived by naming one (null once the seed is not theirs) */
  title: string | null;
  generated: GeneratedWorld;
  history: History;
  /** the reader's own names for this world's places (nameBook.ts), kept in the address */
  names: NameBook;
  /** the names the world was generated with, to give back */
  bornNames: GeneratedNames;
  /** one colouring per world, shared by the first paint, the scrubber and the export (assignNationColors) */
  nationColors: Map<number, string>;
  colorOf: (id: number) => string;
  /** what kind of state each realm was (kingdom / republic / empire), for the labels */
  governmentForms: Map<number, GovernmentForm>;
  /** the realms whose ground is smaller than a province and must survive the snap */
  freeRealms: Set<number>;
}

/**
 * Make the world `params` describes, under the name it was asked for, with the reader's `names` written
 * over its own. Called once at start and again by `regenerate`: a dial moved is a new world and takes
 * the whole record with it.
 */
export function makeWorldState(params: WorldParams, title: string | null, names: NameBook): WorldState {
  const generated = generateWorld(params, title ?? undefined);
  const history = simulateHistory(generated.world, params.seed);
  const bornNames = generatedNames(generated.world, history);
  applyNames(generated.world, history, bornNames, names);
  // Indexing the palette by id draws id 12 exactly like id 0, and civil-war fragments take the high ids
  // while appearing beside the parent they broke from — so the border between them vanished on 7 of the
  // 12 measured seeds. See `assignNationColors`.
  const nationColors = assignNationColors(generated.world.grid.neighbors, history.snapshots.map((s) => s.owner));
  return {
    params: { ...params }, title, generated, history, names, bornNames, nationColors,
    colorOf: (id) => nationColors.get(id) ?? nationColor(id),
    governmentForms: classifyGovernments(generated.world, history),
    freeRealms: new Set(history.polities.filter((p) => p.free).map((p) => p.id)),
  };
}

/** The reader's names, written into the world and its record (over the names it was born with). */
export function setNames(ws: WorldState, names: NameBook): void {
  ws.names = names;
  applyNames(ws.generated.world, ws.history, ws.bornNames, names);
}

/**
 * The world's address: a named world keeps its name in it, so a reload or a shared link still opens the
 * world the reader asked for rather than a stranger with the same seed — but only while the name still
 * describes the whole world. `#seed=Avalon` says the seed and nothing else, so once a dial has been moved
 * the readable form would leave the address describing a world the reader is not looking at, and a reload
 * would quietly undo the change. The name is worth having; it is not worth being wrong.
 */
export function worldHash(ws: WorldState): string {
  const tuned = (Object.keys(DEFAULT_PARAMS) as (keyof WorldParams)[])
    .some((k) => k !== "seed" && ws.params[k] !== DEFAULT_PARAMS[k]);
  return ws.title !== null && !tuned
    ? "seed=" + encodeURIComponent(ws.title)
    : encodeParams(ws.params).slice(1);
}

/** ...and the reader's names ride after it: the link is where they are kept */
export function namesPart(ws: WorldState): string {
  const code = encodeNames(ws.names);
  return code ? "&names=" + code : "";
}

/** Which towns the chronicle has not founded by the year on the scrubber. The capitals are the seats the
 * world starts with and are never held back. */
export function unfoundedAt(ws: WorldState, yearIndex: number): Set<number> {
  const year = ws.history.snapshots[yearIndex]?.year ?? 0;
  const out = new Set<number>();
  for (const f of ws.history.cityFoundings) if (f.year > year) out.add(f.cityId);
  return out;
}

/**
 * The towns as they stand in a year — who holds each (ownership snapped to provinces, as the map paints it)
 * and which are the seats of the realms standing then. The one place the map's stars, its tooltips, the town
 * list and an exported file ask; each used to answer from year zero on its own.
 */
export interface TownsIn { owner: ArrayLike<number>; seats: Set<number>; at: (c: CityMarker) => TownYear }
export function townsIn(ws: WorldState, yearIndex: number, lang: Lang): TownsIn {
  const world = ws.generated.world, snap = ws.history.snapshots[yearIndex];
  const owner = snapOwnersToProvinces(world.grid.count, world.provinceOf, world.provinces, snap.owner, ws.freeRealms);
  const seats = standingSeats(ws.history.polities, snap.year);
  const labelOf = polityLabeller(lang, ws.governmentForms);
  return {
    owner, seats,
    at: (c) => {
      const o = owner[c.cell];
      const name = o >= 0 ? ws.history.polities[o]?.name : undefined;
      return { seat: seats.has(c.cell), realm: name === undefined ? null : labelOf(o, name) };
    },
  };
}

/**
 * A plate is laid out under the name its town was born with and titled with the reader's: its title's
 * tablet is measured from the name, and the town's hamlets and fields keep clear of it (city.ts), so laid
 * out under a new name they moved. The plan is the town's; only the title is the reader's.
 */
export function plateOf(ws: WorldState, marker: CityMarker): CityLayout {
  const born = ws.bornNames.towns[ws.generated.world.cities.indexOf(marker)] ?? marker.name;
  return { ...generateCityLayout(cityContext({ ...marker, name: born }), ws.params.seed), name: marker.name };
}

/** a town's name by its id, for the plate's gates (each named for the towns its road leads to) */
export function townNameOf(ws: WorldState): (id: number) => string | undefined {
  return (id) => ws.generated.world.cities[id]?.name;
}

/**
 * Capitals first, then by size, because that is the order a reader cares about. The tiebreaker sorts by
 * the name actually ON THE BUTTON, not the underlying Latin `c.name` — in Korean that RENDERS as
 * `properName(lang, c.name)`, and sorting by the untransliterated name instead put same-size Korean towns
 * in an order that reads as arbitrary to the reader who never sees the Latin form at all.
 */
export function cityOrder(lang: Lang, a: CityMarker, b: CityMarker, seat: (id: number) => boolean): number {
  return Number(seat(b.id)) - Number(seat(a.id)) || b.size - a.size
    || properName(lang, a.name).localeCompare(properName(lang, b.name));
}

/**
 * What a file is called: the world's name as the reader reads it, and after it whatever tells this file
 * from the world's other ones. Every map file used to be world.png / world.svg / world.json, so a second
 * world's came down as "world (1).png" — while the gazetteer alone took the world's name, in Latin letters
 * on a Korean page. Letters and digits of any script are kept (a name the reader gave may be in any).
 */
export function fileStem(parts: (string | false | null | undefined)[]): string {
  const safe = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "");
  return parts.filter((p): p is string => !!p).map(safe).filter(Boolean).join("_") || "world";
}
