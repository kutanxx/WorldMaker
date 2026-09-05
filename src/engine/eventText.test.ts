import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { simulateHistory } from "./history";
import { eventText } from "./eventText";
import type { HistoryEvent, HistoryPolity } from "./historySim";

const build = (seed: number) => generateWorld({ ...DEFAULT_PARAMS, seed }).world;

// A minimal polity is enough for the renderer: it only ever reads `name`.
const P = (id: number, name: string): HistoryPolity =>
  ({ id, name, color: "#000", capital: 0, foundedYear: 0, endedYear: null, origin: "initial", free: false });

describe("eventText — Korean is byte-identical to what the simulation used to write", () => {
  // The across-seeds equivalence check lived here while `HistoryEvent.text` still existed. It is
  // now the events golden anchor in history.test.ts, which folds this exact rendering on seeds
  // 1, 2 and 3 and reproduces its pre-existing pinned values.

  it("reproduces seed 1's chronicle line for line", () => {
    const h = simulateHistory(build(1), 1);
    expect(h.events.map((e) => eventText(e, h.polities, "ko"))).toEqual([
      "0년, Dhaishdhar 건국",
      "0년, Korvruk 건국",
      "0년, Ceusdu 건국",
      "0년, Thruthkhagg 건국",
      "0년, Skaurnhreir 건국",
      "0년, Liusduan 건국",
      "0년, Khaakak 건국",
      "0년, Kragrgragg 건국",
      "0년, Truanmu 자유무역항 지정",
      "0년, Veirn 자유무역항 지정",
      "0년, Shaih 자유무역항 지정",
      "10년, Dhaishdhar 황금기 도래",
      "20년, Ceusdu 황금기 도래",
      "20년, Skaurnhreir이 Noun 건설",
      "30년, Liusduan 황금기 도래",
      "30년, Ceusdu가 Thu 건설",
      "40년, Kragrgragg이 Korvruk을 정복",
      "40년, Kragrgragg 황금기 도래",
      "40년, Dhaishdhar이 Stothglaem 건설",
      "50년, Khaakak이 Kom 건설",
      "60년, Liusduan이 Khaakak을 정복",
      "70년, 내란이 Dhaishdhar을 Sornaerk으로 쪼갬",
      "90년, 내란이 Kragrgragg을 Lirkthand·Kalfoum으로 쪼갬",
      "90년, Sornaerk이 Mork 건설",
      "120년, Kragrgragg이 Thruthkhagg을 정복",
      "130년, Dhaishdhar이 Ceusdu를 정복",
      "130년, 자유도시 Shaih 독립 선포",
      "130년, Kalfoum 황금기 도래",
      "130년, Kragrgragg이 Stundiark 건설",
      "140년, Kragrgragg이 Larktri 건설",
      "230년, Kalfoum이 Sulian 건설",
      "250년, 내란이 Kragrgragg을 Rirkaen으로 쪼갬",
      "250년, Rirkaen이 Naes 건설",
      "270년, Rirkaen이 Skaurnhreir을 정복",
      "300년, 자유도시 Roismuor 독립 선포",
      "320년, Kragrgragg이 Kalfoum을 정복",
      "330년, 내란이 Kragrgragg을 Kethtrous·Kubral로 쪼갬",
      "330년, Kethtrous 황금기 도래",
      "330년, Kragrgragg이 Stoun 건설",
      "350년, Kethtrous이 Liusduan을 정복",
      "350년, 자유도시 Truanmu 독립 선포",
      "360년, Kragrgragg이 Rirkaen을 정복",
      "360년, 내란이 Dhaishdhar을 Rounstoth·Moundfous으로 쪼갬",
      "360년, Moundfous 황금기 도래",
      "370년, 자유도시 Veirn 독립 선포",
      "370년, Kragrgragg이 Nathstaeth 건설",
      "380년, Dhaishdhar이 Foum 건설",
      "390년, Dhaishdhar이 Sornaerk을 정복",
      "390년, Kubral이 Trem 건설",
      "410년, Kubral이 Sourlol 건설",
      "420년, Kragrgragg이 Trourk 건설",
      "440년, Dhaishdhar이 Ron 건설",
      "450년, Kubral이 Lirkthand을 정복",
      "480년, Kragrgragg이 Nolkaen 건설",
      "490년, Moundfous이 Glath 건설",
      "500년, Moundfous이 Viasmaer 건설",
    ]);
  });
});

