// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { simulateHistory } from "../engine/history";
import { worldToGazetteer } from "../engine/gazetteer";
import { buildChronicle, isMoment } from "../engine/chronicleLines";
import { renderChronicleCaption } from "./chronicle";

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
  it("carries what had last happened, and never a line from the future", () => {
    const { world, history, moments } = momentsOf(1, "ko");
    const cap = renderChronicleCaption(world, history, "ko");
    for (const year of [0, 100, 250, history.years]) {
      cap.setYear(year);
      const text = cap.element.textContent ?? "";
      expect(text.length, `blank at ${year}`).toBeGreaterThan(0);
      const line = moments.filter((l) => l.year <= year).pop()!;
      expect(text.startsWith(line.text), `at ${year} the caption is not the last line before it`).toBe(true);
      // nothing from after the year the map is drawn at
      for (const l of moments.filter((m) => m.year > year)) expect(text).not.toContain(l.text);
    }
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
