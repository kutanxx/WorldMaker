// UI + label localisation (KO/EN). Scope: UI chrome, city district names, biome legend names,
// compass. NOT generated content (world/region/city/nation/river names, chronicle, gazetteer).
import type { WardType } from "../engine/city/zoning";
import {
  TUNDRA, TAIGA, TEMPERATE_FOREST, GRASSLAND, DESERT, TROPICAL, WETLAND, ALPINE, BIOME_NAMES,
} from "../engine/biome";

export type Lang = "en" | "ko";

// district names — also resolves the plaza-vs-market clash (plaza = the open market square,
// market = the commercial stalls district).
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

// UI chrome strings, keyed for both languages
export const UI: Record<Lang, Record<string, string>> = {
  en: {
    generate: "Generate", randomSeed: "Random seed", exportJson: "Export JSON",
    exportPng: "Export PNG", exportSvg: "Export SVG", gazetteer: "Gazetteer",
    terrain: "Terrain", political: "Political", culture: "Culture",
    backToWorld: "Back to world", water: "Water", mainRoad: "Main road",
    compassN: "N", langToggle: "한국어",
  },
  ko: {
    generate: "생성", randomSeed: "랜덤 시드", exportJson: "JSON 내보내기",
    exportPng: "PNG 내보내기", exportSvg: "SVG 내보내기", gazetteer: "가제티어",
    terrain: "지형", political: "정치", culture: "문화",
    backToWorld: "지도로 돌아가기", water: "물", mainRoad: "큰길",
    compassN: "북", langToggle: "EN",
  },
};

export function t(lang: Lang, key: string): string {
  return UI[lang][key] ?? UI.en[key] ?? key;
}

