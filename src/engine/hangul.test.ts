import { describe, it, expect } from "vitest";
import { toHangul } from "./hangul";
import { endsWithConsonant, josa } from "./korean";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { simulateHistory } from "./history";
import { buildDynasties } from "./dynasty";
import { ADJ, NOUNS, WORLD_NOUN } from "./geography";

describe("toHangul", () => {
  it("writes each digraph as the one sound it is", () => {
    expect(toHangul("Khaagg")).toBe("카아그");
    expect(toHangul("Thykhy")).toBe("시키");
    expect(toHangul("Dhaishdhar")).toBe("다이시다르");
  });

  it("gives a trailing consonant the syllable Korean gives it", () => {
    expect(toHangul("Sahias")).toBe("사히아스");
    expect(toHangul("Trous")).toBe("트로우스");
  });

  // `world.name` and every `province.name` are English-RENDERED composites — featureLabel wraps a
  // generated proper noun in words from geography.ts's own ADJ / NOUNS / WORLD_NOUN lists, giving
  // "the Hollow Realm" and "Thakus Wilds". Those English words carry `w` and `p`, letters no token
  // table has, so feeding the whole string to toHangul asks a question about Task 3's
  // featureLabel(label, "ko") rather than about this table. The frame is stripped back off here so
  // the sweep sees the part toHangul is actually for: the proper noun inside.
  const ENGLISH = new Set(
    ["the", "of", ...ADJ, ...Object.values(NOUNS).flat(), ...WORLD_NOUN].map((w) => w.toLowerCase()),
  );
  const propersIn = (s: string) => s.split(/\s+/).filter((w) => w && !ENGLISH.has(w.toLowerCase()));

  it("leaves no Latin letter anywhere, on any name any seed produces", () => {
    const bad: string[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
      const h = simulateHistory(world, seed);
      const names = [
        ...world.cities.map((c) => c.name),
        ...h.polities.map((p) => p.name),
        ...world.cultures.map((c) => c.name),
        ...[...buildDynasties(world, h).values()].flat().map((r) => r.name),
        ...world.regions.map((r) => r.label.proper ?? ""),
        ...world.rivers.map((r) => r.label.proper ?? ""),
        ...world.provinces.flatMap((p) => propersIn(p.name)),
        ...propersIn(world.name),
      ].filter(Boolean);
      for (const n of names) if (/[A-Za-z]/.test(toHangul(n))) bad.push(`${n} -> ${toHangul(n)}`);
    }
    expect(bad, `${bad.length} names kept Latin, e.g. ${bad.slice(0, 8).join(", ")}`).toEqual([]);
  });

  it("is stable: one name is always written one way", () => {
    expect(toHangul("Krathgath")).toBe(toHangul("Krathgath"));
  });

  // `스` is ㅅ+ㅡ with an EMPTY 받침 — the ㅅ is the syllable's ONSET, not its final — so a name
  // written 사히아스 reads OPEN and takes 가, the way 크리스가 and 버스를 do. korean.ts's Latin path
  // cannot see that: it reads the letter `s`, calls the name closed, and returns 이. Transliterating
  // does remove that guess, which is the point of this file — it just removes it in the opposite
  // direction from the one the brief predicted. Both facts live in one test because the josa pair
  // below subsumes the endsWithConsonant line: same claim, once as the primitive and once as the
  // particle a reader would actually see.
  it("removes korean.ts's guess about a final consonant, and reverses it", () => {
    expect(endsWithConsonant(toHangul("Sahias"))).toBe(false);
    expect(josa("Sahias", "이/가")).toBe("이");        // the guess, read off the Latin letter
    expect(josa(toHangul("Sahias"), "이/가")).toBe("가"); // what a Korean reader actually says
  });

  // Value pins, one per mechanism the table has.
  //
  // The sweep above guards the ALPHABET and nothing else: every one of the 22 letters has a
  // single-letter row, so a name can come out entirely Hangul and still be read WRONG. A future
  // edit that flipped `hold` on the `l` row would turn 스탈도운드 into 스타르도운드 and leave all
  // 765 tests green. These pin the READING instead — one real generated name per mechanism, so an
  // edit to a row has to face the name it changes. Every name here is output the seed sweep
  // actually produced, except where a comment says the generator cannot reach the case.
  it("pins the reading each mechanism gives, not just the absence of Latin", () => {
    // ㄹ before a vowel, not word-initial: a ㄹ 받침 on the syllable BEFORE it plus a ㄹ onset —
    // 글라스, 플랜, 이탈리아, 줄리아. Without it `l` and `r` write the same string and 멜리아 could
    // not be told apart from 메리아, which is the one distinction the doubling exists to keep.
    expect(toHangul("Melialae")).toBe("멜리알라에");
    expect(toHangul("Glas")).toBe("글라스");
    expect(toHangul("Liath")).toBe("리아스");        // word-initial ㄹ stays a plain onset: 런던, 리버풀

    // hold: "any" — a sonorant is a 받침 before any consonant, so the ㄹ joins 타 rather than
    // taking a syllable of its own (the 발도르 / 바르도르 fork).
    expect(toHangul("Staldound")).toBe("스탈도운드");
    expect(toHangul("Mealsyo")).toBe("메알쇼");       // and the `yo` row: ly/sy + io trimmed by weld

    // hold: "end" — a voiceless stop is a 받침 only word-final AND only after a real vowel. That
    // second condition is the whole reason a syllable records `fromVowel`: 아 earns the ㄱ, the
    // filler 르 does not (book 북 against Bismarck 비스마르크).
    expect(toHangul("Khaak")).toBe("카악");
    expect(toHangul("Graurk")).toBe("그라우르크");

    // glide — `fj` never takes the vowel after it, so the vowel opens its own syllable: 피오,
    // the shape Korean gives fjord (피오르드).
    expect(toHangul("Fjor")).toBe("피오르");
    expect(toHangul("Fjeifhrarn")).toBe("피에이프흐라른");

    // the `y` rows: y is a VOWEL in names.ts, so sy/ly meeting a vowel is one glide syllable.
    expect(toHangul("Syansyen")).toBe("샨셴");        // ya, ye
    expect(toHangul("Hyir")).toBe("히르");            // yi — one ㅣ, not 히이

    // fill — a stranded consonant takes ㅡ, except after ㅅ/ㅈ/ㅊ where Korean takes ㅣ. One field,
    // two readings: the `sh` here is 시 while the `t` of Trous above is 트.
    expect(toHangul("Sainkhaish")).toBe("사인카이시");

    // `t`'s 받침 is ㅅ (rocket 로켓). NOT a generated name: no coda token in names.ts or culture.ts
    // ends in `t`, so this row is unreachable from the tables and only a loanword can pin it.
    expect(toHangul("Rocket")).toBe("로켓");
  });
});
