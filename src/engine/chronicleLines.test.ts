import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { simulateHistory } from "./history";
import { buildChronicle } from "./chronicleLines";

const build = (seed: number) => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
  return { world, history: simulateHistory(world, seed) };
};

describe("buildChronicle", () => {
  it("is the same chronicle every time it is read", () => {
    const { world, history } = build(1);
    expect(buildChronicle(world, history, "en")).toEqual(buildChronicle(world, history, "en"));
  });

  it("runs in year order, and settles ties the same way twice", () => {
    const { world, history } = build(2);
    const years = buildChronicle(world, history, "en").map((l) => l.year);
    for (let i = 1; i < years.length; i++) expect(years[i]).toBeGreaterThanOrEqual(years[i - 1]);
  });

  // Putting the chronicle on screen made this visible: the world opened with two lines a sentence
  // apart both beginning "8 realms stand", one naming the realms and one counting them and adding a
  // greatest. A century standing is worth a line when it reports a century of change; at year zero
  // it reports the founding line again, and its "greatest realm" is an accident of where the seeds
  // fell rather than anything a realm did.
  it("does not open by saying the same thing twice", () => {
    for (const seed of [1, 2, 3]) {
      const { world, history } = build(seed);
      const opening = buildChronicle(world, history, "en").filter((l) => l.year === 0);
      const standing = opening.filter((l) => /realms stand/.test(l.text));
      expect(standing.length).toBe(1);
      expect(standing[0].kind).toBe("foundings");   // the one that names them, not the one that counts them
    }
  });

  it("still reports where the world stands at the later centuries", () => {
    const { world, history } = build(1);
    const centuries = buildChronicle(world, history, "en").filter((l) => l.kind === "century");
    expect(centuries.length).toBeGreaterThan(2);
    expect(centuries.every((l) => l.year > 0)).toBe(true);
  });

  it("tells the same chronicle in Korean, line for line", () => {
    const { world, history } = build(1);
    const en = buildChronicle(world, history, "en");
    const ko = buildChronicle(world, history, "ko");
    expect(ko.length).toBe(en.length);
    expect(ko.map((l) => l.kind)).toEqual(en.map((l) => l.kind));
    expect(ko.some((l) => /[가-힣]/.test(l.text))).toBe(true);
    expect(en.some((l) => /[가-힣]/.test(l.text))).toBe(false);
  });
});

// "2th of Syalyear, takes the seat". The English accession line built its ordinal by gluing "th"
// onto the number, which is right for 4-20 and wrong for every 1, 2 and 3 — and a five-century
// dynasty reaches 13 rulers, so a world put dozens of these in front of the reader. It survived
// unseen while accessions went only into the downloaded gazetteer; it was on screen 34 times the
// moment the panel started telling them.
describe("the ordinal an English accession is written with", () => {
  // Written out by hand rather than derived, so this is a statement of what English does and not a
  // second copy of the code under test. The teens are the interesting part: 11, 12 and 13 take
  // "th" even though 1, 2 and 3 do not, which is the trap a naive fix falls into next.
  const ENGLISH = [
    "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th",
    "11th", "12th", "13th", "14th", "15th", "16th", "17th", "18th", "19th", "20th",
    "21st", "22nd", "23rd", "24th", "25th",
  ];

  it("never glues 'th' onto a number that does not take it", () => {
    let checked = 0;
    for (const seed of [1, 2, 3]) {
      const { world, history } = build(seed);
      const seats = buildChronicle(world, history, "en").filter((l) => l.kind === "accession");
      expect(seats.length).toBeGreaterThan(0);
      for (const l of seats) {
        const m = l.text.match(/\b(\d+)(st|nd|rd|th)\b/);
        expect(m).not.toBeNull();
        const n = Number(m![1]);
        expect(n).toBeLessThanOrEqual(ENGLISH.length);   // a longer dynasty needs a longer table
        expect(m![0]).toBe(ENGLISH[n - 1]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);                 // the loop ran; it is not vacuously green
  });

  it("writes the second, third and twenty-first the way English writes them", () => {
    const { world, history } = build(1);
    const seats = buildChronicle(world, history, "en").filter((l) => l.kind === "accession");
    const ordinals = new Set(seats.map((l) => l.text.match(/\b\d+(?:st|nd|rd|th)\b/)?.[0]));
    expect(ordinals.has("2nd")).toBe(true);
    expect(ordinals.has("3rd")).toBe(true);
    expect(ordinals.has("2th")).toBe(false);
  });
});
