import type { World } from "../types/world";
import type { History } from "./history";
import {
  OCEAN, TUNDRA, TAIGA, TEMPERATE_FOREST, GRASSLAND, DESERT, TROPICAL, WETLAND, ALPINE,
} from "./biome";
import { buildDynasties } from "./dynasty";
import { classifyGovernments } from "./government";
import { buildChronicle } from "./chronicleLines";
import { featureLabel, worldNameIn } from "./featureLabel";
import { toHangul } from "./hangul";
import { realmLabelKo, peopleLabelKo } from "./nameSuffix";
// 는 was hardcoded after the world's title. It was harmless while the title was Latin and the rule
// went by the final letter; a Hangul title is chosen by its final consonant, and 소덴드 takes 은.
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
// "a arid desert", "a open sea" — the size word for a middling region is the bare article, and two
// of the nine biome phrases begin with a vowel, so seventeen of these went into the document across
// eight seeds. Only the leading article is touched; the vast/small forms already read correctly.
export function anArticle(phrase: string): string {
  return /^a [aeiou]/i.test(phrase) ? `an ${phrase.slice(2)}` : phrase;
}

const RIVER_SIZE: Record<GazetteerLang, Record<string, string>> = {
  en: { large: "a great river", mid: "a river", small: "a slender stream" },
  ko: { large: "큰 강", mid: "강", small: "가느다란 물줄기" },
};


