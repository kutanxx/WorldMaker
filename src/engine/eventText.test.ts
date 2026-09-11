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
  // (자샤인이 카악을, 자샤인이 다이시다르를) — "Zashain" reads 자샤인, not 자사인: `sh` before a
  // vowel takes a Korean glide (hangul.ts's `glideVowel`), the same treatment `Zaiashain` gets in
  // nameSuffix.test.ts, which is also why "Sashaish" below reads 사샤이시, not 사사이시.

  it("reproduces seed 1's chronicle line for line", () => {
    const h = simulateHistory(build(1), 1);
    expect(h.events.map((e) => eventText(e, h.polities, "ko"))).toEqual([
      "0년, 다이시다르 건국",
      "0년, 코르브룩 건국",
      "0년, 케우스두 건국",
      "0년, 스루스카 건국",
      "0년, 카아르그루스 건국",
      "0년, 자샤인 건국",
      "0년, 카악 건국",
      "0년, 라엘마에르 건국",
      "0년, 사인카이시 자유무역항 지정",
      "0년, 그라우르크 자유무역항 지정",
      "0년, 카인자즈 자유무역항 지정",
      "10년, 다이시다르 황금기 도래",
      "20년, 케우스두 황금기 도래",
      "20년, 카악이 구그르카우스 건설",
      "30년, 자샤인 황금기 도래",
      "30년, 스루스카가 카아크그루르 건설",
      "40년, 라엘마에르가 코르브룩을 정복",
      "40년, 라엘마에르 황금기 도래",
      "40년, 케우스두가 트레로이스 건설",
      "50년, 자유도시 카인자즈 독립 선포",
      "50년, 카아르그루스가 흐린드 건설",
      "70년, 스루스카가 브라그르 건설",
      "90년, 자샤인이 카악을 정복",
      "100년, 자유도시 키오르 독립 선포",
      "100년, 스루스카 황금기 도래",
      "110년, 스루스카가 드루르 건설",
      "270년, 내란이 케우스두를 넨미아로 쪼갬",
      "280년, 내란이 다이시다르를 트릴피아·글란디아르크로 쪼갬",
      "320년, 자유도시 아엘메이르 독립 선포",
      "340년, 넨미아가 키오르 건설",
      "350년, 내란이 라엘마에르를 수보우르크·브라엘펨으로 쪼갬",
      "350년, 트릴피아가 브라우르스베이 건설",
      "360년, 다이시다르가 지아시다르 건설",
      "380년, 다이시다르가 다인샤아스 건설",
      "390년, 케우스두가 카인자즈 건설",
      "410년, 내란이 다이시다르를 스타셀·스티아르클룬드로 쪼갬",
      "410년, 브라엘펨 황금기 도래",
      "410년, 다이시다르가 카안다아 건설",
      "420년, 라엘마에르가 스루스카를 정복",
      "420년, 내란이 라엘마에르를 리르스투로 쪼갬",
      "420년, 넨미아가 샤이흐 건설",
      "430년, 리르스투가 그루오그르가우 건설",
      "440년, 라엘마에르가 마에르 건설",
      "450년, 수보우르크가 엘라엔 건설",
      "470년, 브라엘펨이 랴스니아르 건설",
      "480년, 넨미아가 아엘메이르 건설",
      "490년, 넨미아가 그루르크 건설",
      "500년, 수보우르크가 자즈사시 건설",
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
      "Year 0 — Khainzaz is named a free port",
      "Year 10 — a golden age dawns in Dhaishdhar",
      "Year 20 — a golden age dawns in Ceusdu",
      "Year 20 — Khaak founds Gugrkauth",
      "Year 30 — a golden age dawns in Zashain",
      "Year 30 — Thruthkha founds Khaakgrur",
      "Year 40 — Laelmaer conquers Korvruk",
      "Year 40 — a golden age dawns in Laelmaer",
      "Year 40 — Ceusdu founds Trerois",
      "Year 50 — the free city of Khainzaz declares independence",
      "Year 50 — Kaargruth founds Hrynd",
      "Year 70 — Thruthkha founds Vragr",
      "Year 90 — Zashain conquers Khaak",
      "Year 100 — the free city of Cior declares independence",
      "Year 100 — a golden age dawns in Thruthkha",
      "Year 110 — Thruthkha founds Drur",
      "Year 270 — civil war splits Ceusdu into Nenmia",
      "Year 280 — civil war splits Dhaishdhar into Trilfia and Glandiark",
      "Year 320 — the free city of Aelmeir declares independence",
      "Year 340 — Nenmia founds Cior",
      "Year 350 — civil war splits Laelmaer into Suvourk and Braelfem",
      "Year 350 — Trilfia founds Braursvei",
      "Year 360 — Dhaishdhar founds Ziashdhar",
      "Year 380 — Dhaishdhar founds Dhainshaas",
      "Year 390 — Ceusdu founds Khainzaz",
      "Year 410 — civil war splits Dhaishdhar into Stasel and Stiarklund",
      "Year 410 — a golden age dawns in Braelfem",
      "Year 410 — Dhaishdhar founds Khaandhaa",
      "Year 420 — Laelmaer conquers Thruthkha",
      "Year 420 — civil war splits Laelmaer into Rirstu",
      "Year 420 — Nenmia founds Shaih",
      "Year 430 — Rirstu founds Gruogrggau",
      "Year 440 — Laelmaer founds Maer",
      "Year 450 — Suvourk founds Elaen",
      "Year 470 — Braelfem founds Lyathniar",
      "Year 480 — Nenmia founds Aelmeir",
      "Year 490 — Nenmia founds Grurk",
      "Year 500 — Suvourk founds Zazsash",
    ]);
  });

  it("says nothing in Korean", () => {
    const h = simulateHistory(build(1), 1);
    // the count is not what this is for — it only has to be enough that the loop below asserts
    // something. Pinning it broke this test when the towns moved, which says nothing about whether
    // an English sentence came out in Korean.
    expect(h.events.length, "no events to check").toBeGreaterThan(20);
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
