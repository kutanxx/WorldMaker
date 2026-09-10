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

describe("eventText — Korean, and written in Korean", () => {
  // The across-seeds equivalence check lived here while `HistoryEvent.text` still existed. It is
  // now the events golden anchor in history.test.ts, which folds this exact rendering on seeds
  // 1, 2 and 3.
  //
  // These lines used to be the sentences the simulation itself built, Latin names and all
  // ("0년, Dhaishdhar 건국"). The names are written in Hangul now, which is the whole point of the
  // change: a Korean reader was being handed a Korean sentence with an English word in the middle
  // of it. NOTHING ELSE about the list moved — the same fifty events, in the same years, in the
  // same order, with the same verbs — and the particles still agree with the name they follow
  // (자사인이 카악을, 자사인이 다이시다르를).

  it("reproduces seed 1's chronicle line for line", () => {
    const h = simulateHistory(build(1), 1);
    expect(h.events.map((e) => eventText(e, h.polities, "ko"))).toEqual([
      "0년, 다이시다르 건국",
      "0년, 코르브룩 건국",
      "0년, 케우스두 건국",
      "0년, 스루스카 건국",
      "0년, 카아르그루스 건국",
      "0년, 자사인 건국",
      "0년, 카악 건국",
      "0년, 라엘마에르 건국",
      "0년, 사인카이시 자유무역항 지정",
      "0년, 그라우르크 자유무역항 지정",
      "0년, 흐레이르 자유무역항 지정",
      "10년, 다이시다르 황금기 도래",
      "20년, 케우스두 황금기 도래",
      "20년, 카아르그루스가 그룩 건설",
      "30년, 자사인 황금기 도래",
      "30년, 케우스두가 코리오르베안 건설",
      "40년, 라엘마에르가 코르브룩을 정복",
      "40년, 라엘마에르 황금기 도래",
      "40년, 다이시다르가 지아시다르 건설",
      "50년, 카악이 그라르 건설",
      "60년, 카악이 사사이시 건설",
      "90년, 자사인이 카악을 정복",
      "90년, 내란이 라엘마에르를 리아디아르·시아르브로르크로 쪼갬",
      "90년, 시아르브로르크가 엘라르샨 건설",
      "130년, 자유도시 흐레이르 독립 선포",
      "130년, 리아디아르가 샨셴 건설",
      "140년, 리아디아르가 멜리알라에 건설",
      "150년, 시아르브로르크 황금기 도래",
      "250년, 스루스카 황금기 도래",
      "260년, 자유도시 자즈사시 독립 선포",
      "260년, 시아르브로르크가 바슬리스 건설",
      "270년, 내란이 자사인을 스티르크판드·미아란드로 쪼갬",
      "300년, 미아란드가 사아르 건설",
      "320년, 자사인이 다이시다르를 정복",
      "320년, 스티르크판드가 자즈사시 건설",
      "340년, 미아란드가 다아자이흐 건설",
      "350년, 스티르크판드가 리에르미올 건설",
      "360년, 미아란드가 아엘메이르 건설",
      "380년, 내란이 자사인을 룬브리스·스타에스포움으로 쪼갬",
      "380년, 스타에스포움 황금기 도래",
      "380년, 자사인이 자라이르 건설",
      "400년, 자유도시 코리오르베안 독립 선포",
      "400년, 스티르크판드가 코라이스 건설",
      "410년, 스티르크판드가 드루르 건설",
      "420년, 자사인이 미아란드를 정복",
      "420년, 스타에스포움이 시키 건설",
      "430년, 자사인이 케우스두를 정복",
      "440년, 룬브리스가 흐레이르 건설",
      "460년, 자유도시 카아그 독립 선포",
      "500년, 스타에스포움이 스로르구그르 건설",
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
      "Year 0 — Thruthkha is founded",
      "Year 0 — Kaargruth is founded",
      "Year 0 — Zashain is founded",
      "Year 0 — Khaak is founded",
      "Year 0 — Laelmaer is founded",
      "Year 0 — Sainkhaish is named a free port",
      "Year 0 — Graurk is named a free port",
      "Year 0 — Hreir is named a free port",
      "Year 10 — a golden age dawns in Dhaishdhar",
      "Year 20 — a golden age dawns in Ceusdu",
      "Year 20 — Kaargruth founds Gruk",
      "Year 30 — a golden age dawns in Zashain",
      "Year 30 — Ceusdu founds Coriorvean",
      "Year 40 — Laelmaer conquers Korvruk",
      "Year 40 — a golden age dawns in Laelmaer",
      "Year 40 — Dhaishdhar founds Ziashdhar",
      "Year 50 — Khaak founds Grar",
      "Year 60 — Khaak founds Sashaish",
      "Year 90 — Zashain conquers Khaak",
      "Year 90 — civil war splits Laelmaer into Riadiar and Thiarbrork",
      "Year 90 — Thiarbrork founds Elarsyan",
      "Year 130 — the free city of Hreir declares independence",
      "Year 130 — Riadiar founds Syansyen",
      "Year 140 — Riadiar founds Melialae",
      "Year 150 — a golden age dawns in Thiarbrork",
      "Year 250 — a golden age dawns in Thruthkha",
      "Year 260 — the free city of Zazsash declares independence",
      "Year 260 — Thiarbrork founds Vathlith",
      "Year 270 — civil war splits Zashain into Stirkfand and Miarand",
      "Year 300 — Miarand founds Saar",
      "Year 320 — Zashain conquers Dhaishdhar",
      "Year 320 — Stirkfand founds Zazsash",
      "Year 340 — Miarand founds Dhaazaih",
      "Year 350 — Stirkfand founds Liermiol",
      "Year 360 — Miarand founds Aelmeir",
      "Year 380 — civil war splits Zashain into Lunbris and Staethfoum",
      "Year 380 — a golden age dawns in Staethfoum",
      "Year 380 — Zashain founds Zarair",
      "Year 400 — the free city of Coriorvean declares independence",
      "Year 400 — Stirkfand founds Corais",
      "Year 410 — Stirkfand founds Drur",
      "Year 420 — Zashain conquers Miarand",
      "Year 420 — Staethfoum founds Thykhy",
      "Year 430 — Zashain conquers Ceusdu",
      "Year 440 — Lunbris founds Hreir",
      "Year 460 — the free city of Khaagg declares independence",
      "Year 500 — Staethfoum founds Throrgugr",
    ]);
  });

  it("says nothing in Korean", () => {
    const h = simulateHistory(build(1), 1);
    expect(h.events.length).toBe(50);
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
    // The particle follows the name AS WRITTEN, and transliteration is what decides that: "Dhaish"
    // reads as closing on a consonant in Latin and took 으로 before, while 다이시 is an open
    // syllable and takes 로.
    expect(eventText(war([1, 2, 3]), pols, "ko"))
      .toBe("300년, 내란이 아엘사를 브린·코르란·다이시로 쪼갬");
  });

  it("picks the Korean particle from the name's final sound", () => {
    // 받침 있는 이름 → 을, 없는 이름 → 를. Which names those ARE changed with the transliteration,
    // and the fixture had to change with it: "Khokgraur" closes on a consonant as Latin but is
    // written 코크그라우르, whose last syllable is open — 를, and correctly so, exactly as Korean
    // writes 카이사르를. A name that closes in Hangul has to end in a real 받침, so 카악 takes over
    // the 을 half of this test.
    const closed = [P(0, "Vaealelael"), P(1, "Khaak")];
    const open = [P(0, "Vaealelael"), P(1, "Kaarkgruau")];
    const conquer = (year: number): HistoryEvent =>
      ({ year, type: "conquer", polityId: 0, otherId: 1 });
    expect(eventText(conquer(30), closed, "ko")).toBe("30년, 바에알렐라엘이 카악을 정복");
    expect(eventText(conquer(70), open, "ko")).toBe("70년, 바에알렐라엘이 카아르크그루아우를 정복");
  });

  it("prints an unknown id rather than throwing", () => {
    const orphan: HistoryEvent = { year: 10, type: "conquer", polityId: 0, otherId: 99 };
    expect(() => eventText(orphan, pols, "en")).not.toThrow();
    expect(eventText(orphan, pols, "en")).toBe("Year 10 — Aeltha conquers 99");
  });
});
