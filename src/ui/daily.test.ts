import { describe, it, expect } from "vitest";
import { dailyName, dailyTarget } from "./daily";

describe("dailyName", () => {
  it("keys on the UTC date — the same instant is one world everywhere", () => {
    expect(dailyName(new Date(Date.UTC(2026, 6, 12, 23, 30)))).toBe("daily-2026-07-12");
    expect(dailyName(new Date(Date.UTC(2026, 6, 13, 0, 30)))).toBe("daily-2026-07-13");
  });
});

describe("dailyTarget", () => {
  it("routes to play with the readable daily name in the URL", () => {
    expect(dailyTarget(new Date(Date.UTC(2026, 6, 12)))).toBe("play.html#seed=daily-2026-07-12");
  });
});
