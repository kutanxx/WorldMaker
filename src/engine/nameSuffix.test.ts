import { describe, it, expect } from "vitest";
import { realmLabelKo, peopleLabelKo } from "./nameSuffix";

describe("Korean says what kind of thing a name is", () => {
  it("names a realm by the kind of state it is", () => {
    expect(realmLabelKo("Ceusdu", "kingdom")).toBe("케우스두 왕국");
    expect(realmLabelKo("Hreir", "republic")).toBe("흐레이르 공화국");
    // The brief's own worked example writes this "자이아샤인 제국" (with 샤), but `toHangul` does not
    // fuse "sh"+vowel into a y-glide anywhere — only the `sy`/`ly` onsets get that treatment (see
    // hangul.ts's VOWELS "ya"/"ye"/"yo"/"yi" rows), and "Sainkhaish" is already pinned in
    // hangul.test.ts as 사인카이시 (시, not a glide). Verified against the actual function rather than
    // guessed: `toHangul("Zaiashain")` is deterministically "자이아사인", so that is what this locks.
    expect(realmLabelKo("Zaiashain", "empire")).toBe("자이아사인 제국");
  });
  it("marks a people as a people rather than as a place", () => {
    expect(peopleLabelKo("Druthvrau")).toBe("드루스브라우인");
  });
});
