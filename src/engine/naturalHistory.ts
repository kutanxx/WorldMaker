import type { World, CityMarker } from "../types/world";
import type { History } from "./history";
import { mulberry32, deriveSeed } from "./rng";
import { withJosa } from "./korean";
import { TUNDRA, TAIGA, ALPINE, TEMPERATE_FOREST, TROPICAL, DESERT } from "./biome";
import type { ChronicleLang } from "./chronicleLines";

// Everything the chronicle recorded was politics. Realms founded, conquered, split and fell, and in
// five centuries nothing ever happened TO a place — no plague, no fire, no flood, no winter anyone
// remembered — which is why a novelist mining it got a campaign log rather than a history.
//
// The simulation models none of these, so unlike the moments mined out of the snapshots, these are
// INVENTED. The rule governing that was paid for once already: the chronicle used to found towns
// the atlas never drew, telling a reader about somewhere they could not go. So every line here
// lands on a town that IS on the map, in a year after the chronicle founded it, in the realm that
// actually held it then — and only where the place allows it. A town with no river does not flood;
// a town on the steppe does not burn like a timber one; a warm coast has no killing winter.
//
// Off the world's own rng on its own salt, and derived from a finished history, so nothing here can
// move a cell, an event or a behaviour lock. Only the telling grows.
const NATURAL_SALT = 9311;

export type NaturalKind = "plague" | "fire" | "flood" | "winter" | "famine";

export interface NaturalEvent {
  year: number;
  rank: number;
  kind: NaturalKind;
  text: string;
  /** the town it happened to, where it happened to one; famine is a realm's whole country */
  cityId?: number;
  polityId?: number;
}

const TIMBER = [TAIGA, TEMPERATE_FOREST, TROPICAL];
const COLD = [TUNDRA, TAIGA, ALPINE];
/** land that feeds a realm poorly enough that a bad year is a famine rather than a thin harvest */
const HUNGRY = [DESERT, TUNDRA, ALPINE];

