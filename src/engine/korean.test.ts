import { describe, it, expect } from "vitest";
import { josa, withJosa, endsWithConsonant } from "./korean";

describe("korean particles", () => {
  it("reads a Hangul final consonant", () => {
    expect(endsWithConsonant("중앙")).toBe(true);    // ㅇ closes it
    expect(endsWithConsonant("남부")).toBe(false);   // open vowel
    expect(josa("중앙", "을/를")).toBe("을");
    expect(josa("남부", "을/를")).toBe("를");
  });

  it("reads a Latin name by its final letter, as Korean prose does for foreign nouns", () => {
    expect(josa("Cianrium", "이/가")).toBe("이");    // ends m
    expect(josa("Todu", "이/가")).toBe("가");        // ends u
    expect(josa("Karkhar", "을/를")).toBe("을");     // ends r
    expect(josa("Elae", "은/는")).toBe("는");        // ends e
    expect(josa("Vrark", "와/과")).toBe("과");       // ends k
  });

  it("gives ㄹ and a final vowel the same 로, and everything else 으로", () => {
    expect(josa("서울", "으로/로")).toBe("로");       // ㄹ
    expect(josa("남부", "으로/로")).toBe("로");       // vowel
    expect(josa("중앙", "으로/로")).toBe("으로");     // other consonant
    expect(josa("Vrark", "으로/로")).toBe("으로");
    expect(josa("Cianril", "으로/로")).toBe("로");    // Latin l reads as ㄹ
  });

  it("reads a trailing digit by how it is spoken", () => {
    expect(josa("3", "이/가")).toBe("이");            // 삼
    expect(josa("2", "이/가")).toBe("가");            // 이
    expect(josa("5", "은/는")).toBe("는");            // 오
  });

  it("falls back to the open form rather than guessing at an unreadable ending", () => {
    expect(josa("...", "이/가")).toBe("가");
    expect(josa("", "을/를")).toBe("를");
  });

  it("attaches the particle when asked for the whole phrase", () => {
    expect(withJosa("Cianrium", "이/가")).toBe("Cianrium이");
    expect(withJosa("Todu", "을/를")).toBe("Todu를");
  });
});
