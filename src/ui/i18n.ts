// UI + label localisation (KO/EN). Scope: UI chrome, city district names, biome legend names,
// compass, and the chronicle panel's chrome. NOT generated content (world/region/city/nation/river
// names) and NOT the chronicle's own lines — those are assembled by `engine/eventText.ts`.
import type { WardType } from "../engine/city/zoning";
import {
  TUNDRA, TAIGA, TEMPERATE_FOREST, GRASSLAND, DESERT, TROPICAL, WETLAND, ALPINE, BIOME_NAMES,
} from "../engine/biome";

export type Lang = "en" | "ko";

// district names — also resolves the plaza-vs-market clash (plaza = the open market square,
// market = the commercial stalls district).
// The names of the things the plate draws outside its districts. The countryside generator has a
// large vocabulary — abbey, cloister, cemetery, gallows, leper house, fairground, inn, market
// cross, well, windmill, watermill, hamlet, farmstead — and until these existed none of it was
// named anywhere: a reader saw a bent line and had no way to learn it was a gallows.
export const FEATURE_NAME = {
  en: {
    abbey: "Abbey", cemetery: "Cemetery", gallows: "Gallows", leperHouse: "Leper house",
    fairground: "Fairground", inn: "Inn", marketCross: "Market cross", well: "Well",
    barbican: "Barbican", parishChurch: "Parish church", windmill: "Windmill",
    watermill: "Watermill", farmstead: "Farmstead", hamlet: "Hamlet", suburb: "Suburb house",
    field: "Field", fallowField: "Fallow field", pasture: "Pasture", orchard: "Orchard",
    garden: "Garden", harbour: "Harbour", tanner: "Tannery", dyer: "Dyer's yard",
    castle: "Castle", bridge: "Bridge", wall: "Town wall", gate: "Gate",
  },
  ko: {
    abbey: "수도원", cemetery: "공동묘지", gallows: "교수대", leperHouse: "나병자 수용소",
    fairground: "장터", inn: "여관", marketCross: "시장 십자가", well: "우물",
    barbican: "외성", parishChurch: "본당 교회", windmill: "풍차",
    watermill: "물레방아", farmstead: "농장", hamlet: "마을", suburb: "성밖 민가",
    field: "밭", fallowField: "휴경지", pasture: "목초지", orchard: "과수원",
    garden: "텃밭", harbour: "항구", tanner: "무두질터", dyer: "염색장",
    castle: "성채", bridge: "다리", wall: "성벽", gate: "성문",
  },
} as const satisfies Record<Lang, Record<string, string>>;

export type FeatureKey = keyof typeof FEATURE_NAME["en"];
export const featureName = (lang: Lang, key: FeatureKey): string => FEATURE_NAME[lang][key];

export const WARD_NAME: Record<Lang, Partial<Record<WardType, string>>> = {
  en: {
    plaza: "Market Square", market: "Market", guildhall: "Guildhall", cathedral: "Cathedral",
    castle: "Castle", merchant: "Merchants", patriciate: "Patricians", craftsmen: "Craftsmen",
    slum: "Slums", military: "Barracks", park: "Park", harbor: "Harbor",
  },
  ko: {
    plaza: "시장 광장", market: "장터", guildhall: "길드홀", cathedral: "대성당",
    castle: "성채", merchant: "상인 구역", patriciate: "귀족 구역", craftsmen: "장인 구역",
    slum: "빈민가", military: "병영", park: "공원", harbor: "항구",
  },
};

const BIOME_KO: Record<number, string> = {
  [TUNDRA]: "툰드라", [TAIGA]: "타이가", [TEMPERATE_FOREST]: "숲", [GRASSLAND]: "초원",
  [DESERT]: "사막", [TROPICAL]: "열대", [WETLAND]: "습지", [ALPINE]: "고산",
};
export function biomeName(lang: Lang, bm: number): string {
  return (lang === "ko" ? BIOME_KO[bm] : BIOME_NAMES[bm]) ?? "";
}

// The chronicle panel's own chrome. The chronicle's LINES are assembled by `eventText.ts`, not
// here — these two interpolate a number, which is why they are functions and not `UI` keys.
export function chronicleTitle(lang: Lang, years: number): string {
  return lang === "ko" ? `연대기 (0–${years}년)` : `Chronicle (Years 0–${years})`;
}
// matches the gazetteer's century headers: "100년대" / "100s"
export function eraLabel(lang: Lang, startYear: number): string {
  return lang === "ko" ? `${startYear}년대` : `${startYear}s`;
}

// UI chrome strings, keyed for both languages
export const UI: Record<Lang, Record<string, string>> = {
  en: {
    generate: "Generate", randomSeed: "Random seed", exportJson: "JSON",
    exportPng: "PNG", exportSvg: "SVG", exportLabel: "Export", gazetteer: "Gazetteer",
    terrain: "Terrain", political: "Political", culture: "Culture", province: "Provinces",
    backToWorld: "Back to world", water: "Water", mainRoad: "Main road", bridge: "Bridge", capitalSeat: "capital",
    mapOf: "Map of", viewTerrain: "Terrain: biomes, rivers, mountains and coasts, with the regions and settlements named.",
    viewPolitical: "Political: the nations and their borders at the year the timeline is showing.",
    viewCulture: "Cultures: the peoples of the world and the ground each of them holds.",
    viewProvince: "Provinces: the administrative regions, their seats and the countries they make up.",
    cityPlanOf: "Plan of",
    compassN: "N", langToggle: "한국어", home: "🏠", homeLabel: "Home",
    legendTerrain: "Terrain", legendRealms: "Realms", legendCultures: "Cultures", legendDistricts: "Districts",
  },
  ko: {
    generate: "생성", randomSeed: "랜덤 시드", exportJson: "JSON",
    exportPng: "PNG", exportSvg: "SVG", exportLabel: "내보내기", gazetteer: "가제티어",
    terrain: "지형", political: "정치", culture: "문화", province: "영토",
    backToWorld: "지도로 돌아가기", water: "물", mainRoad: "큰길", bridge: "다리", capitalSeat: "수도",
    mapOf: "지도 —", viewTerrain: "지형: 생물군계·강·산맥·해안, 지역명과 도시 표시.",
    viewPolitical: "정치: 연표가 가리키는 해의 국가와 국경.",
    viewCulture: "문화: 세계의 문화권과 각 문화가 차지한 땅.",
    viewProvince: "영토: 행정 구역과 그 중심지, 그리고 이들이 이루는 나라.",
    cityPlanOf: "도면 —",
    compassN: "북", langToggle: "EN", home: "🏠", homeLabel: "홈",
    legendTerrain: "지형", legendRealms: "나라", legendCultures: "문화", legendDistricts: "구역",
  },
};

export function t(lang: Lang, key: string): string {
  return UI[lang][key] ?? UI.en[key] ?? key;
}

// --- Version B play screen (empire sim) ---
