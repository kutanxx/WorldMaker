import type { World } from "../types/world";
import type { History } from "./history";
import {
  OCEAN, TUNDRA, TAIGA, TEMPERATE_FOREST, GRASSLAND, DESERT, TROPICAL, WETLAND, ALPINE,
} from "./biome";
import { withJosa } from "./korean";

// Declared here rather than imported from `src/ui/i18n.ts`: the engine is DOM-free and must not
// depend on the presentation layer. The union is deliberately the same one the UI uses, so the app
// can hand its current language straight through.
export type GazetteerLang = "en" | "ko";

const BIOME_PHRASE: Record<GazetteerLang, Record<number, string>> = {
  en: {
    [OCEAN]: "open sea", [TUNDRA]: "frozen tundra", [TAIGA]: "northern pinewoods",
    [TEMPERATE_FOREST]: "green forest", [GRASSLAND]: "rolling plains", [DESERT]: "arid desert",
    [TROPICAL]: "dense jungle", [WETLAND]: "fenland marsh", [ALPINE]: "high mountains",
  },
  ko: {
    [OCEAN]: "먼바다", [TUNDRA]: "얼어붙은 툰드라", [TAIGA]: "북방 침엽수림",
    [TEMPERATE_FOREST]: "푸른 숲", [GRASSLAND]: "넓은 초원", [DESERT]: "메마른 사막",
    [TROPICAL]: "우거진 밀림", [WETLAND]: "늪지", [ALPINE]: "높은 산맥",
  },
};

const DIR: Record<GazetteerLang, Record<string, string>> = {
  en: {
    north: "north", south: "south", east: "east", west: "west",
    northeast: "northeast", northwest: "northwest", southeast: "southeast", southwest: "southwest",
    "": "heart of the world",
  },
  ko: {
    north: "북부", south: "남부", east: "동부", west: "서부",
    northeast: "북동부", northwest: "북서부", southeast: "남동부", southwest: "남서부",
    "": "중앙",
  },
};

// Where the LAND sits, not where the canvas sits. Compass directions used to be measured against the
// full image, and on a generator that leaves ocean all round the edges nearly every feature landed
// in the middle third of both axes — which is why one gazetteer had five regions in a row described
// as "in the heart of the world". Measured against the landmass, the same word means something.
interface Bounds { x0: number; y0: number; x1: number; y1: number }

function landBounds(world: World): Bounds {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < world.grid.count; i++) {
    if (world.terrain[i] === OCEAN) continue;
    const x = world.grid.points[i * 2], y = world.grid.points[i * 2 + 1];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  // A world with no land at all still has to produce a document rather than NaNs.
  if (x0 === Infinity) return { x0: 0, y0: 0, x1: world.grid.width, y1: world.grid.height };
  return { x0, y0, x1, y1 };
}

function compass(lang: GazetteerLang, cx: number, cy: number, b: Bounds): string {
  const w = Math.max(1, b.x1 - b.x0), h = Math.max(1, b.y1 - b.y0);
  const fx = (cx - b.x0) / w, fy = (cy - b.y0) / h;
  const ns = fy < 1 / 3 ? "north" : fy > 2 / 3 ? "south" : "";
  const ew = fx < 1 / 3 ? "west" : fx > 2 / 3 ? "east" : "";
  return DIR[lang][ns + ew] ?? DIR[lang][""];
}

// "in the north" / "세계 북부의" — the preposition differs enough between the two languages that
// building it here keeps every call site free of language checks.
function inDir(lang: GazetteerLang, dir: string): string {
  return lang === "ko" ? `세계 ${dir}` : `in the ${dir}`;
}

type Size = "large" | "mid" | "small";

// Rank within the group, not a fraction of the largest. Measured against the largest, one huge ocean
// region pushed nine of twelve regions below the "small" threshold and every one of them was
// described as tiny — the adjective stopped carrying information. Splitting at the terciles
// guarantees the three words are actually used, which is the entire reason to have them.
function ranker<T>(items: readonly T[], value: (t: T) => number): (t: T) => Size {
  if (items.length < 3) return () => "mid";
  const sorted = items.map(value).sort((a, b) => a - b);
  const lo = sorted[Math.floor(items.length / 3)];
  const hi = sorted[Math.floor((2 * items.length) / 3)];
  return (t) => { const v = value(t); return v >= hi ? "large" : v <= lo ? "small" : "mid"; };
}

