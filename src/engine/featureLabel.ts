// A place name is a STRUCTURE, not a sentence. It used to be assembled into an English string at
// generation time — "the Bitter Jungle" — which bakes a decision about language into the world
// data, and it is why a Korean reader got an English map. The parts are kept instead and the
// sentence is built where it is read: the same lesson the chronicle learned on 2026-09-05.
import { toHangul } from "./hangul";

export type FeaturePattern = "adj" | "of" | "attributive" | "nounFirst";

export interface FeatureLabel {
  pattern: FeaturePattern;
  kind: number;
  adj?: string;
  noun: string;
  proper?: string;
}

export function featureLabel(label: FeatureLabel, lang: "en" | "ko"): string {
  if (lang === "en") {
    if (label.pattern === "adj") return `the ${label.adj} ${label.noun}`;
    if (label.pattern === "of") return `${label.noun} of ${label.proper}`;
    if (label.pattern === "nounFirst") return `${label.noun} ${label.proper}`;
    // worldName's bare-nation branch has no noun ({noun: ""}) — the world is just "Sodend", not
    // "Sodend " with a trailing space, so the noun is only appended when there is one.
    return label.noun ? `${label.proper} ${label.noun}` : `${label.proper}`;
  }
  // ── Korean ────────────────────────────────────────────────────────────────
  // One word order for all four patterns: the noun goes LAST. English has two (the attributive
  // "Trianork Wilds" and the river's "River Gruathgra"); Korean has neither choice to make, so
  // `nounFirst` and `attributive` are the same sentence here and the branch below does not
  // distinguish them.
  const noun = nounKo(label);
  if (label.pattern === "adj") return `${ADJ_KO[label.adj!] ?? label.adj} ${noun}`;
  if (label.pattern === "of") return `${toHangul(label.proper!)}의 ${noun}`;
  // The bare-name branch again: 소덴드, not "소덴드 " — a trailing space opens a visible gap in the
  // map's title cartouche, which is centred on the string it is given.
  return noun ? `${toHangul(label.proper!)} ${noun}` : toHangul(label.proper!);
}

/**
 * The world's name as a reader should see it.
 *
 * `world.name` is USUALLY the rendering of `world.nameLabel` — but not always. A reader who arrives
 * from the landing page by naming a world keeps that name: `generateWorld` stores it over the
 * generated one and leaves `nameLabel` as the world's own, so that a named and an unnamed world are
 * byte-identical in every other respect. A name the reader typed is already in their language and
 * is not ours to translate or transliterate, so the label is rendered ONLY where it is what
 * `world.name` says. (Caught by app.test.ts: a world asked to be "Avalon" came back "모진 대지".)
 */
export function worldNameIn(world: { name: string; nameLabel: FeatureLabel }, lang: "en" | "ko"): string {
  return world.name === featureLabel(world.nameLabel, "en") ? featureLabel(world.nameLabel, lang) : world.name;
}

/**
 * The Korean word for `label.noun`, taken from the right one of the two tables.
 *
 * ⚠ `kind === -1` does NOT mean "the world". `riverName` builds `{pattern: "adj", kind: -1}` with a
 * RIVER noun for 45% of rivers, so the plan's "kind -1 and the adj pattern is the world" rule would
 * have rendered every such river with a world noun. What is actually true is that the two tables
 * overlap on exactly ONE word — Expanse, an ocean (대해) and a world (대지) — and RIVER_NOUNS shares
 * none of its words with WORLD_NOUN. So the world table is reached only through a word that is IN
 * it, at kind -1.
 */
function nounKo(label: FeatureLabel): string {
  if (!label.noun) return "";
  if (label.kind === -1 && WORLD_NOUN_KO[label.noun]) return WORLD_NOUN_KO[label.noun];
  // The fallback is the English word, and it is never meant to be seen: `featureLabel.test.ts`
  // walks ADJ, NOUNS, RIVER_NOUNS and WORLD_NOUN and fails on a missing entry. A throw here would
  // take the whole map down over one untranslated word, which is a worse answer than a loud one.
  return NOUN_KO[label.noun] ?? label.noun;
}

// ── The Korean vocabulary ────────────────────────────────────────────────────
//
// NO TWO ENGLISH WORDS MAY SHARE A KOREAN ONE, and a test enforces it. A sibling task exists to
// stop one world calling three places the same thing; a table that folded Moor and Barrens both
// onto 황무지 would undo that work in the other language, and would do it invisibly — the English
// map would still read correctly.

export const ADJ_KO: Record<string, string> = {
  Ashen: "잿빛", Grey: "회색", Green: "푸른", Golden: "황금빛", White: "흰",
  Black: "검은",
  // "쓰라린" is a wound, not a country. 모진 is the word Korean uses for a harsh sea or a harsh
  // winter, which is what a Bitter Sea is.
  Bitter: "모진",
  Broken: "부서진", Endless: "끝없는", Silent: "고요한", Frozen: "얼어붙은",
  Shrouded: "안개 덮인", Sunken: "가라앉은", Hollow: "텅 빈", Iron: "무쇠", Amber: "호박빛",
  Pale: "창백한", Riven: "갈라진", Cold: "차가운",
  // "오래된" is how you describe a used object; 옛 is how a place is named (옛 왕토, 옛 숲).
  Old: "옛",
};

export const NOUN_KO: Record<string, string> = {
  // sea
  Sea: "바다", Deep: "심해", Gulf: "만", Waters: "해역", Expanse: "대해",
  // "큰바다" is a description, not a name. 창해 is the classical word for the open blue sea, and
  // gives this table a fourth register beside 바다 / 심해 / 대해.
  Main: "창해",
  // cold + forest
  Tundra: "툰드라", Frostlands: "서리벌판", Barrens: "황무지",
  Pinewood: "침엽수림", Taiga: "타이가", Wilds: "야생지",
  Forest: "숲", Woods: "수풀",
  // Reach is a stretch of ground inside a FOREST biome, so "벌판" (bare open plain) said the
  // opposite of what it names — and 평원/들판/서리벌판 already hold the open country.
  Reach: "너른땅",
  Wold: "언덕숲",
  // open + dry
  Plains: "평원", Steppe: "대초원", Downs: "구릉", Fields: "들판",
  Wastes: "황야", Sands: "모래벌판", Dunes: "사구",
  // wet + warm
  Jungle: "밀림", Rainforest: "우림", Marsh: "습지", Fens: "늪", Mire: "수렁", Moor: "진펄",
  // high
  Peaks: "봉우리", Mountains: "산맥", Range: "연봉", Spires: "첨봉", Heights: "고지",
  // rivers (rivers.ts RIVER_NOUNS — the same table, because a river noun and a region noun can
  // never both be right for one label and keeping them apart would only add a second lookup)
  River: "강", Water: "물줄기", Run: "개울", Fork: "갈래", Flow: "흐름", Rill: "실개천",
  // Race (급류) left with the English word it translated: "the Iron Race" read as a people, not a
  // water. 여울 is the shallow, quick stretch a beck IS, and shares no register with the six above.
  Beck: "여울",
};

// The world's own nouns are a SEPARATE table, exactly as `WORLD_NOUN` is separate from `NOUNS` in
// geography.ts, because Expanse is in both and wants a different word in each: an Expanse of water
// is 대해, an Expanse of world is 대지.
export const WORLD_NOUN_KO: Record<string, string> = {
  Realm: "왕토", Lands: "땅", Reaches: "변방", Dominion: "강역", Expanse: "대지",
};
