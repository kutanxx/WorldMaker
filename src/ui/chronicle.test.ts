// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { simulateHistory } from "../engine/history";
import { worldToGazetteer } from "../engine/gazetteer";
import { buildChronicle, isMoment } from "../engine/chronicleLines";
import { renderChronicle, applyChronicleYear } from "./chronicle";

describe("renderChronicle", () => {
  // Restated twice, and neither time weakened. It first pinned one row per RECORDED event, which
  // was the narrowness that made the panel tell less history than the download. It then pinned the
  // whole assembled chronicle. It now pins the chronicle's MOMENTS — the record (king lists,
  // territorial arithmetic) went back to the gazetteer where you go looking for it — and the
  // original guarantee still holds: more than the simulation's own events.
  it("renders one row per moment, which is still more than the recorded events", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const h = simulateHistory(world, 1);
    const el = renderChronicle(world, h, "ko");
    const moments = buildChronicle(world, h, "ko").filter((l) => isMoment(l.kind));
    expect(el.querySelectorAll(".chronicle-event").length).toBe(moments.length);
    expect(moments.length).toBeGreaterThan(h.events.length);
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
// everything mined out of the 51 territory snapshots. Measured on seeds 1/2/3 the screen showed
// 56/48/42 lines against the download's 122/120/96, and never once named a person. Both come off
// one assembler now — the panel taking its moments and the gazetteer the whole record — so the
// panel can no longer be missing something the reader has no other way to see, which was the bug.
describe("the panel is the gazetteer's moments, and misses none of them", () => {
  const build = (seed: number) => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
    return { world, history: simulateHistory(world, seed) };
  };
  const exportedLines = (world: Parameters<typeof worldToGazetteer>[0], history: ReturnType<typeof simulateHistory>) => {
    const md = worldToGazetteer(world, history, "en");
    return md.slice(md.indexOf("## Chronicle")).split("\n").filter((l) => l.startsWith("- "));
  };

  for (const seed of [1, 2, 3]) {
    it(`shows every moment the gazetteer writes, and no record (seed ${seed})`, () => {
      const { world, history } = build(seed);
      const el = renderChronicle(world, history, "en");
      const shown = [...el.querySelectorAll(".chronicle-event")].map((r) => r.textContent);
      const gazetteer = exportedLines(world, history).map((l) => l.slice(2));
      const moments = buildChronicle(world, history, "en").filter((l) => isMoment(l.kind));
      // the document is still the bigger of the two, and the panel is still bigger than the
      // simulation's own events — the two ends this has been squeezed between all along
      expect(gazetteer.length).toBeGreaterThan(shown.length);
      expect(shown.length).toBeGreaterThan(history.events.length);
      // and every moment on screen is a line the gazetteer also carries: same assembler, no drift
      expect(shown).toEqual(moments.map((l) => l.text));
      for (const line of shown) expect(gazetteer, line!).toContain(line);
    });
  }

  // The morning's bug was a reader on the site never seeing a person named. Sending the king LIST
  // back to the gazetteer must not bring that back: a realm's fall and its reach over another
  // people both say who was reigning, and both are moments.
  it("still names a ruler on screen, without the king list", () => {
    const { world, history } = build(1);
    const el = renderChronicle(world, history, "en");
    expect(el.querySelectorAll(".evt-accession").length).toBe(0);
    expect(el.textContent).toMatch(/\(under \w+\)/);
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
    expect(el.querySelectorAll(".evt-civilwar").length).toBeGreaterThan(0);
  });
});

// The panel shows moments, not the record. Measured over five seeds the full chronicle runs 115
// lines a world — a third of them accessions, a quarter territorial arithmetic — and a scroll that
// long beside a moving map is not read. The gazetteer keeps every line; this keeps the ones where
// something happened.
describe("the panel shows what happened, and leaves the record to the gazetteer", () => {
  const build = (seed: number) => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
    return { world, history: simulateHistory(world, seed) };
  };

  it("drops the king list and the territorial arithmetic", () => {
    const { world, history } = build(1);
    const el = renderChronicle(world, history, "en");
    for (const k of ["accession", "peak", "loss", "surge"]) {
      expect(el.querySelectorAll(`.evt-${k}`).length, k).toBe(0);
    }
  });

  it("keeps every moment, and nothing else", () => {
    const { world, history } = build(2);
    const el = renderChronicle(world, history, "en");
    const moments = buildChronicle(world, history, "en").filter((l) => isMoment(l.kind));
    expect(el.querySelectorAll(".chronicle-event").length).toBe(moments.length);
    expect(el.querySelectorAll(".evt-conquer").length).toBeGreaterThan(0);
    expect(el.querySelectorAll(".evt-civilwar").length).toBeGreaterThan(0);
    expect(el.querySelectorAll(".evt-century").length).toBeGreaterThan(0);
  });

  it("is about half what it was, so the centuries still have a spine", () => {
    const { world, history } = build(1);
    const el = renderChronicle(world, history, "en");
    const shown = el.querySelectorAll(".chronicle-event").length;
    const all = buildChronicle(world, history, "en").length;
    expect(shown).toBeLessThan(all * 0.7);
    expect(el.querySelectorAll(".chronicle-era").length).toBeGreaterThan(3);
  });

  it("still names a ruler somewhere on screen", () => {
    const { world, history } = build(1);
    const el = renderChronicle(world, history, "en");
    expect(el.textContent).toMatch(/\(under \w+\)/);
  });
});
