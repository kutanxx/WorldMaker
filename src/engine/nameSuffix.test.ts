import { describe, it, expect } from "vitest";
import { realmLabelKo, peopleLabelKo, realmLabelEn } from "./nameSuffix";

describe("Korean says what kind of thing a name is", () => {
  it("names a realm by the kind of state it is", () => {
    expect(realmLabelKo("Ceusdu", "kingdom")).toBe("케우스두 왕국");
    expect(realmLabelKo("Hreir", "republic")).toBe("흐레이르 자유도시");
    // Restored to the brief's original "자이아샤인 제국" (with 샤). A prior pass changed this to
    // "자이아사인" on the theory that toHangul's `sh` never glides — but that was the bug, not the
    // brief: Korean writes a PREVOCALIC [ʃ] with a glide (샤 섀 셔 셰 쇼 슈 시 — 샤워, 샴푸, 쇼크, 슈퍼),
    // the same way its `sy`/`ly` onsets already do (see hangul.ts's `glideVowel` flag on the `sh`
    // row). A word-final [ʃ] is still plain 시 — hangul.test.ts's "Sainkhaish" -> 사인카이시 pin is
    // unaffected, since nothing follows that `sh` for a glide to apply to.
    expect(realmLabelKo("Zaiashain", "empire")).toBe("자이아샤인 제국");
  });
  it("marks a people as a people rather than as a place", () => {
    expect(peopleLabelKo("Druthvrau")).toBe("드루스브라우인");
  });
});

// 공화국 was the first word here and is not any more. A five-tile city that threw off a crown is a
// 자유도시 — which is what every other line of the document already called it (five times a realm,
// against 공화국 once) — and a modern republic is not what the simulation is modelling. The three
// forms still read as three kinds of polity: 왕국 / 자유도시 / 제국.
describe("the word a Korean label gives a free city", () => {
  it("calls it what the rest of the document calls it", () => {
    expect(realmLabelKo("Hreir", "republic")).toBe("흐레이르 자유도시");
    expect(realmLabelKo("Hreir", "republic")).not.toContain("공화국");
  });
});

// The same complaint in the other language. Measured on a live English map: `Siash` is a town and
// `Siahsis` is a realm, out of the same phonology, with nothing in the words to tell them apart —
// and the town list put them side by side as `Korkgor Grathggau`, two invented words and no clue.
describe("realmLabelEn", () => {
  it("names the kind of state the reader is looking at", () => {
    expect(realmLabelEn("Grathggau", "kingdom")).toBe("Grathggau Kingdom");
    expect(realmLabelEn("Meileth", "empire")).toBe("Meileth Empire");
    expect(realmLabelEn("Vailior", "republic")).toBe("Vailior Free City");
  });

  // Name first, like the Korean form and unlike "the Kingdom of X": these are labels in a LIST,
  // and a list is scanned down its first word.
  it("puts the name first, the way the Korean label does", () => {
    for (const form of ["kingdom", "empire", "republic"] as const) {
      expect(realmLabelEn("Dauscis", form).startsWith("Dauscis ")).toBe(true);
    }
  });

  // `classifyGovernments` calls a free city a republic; every reader-facing word for it on this
  // site says free city (the gazetteer, and 자유도시 in Korean). One thing, one name.
  it("says free city where the classifier says republic, as the Korean label does", () => {
    expect(realmLabelEn("X", "republic")).toContain("Free City");
    expect(realmLabelEn("X", "republic")).not.toContain("Republic");
  });
});
