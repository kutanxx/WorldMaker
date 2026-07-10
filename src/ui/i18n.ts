// UI + label localisation (KO/EN). Scope: UI chrome, city district names, biome legend names,
// compass. NOT generated content (world/region/city/nation/river names, chronicle, gazetteer).
import type { WardType } from "../engine/city/zoning";
import {
  TUNDRA, TAIGA, TEMPERATE_FOREST, GRASSLAND, DESERT, TROPICAL, WETLAND, ALPINE, BIOME_NAMES,
} from "../engine/biome";
import type { ChoicePreview } from "../engine/dilemma";

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
    noAction: "No action (Pass)", attackChosen: "⚔ Attack: chosen ✓",
    investRealmChosen: "💰 Invest: realm ✓", investFrontierChosen: "💰 Invest: frontier ✓",
    foundChosen: "🏘 Found city: chosen ✓", peaceChosen: "🕊 Peace: chosen ✓",
    peacePlaceholder: "— 🕊 sue for peace —",
    investRealmOpt: "realm", investFrontierOpt: "frontier",
    tipInvest: "Instantly raise cohesion (one-off, then decays normally). Frontier feeds your battles; realm staves off civil war.",
    tipPeace: "A 30-year truce with the chosen neighbour. Attacking them yourself breaks it.",
    tipStrength: "Your territory (cell count) versus the average rival realm. Ahead = strong, behind = weak.",
    tipCohesion: "Low cohesion makes your realm weaker in battle, so you lose ground. A large realm with low cohesion can also split apart in civil war. Restore it with invest (💰) or the internal stance.",
    tipThreat: "The number of enemy realms bordering you. More means greater invasion pressure.",
    cohWeak: "weakened",
    advance: "Advance year ▶", pass: "Pass", endured: "You endured 500 years.",
    winConquest: "You unified the realm.", winProsperity: "Your realm prospered into a golden age.",
    reignExport: "📜 Reign chronicle", playAgain: "▶ Play again", newWorld: "🌍 New world",
    howtoTitle: "How to rule", howtoStart: "▶ Begin your reign", help: "?",
    howto1: "Goal: survive to year 500 — lose your capital and the realm falls.",
    howto2: "Each turn is a decade: change stance freely, then take ONE action — click the map or use the lists.",
    howto3: "Map: green = a region you can seize · blue = a landing across the sea · gold = a city site · red lines = borders under threat.",
    howto4: "Cohesion is your realm's health. Low cohesion invites civil war and erosion — restore it with invest or the internal stance.",
    solStable: "steady", solShaky: "shaky", solDanger: "critical",
    tipAggressive: "Stronger attacks · cohesion slowly decays", tipDefensive: "Stronger defense · slower expansion", tipInternal: "Cohesion recovers · expansion held back",
    adviceLowSol: "💡 Cohesion is low — invest, or switch to the internal stance to recover.",
    adviceDefend: "💡 The border is under pressure — go defensive and invest in the frontier.",
    adviceExpand: "💡 A good moment to expand — click a green region to attack.",
    adviceBuild: "💡 The realm is stable — found a city on a gold cell to build your base.",
    legendPush: "seizable region", legendSea: "sea landing", legendSite: "city site", legendThreat: "threatened border", legendCity: "your city",
    strength: "power", strengthStrong: "ahead", strengthEven: "even", strengthWeak: "behind",
    yourNation: "You rule",
    thisTurn: "This turn", firstTurn: "First turn", cellsLost: " lost",
    border: "borders", truce: "truces", vs: "vs",
    goals: "Goals", goalRivals: "rivals",
    fxFortify: "frontier cohesion ▲ · interior ▼", fxNoTarget: "no target to strike",
    fxOdds: "{p}% success", fxFail: "fail",
    fxTruceBreak: "breaks the truce", fxTruceGain: "truce +1 (10y)",
    fxOwn: "your action", fxCityNext: "city #{n} planned",
    advFound: "🏘 found city", advPeace: "🕊 peace",
    advanceAlertTip: "An unanswered card expires with the decade.",
    adviseAct: "Do it", adviseStance: "Go defensive",
  },
  ko: {
    chooseRealm: "국가를 선택하세요", cells: "셀", cohesion: "결속", threats: "위협",
    diffEasy: "쉬움", diffNormal: "보통", diffHard: "어려움",
    civilWarRisk: "내전 위험", fallen: "멸망",
    aggressive: "공격적", defensive: "방어적", internal: "내치",
    noAction: "행동 없음 (넘기기)", attackChosen: "⚔ 공격 지정됨 ✓",
    investRealmChosen: "💰 투자: 전국 ✓", investFrontierChosen: "💰 투자: 국경 ✓",
    foundChosen: "🏘 도시 건설 지정됨 ✓", peaceChosen: "🕊 강화 지정됨 ✓",
    peacePlaceholder: "— 🕊 강화 요청 —",
    investRealmOpt: "전국", investFrontierOpt: "국경",
    tipInvest: "영지 결속을 즉시 올립니다(일회성, 이후 자연 감쇠). 국경 = 전투 직결, 전국 = 내전 예방.",
    tipPeace: "선택한 이웃과 30년 불가침. 내가 먼저 공격하면 파기됩니다.",
    tipStrength: "내 영토(셀 수)를 이웃 세력 평균과 비교합니다. 앞서면 우세, 밀리면 열세.",
    tipCohesion: "결속이 낮으면 전투에서 약해져 땅을 잃기 쉽습니다. 나라가 크고 결속까지 낮으면 내란으로 분열될 수 있습니다. 투자(💰)나 내치 태세로 회복합니다.",
    tipThreat: "국경에 맞닿은 적국 수. 많을수록 침공 압박이 커집니다.",
    cohWeak: "약해짐",
    advance: "다음 해로 ▶", pass: "패스", endured: "당신은 500년을 버텼습니다.",
    winConquest: "당신은 천하를 통일했습니다.", winProsperity: "당신의 나라가 황금기를 이루었습니다.",
    reignExport: "📜 치세 연대기", playAgain: "▶ 다시 통치", newWorld: "🌍 새 세계",
    howtoTitle: "통치 안내", howtoStart: "▶ 통치 시작", help: "?",
    howto1: "목표: 500년까지 살아남기 — 수도를 빼앗기면 멸망합니다.",
    howto2: "한 턴은 10년: 태세는 언제든 무료로 바꾸고, 행동은 하나만 — 지도를 클릭하거나 목록에서 고르세요.",
    howto3: "지도: 초록 = 공격해 얻을 구역 · 파랑 = 바다 건너 상륙 · 금색 = 도시 부지 · 붉은 선 = 위험한 국경.",
    howto4: "결속은 나라의 체력입니다. 낮으면 내전과 침식이 옵니다 — 투자나 내치 태세로 회복하세요.",
    solStable: "안정", solShaky: "불안", solDanger: "위험",
    tipAggressive: "공격 강화 · 결속 서서히 감소", tipDefensive: "수비 강화 · 확장 둔화", tipInternal: "결속 회복 · 확장 억제",
    adviceLowSol: "💡 결속이 낮습니다 — 투자하거나 내치 태세로 회복하세요.",
    adviceDefend: "💡 국경이 밀리고 있습니다 — 방어 태세로 바꾸고 국경에 투자하세요.",
    adviceExpand: "💡 확장의 적기입니다 — 지도의 초록 구역을 클릭해 공격하세요.",
    adviceBuild: "💡 정세가 안정적입니다 — 금색 셀에 도시를 세워 기반을 다지세요.",
    legendPush: "점령 가능 구역", legendSea: "상륙 지점", legendSite: "도시 부지", legendThreat: "위험 국경", legendCity: "내 도시",
    strength: "국력", strengthStrong: "우세", strengthEven: "균형", strengthWeak: "열세",
    yourNation: "당신의 국가",
    thisTurn: "이번 턴", firstTurn: "첫 턴", cellsLost: "셀 상실",
    border: "국경 접촉", truce: "휴전", vs: "vs",
    goals: "목표", goalRivals: "라이벌",
    fxFortify: "국경 결속 ▲ · 내지 ▼", fxNoTarget: "칠 곳 없음",
    fxOdds: "성공 {p}%", fxFail: "실패",
    fxTruceBreak: "휴전 파기", fxTruceGain: "휴전 +1 (10년)",
    fxOwn: "내 행동 효과", fxCityNext: "{n}번째 도시 예정",
    advFound: "🏘 도시 건설", advPeace: "🕊 강화",
    advanceAlertTip: "답하지 않은 카드는 이 턴이 끝나면 사라집니다.",
    adviseAct: "실행", adviseStance: "방어 태세로",
  },
};
export function playT(lang: Lang, key: string): string {
  return PLAY_UI[lang][key] ?? PLAY_UI.en[key] ?? key;
}
// the localized effect line under a dilemma choice, composed from its read-only preview
export function playDilemmaFx(lang: Lang, pv: ChoicePreview): string {
  if (pv.note === "fortify") return playT(lang, "fxFortify");
  if (pv.note === "noTarget") return playT(lang, "fxNoTarget");
  const parts: string[] = [];
  if (pv.cells) {
    const glyph = pv.cells > 0 ? `▲+${pv.cells}` : `▼${-pv.cells}`;
    parts.push(`${playT(lang, "strength")} ${glyph}${playT(lang, "cells")}`);
  }
  if (pv.cohesion) {
    const up = pv.cohesion > 0;
    const glyph = up ? "▲".repeat(pv.cohesion) : "▼".repeat(-pv.cohesion);
    const line = `${playT(lang, "cohesion")} ${glyph}`;
    parts.push(pv.odds === undefined ? line
      : `${playT(lang, "fxOdds").replace("{p}", String(Math.round(pv.odds * 100)))}: ${line} / ${playT(lang, "fxFail")}: ${up ? "▼" : "▲"}`);
  }
  if (pv.truce === "break") parts.push(playT(lang, "fxTruceBreak"));
  if (pv.truce === "gain") parts.push(playT(lang, "fxTruceGain"));
  return parts.join(" · ");
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
// Reigns-style dilemma cards: title + the two choices, per dilemma code
export function playDilemma(lang: Lang, code: string, data: Record<string, string | number> = {}): { title: string; a: string; b: string } {
  const name = String(data.name ?? "");
  if (lang === "ko") {
    switch (code) {
      case "unrest": return { title: "제후들의 불만이 끓어오릅니다.", a: "변경 영지를 양보한다 (영토 −, 결속 +)", b: "강경 진압한다 (도박)" };
      case "raiders": return { title: "국경에 습격이 잇따릅니다.", a: "국경을 요새화한다 (국경 결속 +)", b: "보복 원정을 보낸다 (무료 공격)" };
      case "prosperity": return { title: "나라에 풍년이 들었습니다.", a: "대축제를 연다 (전국 결속 +)", b: "변경 개척에 투자한다 (국경 결속 +)" };
      case "defector": return { title: `${name}의 제후가 망명을 청합니다.`, a: "받아들인다 (영지 획득, 관계 악화)", b: "돌려보낸다 (10년 불가침)" };
    }
  }
  switch (code) {
    case "unrest": return { title: "The lords seethe with discontent.", a: "Concede border fiefs (lose land, regain cohesion)", b: "Crush them (a gamble)" };
    case "raiders": return { title: "Raiders harry the frontier.", a: "Fortify the border (frontier cohesion +)", b: "Send a punitive raid (free strike)" };
    case "prosperity": return { title: "The realm prospers.", a: "Hold a great festival (realm cohesion +)", b: "Fund the frontier (border cohesion +)" };
    case "defector": return { title: `A lord of ${name} begs asylum.`, a: "Take them in (gain their fief, sour relations)", b: "Send them back (10-year non-aggression)" };
  }
  return { title: code, a: "A", b: "B" };
}
export function playDilemmaOutcome(lang: Lang, code: string, data: Record<string, string | number> = {}): string {
  const name = String(data.name ?? "");
  const n = Number(data.n ?? 0);
  if (lang === "ko") {
    switch (code) {
      case "unrestConcede": return `변경 ${n}개 영지를 양보했다. 민심이 가라앉는다.`;
      case "unrestCrushOk": return "반란의 싹을 잘랐다. 권위가 섰다.";
      case "unrestCrushFail": return "진압이 역효과를 냈다. 민심이 흉흉하다.";
      case "raidersFortify": return `국경 ${n}개 셀을 요새화했다.`;
      case "raidersRaid": return `보복 원정이 ${name}에게서 셀 ${n}개를 빼앗았다.`;
      case "raidersNoTarget": return "원정대가 마땅한 목표를 찾지 못했다.";
      case "prosperityFeast": return "대축제가 열렸다. 온 나라가 하나가 된다.";
      case "prosperityFrontier": return `변경 ${n}개 셀에 개척민이 들어섰다.`;
      case "defectorAccept": return `${name}의 영지가 귀부했다.`;
      case "defectorReturn": return `${name}이(가) 10년 불가침을 약속했다.`;
      default: return "";
    }
  }
  switch (code) {
    case "unrestConcede": return `Conceded ${n} border fiefs; the realm breathes again.`;
    case "unrestCrushOk": return "The unrest was crushed; authority holds.";
    case "unrestCrushFail": return "The crackdown backfired; resentment spreads.";
    case "raidersFortify": return `Fortified ${n} border cells.`;
    case "raidersRaid": return `The punitive raid took ${n} cells from ${name}.`;
    case "raidersNoTarget": return "The raiders found no worthy target.";
    case "prosperityFeast": return "A great festival unites the realm.";
    case "prosperityFrontier": return `Settlers strengthen ${n} frontier cells.`;
    case "defectorAccept": return `The defecting fief joins you, angering ${name}.`;
    case "defectorReturn": return `${name} pledges 10 years of peace.`;
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
