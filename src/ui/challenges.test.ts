import { describe, it, expect } from "vitest";
import type { SimState } from "../engine/historySim";
import {
  CHALLENGES, CHALLENGE_BLITZ_GROWTH, CHALLENGE_BLITZ_YEAR,
  CHALLENGE_PHOENIX_LOW_FRAC, CHALLENGE_PHOENIX_HIGH_FRAC, type ChallengeCtx,
} from "./challenges";

// minimal fake: aggregate() only reads owner/solidarity over n and polities.length.
// `cells` = player-0 tiles; the player is polity 0, always the first entry.
function fake(cells: number, tick: number, alive = true): SimState {
  const n = Math.max(cells, 1);
  const owner = new Int32Array(n).fill(0);
  for (let i = cells; i < n; i++) owner[i] = -1;
  return {
    n, owner, solidarity: new Float32Array(n).fill(0.5),
    polities: [{ id: 0 }], playerPolity: 0, alive: [alive], tick,
  } as unknown as SimState;
}
const get = (code: string) => CHALLENGES.find((c) => c.code === code)!;
// targets are relative to startCells, so tests set it explicitly
const ctx = (o: Partial<ChallengeCtx> = {}): ChallengeCtx => ({ everAttacked: false, minCellsEver: 1e9, startCells: 40, ...o });

describe("bloodless", () => {
  it("fails once the player has attacked", () => {
    expect(get("bloodless").evaluate(fake(10, 5), ctx({ everAttacked: true }), false).state).toBe("failed");
  });
  it("is active mid-reign with no attack, done on a non-defeat ending", () => {
    expect(get("bloodless").evaluate(fake(10, 5), ctx(), false).state).toBe("active");
    expect(get("bloodless").evaluate(fake(10, 50), ctx(), true).state).toBe("done");
  });
  it("is not done if the reign ended in defeat (player not alive)", () => {
    expect(get("bloodless").evaluate(fake(0, 50, false), ctx(), true).state).toBe("active");
  });
});

describe("blitz (relative: grow to startCells × growth)", () => {
  const start = 40;
  const target = Math.round(start * CHALLENGE_BLITZ_GROWTH); // 60 at growth 1.5
  const beforeYear = (CHALLENGE_BLITZ_YEAR - 10) / 10; // tick
  const afterYear = (CHALLENGE_BLITZ_YEAR + 10) / 10;
  it("is NOT trivially done at the starting size (the old absolute-target bug)", () => {
    expect(get("blitz").evaluate(fake(start, beforeYear), ctx({ startCells: start }), false).state).toBe("active");
  });
  it("is done once the realm has grown to the relative target before the deadline", () => {
    expect(get("blitz").evaluate(fake(target, beforeYear), ctx({ startCells: start }), false).state).toBe("done");
  });
  it("fails once the deadline passes below the target", () => {
    expect(get("blitz").evaluate(fake(target - 1, afterYear), ctx({ startCells: start }), false).state).toBe("failed");
  });
});

describe("phoenix (relative: fall to startCells × low, recover to × high)", () => {
  const start = 40;
  const lowMark = Math.round(start * CHALLENGE_PHOENIX_LOW_FRAC);  // 12 at 0.3
  const highMark = Math.round(start * CHALLENGE_PHOENIX_HIGH_FRAC); // 36 at 0.9
  it("is NOT low at the starting size — a small nation must still fall relative to its own start", () => {
    const r = get("phoenix").evaluate(fake(start, 3), ctx({ startCells: start, minCellsEver: start }), false);
    expect(r.state).toBe("active");
    expect(r.progress.cells).toBeUndefined(); // no numeric progress before falling low
  });
  it("shows recovery progress once fallen low, and completes at the high mark", () => {
    const recovering = get("phoenix").evaluate(fake(highMark - 5, 30), ctx({ startCells: start, minCellsEver: lowMark }), false);
    expect(recovering.state).toBe("active");
    expect(recovering.progress.cells).toBe(highMark - 5);
    expect(recovering.progress.target).toBe(highMark);
    expect(get("phoenix").evaluate(fake(highMark, 30), ctx({ startCells: start, minCellsEver: lowMark }), false).state).toBe("done");
  });
});