describe("eventText — English", () => {
  it("tells seed 1's chronicle in the gazetteer's own voice", () => {
    const h = simulateHistory(build(1), 1);
    expect(h.events.map((e) => eventText(e, h.polities, "en"))).toEqual([
      "Year 0 — Dhaishdhar is founded",
      "Year 0 — Korvruk is founded",
      "Year 0 — Ceusdu is founded",
      "Year 0 — Thruthkhagg is founded",
      "Year 0 — Skaurnhreir is founded",
      "Year 0 — Liusduan is founded",
      "Year 0 — Khaakak is founded",
      "Year 0 — Kragrgragg is founded",
      "Year 0 — Truanmu is named a free port",
      "Year 0 — Veirn is named a free port",
      "Year 0 — Shaih is named a free port",
      "Year 10 — a golden age dawns in Dhaishdhar",
      "Year 20 — a golden age dawns in Ceusdu",
      "Year 20 — Skaurnhreir founds Noun",
      "Year 30 — a golden age dawns in Liusduan",
      "Year 30 — Ceusdu founds Thu",
      "Year 40 — Kragrgragg conquers Korvruk",
      "Year 40 — a golden age dawns in Kragrgragg",
      "Year 40 — Dhaishdhar founds Stothglaem",
      "Year 50 — Khaakak founds Kom",
      "Year 60 — Liusduan conquers Khaakak",
      "Year 70 — civil war splits Dhaishdhar into Sornaerk",
      "Year 90 — civil war splits Kragrgragg into Lirkthand and Kalfoum",
      "Year 90 — Sornaerk founds Mork",
      "Year 120 — Kragrgragg conquers Thruthkhagg",
      "Year 130 — Dhaishdhar conquers Ceusdu",
      "Year 130 — the free city of Shaih declares independence",
      "Year 130 — a golden age dawns in Kalfoum",
      "Year 130 — Kragrgragg founds Stundiark",
      "Year 140 — Kragrgragg founds Larktri",
      "Year 230 — Kalfoum founds Sulian",
      "Year 250 — civil war splits Kragrgragg into Rirkaen",
      "Year 250 — Rirkaen founds Naes",
      "Year 270 — Rirkaen conquers Skaurnhreir",
      "Year 300 — the free city of Roismuor declares independence",
      "Year 320 — Kragrgragg conquers Kalfoum",
      "Year 330 — civil war splits Kragrgragg into Kethtrous and Kubral",
      "Year 330 — a golden age dawns in Kethtrous",
      "Year 330 — Kragrgragg founds Stoun",
      "Year 350 — Kethtrous conquers Liusduan",
      "Year 350 — the free city of Truanmu declares independence",
      "Year 360 — Kragrgragg conquers Rirkaen",
      "Year 360 — civil war splits Dhaishdhar into Rounstoth and Moundfous",
      "Year 360 — a golden age dawns in Moundfous",
      "Year 370 — the free city of Veirn declares independence",
      "Year 370 — Kragrgragg founds Nathstaeth",
      "Year 380 — Dhaishdhar founds Foum",
      "Year 390 — Dhaishdhar conquers Sornaerk",
      "Year 390 — Kubral founds Trem",
      "Year 410 — Kubral founds Sourlol",
      "Year 420 — Kragrgragg founds Trourk",
      "Year 440 — Dhaishdhar founds Ron",
      "Year 450 — Kubral conquers Lirkthand",
      "Year 480 — Kragrgragg founds Nolkaen",
      "Year 490 — Moundfous founds Glath",
      "Year 500 — Moundfous founds Viasmaer",
    ]);
  });

  it("says nothing in Korean", () => {
    const h = simulateHistory(build(1), 1);
    expect(h.events.length).toBe(56);
    for (const e of h.events) expect(eventText(e, h.polities, "en")).not.toMatch(/[가-힣]/);
  });
});

describe("eventText — the parts a single seed does not exercise", () => {
  const pols = [P(0, "Aeltha"), P(1, "Bryn"), P(2, "Corran"), P(3, "Dhaish")];
  const war = (intoIds: number[]): HistoryEvent =>
    ({ year: 300, type: "civilwar", polityId: 0, intoIds });

  it("joins three successors as a sentence, not as an array", () => {
    expect(eventText(war([1, 2, 3]), pols, "en"))
      .toBe("Year 300 — civil war splits Aeltha into Bryn, Corran and Dhaish");
    // "Dhaish" closes on a consonant and is not ㄹ, so it takes 으로. (The ㄹ exception — a name
    // ending in l/r takes 로 — is covered by seed 1's real line, "…Thaendfoul로 쪼갬".)
    expect(eventText(war([1, 2, 3]), pols, "ko"))
      .toBe("300년, 내란이 Aeltha를 Bryn·Corran·Dhaish으로 쪼갬");
  });

  it("picks the Korean particle from the name's final sound", () => {
    // 받침 있는 이름 → 을, 없는 이름 → 를; and the civil-war particle follows the LAST successor.
    const consonant = [P(0, "Vaealelael"), P(1, "Khokgraur")];
    const vowel = [P(0, "Vaealelael"), P(1, "Kaarkgruau")];
    const conquer = (year: number): HistoryEvent =>
      ({ year, type: "conquer", polityId: 0, otherId: 1 });
    expect(eventText(conquer(30), consonant, "ko")).toBe("30년, Vaealelael이 Khokgraur을 정복");
    expect(eventText(conquer(70), vowel, "ko")).toBe("70년, Vaealelael이 Kaarkgruau를 정복");
  });

  it("prints an unknown id rather than throwing", () => {
    const orphan: HistoryEvent = { year: 10, type: "conquer", polityId: 0, otherId: 99 };
    expect(() => eventText(orphan, pols, "en")).not.toThrow();
    expect(eventText(orphan, pols, "en")).toBe("Year 10 — Aeltha conquers 99");
  });
});
