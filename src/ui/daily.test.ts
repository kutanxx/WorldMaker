import { describe, it, expect } from "vitest";
import { dailyName, dailyTarget } from "./daily";
import { initialParams } from "./urlState";
import { hashStringToSeed } from "../engine/rng";

describe("dailyName", () => {
  // It keyed on the UTC date, and "today" meant the reader's today only in London: in Korea, from
  // midnight to nine in the morning, the front page offered yesterday's world under yesterday's
  // date. A link still names its day outright (`#seed=daily-2026-07-12`), so a shared world opens
  // the same world everywhere — only which day the button calls "today" follows the reader's clock,
  // as the daily puzzles people already know do.
  it("keys on the reader's own calendar date", () => {
    expect(dailyName(new Date(2026, 6, 12, 23, 30))).toBe("daily-2026-07-12");
    expect(dailyName(new Date(2026, 6, 13, 0, 30))).toBe("daily-2026-07-13");
  });
  it("gives a reader in Korea at half past eight in the morning that morning's world, not yesterday's", () => {
    const was = process.env.TZ;
    process.env.TZ = "Asia/Seoul";
    try {
      // 2026-07-12 23:30 UTC is 2026-07-13 08:30 in Seoul.
      expect(dailyName(new Date(Date.UTC(2026, 6, 12, 23, 30)))).toBe("daily-2026-07-13");
    } finally {
      if (was === undefined) delete process.env.TZ; else process.env.TZ = was;
    }
  });
  it("writes the month and day in two digits, so the key is the one a link has always carried", () => {
    expect(dailyName(new Date(2026, 0, 5, 12))).toBe("daily-2026-01-05");
  });
});

// This used to pin `play.html`, and the page it named does not exist: the games were deleted and
// only index.html and map.html remain, so one of the two buttons on the front page led to a
// GitHub Pages 404. `nameTargets` was moved off `play.html` at the time — the daily was missed,
// and its test held the broken behaviour in place.
describe("dailyTarget", () => {
  it("routes to a page this site actually has, keeping the readable daily name in the URL", () => {
    expect(dailyTarget(new Date(2026, 6, 12))).toBe("map.html#seed=daily-2026-07-12");
  });
  it("gives everyone who opens it on the same day the same world", () => {
    const morning = dailyTarget(new Date(2026, 6, 12, 1));
    const midnight = dailyTarget(new Date(2026, 6, 12, 23, 59));
    expect(morning).toBe(midnight);
    expect(initialParams(morning.slice(morning.indexOf("#"))).seed)
      .toBe(hashStringToSeed("daily-2026-07-12"));
  });
});
