import { describe, it, expect } from "vitest";
import { dailyName, dailyTarget } from "./daily";
import { initialParams } from "./urlState";
import { hashStringToSeed } from "../engine/rng";

describe("dailyName", () => {
  it("keys on the UTC date — the same instant is one world everywhere", () => {
    expect(dailyName(new Date(Date.UTC(2026, 6, 12, 23, 30)))).toBe("daily-2026-07-12");
    expect(dailyName(new Date(Date.UTC(2026, 6, 13, 0, 30)))).toBe("daily-2026-07-13");
  });
});

// This used to pin `play.html`, and the page it named does not exist: the games were deleted and
// only index.html and map.html remain, so one of the two buttons on the front page led to a
// GitHub Pages 404. `nameTargets` was moved off `play.html` at the time — the daily was missed,
// and its test held the broken behaviour in place.
describe("dailyTarget", () => {
  it("routes to a page this site actually has, keeping the readable daily name in the URL", () => {
    expect(dailyTarget(new Date(Date.UTC(2026, 6, 12)))).toBe("map.html#seed=daily-2026-07-12");
  });
  it("gives everyone who opens it on the same UTC day the same world", () => {
    const morning = dailyTarget(new Date(Date.UTC(2026, 6, 12, 1)));
    const midnight = dailyTarget(new Date(Date.UTC(2026, 6, 12, 23, 59)));
    expect(morning).toBe(midnight);
    expect(initialParams(morning.slice(morning.indexOf("#"))).seed)
      .toBe(hashStringToSeed("daily-2026-07-12"));
  });
});
