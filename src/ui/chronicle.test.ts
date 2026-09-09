// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { simulateHistory } from "../engine/history";
import { worldToGazetteer } from "../engine/gazetteer";
import { buildChronicle } from "../engine/chronicleLines";
import { renderChronicle, applyChronicleYear } from "./chronicle";

describe("renderChronicle", () => {
  // Restated, not weakened: the panel used to draw one row per RECORDED event, which is why it told
  // less history than the download. It now draws the whole chronicle, so the count it must match is
  // the assembler's, and that count is strictly larger than the raw events.
  it("renders one row per chronicle line, which is more than the recorded events", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const h = simulateHistory(world, 1);
    const el = renderChronicle(world, h, "ko");
    const lines = buildChronicle(world, h, "ko");
    expect(el.querySelectorAll(".chronicle-event").length).toBe(lines.length);
    expect(lines.length).toBeGreaterThan(h.events.length);
    // seed 1's eight foundings are told as one line, so "건국" is not the word to look for;
    // the free-port namings are unconditional and Korean-only.
    expect(el.textContent).toContain("자유무역항 지정");
  });
  it("keeps era headers OUT of the <ol> (valid list markup: an <ol> holds only <li>)", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const h = simulateHistory(world, 1);
    const el = renderChronicle(world, h, "ko");
    const eras = el.querySelectorAll(".chronicle-era");
    expect(eras.length).toBeGreaterThan(0);
    for (const era of eras) expect(era.tagName.toLowerCase()).not.toBe("li"); // a header, not a list item
    // every list child is an event row (no header smuggled into the <ol>)
    for (const ol of el.querySelectorAll("ol.chronicle-list")) {
      for (const child of ol.children) expect(child.classList.contains("chronicle-event")).toBe(true);
    }
  });
  it("tells the chronicle in English, chrome and all", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const h = simulateHistory(world, 1);
    const el = renderChronicle(world, h, "en");
    expect(el.textContent).not.toMatch(/[가-힣]/);
    expect(el.querySelector("h3")!.textContent).toBe(`Chronicle (Years 0–${h.years})`);
    expect(el.querySelector(".chronicle-era")!.textContent).toBe("0s");
    // the eight foundings are one line; assert that line rather than the first row, whose identity
    // is a question of ordering and not of language
    expect(el.querySelector(".evt-foundings")!.textContent)
      .toBe("Year 0 — 8 realms stand: Dhaishdhar, Korvruk, Ceusdu, Thruthkhagg, Kaarkgruau, Zaiashain, Khaak, Laelmaer");
  });
  it("still tells it in Korean when the reader is reading Korean", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const h = simulateHistory(world, 1);
    const el = renderChronicle(world, h, "ko");
    expect(el.querySelector("h3")!.textContent).toBe(`연대기 (0–${h.years}년)`);
    expect(el.querySelector(".chronicle-era")!.textContent).toBe("0년대");
    expect(el.textContent).toContain("자유무역항 지정");
  });
});

describe("applyChronicleYear", () => {
  it("dims events after the current year and clears earlier ones", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const h = simulateHistory(world, 1);
    const el = renderChronicle(world, h, "ko");
    applyChronicleYear(el, 100);
    const rows = Array.from(el.querySelectorAll<HTMLElement>(".chronicle-event"));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.classList.contains("future")).toBe(Number(r.dataset.year) > 100);
    }
  });
});

// The panel drew only the simulation's raw events, while the downloaded gazetteer drew those PLUS
// everything mined out of the 51 territory snapshots — realms peaking, realms falling, one power
// overtaking another, and the rulers `dynasty.ts` had already invented. Measured on seeds 1/2/3 the
// screen showed 56/48/42 lines against the download's 122/120/96, and never once named a person.
// Both now come off one assembler, so the reader on the site reads the same history as the reader
// who downloads it.
describe("the panel tells the same chronicle the download does", () => {
  const build = (seed: number) => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
    return { world, history: simulateHistory(world, seed) };
  };
  const exportedLines = (world: Parameters<typeof worldToGazetteer>[0], history: ReturnType<typeof simulateHistory>) => {
    const md = worldToGazetteer(world, history, "en");
    return md.slice(md.indexOf("## Chronicle")).split("\n").filter((l) => l.startsWith("- "));
  };

  for (const seed of [1, 2, 3]) {
    it(`renders a row for every line the gazetteer writes (seed ${seed})`, () => {
      const { world, history } = build(seed);
      const el = renderChronicle(world, history, "en");
      const rows = el.querySelectorAll(".chronicle-event");
      const lines = exportedLines(world, history);
      expect(lines.length).toBeGreaterThan(history.events.length);   // the gap this closes
      expect(rows.length).toBe(lines.length);
    });
  }

  it("names the rulers the dynasty layer had already invented", () => {
    const { world, history } = build(1);
    const el = renderChronicle(world, history, "en");
    const seats = Array.from(el.querySelectorAll(".chronicle-event"))
      .filter((r) => /takes the seat$/.test(r.textContent ?? ""));
    expect(seats.length).toBeGreaterThan(0);
    // the ruler's own name, not just the realm's: "<name>, Nth of <realm>, takes the seat"
    expect(seats[0].textContent).toMatch(/^Year \d+ — \w+, \d+(?:st|nd|rd|th) of \w+, takes the seat$/);
  });

  it("says where the world stands at each century, so a quiet century is not a blank one", () => {
    const { world, history } = build(1);
    const el = renderChronicle(world, history, "en");
    const rows = Array.from(el.querySelectorAll(".chronicle-event"));
    const standing = rows.filter((r) => /realms stand/.test(r.textContent ?? ""));
    expect(standing.length).toBeGreaterThan(1);
    // seed 1's second century carried 4 raw events; it must no longer be near-empty
    const second = rows.filter((r) => Number((r as HTMLElement).dataset.year) >= 200
                                   && Number((r as HTMLElement).dataset.year) < 300);
    expect(second.length).toBeGreaterThan(history.events.filter((e) => e.year >= 200 && e.year < 300).length);
  });

  it("carries the kind on the row so the stylesheet can still colour a conquest", () => {
    const { world, history } = build(1);
    const el = renderChronicle(world, history, "en");
    expect(el.querySelectorAll(".evt-conquer").length).toBeGreaterThan(0);
    expect(el.querySelectorAll(".evt-accession").length).toBeGreaterThan(0);
  });
});
