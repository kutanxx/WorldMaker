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
      "0년, Thruthkha 건국",
      "0년, Kaargruth 건국",
      "0년, Zashain 건국",
      "0년, Khaak 건국",
      "0년, Laelmaer 건국",
      "0년, Sainkhaish 자유무역항 지정",
      "0년, Graurk 자유무역항 지정",
      "0년, Hreir 자유무역항 지정",
      "10년, Dhaishdhar 황금기 도래",
      "20년, Ceusdu 황금기 도래",
      "20년, Kaargruth이 Gruk 건설",
      "30년, Zashain 황금기 도래",
      "30년, Ceusdu가 Coriorvean 건설",
      "40년, Laelmaer이 Korvruk을 정복",
      "40년, Laelmaer 황금기 도래",
      "40년, Dhaishdhar이 Ziashdhar 건설",
      "50년, Khaak이 Grar 건설",
      "60년, Khaak이 Sashaish 건설",
      "90년, Zashain이 Khaak을 정복",
      "90년, 내란이 Laelmaer을 Riadiar·Thiarbrork으로 쪼갬",
      "90년, Thiarbrork이 Elarsyan 건설",
      "130년, 자유도시 Hreir 독립 선포",
      "130년, Riadiar이 Syansyen 건설",
      "140년, Riadiar이 Melialae 건설",
      "150년, Thiarbrork 황금기 도래",
      "250년, Thruthkha 황금기 도래",
      "260년, 자유도시 Zazsash 독립 선포",
      "260년, Thiarbrork이 Vathlith 건설",
      "270년, 내란이 Zashain을 Stirkfand·Miarand으로 쪼갬",
      "300년, Miarand이 Saar 건설",
      "320년, Zashain이 Dhaishdhar을 정복",
      "320년, Stirkfand이 Zazsash 건설",
      "340년, Miarand이 Dhaazaih 건설",
      "350년, Stirkfand이 Liermiol 건설",
      "360년, Miarand이 Aelmeir 건설",
      "380년, 내란이 Zashain을 Lunbris·Staethfoum으로 쪼갬",
      "380년, Staethfoum 황금기 도래",
      "380년, Zashain이 Zarair 건설",
      "400년, 자유도시 Coriorvean 독립 선포",
      "400년, Stirkfand이 Corais 건설",
      "410년, Stirkfand이 Drur 건설",
      "420년, Zashain이 Miarand을 정복",
      "420년, Staethfoum이 Thykhy 건설",
      "430년, Zashain이 Ceusdu를 정복",
      "440년, Lunbris이 Hreir 건설",
      "460년, 자유도시 Khaagg 독립 선포",
      "500년, Staethfoum이 Throrgugr 건설",
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
