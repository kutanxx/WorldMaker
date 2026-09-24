// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { simulateHistory } from "../engine/history";
import { worldToGazetteer } from "../engine/gazetteer";
import { buildChronicle, isMoment } from "../engine/chronicleLines";
import { renderChronicleCaption, HEADLINE_ORDER, BIG_NEWS } from "./chronicle";

const build = (seed: number) => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
  return { world, history: simulateHistory(world, seed) };
};
const momentsOf = (seed: number, lang: "en" | "ko" = "en") => {
  const { world, history } = build(seed);
  return { world, history, moments: buildChronicle(world, history, lang).filter((l) => isMoment(l.kind)) };
};

// ⚠ These used to be assertions about a PANEL: 48 rows under the map, one per moment, each a
// button that moved the year. The reader it was built for, asked whether they read it, said no, so
// the screen keeps one line and the gazetteer keeps the list. What was worth holding was never the
// DOM but the chronicle behind it, so the invariants moved onto the lines themselves.
describe("the chronicle caption", () => {
  // (It used to hold the caption to the LAST line of the year in sort order — which is the bug the
  // next test closes: that order is not importance, and it put a free port over the founding of
  // every realm in all twelve worlds measured. What it held is still the point: the latest year's
  // news, and nothing from a year the map has not reached.)
  it("carries what had last happened, and never a line from the future", () => {
    const { world, history, moments } = momentsOf(1, "ko");
    const cap = renderChronicleCaption(world, history, "ko");
    for (const year of [0, 100, 250, history.years]) {
      cap.setYear(year);
      const text = cap.element.textContent ?? "";
      expect(text.length, `blank at ${year}`).toBeGreaterThan(0);
      const latest = moments.filter((l) => l.year <= year).pop()!.year;
      const candidates = moments.filter((l) => l.year === latest).map((l) => l.short ?? l.text);
      expect(candidates.some((c) => text.startsWith(c)), `at ${year} the caption is none of year ${latest}'s lines`).toBe(true);
      // nothing from after the year the map is drawn at
      for (const l of moments.filter((m) => m.year > year)) expect(text).not.toContain(l.short ?? l.text);
    }
  });

  // ★ Measured over 12 seeds: every world opened on "0년, <town> 자유무역항 지정 외 3건" — the
  // founding of every realm hidden in the "3건" — and 72 of 187 busy years led with the smaller
  // news (a new town over a conquest, a plague over an independence, a culture over a civil war).
  it("leads with the biggest thing that happened that year", () => {
    const rank = (k: string) => { const i = HEADLINE_ORDER.indexOf(k); return i < 0 ? HEADLINE_ORDER.length : i; };
    for (const seed of [1, 2, 3, 4]) {
      const { world, history, moments } = momentsOf(seed, "ko");
      const cap = renderChronicleCaption(world, history, "ko");
      for (const s of history.snapshots) {
        const upTo = moments.filter((l) => l.year <= s.year);
        if (!upTo.length) continue;
        const latest = upTo[upTo.length - 1].year;
        const best = Math.min(...moments.filter((l) => l.year === latest).map((l) => rank(l.kind)));
        cap.setYear(s.year);
        const kind = (cap.element.className.match(/evt-(\S+)/) ?? [])[1] ?? "";
        expect(rank(kind), `seed ${seed} year ${s.year} led with ${kind}`).toBe(best);
      }
      cap.setYear(0);
      expect(cap.element.className, `seed ${seed} does not open on its founding`).toContain("evt-foundings");
    }
  });

  it("writes the headline and leaves the detail to the gazetteer", () => {
    for (const lang of ["ko", "en"] as const) {
      const { world, history } = build(1);
      const cap = renderChronicleCaption(world, history, lang);
      for (const s of history.snapshots) {
        cap.setYear(s.year);
        expect(cap.element.textContent ?? "", `${lang} ${s.year}`).not.toMatch(/치세|\(under /);
      }
      cap.setYear(0);
      expect(cap.element.textContent ?? "", "the founding still lists every realm").not.toMatch(/[—:] \S+, /);
    }
  });

  // ★ Played, the caption changed on 360 of 612 steps — about half a second a line, where a
  // 25-character Korean line wants two (Netflix's Korean subtitle guide: 12 characters a second for
  // adults). So the player stops on the big news for as long as it takes to read it, and lets the
  // small news pass at the old pace.
  it("asks the player to stay on the big news for as long as it takes to read", () => {
    const { world, history } = build(1);
    const cap = renderChronicleCaption(world, history, "ko");
    const dwell0 = cap.dwellAt(0);
    cap.setYear(history.snapshots[0].year);
    const words = [...(cap.element.textContent ?? "")].length;
    expect(dwell0, "the founding goes past unread").toBe(Math.min(3000, Math.round(words / 12 * 1000)));
    let held = 0, quiet = 0;
    for (let i = 1; i < history.snapshots.length; i++) {
      const d = cap.dwellAt(i);
      cap.setYear(history.snapshots[i - 1].year);
      const before = cap.element.textContent;
      cap.setYear(history.snapshots[i].year);
      const changed = cap.element.textContent !== before;
      const big = BIG_NEWS.has((cap.element.className.match(/evt-(\S+)/) ?? [])[1] ?? "");
      if (changed && big) { held++; expect(d, `step ${i}`).toBeGreaterThan(0); }
      else { quiet++; expect(d, `step ${i} holds for news that is not new, or not big`).toBe(0); }
    }
    expect(held, "nothing to stop for in a whole world").toBeGreaterThan(3);
    expect(quiet).toBeGreaterThan(held);
  });

  // Measured over 12 seeds: 43.5 events on 51 scrub steps, 54% of steps empty, runs of 34 empty
  // steps at the worst. A caption of "this year's events" would be blank more than half the time.
  it("is never blank on any step of any of four worlds, after the founding", () => {
    for (const seed of [1, 2, 3, 4]) {
      const { world, history } = build(seed);
      const cap = renderChronicleCaption(world, history, "en");
      for (const s of history.snapshots) {
        cap.setYear(s.year);
        expect((cap.element.textContent ?? "").length, `blank at ${s.year} on seed ${seed}`).toBeGreaterThan(0);
      }
    }
  });

  it("says how many others shared the year, rather than showing one of six in silence", () => {
    const { world, history, moments } = momentsOf(1, "ko");
    const busiest = [...new Set(moments.map((l) => l.year))]
      .map((y) => ({ y, n: moments.filter((l) => l.year === y).length }))
      .sort((a, b) => b.n - a.n)[0];
    expect(busiest.n, "no year carries more than one moment").toBeGreaterThan(1);
    const cap = renderChronicleCaption(world, history, "ko");
    cap.setYear(busiest.y);
    expect(cap.element.textContent).toContain(`외 ${busiest.n - 1}건`);
  });

  it("speaks the reader's language", () => {
    const { world, history } = build(1);
    const en = renderChronicleCaption(world, history, "en");
    en.setYear(0);
    expect(en.element.textContent).not.toMatch(/[가-힣]/);
    const ko = renderChronicleCaption(world, history, "ko");
    ko.setYear(0);
    expect(ko.element.textContent).toMatch(/[가-힣]/);
  });

  it("carries the kind, so the stylesheet can still colour a fall differently from a founding", () => {
    const { world, history, moments } = momentsOf(1, "en");
    const cap = renderChronicleCaption(world, history, "en");
    const kinds = new Set<string>();
    for (const l of moments) {
      cap.setYear(l.year);
      kinds.add((cap.element.className.match(/evt-\S+/) ?? [""])[0]);
    }
    expect(kinds.size, "every line came out the same kind").toBeGreaterThan(1);
    for (const k of kinds) expect(k.startsWith("evt-"), k).toBe(true);
  });
});

// The screen drew only the simulation's raw events, while the downloaded gazetteer drew those PLUS
// everything mined out of the 51 territory snapshots. Measured on seeds 1/2/3 the screen showed
// 56/48/42 lines against the download's 122/120/96, and never once named a person. Both come off
// one assembler now — the screen taking its moments and the gazetteer the whole record — so the
// screen can no longer be missing something the reader has no other way to see, which was the bug.
describe("the screen's moments are the gazetteer's, and miss none of them", () => {
  const exportedLines = (world: Parameters<typeof worldToGazetteer>[0], history: ReturnType<typeof simulateHistory>) => {
    const md = worldToGazetteer(world, history, "en");
    return md.slice(md.indexOf("## Chronicle")).split("\n").filter((l) => l.startsWith("- "));
  };

  for (const seed of [1, 2, 3]) {
    it(`draws on every moment the gazetteer writes, and no record (seed ${seed})`, () => {
      const { world, history, moments } = momentsOf(seed, "en");
      const gazetteer = exportedLines(world, history).map((l) => l.slice(2));
      // the document is still the bigger of the two, and the moments are still more than the
      // simulation's own events — the two ends this has been squeezed between all along
      expect(gazetteer.length).toBeGreaterThan(moments.length);
      expect(moments.length).toBeGreaterThan(history.events.length);
      for (const line of moments) expect(gazetteer, line.text).toContain(line.text);
    });
  }

  // The bug this closed was a reader on the site never seeing a person named. Sending the king LIST
  // back to the gazetteer must not bring that back: a realm's fall and its reach over another
  // people both say who was reigning, and both are moments.
  it("still names a ruler among the moments, without the king list", () => {
    const { moments } = momentsOf(1, "en");
    expect(moments.filter((l) => l.kind === "accession").length).toBe(0);
    expect(moments.map((l) => l.text).join(" ")).toMatch(/\(under \w+\)/);
  });

  it("says where the world stands at each century, so a quiet century is not a blank one", () => {
    const { history, moments } = momentsOf(1, "en");
    expect(moments.filter((l) => /realms stand/.test(l.text)).length).toBeGreaterThan(1);
    // seed 1's second century carried 4 raw events; it must no longer be near-empty
    const second = moments.filter((l) => l.year >= 200 && l.year < 300);
    expect(second.length).toBeGreaterThan(history.events.filter((e) => e.year >= 200 && e.year < 300).length);
  });
});