export function worldToGazetteer(world: World, history: History, lang: GazetteerLang = "en"): string {
  const { grid } = world;
  const b = landBounds(world);
  const bio = BIOME_PHRASE[lang];
  const ko = lang === "ko";
  // What kind of state each realm was. Read off the record — who declared themselves free, whose
  // land each realm came to hold — never invented for the page.
  const gov = classifyGovernments(world, history);
  const dyn = buildDynasties(world, history, gov);
  // Two doors, and which one a name goes through is not a choice. A world's, a region's and a
  // river's name has a common noun IN it and is rebuilt from its parts; a people, a realm, a town
  // and a ruler are single invented words and are transliterated. `world.name` is "the Hollow
  // Realm" — it carries letters (w, p) that no invented word contains, and toHangul has no rule
  // for them.
  const say = (n: string) => (ko ? toHangul(n) : n);
  // A people's own heading in "## 민족" STANDS ALONE as a label — the identical shape realmLabelKo
  // already earns for a realm's "### {name}" heading — so it takes peopleLabelKo's fused 인, not
  // `say`'s bare transliteration. Every other mention of a people's name in this document (the
  // chronicle's "민족의 땅을 다스리게 되다") stays inside a clause and goes through `say`, unchanged.
  const peopleLabel = (n: string) => (ko ? peopleLabelKo(n) : n);
  // The English title capitalises the article; Korean has no case to raise, and its name is built
  // from the label rather than from the finished English string.
  const title = ko ? worldNameIn(world, "ko") : world.name.charAt(0).toUpperCase() + world.name.slice(1);
  const L: string[] = [];

  L.push(`# ${title}`, "");
  // Both counts, because they are different numbers and the document uses both: the world begins
  // with `world.polities`, and the Realms section below describes every realm that ever stood. This
  // line said "a world of 8 realms" directly above a section describing nineteen — the last place
  // in the document still answering as of year zero.
  L.push(ko
    ? `${withJosa(title, "은/는")} ${world.cultures.length}개 민족의 세계다. ${world.polities.length}개 나라로 시작해, ${history.years}년 동안 모두 ${history.polities.length}개 나라가 서고 스러졌다.`
    : `${title} is a world of ${world.cultures.length} peoples, founded by ${world.polities.length} realms; ${history.polities.length} in all rose and fell across its ${history.years} years.`, "");

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
      ? `- **${featureLabel(r.label, "ko")}** — ${dir}에 펼쳐진 ${size}${phrase}.`
      : `- **${r.name}** — ${anArticle(`${size}${phrase}`)} ${dir}.`);
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
          ? `- **${featureLabel(r.label, "ko")}** — 세계 ${to}${objectParticle(to)} 흐르는 ${kind}.`
          : `- **${featureLabel(r.label, "ko")}** — 세계 ${from}에서 발원해 ${to}에서 바다로 드는 ${kind}.`)
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
    if (!a || a.n === 0) { L.push(`- **${peopleLabel(cult.name)}** — ${ko ? "흩어져 사는 민족." : "a scattered people."}`); return; }
    let dom = OCEAN, dn = -1;
    for (const [bm, cnt] of a.biome) if (bm !== OCEAN && cnt > dn) { dn = cnt; dom = bm; }
    const dir = compass(lang, a.sx / a.n, a.sy / a.n, b);
    const t = townsPerCulture[i];
    L.push(ko
      ? `- **${peopleLabel(cult.name)}** — 세계 ${dir}, ${bio[dom] ?? "거친 땅"}에 사는 민족.` + (t ? ` 성읍 ${t}곳을 품는다.` : "")
      : `- **${cult.name}** — a people of the ${bio[dom] ?? "wild country"} in the ${dir}.` + (t ? ` They hold ${t} town${t > 1 ? "s" : ""}.` : ""));
  });
  L.push("");

  // ── Realms ──────────────────────────────────────────────────────────────────
  L.push(ko ? "## 나라" : "## Realms", "");
  // Every realm the world ever had, not the eight it began with. This used to walk
  // `world.polities` — the founding realms, as of year zero — inside a document whose chronicle
  // runs five centuries. Measured on seeds 1/2/3: nine, six and eight of the realms STANDING at
  // year 500 appeared nowhere in it, while four to five of the eight it did describe had fallen
  // long before, with nothing on the page to say so. A reader looking up who held the east got an
  // entry for a dead realm and none for the living one.
  //
  // So each entry is dated: when the realm stood, how it began, how far it reached and when, which
  // towns it held at that height, and how it ended. All of it comes off the snapshots the
  // simulation already kept.
  const cellsAt = history.snapshots.map((snap) => {
    const count = new Map<number, number>();
    for (const o of snap.owner) if (o >= 0) count.set(o, (count.get(o) ?? 0) + 1);
    return count;
  });
  // the civil war that made each fragment, so a successor state can say what it broke from
  const brokeFrom = new Map<number, string>();
  for (const ev of history.events) {
    if (ev.type !== "civilwar") continue;
    for (const id of ev.intoIds ?? []) brokeFrom.set(id, say(history.polities[ev.polityId]?.name ?? ""));
  }

  for (const p of history.polities) {
    // Read once, up front: the heading needs it too. A realm heading STANDS ALONE as a label — the
    // same reason a Korean map draws "케우스두 왕국" rather than leaving a reader to guess whether
    // Ceusdu is a kingdom or its own capital — so it goes through `realmLabelKo`, not `say`, which
    // only transliterates. This is deliberately NOT how a realm's name reads inside a sentence a few
    // lines down (`parent`, `realm` in Free Ports): a clause like "broke from X" already carries its
    // own grammar, and stacking a second noun onto it there would read as a translation of an
    // English sentence rather than as a chronicle.
    const form = gov.get(p.id) ?? { form: "kingdom" as const, since: null };
    L.push(`### ${ko ? realmLabelKo(p.name, form.form) : p.name}`);
    // The height of a realm is the fairest moment to describe it by: at its founding it has not
    // done anything yet, and at its fall there is nothing left to describe.
    let peak = 0, peakIdx = 0;
    for (let t = 0; t < cellsAt.length; t++) {
      const n = cellsAt[t].get(p.id) ?? 0;
      if (n > peak) { peak = n; peakIdx = t; }
    }
    const peakSnap = history.snapshots[peakIdx];
    const peakYear = peakSnap?.year ?? p.foundedYear;

    let dom = -1;
    {
      const tally = new Map<number, number>();
      if (peakSnap) {
        for (let i = 0; i < peakSnap.owner.length; i++) {
          if (peakSnap.owner[i] !== p.id || world.biome[i] === OCEAN) continue;
          tally.set(world.biome[i], (tally.get(world.biome[i]) ?? 0) + 1);
        }
      }
      let bn = -1;
      for (const [bm, cnt] of tally) if (cnt > bn) { bn = cnt; dom = bm; }
    }
    const land = dom >= 0 ? bio[dom] : undefined;
    const cap = world.cities.find((c) => c.cell === p.capital);
    const towns = peakSnap
      ? world.cities.filter((c) => peakSnap.owner[c.cell] === p.id && c.id !== cap?.id).map((c) => say(c.name))
      : [];
    const parent = brokeFrom.get(p.id);
    const ended = p.endedYear;
    // A realm born of a civil war takes an ordinary land cell for its seat, so most fragments have
    // no town to be named after. "No seat the atlas names" is honest but a dead end for a reader
    // who wants to know WHERE it was — the free-port entries already answer that with a bearing,
    // so a seatless realm gets the same one, taken from the cell it was governed from.
    const seatDir = cap || p.capital < 0 ? "" :
      compass(lang, grid.points[p.capital * 2], grid.points[p.capital * 2 + 1], b);

    const seatTrait = cap
      ? (cap.coastal ? (ko ? "바닷가의 " : "the coastal seat of ")
        : cap.elevation >= world.params.mountainLevel ? (ko ? "산중의 " : "the highland seat of ") : (ko ? "" : "the seat of "))
      : "";

    // The three forms differ in the noun the entry opens with, in whether an imperial date is given,
    // and in what the list of names at the foot is CALLED. Nothing else moves: a republic still
    // reaches its height in a year and still holds towns. (`form` was already read above, for the
    // heading.)
    const since = form.since;
    const bornImperial = since !== null && since <= p.foundedYear;

    if (ko) {
      const kind = form.form === "republic" ? "자유도시" : "나라";
      const where = land ? `${land}에 자리한 ${kind}.` : "";
      const seat = cap ? ` 도읍은 ${seatTrait}**${say(cap.name)}**.`
        : seatDir ? ` 지도가 이름 붙인 도읍은 없고, 중심은 세계 ${seatDir}에 있었다.` : " 지도가 이름을 붙인 도읍은 없다.";
      L.push(`${where}${seat}`.trim());
      const born = parent ? `${p.foundedYear}년 ${parent}에서 갈라져 나왔고` : p.free ? `${p.foundedYear}년 자유도시로 독립했고` : `${p.foundedYear}년에 서서`;
      const died = ended !== null ? `${ended}년에 무너졌다` : `${history.years}년까지 서 있다`;
      L.push(`${born}, ${died}.` + (peak > 0 ? ` 최대 판도는 ${peakYear}년의 ${peak}칸.` : ""));
      if (form.form === "empire") {
        L.push(bornImperial ? "선 날부터 다른 민족의 땅을 거느린 제국이었다."
          : `${since}년, 두 번째 민족의 땅을 품으며 제국이 되었다.`);
      }
      if (towns.length) L.push(`그때 거느린 성읍은 ${towns.join(", ")}.`);
      const line = dyn.get(p.id) ?? [];
      const heading = form.form === "republic" ? "역대 수반"
        : form.form === "empire" ? (bornImperial ? "역대 황제" : `역대 군주(${since}년부터 황제)`)
        : "역대 군주";
      if (line.length) L.push("", `${heading} — ${line.map((r) => `${say(r.name)} (${r.from}–${r.to})`).join(", ")}`);
      L.push("");
    } else {
      const where = land ? `A ${form.form === "republic" ? "free city" : "realm"} of the ${land}.` : "";
      const seat = cap ? ` ${seatTrait.charAt(0).toUpperCase()}${seatTrait.slice(1)}**${cap.name}**.`
        : seatDir ? ` No seat the atlas names; it was governed from the ${seatDir}.` : " No seat the atlas names.";
      L.push(`${where}${seat}`.trim());
      const born = parent ? `Broke from ${parent} in ${p.foundedYear}` : p.free ? `Declared itself free in ${p.foundedYear}` : `Stood from ${p.foundedYear}`;
      const died = ended !== null ? `and fell in ${ended}` : `and was still standing at ${history.years}`;
      L.push(`${born} ${died}.` + (peak > 0 ? ` At its greatest, ${peak} tiles in ${peakYear}.` : ""));
      if (form.form === "empire") {
        L.push(bornImperial ? "An empire from its first day, holding land that was never its own people's."
          : `An empire from ${since}, when a second people's land came under it.`);
      }
      if (towns.length) L.push(`Its towns then were ${towns.join(", ")}.`);
      const line = dyn.get(p.id) ?? [];
      const heading = form.form === "republic" ? "Elected heads"
        : form.form === "empire" ? (bornImperial ? "Emperors" : `Rulers, emperors from ${since}`)
        : "Rulers";
      if (line.length) L.push("", `${heading} — ${line.map((r) => `${r.name} (${r.from}–${r.to})`).join(", ")}`);
      L.push("");
    }
  }

  // ── Free Ports ──────────────────────────────────────────────────────────────
  if (history.economicZones.length) {
    L.push(ko ? "## 자유도시" : "## Free Ports", "");
    for (const z of history.economicZones) {
      // Every free port used to get one identical sentence. Each one sits in a real place, under a
      // real realm — both were already in the data.
      const owner = world.polityOf[z.cell];
      const held = owner >= 0 ? world.polities.find((p) => p.id === owner)?.name : undefined;
      const realm = held === undefined ? undefined : say(held);
      const px = grid.points[z.cell * 2], py = grid.points[z.cell * 2 + 1];
      const dir = compass(lang, px, py, b);
      L.push(ko
        ? `- **${say(z.name)}** — 세계 ${dir}의 자유도시.` + (realm ? ` ${realm}의 땅에 선다.` : "")
        : `- **${z.name}** — a free port of the ${dir}.` + (realm ? ` It stands on ${realm}'s ground.` : ""));
    }
    L.push("");
  }

  // ── Chronicle ───────────────────────────────────────────────────────────────
  L.push(ko ? `## 연대기 (0–${history.years}년)` : `## Chronicle (Years 0–${history.years})`, "");
  let lastCentury = -1;
  // The chronicle itself is assembled in `chronicleLines.ts`, which the on-screen panel reads too;
  // all that belongs here is the markdown around it.
  for (const t of buildChronicle(world, history, lang, dyn, gov)) {
    const century = Math.floor(t.year / 100);
    if (century !== lastCentury) { lastCentury = century; L.push("", ko ? `### ${century * 100}년대` : `### ${century * 100}s`); }
    L.push(`- ${t.text}`);
  }

  return L.join("\n") + "\n";
}
