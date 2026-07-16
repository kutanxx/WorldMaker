import type { SimState } from "../engine/historySim";
import { aggregate, YEARS_PER_TICK } from "../engine/historySim";

export type ChallengeState = "active" | "done" | "failed";

// small session history the raw SimState doesn't keep; playApp maintains it across the reign.
export interface ChallengeCtx {
  everAttacked: boolean; // set true the turn the player commits an attack
  minCellsEver: number;  // running min of the player's owned-tile count
  startCells: number;    // the player's tile count at the start of the reign — targets scale off this
}

export interface ChallengeProgress {
  cells?: number; target?: number; year?: number; low?: boolean;
}

export interface Challenge {
  code: "bloodless" | "blitz" | "phoenix";
  icon: string;
  evaluate(s: SimState, ctx: ChallengeCtx, over: boolean): { state: ChallengeState; progress: ChallengeProgress };
}

// tunable targets, RELATIVE to the reign's starting tile count so every nation (tiny or vast) gets
// a meaningful challenge. Blitz = grow to startCells × GROWTH; Phoenix = fall to startCells × LOW,
// then recover to startCells × HIGH. (A sweep can retune the multipliers.)
export const CHALLENGE_BLITZ_GROWTH = 1.5;
export const CHALLENGE_BLITZ_YEAR = 200;
export const CHALLENGE_PHOENIX_LOW_FRAC = 0.3;
export const CHALLENGE_PHOENIX_HIGH_FRAC = 0.9;

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
    evaluate(s, ctx, _over) {
      const cells = playerCells(s);
      const year = s.tick * YEARS_PER_TICK;
      const target = Math.round(ctx.startCells * CHALLENGE_BLITZ_GROWTH);
      const progress: ChallengeProgress = { cells, target, year };
      if (cells >= target) return { state: "done", progress };
      if (year > CHALLENGE_BLITZ_YEAR) return { state: "failed", progress };
      return { state: "active", progress };
    },
  },
  {
    code: "phoenix", icon: "📈",
    evaluate(s, ctx, _over) {
      const cells = playerCells(s);
      const lowMark = Math.round(ctx.startCells * CHALLENGE_PHOENIX_LOW_FRAC);
      const highMark = Math.round(ctx.startCells * CHALLENGE_PHOENIX_HIGH_FRAC);
      const low = ctx.minCellsEver <= lowMark; // has the realm been pushed to a third of its start?
      if (low && cells >= highMark) return { state: "done", progress: { cells, target: highMark, low } };
      // before falling low, show no numeric progress — the goal is FIRST to be driven low; only once
      // fallen do we show the recovery bar toward the high mark.
      return { state: "active", progress: low ? { cells, target: highMark, low } : { low } };
    },
  },
];
