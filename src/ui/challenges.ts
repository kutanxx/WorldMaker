import type { SimState } from "../engine/historySim";
import { aggregate, YEARS_PER_TICK } from "../engine/historySim";

export type ChallengeState = "active" | "done" | "failed";

// small session history the raw SimState doesn't keep; playApp maintains it across the reign.
export interface ChallengeCtx {
  everAttacked: boolean; // set true the turn the player commits an attack
  minCellsEver: number;  // running min of the player's owned-tile count
}

export interface ChallengeProgress {
  cells?: number; target?: number; year?: number; low?: boolean;
}

export interface Challenge {
  code: "bloodless" | "blitz" | "phoenix";
  icon: string;
  evaluate(s: SimState, ctx: ChallengeCtx, over: boolean): { state: ChallengeState; progress: ChallengeProgress };
}

// tunable placeholder targets (a sweep tunes them post-implementation)
export const CHALLENGE_BLITZ_TILES = 100;
export const CHALLENGE_BLITZ_YEAR = 200;
export const CHALLENGE_PHOENIX_LOW = 15;
export const CHALLENGE_PHOENIX_HIGH = 50;

function playerCells(s: SimState): number {
  return aggregate(s)[s.playerPolity]?.cells ?? 0;
}

export const CHALLENGES: Challenge[] = [
  {
    code: "bloodless", icon: "🕊",
    evaluate(s, ctx, over) {
      if (ctx.everAttacked) return { state: "failed", progress: {} };
      if (over && s.alive[s.playerPolity]) return { state: "done", progress: {} };
      return { state: "active", progress: { year: s.tick * YEARS_PER_TICK } };
    },
  },
  {
    code: "blitz", icon: "⚡",
    evaluate(s, _ctx, _over) {
      const cells = playerCells(s);
      const year = s.tick * YEARS_PER_TICK;
      const progress: ChallengeProgress = { cells, target: CHALLENGE_BLITZ_TILES, year };
      if (cells >= CHALLENGE_BLITZ_TILES) return { state: "done", progress };
      if (year > CHALLENGE_BLITZ_YEAR) return { state: "failed", progress };
      return { state: "active", progress };
    },
  },
  {
    code: "phoenix", icon: "📈",
    evaluate(s, ctx, _over) {
      const cells = playerCells(s);
      const low = ctx.minCellsEver <= CHALLENGE_PHOENIX_LOW;
      const progress: ChallengeProgress = { cells, target: CHALLENGE_PHOENIX_HIGH, low };
      if (low && cells >= CHALLENGE_PHOENIX_HIGH) return { state: "done", progress };
      return { state: "active", progress };
    },
  },
];