// Korean marks its object with 을 after a final consonant and 를 after a vowel. Getting this wrong
// is the kind of thing that makes generated prose unreadable to a native speaker, and the rule is
// exact: Hangul syllables are laid out so that the final-consonant index is the code point's
// remainder modulo 28.
function objectParticle(word: string): string {
  const ch = word.charCodeAt(word.length - 1);
  if (ch < 0xac00 || ch > 0xd7a3) return "를";      // not a Hangul syllable; the softer default
  return (ch - 0xac00) % 28 !== 0 ? "을" : "를";
}

const REGION_SIZE: Record<GazetteerLang, Record<string, string>> = {
  en: { large: "a vast ", mid: "a ", small: "a small pocket of " },
  ko: { large: "광대한 ", mid: "", small: "자그마한 " },
};
const RIVER_SIZE: Record<GazetteerLang, Record<string, string>> = {
  en: { large: "a great river", mid: "a river", small: "a slender stream" },
  ko: { large: "큰 강", mid: "강", small: "가느다란 물줄기" },
};

// A chronicle entry the simulation lived through but never wrote down. `rank` only orders entries
// that share a year, so the output is stable.
interface Told { year: number; rank: number; text: string }

// The simulation keeps 51 territory snapshots and the chronicle read none of them: measured across
// seven seeds it recorded 31-44 events over five centuries — one entry per sixteen years, with more
// than half the recorded moments silent. Everything below already happened; it was simply never
// told. Deriving it here rather than emitting it from the simulation means the world's history is
// unchanged — only the telling of it grows.
function minedChronicle(history: History, lang: GazetteerLang): Told[] {
  const ko = lang === "ko";
  const n = history.polities.length;
  if (!history.snapshots.length || n === 0) return [];

  // `id` is assigned as `polities.length` at every push, so an id is always its own array index.
  const series: number[][] = history.snapshots.map((snap) => {
    const c = new Array<number>(n).fill(0);
    for (let i = 0; i < snap.owner.length; i++) { const o = snap.owner[i]; if (o >= 0 && o < n) c[o]++; }
    return c;
  });
  const nameOf = (p: number) => history.polities[p]?.name ?? String(p);
  const out: Told[] = [];

  // The greatest extent a realm ever reached. Skipped at the first and last snapshot: a realm that
  // peaks at its founding never rose, and one still peaking at the end has not yet fallen.
  for (let p = 0; p < n; p++) {
    let best = 0, bestT = -1;
    for (let t = 0; t < series.length; t++) if (series[t][p] > best) { best = series[t][p]; bestT = t; }
    if (best < 20 || bestT <= 0 || bestT >= series.length - 1) continue;
    const year = history.snapshots[bestT].year;
    out.push({ year, rank: 2, text: ko
      ? `${year}년, ${withJosa(nameOf(p), "이/가")} 최대 판도에 이르다 — ${best}칸`
      : `Year ${year} — ${nameOf(p)} reaches its greatest extent, ${best} tiles` });
  }

  // Sudden losses and gains between two snapshots. A cooldown keeps one long decline from being
  // reported every decade as though it were news each time.
  const lastLoss = new Array<number>(n).fill(-99);
  const lastGain = new Array<number>(n).fill(-99);
  for (let t = 1; t < series.length; t++) {
    const year = history.snapshots[t].year;
    for (let p = 0; p < n; p++) {
      const a = series[t - 1][p], b = series[t][p];
      if (a >= 15 && b <= a * 0.66 && t - lastLoss[p] >= 3) {
        lastLoss[p] = t;
        // Losing everything is a fall, not a percentage: "lost 100% of its land" is arithmetic
        // where the chronicle wants an ending.
        const share = Math.round(100 * (1 - b / a));
        out.push({ year, rank: 3, text: b === 0
          ? (ko ? `${year}년, ${withJosa(nameOf(p), "이/가")} 멸망하다 — 마지막까지 ${a}칸을 지켰다`
                : `Year ${year} — ${nameOf(p)} falls, holding ${a} tiles to the last`)
          : (ko ? `${year}년, ${withJosa(nameOf(p), "이/가")} 한 세대 만에 영토의 ${share}%를 잃다 (${a} → ${b}칸)`
                : `Year ${year} — ${nameOf(p)} loses ${share}% of its land in a generation (${a} → ${b} tiles)`) });
      } else if (a >= 10 && b >= a * 1.5 && t - lastGain[p] >= 3) {
        lastGain[p] = t;
        out.push({ year, rank: 3, text: ko
          ? `${year}년, ${withJosa(nameOf(p), "이/가")} 영토를 크게 넓히다 (${a} → ${b}칸)`
          : `Year ${year} — ${nameOf(p)} expands sharply (${a} → ${b} tiles)` });
      }
    }
  }

  // Which realm is largest, and when that passes to another.
  let lastTop = -1;
  for (let t = 0; t < series.length; t++) {
    let top = -1, tv = 0;
    for (let p = 0; p < n; p++) if (series[t][p] > tv) { tv = series[t][p]; top = p; }
    if (top < 0 || top === lastTop) continue;
    if (lastTop >= 0) {
      const year = history.snapshots[t].year;
      out.push({ year, rank: 1, text: ko
        ? `${year}년, ${withJosa(nameOf(top), "이/가")} ${nameOf(lastTop)}를 제치고 가장 큰 나라가 되다`
        : `Year ${year} — ${nameOf(top)} overtakes ${nameOf(lastTop)} as the greatest realm` });
    }
    lastTop = top;
  }

  // Where the centuries stand. The chronicle is front-loaded by nature: measured across seven seeds
  // the opening century carries 17-21 entries and later ones drop to one or none, because the
  // simulation reaches equilibrium and simply stops producing events. A century with nothing in it
  // is not an absence of history — it is a century in which the borders held, and saying so is
  // worth a line to anyone reading this for material.
  for (let t = 0; t < series.length; t++) {
    const year = history.snapshots[t].year;
    if (year % 100 !== 0) continue;
    let alive = 0, top = -1, tv = 0, held = 0;
    for (let q = 0; q < n; q++) {
      const v = series[t][q];
      if (v > 0) { alive++; held += v; }
      if (v > tv) { tv = v; top = q; }
    }
    if (alive === 0) continue;
    out.push({ year, rank: -1, text: ko
      ? `${year}년 현재 — ${alive}개 나라가 서 있고, 가장 큰 나라는 ${nameOf(top)}(${tv}칸). 사람의 땅은 ${held}칸.`
      : `Year ${year} — ${alive} realms stand; the greatest is ${nameOf(top)} at ${tv} tiles, of ${held} tiles settled.` });
  }

  return out;
}

