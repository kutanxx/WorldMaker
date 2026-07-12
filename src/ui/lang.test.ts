// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { detectLang, saveLang } from "./lang";

function mem(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
}

describe("detectLang", () => {
  it("a saved choice wins over the browser language", () => {
    expect(detectLang("en-US", mem({ "wm:lang": "ko" }))).toBe("ko");
    expect(detectLang("ko-KR", mem({ "wm:lang": "en" }))).toBe("en");
  });
  it("falls back to the browser language: ko* → ko, anything else → en", () => {
    expect(detectLang("ko-KR", mem())).toBe("ko");
    expect(detectLang("ko", mem())).toBe("ko");
    expect(detectLang("en-US", mem())).toBe("en");
    expect(detectLang("de-DE", mem())).toBe("en");
    expect(detectLang("kok-IN", mem())).toBe("en");
    expect(detectLang(undefined, mem())).toBe("en"); // jsdom navigator.language is en-US
  });
  it("ignores a corrupt saved value", () => {
    expect(detectLang("ko-KR", mem({ "wm:lang": "de" }))).toBe("ko");
  });
  it("never throws on a hostile storage", () => {
    const bad = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(detectLang("ko-KR", bad)).toBe("ko");
    expect(() => saveLang("ko", bad)).not.toThrow();
  });
  it("saveLang round-trips through detectLang", () => {
    const st = mem();
    saveLang("ko", st);
    expect(detectLang("en-US", st)).toBe("ko");
  });
});
