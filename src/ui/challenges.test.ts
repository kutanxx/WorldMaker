import { describe, it, expect } from "vitest";
import type { SimState } from "../engine/historySim";
import {
  CHALLENGES, CHALLENGE_BLITZ_TILES, CHALLENGE_BLITZ_YEAR,
  CHALLENGE_PHOENIX_LOW, CHALLENGE_PHOENIX_HIGH, type ChallengeCtx,
} from "./challenges";

// minimal fake: aggregate() only reads owner/solidarity over n and polities.length.
// `cells` player-0 tiles; the player is polity 0, always the first entry.
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
const ctx = (o: Partial<ChallengeCtx> = {}): ChallengeCtx => ({ everAttacked: false, minCellsEver: 999, ...o });

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

describe("blitz", () => {
  it("is done at the tile target before the deadline year", () => {
    const year = CHALLENGE_BLITZ_YEAR - 10;
    expect(get("blitz").evaluate(fake(CHALLENGE_BLITZ_TILES, year / 10), ctx(), false).state).toBe("done");
  });
  it("fails once the deadline year passes below target", () => {
    expect(get("blitz").evaluate(fake(CHALLENGE_BLITZ_TILES - 1, (CHALLENGE_BLITZ_YEAR + 10) / 10), ctx(), false).state).toBe("failed");
  });
});

describe("phoenix", () => {
  it("is done only after dropping low then recovering to the high mark", () => {
    expect(get("phoenix").evaluate(fake(CHALLENGE_PHOENIX_HIGH, 30), ctx({ minCellsEver: 999 }), false).state).toBe("active");
    expect(get("phoenix").evaluate(fake(CHALLENGE_PHOENIX_HIGH, 30), ctx({ minCellsEver: CHALLENGE_PHOENIX_LOW }), false).state).toBe("done");
  });
});
