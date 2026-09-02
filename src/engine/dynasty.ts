import type { World } from "../types/world";
import type { History } from "./history";
import { mulberry32, deriveSeed, randInt } from "./rng";
import { makeNameGen, DEFAULT_PHON } from "./names";

// Rulers. The chronicle recorded realms conquering realms and never once named a person, which is
// why it read as a campaign log rather than as history — a novelist mining it got no one to write
// about. Nothing in the simulation models a ruler, so this invents them: a line of names filling the
// span each realm actually existed for, drawn from the phonetics of the people whose land its
// capital stands on, so a northern realm's kings sound northern.
//
// Deterministic and OFF the world's own rng: every realm's line is derived from the world seed and
// the realm's id, so adding, removing or reordering this cannot shift a single cell on the map.

const DYNASTY_SALT = 7723;
const REIGN_MIN = 20;      // years; the simulation records history in decades, so reigns are decades
const REIGN_MAX = 60;

export interface Reign { polityId: number; name: string; from: number; to: number; ordinal: number }

// The ruler holding a realm in a given year, or undefined if the realm did not exist then.
export function rulerAt(reigns: readonly Reign[], year: number): Reign | undefined {
  return reigns.find((r) => year >= r.from && year < r.to) ?? (reigns.length ? reigns[reigns.length - 1] : undefined);
}

export function buildDynasties(world: World, history: History): Map<number, Reign[]> {
  const out = new Map<number, Reign[]>();
  const end = history.years;

  for (const p of history.polities) {
    const rng = mulberry32(deriveSeed(world.params.seed, DYNASTY_SALT + p.id));
    // A realm's rulers sound like the people its seat sits among, not like a generic fantasy king.
    const cell = p.capital;
    const cultureIdx = cell >= 0 && cell < world.cultureOf.length ? world.cultureOf[cell] : -1;
    const phon = world.cultures[cultureIdx]?.phon ?? DEFAULT_PHON;
    const gen = makeNameGen(rng, phon);

    const stop = p.endedYear ?? end;
    const reigns: Reign[] = [];
    let year = p.foundedYear;
    let ordinal = 1;
    // A realm that lived only a decade still had someone at its head; the loop always yields one.
    while (year < stop || reigns.length === 0) {
      const span = 10 * randInt(rng, REIGN_MIN / 10, REIGN_MAX / 10);
      const to = Math.min(stop, year + span);
      reigns.push({ polityId: p.id, name: gen.place(), from: year, to: Math.max(to, year + 10), ordinal });
      year = to;
      ordinal++;
      if (reigns.length > 60) break;   // a guard, not a rule: 500 years cannot hold this many
    }
    out.set(p.id, reigns);
  }
  return out;
}
