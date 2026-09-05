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
  // The temporary equivalence proof. `text` is removed in the next task; from then on the events
  // golden anchor in history.test.ts enforces this same property across seeds 1, 2 and 3.
  for (const seed of [1, 2, 3]) {
    it(`reproduces every recorded sentence on seed ${seed}`, () => {
      const h = simulateHistory(build(seed), seed);
      expect(h.events.length).toBeGreaterThan(0);
      for (const e of h.events) expect(eventText(e, h.polities, "ko")).toBe(e.text);
    });
  }

  it("reproduces seed 1's chronicle line for line", () => {
    const h = simulateHistory(build(1), 1);
    expect(h.events.map((e) => eventText(e, h.polities, "ko"))).toEqual([
      "0년, Dhaishdhar 건국",
      "0년, Korvruk 건국",
      "0년, Khokgraur 건국",
      "0년, Bryrbrok 건국",
      "0년, Kaarkgruau 건국",
      "0년, Zaiashain 건국",
      "0년, Vaealelael 건국",
      "0년, Fovok 건국",
      "0년, Forthor 자유무역항 지정",
      "0년, Eleir 자유무역항 지정",
      "0년, Sah 자유무역항 지정",
      "10년, Korvruk 황금기 도래",
      "20년, Bryrbrok 황금기 도래",
      "20년, Vaealelael이 Noun 건설",
      "30년, Vaealelael이 Khokgraur을 정복",
      "30년, Zaiashain 황금기 도래",
      "30년, Vaealelael이 Thu 건설",
      "40년, Vaealelael 황금기 도래",
      "60년, Vaealelael이 Stothglaem 건설",
      "70년, Korvruk이 Kaarkgruau를 정복",
      "80년, Zaiashain이 Fovok을 정복",
      "120년, Vaealelael이 Korvruk을 정복",
      "140년, 내란이 Zaiashain을 Komtros·Thaendfoul로 쪼갬",
      "140년, Thaendfoul이 Lan 건설",
      "170년, Zaiashain이 Dhaishdhar을 정복",
      "180년, Thaendfoul이 Kal 건설",
      "190년, 자유도시 Sah 독립 선포",
      "200년, Zaiashain이 Lulfia 건설",
      "320년, 자유도시 Graurk 독립 선포",
      "330년, 자유도시 Eleirlieiel 독립 선포",
      "430년, 자유도시 Meleil 독립 선포",
    ]);
  });
});

describe("eventText — English", () => {
  it("tells seed 1's chronicle in the gazetteer's own voice", () => {
    const h = simulateHistory(build(1), 1);
    expect(h.events.map((e) => eventText(e, h.polities, "en"))).toEqual([
      "Year 0 — Dhaishdhar is founded",
      "Year 0 — Korvruk is founded",
      "Year 0 — Khokgraur is founded",
      "Year 0 — Bryrbrok is founded",
      "Year 0 — Kaarkgruau is founded",
      "Year 0 — Zaiashain is founded",
      "Year 0 — Vaealelael is founded",
      "Year 0 — Fovok is founded",
      "Year 0 — Forthor is named a free port",
      "Year 0 — Eleir is named a free port",
      "Year 0 — Sah is named a free port",
      "Year 10 — a golden age dawns in Korvruk",
      "Year 20 — a golden age dawns in Bryrbrok",
      "Year 20 — Vaealelael founds Noun",
      "Year 30 — Vaealelael conquers Khokgraur",
      "Year 30 — a golden age dawns in Zaiashain",
      "Year 30 — Vaealelael founds Thu",
      "Year 40 — a golden age dawns in Vaealelael",
      "Year 60 — Vaealelael founds Stothglaem",
      "Year 70 — Korvruk conquers Kaarkgruau",
      "Year 80 — Zaiashain conquers Fovok",
      "Year 120 — Vaealelael conquers Korvruk",
      "Year 140 — civil war splits Zaiashain into Komtros and Thaendfoul",
      "Year 140 — Thaendfoul founds Lan",
      "Year 170 — Zaiashain conquers Dhaishdhar",
      "Year 180 — Thaendfoul founds Kal",
      "Year 190 — the free city of Sah declares independence",
      "Year 200 — Zaiashain founds Lulfia",
      "Year 320 — the free city of Graurk declares independence",
      "Year 330 — the free city of Eleirlieiel declares independence",
      "Year 430 — the free city of Meleil declares independence",
    ]);
  });

  it("says nothing in Korean", () => {
    const h = simulateHistory(build(1), 1);
    for (const e of h.events) expect(eventText(e, h.polities, "en")).not.toMatch(/[가-힣]/);
  });
});

describe("eventText — the parts a single seed does not exercise", () => {
  const pols = [P(0, "Aeltha"), P(1, "Bryn"), P(2, "Corran"), P(3, "Dhaish")];
  const war = (intoIds: number[]): HistoryEvent =>
    ({ year: 300, type: "civilwar", text: "", polityId: 0, intoIds });

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
      ({ year, type: "conquer", text: "", polityId: 0, otherId: 1 });
    expect(eventText(conquer(30), consonant, "ko")).toBe("30년, Vaealelael이 Khokgraur을 정복");
    expect(eventText(conquer(70), vowel, "ko")).toBe("70년, Vaealelael이 Kaarkgruau를 정복");
  });

  it("prints an unknown id rather than throwing", () => {
    const orphan: HistoryEvent = { year: 10, type: "conquer", text: "", polityId: 0, otherId: 99 };
    expect(() => eventText(orphan, pols, "en")).not.toThrow();
    expect(eventText(orphan, pols, "en")).toBe("Year 10 — Aeltha conquers 99");
  });
});
