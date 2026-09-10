import type { CityMarker, World } from "../types/world";
import type { CityLayout } from "../engine/city";
import type { GovernmentForm } from "../engine/government";
import { t, type Lang } from "./i18n";
import { properName, polityLabeller } from "./properName";

/**
 * What a plate can honestly say about the town it draws.
 *
 * An outside review asked for population, realm, founding year and a line of description beside
 * each city plan, and said the founding year "is already in the chronicle". It was not, when this
 * was written: the simulation raised 19 `newCity` events on seed 1 and none of them named a town on
 * the map. That was fixed at the source rather than papered over here, so the year IS available
 * now — for the towns the chronicle founds. A capital is a seat the world starts with, and a town
 * the five centuries never got round to founding predates the record; both say so.
 *
 * The rest is real. The realm comes from the cell's owner, the kind of town from the archetype the
 * generator chose for it, and the size band from `size` — which is a rank, 1 to 6, not a count. The
 * population is therefore STIPULATED, the way the map's scale is: these are the bands medieval
 * Europe actually had, from a hamlet of a couple of hundred to the handful of cities that passed
 * twenty thousand, and they are given as ranges because a rank cannot honestly become a number.
 */
export const POPULATION_BANDS: Record<number, [number, number]> = {
  1: [150, 400],
  2: [400, 1200],
  3: [1200, 3000],
  4: [3000, 8000],
  5: [8000, 20000],
  6: [20000, 45000],
};

export interface CityFacts {
  name: string;
  founded: number | null;   // null: older than the chronicle (a capital, or a town never founded)
  realm: string | null;
  /** the year `realm` is true of. A plate carries no scrubber, so an undated realm is a guess. */
  year: number | null;
  kind: string;
  rank: string;
  population: string;
  neighbours: { id: number; name: string; km: number }[];
}

const groups = (n: number) => n.toLocaleString("en-US");

/**
 * `at` is the moment the reader is looking at — the scrubbed year's ownership and the realms of
 * that year. Without it the plate falls back to `world.polityOf`, which is YEAR ZERO: the plate
 * used to answer "Realm — Melaelae" for a town whose realm had fallen forty years earlier, because
 * the founding owner was the only owner it knew.
 */
export function cityFacts(
  world: World, city: CityMarker, layout: CityLayout, lang: Lang, kmPerUnit: number,
  foundings: readonly { cityId: number; year: number }[] = [],
  at?: { owner: ArrayLike<number>; polities: readonly { id: number; name: string }[]; year: number },
  // What kind of state the realm line's realm is — a kingdom/republic/empire, read off the record
  // by `classifyGovernments`. Optional for the same reason `polityLabeller`'s is: a caller with no
  // history handy (a test, an older call site) still gets a plate, just without the government word.
  forms?: Map<number, GovernmentForm>,
): CityFacts {
  const owner = at ? at.owner[city.cell] : world.polityOf[city.cell];
  const pool = at ? at.polities : world.polities;
  const realmName = owner >= 0 ? pool.find((p) => p.id === owner)?.name : undefined;
  const realm = realmName === undefined ? null : polityLabeller(lang, forms)(owner, realmName);
  const [lo, hi] = POPULATION_BANDS[city.size] ?? POPULATION_BANDS[3];

  // the three nearest towns, so a reader can walk out of one plate and into the next
  const neighbours = world.cities
    .filter((c) => c.id !== city.id)
    .map((c) => ({ id: c.id, name: properName(lang, c.name), km: Math.hypot(c.x - city.x, c.y - city.y) * kmPerUnit }))
    .sort((a, b) => a.km - b.km)
    .slice(0, 3)
    .map((n) => ({ ...n, km: Math.round(n.km) }));

  return {
    name: properName(lang, city.name),
    founded: foundings.find((f) => f.cityId === city.id)?.year ?? null,
    realm,
    year: at?.year ?? null,
    kind: t(lang, `kind_${layout.archetype.id}` as never),
    rank: t(lang, `rank${city.size}` as never),
    population: `${groups(lo)}–${groups(hi)}`,
    neighbours,
  };
}
