import type { World } from "../types/world";
import type { History } from "./history";

// What KIND of state a realm was. The simulation has always known the difference — it records which
// realms broke away as free cities, and its snapshots say whose land each realm ended up holding —
// but every realm was described in the same words, so a gazetteer read as one country repeated
// under nineteen names, and a city that declared itself free was handed ten hereditary monarchs.
//
// Nothing here touches the simulation. Every judgement is read off `history.polities` and the
// territory snapshots it already left behind, so no rng moves and no cell changes owner. A form of
// government is a fact about how the world is TOLD, not a force inside it: republics do not decay
// differently here, and that is deliberate.

export type Government = "kingdom" | "republic" | "empire";

/** `since` is the year a realm became an empire; every other form has no such year. */
export interface GovernmentForm { form: Government; since: number | null }

// An empire is a realm that governs other peoples — not merely one that won a war. Measured over
// five seeds and eighty-four realms: 13% declared themselves free, and 19% held two or more other
// peoples' land at their height. Two of those nineteen percent were border accidents (87 and 110
// tiles, one of them dead inside forty years), and letting the word cover those would spend it.
export const EMPIRE_MIN_PEOPLES = 2;
export const EMPIRE_MIN_TILES = 150;

export function classifyGovernments(world: World, history: History): Map<number, GovernmentForm> {
  const out = new Map<number, GovernmentForm>();
  const n = history.polities.length;
  if (n === 0) return out;

  // Per snapshot: how many tiles each realm held, and which peoples' land those tiles were.
  const tiles: number[][] = [];
  const peoples: Set<number>[][] = [];
  for (const snap of history.snapshots) {
    const count = new Array<number>(n).fill(0);
    const holds: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
    for (let i = 0; i < snap.owner.length; i++) {
      const o = snap.owner[i];
      if (o < 0 || o >= n) continue;
      count[o]++;
      const c = world.cultureOf[i];
      if (c >= 0 && c < world.cultures.length) holds[o].add(c);
    }
    tiles.push(count);
    peoples.push(holds);
  }

  for (const p of history.polities) {
    const id = p.id;
    // A free city stays a republic however far it reaches. The way a state is constituted is not
    // undone by its size, and a realm founded by throwing off a king is the one case the simulation
    // itself already asserted.
    if (p.free) { out.set(id, { form: "republic", since: null }); continue; }

    // Its own people are not a conquest, so the culture its seat stands among never counts.
    const home = world.cultureOf[p.capital] ?? -1;
    const foreignAt = (t: number) => {
      let k = 0;
      for (const c of peoples[t][id]) if (c !== home) k++;
      return k;
    };

    let peak = 0, peakIdx = -1, since: number | null = null;
    for (let t = 0; t < tiles.length; t++) {
      if (tiles[t][id] > peak) { peak = tiles[t][id]; peakIdx = t; }
      // The first year it held two peoples at once — which is the year the chronicle already
      // announces, so the title arrives with a date attached rather than as an adjective.
      if (since === null && foreignAt(t) >= EMPIRE_MIN_PEOPLES) since = history.snapshots[t].year;
    }
    // Judged at its height: at its founding it has done nothing yet, and at its fall there is
    // nothing left to judge. This is the same moment the gazetteer describes a realm by.
    const imperial = peakIdx >= 0 && peak >= EMPIRE_MIN_TILES
      && foreignAt(peakIdx) >= EMPIRE_MIN_PEOPLES && since !== null;
    out.set(id, imperial ? { form: "empire", since } : { form: "kingdom", since: null });
  }
  return out;
}
