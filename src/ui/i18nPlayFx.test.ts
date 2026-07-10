import { describe, it, expect } from "vitest";
import { playDilemmaFx, playT } from "./i18n";

describe("playDilemmaFx", () => {
  it("formats cell and cohesion deltas with direction glyphs", () => {
    expect(playDilemmaFx("ko", { cells: -5, cohesion: 1 })).toBe("국력 ▼5셀 · 결속 ▲");
    expect(playDilemmaFx("ko", { cells: 3 })).toBe("국력 ▲+3셀");
    expect(playDilemmaFx("en", { cohesion: 2 })).toBe("cohesion ▲▲");
  });
  it("renders a gamble as odds + reversed failure, never a resolved outcome", () => {
    const line = playDilemmaFx("ko", { cohesion: 1, odds: 0.5 });
    expect(line).toContain("50%");
    expect(line).toContain("▲");
    expect(line).toContain("▼"); // the failure direction is shown too
  });
  it("formats truce changes and the two note codes", () => {
    expect(playDilemmaFx("ko", { cells: 1, truce: "break" })).toBe("국력 ▲+1셀 · 휴전 파기");
    expect(playDilemmaFx("en", { truce: "gain" })).toBe(playT("en", "fxTruceGain"));
    expect(playDilemmaFx("ko", { note: "fortify" })).toBe(playT("ko", "fxFortify"));
    expect(playDilemmaFx("en", { note: "noTarget" })).toBe(playT("en", "fxNoTarget"));
  });
});