export function naturalHistory(world: World, history: History, lang: ChronicleLang): NaturalEvent[] {
  const ko = lang === "ko";
  const rng = mulberry32(deriveSeed(world.params.seed, NATURAL_SALT));
  const out: NaturalEvent[] = [];
  if (!history.snapshots.length || !world.cities.length) return out;

  const snapAt = (year: number) => {
    let s = history.snapshots[0];
    for (const q of history.snapshots) if (q.year <= year) s = q;
    return s;
  };
  const foundedAt = new Map(history.cityFoundings.map((f) => [f.cityId, f.year]));
  const years = history.snapshots.map((s) => s.year).filter((y) => y > 0);
  const realmName = (id: number) => history.polities[id]?.name ?? "";

  // Which towns each kind of misfortune is even possible in. A flood needs the river the atlas
  // drew through the town; a fire needs a town built of timber; a winter needs the cold country.
  // A plague travels, so it wants a port or a town big enough to have strangers in it.
  const eligible: Record<NaturalKind, CityMarker[]> = {
    flood: world.cities.filter((c) => c.river),
    fire: world.cities.filter((c) => TIMBER.includes(c.biome) && c.size >= 3),
    winter: world.cities.filter((c) => COLD.includes(c.biome)),
    plague: world.cities.filter((c) => c.coastal || c.size >= 4),
    famine: [],
  };

  const KINDS: NaturalKind[] = ["plague", "fire", "flood", "winter", "famine"];
  const struck = new Set<number>();         // a town is struck once in five centuries, not twice
  const takenFamine = new Set<string>();
  const used = new Map<NaturalKind, number>(KINDS.map((k) => [k, 0]));
  const want = 4 + Math.floor(rng() * 5);   // 4-8: a bad century has one or two, not one a decade

  for (let i = 0; i < want * 6 && out.length < want; i++) {
    // Drawing the kind uniformly gave the commonest one the world: a plague can happen in any port
    // or any big town, so on seed 2 five of eight lines were plague, twice at the same town. The
    // draw is over the LEAST-USED kinds instead, so a world's misfortunes read as a spread of what
    // could befall it rather than as one thing that kept happening.
    const fewest = Math.min(...KINDS.map((k) => used.get(k)!));
    const hungriest = KINDS.filter((k) => used.get(k) === fewest);
    const kind = hungriest[Math.floor(rng() * hungriest.length)];
    const year = years[Math.floor(rng() * years.length)];
    const snap = snapAt(year);

    if (kind === "famine") {
      // A famine is a realm's whole country going hungry, so it is keyed to the land the realm
      // holds THAT YEAR — a realm that has just taken good ground does not starve on its old.
      const held = new Map<number, { n: number; hungry: number }>();
      for (let c = 0; c < snap.owner.length; c++) {
        const o = snap.owner[c];
        if (o < 0) continue;
        const e = held.get(o) ?? { n: 0, hungry: 0 };
        e.n++;
        if (HUNGRY.includes(world.biome[c])) e.hungry++;
        held.set(o, e);
      }
      const starving = [...held.entries()]
        .filter(([, v]) => v.n >= 20 && v.hungry / v.n >= 0.4)
        .map(([id]) => id)
        .sort((a, b) => a - b);
      if (!starving.length) continue;
      const pid = starving[Math.floor(rng() * starving.length)];
      const key = `famine:${pid}`;
      if (takenFamine.has(key)) continue;
      takenFamine.add(key);
      used.set("famine", used.get("famine")! + 1);
      const self = realmName(pid);
      out.push({
        year, rank: 5, kind, polityId: pid,
        text: ko
          ? `${year}년, ${withJosa(self, "이/가")} 기근을 겪다 — 메마른 땅에 흉년이 겹치다`
          : `Year ${year} — famine in ${self}, a lean year on hard ground`,
      });
      continue;
    }

    const pool = eligible[kind].filter((c) => !struck.has(c.id));
    if (!pool.length) continue;
    const city = pool[Math.floor(rng() * pool.length)];
    // A town the chronicle has not founded yet is not somewhere anything can happen.
    if (year < (foundedAt.get(city.id) ?? 0)) continue;
    const pid = snap.owner[city.cell];
    if (pid < 0 || !history.polities[pid]) continue;
    struck.add(city.id);
    used.set(kind, used.get(kind)! + 1);

    const town = city.name;
    const self = realmName(pid);
    // A realm often takes its name from its seat, and then the clause naming the realm says the
    // town's name a second time in the same sentence ("at Zaiashair; Zaiashair counts what it
    // lost"). Where they are the same word, the sentence has only one place to name.
    const realm = self === town ? "" : self;
    const text = ko ? koText(kind, year, town, realm) : enText(kind, year, town, realm);
    out.push({ year, rank: 5, kind, text, cityId: city.id, polityId: pid });
  }

  out.sort((a, b) => a.year - b.year || a.kind.localeCompare(b.kind));
  return out;
}

// `realm` is empty where the realm's name IS the town's, and the sentence then simply stops after
// the town rather than repeating it.
function enText(kind: NaturalKind, year: number, town: string, realm: string): string {
  switch (kind) {
    case "plague": return `Year ${year} — plague comes ashore at ${town}${realm ? `, and ${realm} buries its dead` : `, and the dead go unburied for a week`}`;
    case "fire":   return `Year ${year} — fire takes ${town} street by street`;
    case "flood":  return `Year ${year} — the river rises over ${town} and takes the harvest with it`;
    case "winter": return `Year ${year} — a winter without end at ${town}${realm ? `; ${realm} counts what it lost` : `, and the roads out of it stay shut till spring`}`;
    default:       return `Year ${year} — famine in ${realm}`;
  }
}

function koText(kind: NaturalKind, year: number, town: string, realm: string): string {
  switch (kind) {
    case "plague": return realm
      ? `${year}년, ${withJosa(town, "이/가")} 역병에 잠기고 ${withJosa(realm, "이/가")} 주검을 묻다`
      : `${year}년, ${withJosa(town, "이/가")} 역병에 잠기고 이레 동안 주검을 묻지 못하다`;
    case "fire":   return `${year}년, ${withJosa(town, "이/가")} 거리마다 불길에 휩싸이다`;
    case "flood":  return `${year}년, 강물이 ${withJosa(town, "을/를")} 덮치고 그해 수확을 앗아가다`;
    case "winter": return realm
      ? `${year}년, ${town}에 끝나지 않는 겨울이 오고 ${withJosa(realm, "이/가")} 잃은 것을 세다`
      : `${year}년, ${town}에 끝나지 않는 겨울이 오고 봄까지 길이 막히다`;
    default:       return `${year}년, ${withJosa(realm, "이/가")} 기근을 겪다`;
  }
}
