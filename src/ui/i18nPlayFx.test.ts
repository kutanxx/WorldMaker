import { describe, it, expect } from "vitest";
import { playDilemmaFx, playT } from "./i18n";

describe("playDilemmaFx", () => {
  it("formats cell and cohesion deltas with direction glyphs", () => {
    expect(playDilemmaFx("ko", { cells: -5, cohesion: 1 })).toBe("국력 ▼5셀 · 민심 ▲");
    expect(playDilemmaFx("ko", { cells: 3 })).toBe("국력 ▲+3셀");
    expect(playDilemmaFx("en", { cohesion: 2 })).toBe("loyalty ▲▲");
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
  it("a gamble with cells AND cohesion wraps the whole effect, failure fully negated", () => {
    const line = playDilemmaFx("ko", { cells: 8, cohesion: 1, odds: 0.62 });
    expect(line).toBe("성공 62%: 국력 ▲+8셀 · 민심 ▲ / 실패: 국력 ▼8셀 · 민심 ▼");
  });
  it("renders the new note codes, including the live prophecy condition percent", () => {
    expect(playDilemmaFx("en", { note: "noEffect" })).toBe(playT("en", "fxNoEffect"));
    expect(playDilemmaFx("ko", { note: "citywall" })).toBe(playT("ko", "fxCitywall"));
    expect(playDilemmaFx("en", { note: "prophecyDeal" })).toBe(playT("en", "fxProphecyDeal"));
    const cond = playDilemmaFx("ko", { note: "prophecyCond", pct: 47 });
    expect(cond).toContain("47%");
    expect(cond).toContain("50%"); // the threshold is stated
  });
  it("fxTruceGain no longer states a duration (durations live in choice labels)", () => {
    expect(playT("en", "fxTruceGain")).not.toMatch(/10|y\)/);
    expect(playT("ko", "fxTruceGain")).not.toContain("10년");
  });
});