export function worldToGazetteer(world: World, history: History, lang: GazetteerLang = "en"): string {
  const { grid } = world;
  const b = landBounds(world);
  const bio = BIOME_PHRASE[lang];
  const ko = lang === "ko";
  const title = world.name.charAt(0).toUpperCase() + world.name.slice(1);
  const L: string[] = [];

  L.push(`# ${title}`, "");
  L.push(ko
    ? `${title}는 ${world.polities.length}개 나라와 ${world.cultures.length}개 민족의 세계다.`
    : `${title} is a world of ${world.polities.length} realms and ${world.cultures.length} peoples.`, "");

  // ── The Land ────────────────────────────────────────────────────────────────
  L.push(ko ? "## 땅" : "## The Land", "");
  // Sea and land are ranked apart: an ocean region dwarfs any stretch of ground, so comparing them
  // to each other makes every province on the map "small".
  const seas = world.regions.filter((r) => r.kind === OCEAN);
  const lands = world.regions.filter((r) => r.kind !== OCEAN);
  const seaSize = ranker(seas, (r) => r.cells), landSize = ranker(lands, (r) => r.cells);
  for (const r of world.regions) {
    const size = REGION_SIZE[lang][r.kind === OCEAN ? seaSize(r) : landSize(r)];
    const phrase = bio[r.kind] ?? (ko ? "거친 땅" : "wild country");
    const dir = inDir(lang, compass(lang, r.centroid[0], r.centroid[1], b));
    L.push(ko
      ? `- **${r.name}** — ${dir}에 펼쳐진 ${size}${phrase}.`
      : `- **${r.name}** — ${size}${phrase} ${dir}.`);
  }
  L.push("");

  if (world.rivers.length) {
    L.push(ko ? "### 강" : "### Rivers", "");
    const riverSize = ranker(world.rivers, (r) => r.flux);
    for (const r of world.rivers) {
      const kind = RIVER_SIZE[lang][riverSize(r)];
      // A river that only ever said where it ended told a writer nothing about the land it crosses;
      // its source is the other half of the sentence and was sitting unused in `path[0]`.
      const src = r.path.length ? r.path[0] : r.mouth;
      const from = compass(lang, src[0], src[1], b);
      const to = compass(lang, r.mouth[0], r.mouth[1], b);
      L.push(ko
        ? (from === to
          ? `- **${r.name}** — 세계 ${to}${objectParticle(to)} 흐르는 ${kind}.`
          : `- **${r.name}** — 세계 ${from}에서 발원해 ${to}에서 바다로 드는 ${kind}.`)
        : (from === to
          ? `- **${r.name}** — ${kind} running through the ${to}.`
          : `- **${r.name}** — ${kind} rising in the ${from} and meeting the sea in the ${to}.`));
    }
    L.push("");
  }

  // ── Peoples ─────────────────────────────────────────────────────────────────
  L.push(ko ? "## 민족" : "## Peoples", "");
  const agg = world.cultures.map(() => ({ sx: 0, sy: 0, n: 0, biome: new Map<number, number>() }));
  for (let i = 0; i < grid.count; i++) {
    const c = world.cultureOf[i];
    if (c < 0 || !agg[c]) continue;
    const a = agg[c];
    a.sx += grid.points[i * 2]; a.sy += grid.points[i * 2 + 1]; a.n++;
    const bm = world.biome[i];
    a.biome.set(bm, (a.biome.get(bm) ?? 0) + 1);
  }
  // How many towns each people actually holds — the difference between "a people of the plains" and
  // "a people of the plains, holding nine towns", which is the sort of thing a writer can use.
  const townsPerCulture = new Int32Array(world.cultures.length);
  for (const city of world.cities) {
    const c = world.cultureOf[city.cell];
    if (c >= 0 && c < townsPerCulture.length) townsPerCulture[c]++;
  }
  world.cultures.forEach((cult, i) => {
    const a = agg[i];
    if (!a || a.n === 0) { L.push(`- **${cult.name}** — ${ko ? "흩어져 사는 민족." : "a scattered people."}`); return; }
    let dom = OCEAN, dn = -1;
    for (const [bm, cnt] of a.biome) if (bm !== OCEAN && cnt > dn) { dn = cnt; dom = bm; }
    const dir = compass(lang, a.sx / a.n, a.sy / a.n, b);
    const t = townsPerCulture[i];
    L.push(ko
      ? `- **${cult.name}** — 세계 ${dir}, ${bio[dom] ?? "거친 땅"}에 사는 민족.` + (t ? ` 성읍 ${t}곳을 품는다.` : "")
      : `- **${cult.name}** — a people of the ${bio[dom] ?? "wild country"} in the ${dir}.` + (t ? ` They hold ${t} town${t > 1 ? "s" : ""}.` : ""));
  });
  L.push("");

  // ── Realms ──────────────────────────────────────────────────────────────────
  L.push(ko ? "## 나라" : "## Realms", "");
  const byPolity = new Map<number, { cap?: typeof world.cities[number]; towns: string[] }>();
  for (const city of world.cities) {
    const e = byPolity.get(city.polityId) ?? { towns: [] };
    if (city.isCapital) e.cap = city; else e.towns.push(city.name);
    byPolity.set(city.polityId, e);
  }
  // Dominant terrain per realm, so a realm reads as somewhere rather than as a list of names.
  const realmBiome = new Map<number, number>();
  {
    const tally = new Map<number, Map<number, number>>();
    for (let i = 0; i < grid.count; i++) {
      const p = world.polityOf[i];
      if (p < 0 || world.biome[i] === OCEAN) continue;
      const m = tally.get(p) ?? new Map<number, number>();
      m.set(world.biome[i], (m.get(world.biome[i]) ?? 0) + 1);
      tally.set(p, m);
    }
    for (const [p, m] of tally) {
      let best = -1, bn = -1;
      for (const [bm, cnt] of m) if (cnt > bn) { bn = cnt; best = bm; }
      realmBiome.set(p, best);
    }
  }
  for (const p of world.polities) {
    const e = byPolity.get(p.id) ?? { towns: [] };
    L.push(`### ${p.name}`);
    const dom = realmBiome.get(p.id);
    const land = dom !== undefined && dom >= 0 ? bio[dom] : undefined;
    const cap = e.cap;
    // The capital's own character was already recorded and never used: whether it stands on the
    // coast, and whether it sits up in the highlands.
    const seatTrait = cap
      ? (cap.coastal ? (ko ? "바닷가의 " : "the coastal seat of ")
        : cap.elevation >= world.params.mountainLevel ? (ko ? "산중의 " : "the highland seat of ") : (ko ? "" : "the seat of "))
      : "";
    if (ko) {
      const where = land ? `${land}에 자리한 나라.` : "";
      const seat = cap ? ` 도읍은 ${seatTrait}**${cap.name}**.` : " 정해진 도읍이 없다.";
      const towns = e.towns.length ? ` 성읍은 ${e.towns.join(", ")}.` : "";
      L.push(`${where}${seat}${towns}`.trim(), "");
    } else {
      const where = land ? `A realm of the ${land}.` : "";
      const seat = cap ? ` ${seatTrait.charAt(0).toUpperCase()}${seatTrait.slice(1)}**${cap.name}**.` : " It keeps no fixed seat.";
      const towns = e.towns.length ? ` Its towns are ${e.towns.join(", ")}.` : "";
      L.push(`${where}${seat}${towns}`.trim(), "");
    }
  }

  // ── Free Ports ──────────────────────────────────────────────────────────────
  if (history.economicZones.length) {
    L.push(ko ? "## 자유도시" : "## Free Ports", "");
    for (const z of history.economicZones) {
      // Every free port used to get one identical sentence. Each one sits in a real place, under a
      // real realm — both were already in the data.
      const owner = world.polityOf[z.cell];
      const realm = owner >= 0 ? world.polities.find((p) => p.id === owner)?.name : undefined;
      const px = grid.points[z.cell * 2], py = grid.points[z.cell * 2 + 1];
      const dir = compass(lang, px, py, b);
      L.push(ko
        ? `- **${z.name}** — 세계 ${dir}의 자유도시.` + (realm ? ` ${realm}의 땅에 선다.` : "")
        : `- **${z.name}** — a free port of the ${dir}.` + (realm ? ` It stands on ${realm}'s ground.` : ""));
    }
    L.push("");
  }

  // ── Chronicle ───────────────────────────────────────────────────────────────
  L.push(ko ? `## 연대기 (0–${history.years}년)` : `## Chronicle (Years 0–${history.years})`, "");
  let lastCentury = -1;
  // Every chronicle opened with one "founded" line per realm — eight identical-shaped lines before
  // anything happened, on every seed and in both languages. They are one event in the world's life,
  // so they are told as one line. Only the RENDERING changes: the simulation still records each
  // founding separately, which is what keeps the history itself (and its behaviour lock) untouched.
  const founded = history.events.filter((e) => e.type === "found");
  const groupedFoundYear = founded.length >= 3 ? founded[0].year : null;
  const groupedAllSameYear = groupedFoundYear !== null && founded.every((e) => e.year === groupedFoundYear);

  // The recorded events and the moments mined out of the snapshots are one chronicle, told in order.
  const told: Told[] = [];
  for (const ev of history.events) {
    if (groupedAllSameYear && ev.type === "found") {
      if (ev !== founded[0]) continue;            // the rest are folded into the line below
      const names = founded
        .map((e) => history.polities.find((p) => p.id === e.polityId)?.name)
        .filter((n): n is string => !!n);
      told.push({ year: ev.year, rank: 0, text: ko
        ? `${ev.year}년, ${names.length}개 나라가 서다 — ${names.join(", ")}`
        : `Year ${ev.year} — ${names.length} realms stand: ${names.join(", ")}` });
      continue;
    }
    told.push({ year: ev.year, rank: 0, text: ev.text });
  }
  told.push(...minedChronicle(history, lang));
  // Stable: year, then kind, then the order each was produced in — no comparison falls through to
  // chance, so the same world always reads the same way.
  told.forEach((t, i) => ((t as Told & { i: number }).i = i));
  told.sort((a, b) => a.year - b.year || a.rank - b.rank
    || ((a as Told & { i: number }).i - (b as Told & { i: number }).i));

  for (const t of told) {
    const century = Math.floor(t.year / 100);
    if (century !== lastCentury) { lastCentury = century; L.push("", ko ? `### ${century * 100}년대` : `### ${century * 100}s`); }
    L.push(`- ${t.text}`);
  }

  return L.join("\n") + "\n";
}
