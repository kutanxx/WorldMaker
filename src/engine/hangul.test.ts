import { describe, it, expect } from "vitest";
import { toHangul } from "./hangul";
import { endsWithConsonant, josa } from "./korean";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { simulateHistory } from "./history";
import { buildDynasties } from "./dynasty";

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
      ].filter(Boolean);
      for (const n of names) if (/[A-Za-z]/.test(toHangul(n))) bad.push(`${n} -> ${toHangul(n)}`);
    }
    expect(bad, `${bad.length} names kept Latin, e.g. ${bad.slice(0, 8).join(", ")}`).toEqual([]);
  });

  it("is stable: one name is always written one way", () => {
    expect(toHangul("Krathgath")).toBe(toHangul("Krathgath"));
  });

  it("gives korean.ts a real final consonant instead of a guess", () => {
    // 스 is ㅅ+ㅡ with empty 받침. Latin path guesses "ends in s" → 이; Hangul path reads the real
    // empty consonant → 가. This is why we transliterate: to get the real answer instead of the guess.
    expect(endsWithConsonant(toHangul("Sahias"))).toBe(false);
  });

  // Added, not briefed: the case above and this one disagree, and this is the one the particle
  // rule has to be right about. `스` is ㅅ+ㅡ with an EMPTY 받침 — the ㅅ is its onset — so a name
  // written 사히아스 is open and takes 가, the way 크리스가 and 버스를 do. The Latin path guesses
  // "ends in s, therefore closed" and returns 이, which is the guess this whole task removes.
  it("shows what the Latin guess gets wrong about a name ending in s", () => {
    expect(josa("Sahias", "이/가")).toBe("이");        // the guess, read off the letter
    expect(josa(toHangul("Sahias"), "이/가")).toBe("가"); // what a Korean reader actually says
  });
});