// --- Version B play screen (empire sim) ---
export const PLAY_UI: Record<Lang, Record<string, string>> = {
  en: {
    chooseRealm: "Choose your realm", cells: "cells", cohesion: "cohesion", threats: "threats",
    diffEasy: "easy", diffNormal: "normal", diffHard: "hard",
    civilWarRisk: "civil-war risk", fallen: "fallen",
    aggressive: "aggressive", defensive: "defensive", internal: "internal",
    noAction: "No action (Pass)", attackChosen: "Attack: chosen ✓",
    investRealmChosen: "Invest: realm ✓", investFrontierChosen: "Invest: frontier ✓",
    foundChosen: "Found city: chosen ✓", peaceChosen: "Peace: chosen ✓",
    attackPlaceholder: "— attack a border cell —", investPlaceholder: "— invest cohesion —",
    foundPlaceholder: "— found a city —", peacePlaceholder: "— sue for peace —",
    investRealmOpt: "realm (all cells)", investFrontierOpt: "frontier (border cells)",
    advance: "Advance year ▶", endured: "You endured 500 years.",
  },
  ko: {
    chooseRealm: "국가를 선택하세요", cells: "셀", cohesion: "결속", threats: "위협",
    diffEasy: "쉬움", diffNormal: "보통", diffHard: "어려움",
    civilWarRisk: "내전 위험", fallen: "멸망",
    aggressive: "공격적", defensive: "방어적", internal: "내치",
    noAction: "행동 없음 (넘기기)", attackChosen: "공격 지정됨 ✓",
    investRealmChosen: "투자: 전국 ✓", investFrontierChosen: "투자: 국경 ✓",
    foundChosen: "도시 건설 지정됨 ✓", peaceChosen: "강화 지정됨 ✓",
    attackPlaceholder: "— 국경 셀 공격 —", investPlaceholder: "— 결속 투자 —",
    foundPlaceholder: "— 도시 건설 —", peacePlaceholder: "— 강화 요청 —",
    investRealmOpt: "전국 (모든 셀)", investFrontierOpt: "국경 (접경 셀)",
    advance: "다음 해로 ▶", endured: "당신은 500년을 버텼습니다.",
  },
};
export function playT(lang: Lang, key: string): string {
  return PLAY_UI[lang][key] ?? PLAY_UI.en[key] ?? key;
}
export function playYear(lang: Lang, year: number): string {
  return lang === "ko" ? `${year}년` : `Year ${year}`;
}
// localised player-action log line, from the intervention outcome code + data
export function playLog(lang: Lang, code: string | undefined, data: Record<string, string | number> = {}): string {
  const name = String(data.name ?? "");
  const n = Number(data.n ?? 0);
  const cnt = Math.max(1, Number(data.n ?? 1)); // cells captured by an attack (breakthrough > 1)
  const where = data.scope === "border"
    ? (lang === "ko" ? "국경" : "the frontier")
    : (lang === "ko" ? "전국" : "the realm");
  if (lang === "ko") {
    switch (code) {
      case "captured": return cnt > 1 ? `${name}에게서 셀 ${cnt}개를 빼앗았습니다.` : `${name}에게서 셀을 빼앗았습니다.`;
      case "landed": return cnt > 1 ? `${name}에 상륙하여 셀 ${cnt}개를 점령했습니다.` : `${name}에 상륙하여 셀을 점령했습니다.`;
      case "repulsed": return `${name} 공격이 격퇴당했습니다.`;
      case "invested": return `${where}에 투자: ${n}개 셀의 결속이 올랐습니다.`;
      case "founded": return `${name}을(를) 건설했습니다.`;
      case "badSite": return "도시를 세울 수 없는 곳입니다.";
      case "peaceMade": return `${name}과(와) ${Number(data.years ?? 0)}년 강화를 맺었습니다.`;
      case "notHostile": return "접경한 적국이 아닙니다.";
      case "notEnemy": return "적의 영토가 아닙니다.";
      case "unreachable": return "당신의 영토에서 닿을 수 없습니다.";
      default: return "";
    }
  }
  switch (code) {
    case "captured": return cnt > 1 ? `Captured ${cnt} cells from ${name}.` : `Captured a cell from ${name}.`;
    case "landed": return cnt > 1 ? `Landed on and captured ${cnt} cells from ${name}.` : `Landed on and captured a cell from ${name}.`;
    case "repulsed": return `Attack on ${name} was repulsed.`;
    case "invested": return `Invested in ${where}: cohesion raised on ${n} cells.`;
    case "founded": return `Founded the city of ${name}.`;
    case "badSite": return "Not a viable city site.";
    case "peaceMade": return `Made peace with ${name} for ${Number(data.years ?? 0)} years.`;
    case "notHostile": return "Not a hostile neighbour.";
    case "notEnemy": return "Not an enemy cell.";
    case "unreachable": return "Not reachable from your territory.";
    default: return "";
  }
}
// intro + end-screen lines that interpolate values
export function playRuleIntro(lang: Lang, name: string): string {
  return lang === "ko" ? `0년 — 당신은 ${name}을(를) 다스립니다.` : `Year 0 — you rule ${name}.`;
}
export function playFell(lang: Lang, years: number): string {
  return lang === "ko" ? `당신의 나라는 ${years}년 만에 멸망했습니다.` : `Your realm fell in ${years} years.`;
}
export function playStats(lang: Lang, peak: number, final: number, rank: string, cities = 0): string {
  const cityPart = cities ? (lang === "ko" ? ` · 도시 ${cities}` : ` · ${cities} cities founded`) : "";
  return lang === "ko"
    ? `최대 ${peak}셀 · 최종 ${final}셀${cityPart} · 순위 ${rank}.`
    : `Peak ${peak} cells · final ${final} cells${cityPart} · rank ${rank}.`;
}
// per-decade gain/loss summary; "−" is U+2212 to match the minus used elsewhere
export function playDelta(lang: Lang, year: number, gained: number, lost: number): string {
  const parts: string[] = [];
  if (gained) parts.push(`+${gained}`);
  if (lost) parts.push(`−${lost}`);
  const unit = lang === "ko" ? "셀" : "cells";
  const still = lang === "ko" ? "변동 없음" : "no change";
  const change = parts.length ? `${parts.join(" ")} ${unit}` : still;
  return lang === "ko" ? `${year}년: ${change}` : `Year ${year}: ${change}`;
}
export function playDefeatCause(lang: Lang, name: string): string {
  return lang === "ko" ? `${name}에게 정복당함.` : `Conquered by ${name}.`;
}
