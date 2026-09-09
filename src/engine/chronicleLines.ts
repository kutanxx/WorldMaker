import type { World } from "../types/world";
import type { History, HistoryEventType } from "./history";
import { withJosa } from "./korean";
import { buildDynasties, rulerAt, type Reign } from "./dynasty";
import { eventText } from "./eventText";

// One chronicle, assembled once, read by two readers. The downloaded gazetteer and the panel on the
// site were filling their chronicles from different code: the gazetteer told the recorded events
// PLUS everything mined out of the 51 territory snapshots, while the panel told only the recorded
// events. Measured on seeds 1/2/3 that was 122/120/96 lines against 56/48/42 — the reader looking
// at the map got less than half the history of the reader who downloaded it, and never saw a
// ruler's name. Two paths rendering "the same thing" drift; this is the one path.
//
// Nothing here touches the simulation. Every line is either an event the simulation recorded or a
// fact derived from the snapshots it left behind, so the world, the map and the behaviour locks in
// history.test.ts are untouched by anything in this file.

// Declared here rather than imported from the UI: the engine is DOM-free.
export type ChronicleLang = "en" | "ko";

// English ordinals, for the accession lines. Gluing "th" onto the number is right from the fourth
// ruler to the twentieth and wrong for every first, second and third — the teens are the trap on
// the way past that, since eleven, twelve and thirteen take "th" although one, two and three do not.
function ordinalEn(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** What a line is about. Event kinds come straight from the simulation; the rest are mined. */
export type ChronicleKind =
  | HistoryEventType | "foundings"
  | "peak" | "fall" | "loss" | "surge" | "hegemon" | "century" | "culture" | "accession";

/** `rank` only orders lines that share a year, so the output is stable. */
export interface ChronicleLine { year: number; rank: number; kind: ChronicleKind; text: string }


// The simulation keeps 51 territory snapshots and the chronicle read none of them: measured across
// seven seeds it recorded 31-44 events over five centuries — one entry per sixteen years, with more
// than half the recorded moments silent. Everything below already happened; it was simply never
// told. Deriving it here rather than emitting it from the simulation means the world's history is
// unchanged — only the telling of it grows.
function mined(world: World, history: History, lang: ChronicleLang,
                dyn: Map<number, Reign[]>): ChronicleLine[] {
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
  // Who held the realm when it happened. A peak or a collapse with a name on it is a person's
  // reign; without one it is a statistic.
  const underOf = (p: number, year: number) => {
    const r = rulerAt(dyn.get(p) ?? [], year);
    if (!r) return "";
    return ko ? ` (${r.name} 치세)` : ` (under ${r.name})`;
  };
  const out: ChronicleLine[] = [];

  // The greatest extent a realm ever reached. Skipped at the first and last snapshot: a realm that
  // peaks at its founding never rose, and one still peaking at the end has not yet fallen.
  for (let p = 0; p < n; p++) {
    let best = 0, bestT = -1;
    for (let t = 0; t < series.length; t++) if (series[t][p] > best) { best = series[t][p]; bestT = t; }
    if (best < 20 || bestT <= 0 || bestT >= series.length - 1) continue;
    const year = history.snapshots[bestT].year;
    out.push({ year, rank: 2, kind: "peak", text: ko
      ? `${year}년, ${withJosa(nameOf(p), "이/가")} 최대 판도에 이르다 — ${best}칸${underOf(p, year)}`
      : `Year ${year} — ${nameOf(p)} reaches its greatest extent, ${best} tiles${underOf(p, year)}` });
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
        out.push({ year, rank: 3, kind: b === 0 ? "fall" : "loss", text: b === 0
          ? (ko ? `${year}년, ${withJosa(nameOf(p), "이/가")} 멸망하다 — ${a}칸을 지키던 끝${underOf(p, year - 10)}`
                : `Year ${year} — ${nameOf(p)} falls, holding ${a} tiles to the last${underOf(p, year - 10)}`)
          : (ko ? `${year}년, ${withJosa(nameOf(p), "이/가")} 한 세대 만에 영토의 ${share}%를 잃다 (${a} → ${b}칸)`
                : `Year ${year} — ${nameOf(p)} loses ${share}% of its land in a generation (${a} → ${b} tiles)`) });
      } else if (a >= 10 && b >= a * 1.5 && t - lastGain[p] >= 3) {
        lastGain[p] = t;
        out.push({ year, rank: 3, kind: "surge", text: ko
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
      out.push({ year, rank: 1, kind: "hegemon", text: ko
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
  // Year zero is not one of them. The founding line already says how many realms stand and names
  // every one of them, so a standing there repeats it a sentence later in weaker words — and the
  // "greatest realm" it would crown is an accident of where the seeds fell, not something a realm
  // did. The wart was invisible while this ran only into the download; it appeared the moment the
  // chronicle reached the screen.
  for (let t = 1; t < series.length; t++) {
    const year = history.snapshots[t].year;
    if (year % 100 !== 0) continue;
    let alive = 0, top = -1, tv = 0, held = 0;
    for (let q = 0; q < n; q++) {
      const v = series[t][q];
      if (v > 0) { alive++; held += v; }
      if (v > tv) { tv = v; top = q; }
    }
    if (alive === 0) continue;
    out.push({ year, rank: -1, kind: "century", text: ko
      ? `${year}년 현재 — ${alive}개 나라가 서 있고, 가장 큰 나라는 ${nameOf(top)}(${tv}칸). 사람의 땅은 ${held}칸.`
      : `Year ${year} — ${alive} realms stand; the greatest is ${nameOf(top)} at ${tv} tiles, of ${held} tiles settled.` });
  }

  // Which peoples a realm comes to rule. The generator gives every world five cultures and the
  // chronicle never mentioned one of them — yet a realm reaching over a second people's land is the
  // kind of turn a story is built on, and it is sitting in `cultureOf` crossed with the snapshots.
  // Only the first time counts: a realm holds that ground for centuries afterwards.
  const seenCulture = new Set<string>();
  for (let t = 0; t < history.snapshots.length; t++) {
    const snap = history.snapshots[t];
    const holds: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
    for (let i = 0; i < snap.owner.length; i++) {
      const o = snap.owner[i];
      if (o < 0 || o >= n) continue;
      const c = world.cultureOf[i];
      if (c >= 0 && c < world.cultures.length) holds[o].add(c);
    }
    for (let p = 0; p < n; p++) {
      // A realm's own people are not a conquest, so the culture its seat stands in never counts.
      const home = world.cultureOf[history.polities[p]?.capital ?? -1] ?? -1;
      const gained: string[] = [];
      for (const c of [...holds[p]].sort((a, b) => a - b)) {
        const key = p + ":" + c;
        if (c === home || seenCulture.has(key)) continue;
        seenCulture.add(key);
        if (t === 0) continue;                 // held from the first day: not a moment, just a fact
        gained.push(world.cultures[c]?.name ?? String(c));
      }
      // One conquest can reach two peoples at once; that is one line, not two identical ones.
      if (!gained.length) continue;
      const year = snap.year;
      out.push({ year, rank: 2, kind: "culture", text: ko
        ? `${year}년, ${withJosa(nameOf(p), "이/가")} ${gained.join("·")} 민족의 땅을 다스리게 되다${underOf(p, year)}`
        : `Year ${year} — ${nameOf(p)} comes to rule land of the ${gained.join(" and ")}${underOf(p, year)}` });
    }
  }

  // Accessions, but only where a realm is large enough for its succession to be news. Narrating
  // every crowning of every realm would bury the chronicle: eight to sixteen realms across five
  // centuries make far more successions than events.
  const snapAt = (year: number) => {
    let t = 0;
    for (let i = 0; i < history.snapshots.length; i++) if (history.snapshots[i].year <= year) t = i;
    return t;
  };
  // 1 = largest realm standing that year. Realms holding nothing rank last.
  const rankAt = (p: number, year: number) => {
    const row = series[snapAt(year)];
    if (!row || !row[p]) return Number.MAX_SAFE_INTEGER;
    let rank = 1;
    for (let q = 0; q < n; q++) if (row[q] > row[p]) rank++;
    return rank;
  };
  for (const [pid, reigns] of [...dyn.entries()].sort((a, b) => a[0] - b[0])) {
    for (const r of reigns) {
      if (r.ordinal === 1) continue;                 // the founding is already told
      // Only the great powers' successions. A flat size threshold still let every middling realm
      // crown someone: accessions came to 48-63 of 85-115 chronicle lines, turning the record into a
      // king list — the same monotony in a different key. Being among the three largest realms of
      // the moment is what makes a succession matter to anyone outside the realm.
      if (rankAt(pid, r.from) > 3) continue;
      out.push({ year: r.from, rank: 4, kind: "accession", text: ko
        ? `${r.from}년, ${nameOf(pid)}의 ${r.ordinal}대 ${r.name} 즉위`
        : `Year ${r.from} — ${r.name}, ${ordinalEn(r.ordinal)} of ${nameOf(pid)}, takes the seat` });
    }
  }

  return out;
}

/**
 * The whole chronicle of a world, in reading order: the events the simulation recorded, folded and
 * worded for a reader, together with the moments mined out of its snapshots.
 *
 * `dyn` is accepted so a caller that already built the dynasties (the gazetteer needs them for its
 * realm entries too) does not build them twice; it is deterministic either way.
 */
export function buildChronicle(world: World, history: History, lang: ChronicleLang,
                               dyn: Map<number, Reign[]> = buildDynasties(world, history)): ChronicleLine[] {
  const ko = lang === "ko";
  // Every chronicle opened with one "founded" line per realm — eight identical-shaped lines before
  // anything happened, on every seed and in both languages. They are one event in the world's life,
  // so they are told as one line. Only the RENDERING changes: the simulation still records each
  // founding separately, which is what keeps the history itself (and its behaviour lock) untouched.
  const founded = history.events.filter((e) => e.type === "found");
  const groupedFoundYear = founded.length >= 3 ? founded[0].year : null;
  const groupedAllSameYear = groupedFoundYear !== null && founded.every((e) => e.year === groupedFoundYear);

  // The recorded events and the moments mined out of the snapshots are one chronicle, told in order.
  const told: ChronicleLine[] = [];
  for (const ev of history.events) {
    if (groupedAllSameYear && ev.type === "found") {
      if (ev !== founded[0]) continue;            // the rest are folded into the line below
      const names = founded
        .map((e) => history.polities.find((p) => p.id === e.polityId)?.name)
        .filter((n): n is string => !!n);
      told.push({ year: ev.year, rank: 0, kind: "foundings", text: ko
        ? `${ev.year}년, ${names.length}개 나라가 서다 — ${names.join(", ")}`
        : `Year ${ev.year} — ${names.length} realms stand: ${names.join(", ")}` });
      continue;
    }
    told.push({ year: ev.year, rank: 0, kind: ev.type, text: eventText(ev, history.polities, lang) });
  }
  told.push(...mined(world, history, lang, dyn));
  // Stable: year, then kind, then the order each was produced in — no comparison falls through to
  // chance, so the same world always reads the same way.
  told.forEach((t, i) => ((t as ChronicleLine & { i: number }).i = i));
  told.sort((a, b) => a.year - b.year || a.rank - b.rank
    || ((a as ChronicleLine & { i: number }).i - (b as ChronicleLine & { i: number }).i));
  return told;
}
