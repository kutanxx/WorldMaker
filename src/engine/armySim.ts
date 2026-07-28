import type { World } from "../types/world";
import { buildProvinceAdj } from "./provinceSim";
import { OCEAN, TUNDRA, TAIGA, TEMPERATE_FOREST, GRASSLAND, DESERT, TROPICAL, WETLAND, ALPINE } from "./biome";
import { mulberry32, deriveSeed } from "./rng";

// --- tunable constants (the whole balance surface of the prototype lives here) ---
export const LEVY_FRAC = 0.2;      // max share of a province's population one levy takes
export const REGROW_FRAC = 0.03;   // share of basePop regained per turn
export const UPKEEP_FRAC = 0.03;   // share of an army lost per turn (use it or lose it)
export const MILITIA_FRAC = 0.2;   // share of a province's population that defends it in battle
export const WIN_LOSS_MULT = 0.6;  // winner's losses as a share of the loser's effective strength
export const CITY_BONUS = 0.5;     // population multiplier added per city in the province
export const POP_SCALE = 20;      // people per "cell-unit" — sets the game's numeric scale so levies
                                  // and upkeep survive integer floors and read like real armies
export const ODDS_K = 3;          // sharpness of the odds curve: 2:1 ~ 89%, 1:1 = 50%
export const DEF_LOSS_MULT = 0.35; // a repelled attack still bleeds the defender — holding is not free

// population potential by biome: rich plains, empty mountains
export const BIOME_POP: Record<number, number> = {
  [OCEAN]: 0, [GRASSLAND]: 1.0, [TEMPERATE_FOREST]: 0.8, [TROPICAL]: 0.7,
  [TAIGA]: 0.5, [WETLAND]: 0.5, [TUNDRA]: 0.3, [DESERT]: 0.3, [ALPINE]: 0.25,
};

// defensibility by biome. Below 1.0 = the ATTACKER is favoured (open ground), so defence
// never simply pays and the map cannot stalemate.
export const BIOME_DEF: Record<number, number> = {
  [OCEAN]: 1.0, [GRASSLAND]: 0.85, [DESERT]: 0.9, [TUNDRA]: 1.0, [TROPICAL]: 1.15,
  [TEMPERATE_FOREST]: 1.2, [TAIGA]: 1.2, [WETLAND]: 1.35, [ALPINE]: 1.6,
};

// movedOn is optional (rather than required) so pre-existing tests that construct Army
// literals directly (before this field existed) keep compiling unchanged; a missing value
// behaves exactly like -1 (never moved this turn) everywhere it is read.
export interface Army { prov: number; nation: number; men: number; movedOn?: number }

export interface ArmyState {
  world: World;
  n: number;
  owner: Int32Array;      // province -> nation id (-1 unowned)
  pop: Float64Array;      // province -> current population
  basePop: Float64Array;  // province -> population ceiling
  armies: Army[];
  adj: number[][];
  turn: number;
  scope?: Uint8Array; // 1 = in the current theater; absent = whole map
  startCounts: Int32Array; // province count per nation when the game began — every nation races from its own start
  // leviedOn is optional (rather than required) so pre-existing tests that construct ArmyState by hand
  // (before this field existed) keep compiling unchanged; a missing array behaves exactly like "never
  // levied" everywhere it is read. -1 = never levied; otherwise the last turn this province was levied.
  leviedOn?: Int32Array;
}

// a province's population ceiling, derived from the generated world: size x biome x cities.
export function basePopOf(world: World, provId: number): number {
  const p = world.provinces[provId];
  if (!p) return 0;
  let cities = 0;
  for (const c of world.cities) if (world.provinceOf[c.cell] === provId) cities++;
  return p.cells * (BIOME_POP[p.biome] ?? 0) * (1 + CITY_BONUS * cities) * POP_SCALE;
}

// each province's majority owner over its cells (ties -> lower id; unowned -> -1)
function majorityOwner(world: World, nProv: number): Int32Array {
  const tally: Map<number, number>[] = Array.from({ length: nProv }, () => new Map<number, number>());
  for (let c = 0; c < world.provinceOf.length; c++) {
    const p = world.provinceOf[c];
    if (p < 0 || p >= nProv) continue;
    const o = world.polityOf[c];
    if (o < 0) continue;
    tally[p].set(o, (tally[p].get(o) ?? 0) + 1);
  }
  const out = new Int32Array(nProv).fill(-1);
  for (let p = 0; p < nProv; p++) {
    let best = -1, bestN = 0;
    for (const [o, k] of tally[p]) if (k > bestN || (k === bestN && o < best)) { bestN = k; best = o; }
    out[p] = best;
  }
  return out;
}

export function initArmySim(world: World): ArmyState {
  const n = world.provinces.length;
  const owner = majorityOwner(world, n);
  // a nation must not start capital-less: force each capital's province to its polity
  for (const pol of world.polities) {
    const cap = world.provinceOf[pol.capital];
    if (cap >= 0) owner[cap] = pol.id;
  }
  const basePop = new Float64Array(n);
  const pop = new Float64Array(n);
  for (let p = 0; p < n; p++) { basePop[p] = basePopOf(world, p); pop[p] = basePop[p]; }
  const adj = buildProvinceAdj(world.provinceOf, world.provinces, world.grid);
  const startCounts = new Int32Array(world.polities.length);
  for (let p = 0; p < n; p++) { const o = owner[p]; if (o >= 0 && o < startCounts.length) startCounts[o]++; }
  const leviedOn = new Int32Array(n).fill(-1);
  return { world, n, owner, pop, basePop, armies: [], adj, turn: 0, startCounts, leviedOn };
}

export function armyAt(s: ArmyState, prov: number, nation: number): Army | undefined {
  return s.armies.find((a) => a.prov === prov && a.nation === nation);
}

// men one levy can raise from a province right now
export function maxLevy(s: ArmyState, prov: number): number {
  if (prov < 0 || prov >= s.n) return 0;
  return Math.floor(s.pop[prov] * LEVY_FRAC);
}

// the levy clock, allocated on first use so hand-built fixtures without it still work (mirrors
// provinceSim's unrestArr pattern).
function leviedOnArr(s: ArmyState): Int32Array {
  if (!s.leviedOn || s.leviedOn.length !== s.n) s.leviedOn = new Int32Array(s.n).fill(-1);
  return s.leviedOn;
}

// whether `nation` may levy `prov` right now: owned, something left to raise, and not already
// levied this turn. The UI asks this before attempting, so it can disable the button outright
// instead of letting a click silently do nothing.
export function canLevy(s: ArmyState, prov: number, nation: number): boolean {
  if (nation < 0 || prov < 0 || prov >= s.n || s.owner[prov] !== nation) return false;
  if (maxLevy(s, prov) <= 0) return false;
  return leviedOnArr(s)[prov] !== s.turn;
}

// raise men from an owned province: the population really leaves the land. One levy per province
// per turn — over-levying is meant to hollow a province out ACROSS turns (the population regrows
// slowly via REGROW_FRAC), not be bypassed by clicking the same province repeatedly in one turn.
export function levy(s: ArmyState, prov: number, nation: number): number {
  if (!canLevy(s, prov, nation)) return 0;
  const men = maxLevy(s, prov);
  s.pop[prov] -= men;
  const a = armyAt(s, prov, nation);
  if (a) a.men += men; else s.armies.push({ prov, nation, men, movedOn: -1 });
  leviedOnArr(s)[prov] = s.turn;
  return men;
}

// a mobilised army bleeds every turn — you must use it or lose it (the anti-turtle force).
export function applyUpkeep(s: ArmyState): void {
  for (const a of s.armies) a.men -= Math.max(1, Math.floor(a.men * UPKEEP_FRAC));
  s.armies = s.armies.filter((a) => a.men > 0);
}

export function regrow(s: ArmyState): void {
  for (let p = 0; p < s.n; p++) {
    const v = s.pop[p] + s.basePop[p] * REGROW_FRAC;
    s.pop[p] = v > s.basePop[p] ? s.basePop[p] : v;
  }
}

// the province's own people take up arms when attacked. Computed at battle time, so a province
// hollowed out by over-levying really is defenceless. Militia cannot move.
export function militiaOf(s: ArmyState, prov: number): number {
  if (prov < 0 || prov >= s.n) return 0;
  return Math.floor(s.pop[prov] * MILITIA_FRAC);
}

// effective defence of `prov` against `attacker`: every non-attacker army standing there plus the
// militia, all multiplied by how defensible the terrain is.
export function defenceOf(s: ArmyState, prov: number, attacker: number): number {
  if (prov < 0 || prov >= s.n) return 0;
  let men = 0;
  for (const a of s.armies) if (a.prov === prov && a.nation !== attacker) men += a.men;
  const mult = BIOME_DEF[s.world.provinces[prov].biome] ?? 1;
  return (men + militiaOf(s, prov)) * mult;
}

export interface BattleResult { won: boolean; atk: number; def: number; p: number; attackerLosses: number; captured: boolean }

// Win probability from the strength ratio, sharpened by ODDS_K so overwhelming force is nearly safe
// while an even fight is a coin flip. That gamble is the decision the deterministic version lacked.
export function winChance(atk: number, def: number): number {
  if (atk <= 0) return 0;
  if (def <= 0) return 1;
  const a = Math.pow(atk, ODDS_K), d = Math.pow(def, ODDS_K);
  return a / (a + d);
}

// The battle's die. NOT Math.random: a pure hash of (world seed, turn, target, attacker), so the game
// stays perfectly replayable — the same seed and the same commands reproduce every outcome — while the
// player cannot predict any single result.
export function battleRoll(s: ArmyState, target: number, attacker: number): number {
  const seed = deriveSeed(deriveSeed(deriveSeed(s.world.params.seed, s.turn + 1), target + 1), attacker + 1);
  return mulberry32(seed)();
}

function resolve(s: ArmyState, prov: number, nation: number, target: number): BattleResult | null {
  const army = armyAt(s, prov, nation);
  if (!army || !s.adj[prov]?.includes(target)) return null;
  if (s.owner[target] === nation) return { won: true, atk: army.men, def: 0, p: 1, attackerLosses: 0, captured: false };
  const atk = army.men;
  const def = defenceOf(s, target, nation);
  const p = winChance(atk, def);
  const won = battleRoll(s, target, nation) < p;
  // a near-run fight is ruinous, a rout is cheap: scale the winner's losses by how close it was.
  const closeness = Math.max(atk, def) > 0 ? Math.min(atk, def) / Math.max(atk, def) : 0;
  // Math.min guards a future WIN_LOSS_MULT >= 1 from producing negative men.
  const attackerLosses = won ? Math.min(atk, Math.round(def * WIN_LOSS_MULT * closeness)) : atk;
  return { won, atk, def, p, attackerLosses, captured: won };
}

// PURE forecast of a move — same arithmetic the real move runs, so the preview can never lie.
export function previewMove(s: ArmyState, prov: number, nation: number, target: number): BattleResult | null {
  return resolve(s, prov, nation, target);
}

// march or attack. On a win the army occupies the target (and the land, with its population, changes
// hands — that population is levyable next turn, which is what makes attacking compound).
export function moveArmy(s: ArmyState, prov: number, nation: number, target: number): BattleResult | null {
  const before = armyAt(s, prov, nation);
  if (before && before.movedOn === s.turn) return null;  // one move per army per turn
  const r = resolve(s, prov, nation, target);
  if (!r) return null;
  const army = armyAt(s, prov, nation)!;
  if (!r.won) {                                   // wiped out — but the defender bleeds too
    s.armies = s.armies.filter((a) => a !== army);
    let toll = Math.round(r.atk * DEF_LOSS_MULT);
    for (const d of s.armies) {                   // garrison first
      if (d.prov !== target || toll <= 0) continue;
      const hit = Math.min(d.men, toll);
      d.men -= hit; toll -= hit;
    }
    s.armies = s.armies.filter((a) => a.men > 0);
    if (toll > 0) s.pop[target] = Math.max(0, s.pop[target] - toll); // the militia that died
    return r;
  }
  // losses, then relocate the survivors onto the target
  army.men -= r.attackerLosses;
  const militiaLost = r.captured ? militiaOf(s, target) : 0;
  s.armies = s.armies.filter((a) => a !== army);
  if (r.captured) {
    s.armies = s.armies.filter((a) => a.prov !== target);  // the defenders are destroyed
    s.pop[target] = Math.max(0, s.pop[target] - militiaLost);
    s.owner[target] = nation;
  }
  if (army.men > 0) {
    const there = armyAt(s, target, nation);
    // movedOn is always set to THIS turn, never inherited from the mover — otherwise merging a
    // fresh army into an already-spent stack would launder the stack back to "hasn't moved".
    if (there) { there.men += army.men; there.movedOn = s.turn; }
    else s.armies.push({ prov: target, nation, men: army.men, movedOn: s.turn });
  }
  return r;
}

// a human player levies from many provinces and moves every army each turn; an AI that only ever
// touches its single best province and its single biggest army mobilises roughly n-times slower than
// that (n = the nation's province count), so it can never concentrate enough force to crack a
// defended player and the map freezes. AI_LEVY_FRAC ties the AI's mobilisation to its own size instead
// of a flat "one", so a big nation musters proportionally more without needing per-nation tuning.
export const AI_LEVY_FRAC = 0.25;

// A province owned by the race leader is worth more than its raw value — this is the whole
// leader-check. It only reorders targets the AI could already beat; it never overrides the
// winnability test in aiTurn. That restraint is deliberate: the winner of a battle loses
// def x WIN_LOSS_MULT x closeness, so close fights are ruinous and an AI pushed into the strongest
// nation would grind itself down. Set to 1 to restore the unbiased AI exactly.
export const AI_LEADER_BIAS = 2;

// `leader >= 0` is load-bearing: unowned provinces carry owner -1 and raceLeader returns -1 when
// nobody qualifies, so without the guard every wasteland would score as the leader's land.
function leaderWeight(s: ArmyState, prov: number, leader: number): number {
  return leader >= 0 && s.owner[prov] === leader ? AI_LEADER_BIAS : 1;
}

// What this nation is trying to take. Scored by value-for-defence — population is what becomes
// soldiers next turn, so the AI should want the same provinces a player wants, not merely the
// emptiest wasteland on its border (which is what "lowest defence" alone picks). Ties -> lower id.
export function aiObjective(s: ArmyState, nation: number, leader = -1): number {
  let best = -1, bestScore = -Infinity;
  for (let p = 0; p < s.n; p++) {
    if (s.owner[p] === nation) continue;
    let touches = false;
    for (const q of s.adj[p]) if (s.owner[q] === nation) { touches = true; break; }
    if (!touches) continue;
    const score = leaderWeight(s, p, leader) * s.pop[p] / (1 + defenceOf(s, p, nation));
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}

// One step along a shortest path from `from` to `to` through provinces this nation OWNS. BFS with an
// ascending-id frontier so the path (and therefore the whole game) stays deterministic. -1 when `to`
// is not reachable through own territory, or when `from` is already `to`.
export function stepToward(s: ArmyState, from: number, to: number, nation: number): number {
  if (from === to) return -1;
  const prev = new Int32Array(s.n).fill(-1);
  const seen = new Uint8Array(s.n);
  seen[from] = 1;
  let frontier = [from];
  while (frontier.length) {
    const next: number[] = [];
    for (const u of frontier) {
      for (const v of [...s.adj[u]].sort((a, b) => a - b)) {
        if (seen[v]) continue;
        if (v !== to && s.owner[v] !== nation) continue;   // may only march through own land
        seen[v] = 1; prev[v] = u;
        if (v === to) {                                    // walk back to the first step
          let cur = v;
          while (prev[cur] !== from) cur = prev[cur];
          return cur;
        }
        next.push(v);
      }
    }
    next.sort((a, b) => a - b);
    frontier = next;
  }
  return -1;
}

// Deliberately dumb AI: enough for the world to push back while we test whether the loop is fun.
// Each non-player nation levies from its AI_LEVY_FRAC most populous owned provinces, then concentrates
// its armies on the front instead of idling. Deterministic: province selection sorts by population
// descending then id ascending; armies are processed in ascending province-id order; target and front
// selection tie-break on lower id.
export function aiTurn(s: ArmyState, playerNation: number): void {
  const nations = [...new Set([...s.owner].filter((o) => o >= 0 && o !== playerNation))].sort((a, b) => a - b);
  const leader = raceLeader(s);   // computed once: the turn's outcome must not depend on nation order
  for (const nation of nations) {
    // 1. levy from the n most populous owned provinces
    const owned: number[] = [];
    for (let p = 0; p < s.n; p++) if (s.owner[p] === nation) owned.push(p);
    owned.sort((a, b) => (s.pop[b] - s.pop[a]) || (a - b));
    const nLevy = Math.max(1, Math.ceil(owned.length * AI_LEVY_FRAC));
    for (let i = 0; i < nLevy && i < owned.length; i++) levy(s, owned[i], nation);

    // 2. concentrate. Each army fights if it can win where it stands; otherwise it marches toward the
    // front rather than standing still for the rest of the game bleeding upkeep. Snapshot positions
    // first because moveArmy mutates s.armies (removes/merges/relocates).
    const obj = aiObjective(s, nation, leader);
    let front = -1, frontMen = -1;
    if (obj >= 0) {
      for (const q of s.adj[obj]) {
        if (s.owner[q] !== nation) continue;
        const men = armyAt(s, q, nation)?.men ?? 0;
        if (men > frontMen || (men === frontMen && (front < 0 || q < front))) { frontMen = men; front = q; }
      }
    }
    const positions = s.armies.filter((a) => a.nation === nation).map((a) => a.prov).sort((a, b) => a - b);
    for (const prov of positions) {
      const army = armyAt(s, prov, nation);
      if (!army) continue;                       // merged away by an earlier move this turn
      // fight if this army can win where it stands — best value-for-defence among what it can beat
      let target = -1, bestScore = -Infinity;
      for (const q of s.adj[army.prov]) {
        if (s.owner[q] === nation) continue;
        const d = defenceOf(s, q, nation);
        if (d >= army.men) continue;
        const score = leaderWeight(s, q, leader) * s.pop[q] / (1 + d);
        if (score > bestScore) { bestScore = score; target = q; }
      }
      if (target >= 0) { moveArmy(s, army.prov, nation, target); continue; }
      // otherwise walk toward the front so force accumulates where it will matter
      if (front >= 0 && army.prov !== front) {
        const step = stepToward(s, army.prov, front, nation);
        if (step >= 0) moveArmy(s, army.prov, nation, step);
      }
    }
  }
}

export function endTurn(s: ArmyState, playerNation: number): void {
  aiTurn(s, playerNation);
  applyUpkeep(s);
  regrow(s);
  s.turn++;
}

// The province graph splits into land-connected components; armies move only by land, so two
// components can never interact. Deterministic: provinces scanned ascending, ids in first-seen order.
export function landComponents(s: ArmyState): Int32Array {
  const comp = new Int32Array(s.n).fill(-1);
  let next = 0;
  for (let i = 0; i < s.n; i++) {
    if (comp[i] >= 0) continue;
    const stack = [i]; comp[i] = next;
    while (stack.length) {
      const u = stack.pop()!;
      for (const v of s.adj[u]) if (comp[v] < 0) { comp[v] = next; stack.push(v); }
    }
    next++;
  }
  return comp;
}

// the landmass this nation actually plays on: every province reachable by land from its territory.
export function theaterOf(s: ArmyState, nation: number): Uint8Array {
  const comp = landComponents(s);
  const mine = new Set<number>();
  for (let p = 0; p < s.n; p++) if (s.owner[p] === nation) mine.add(comp[p]);
  const mask = new Uint8Array(s.n);
  for (let p = 0; p < s.n; p++) if (mine.has(comp[p])) mask[p] = 1;
  return mask;
}

export function setTheater(s: ArmyState, nation: number): void { s.scope = theaterOf(s, nation); }

// nations worth offering: those with at least one rival reachable by land. A nation alone on an
// island can neither attack nor be attacked, so picking it is 50 turns of pressing "end turn".
export function playableNations(s: ArmyState): number[] {
  const comp = landComponents(s);
  const byComp = new Map<number, Set<number>>();
  for (let p = 0; p < s.n; p++) {
    const o = s.owner[p];
    if (o < 0) continue;
    if (!byComp.has(comp[p])) byComp.set(comp[p], new Set());
    byComp.get(comp[p])!.add(o);
  }
  const out = new Set<number>();
  for (const nations of byComp.values()) if (nations.size >= 2) for (const n of nations) out.add(n);
  return [...out].sort((a, b) => a - b);
}

// whether a province counts at all: absent scope means the whole map is in play.
const inScope = (s: ArmyState, p: number) => !s.scope || s.scope[p] === 1;

// --- goal: what you are racing toward, and how a game ends ---
export const HORIZON = 50;      // the game ends here and ranks you — a real ending, not a soft stop

// provinces that can be owned at all (the denominator the goal is a fraction of)
export function landProvinces(s: ArmyState): number {
  let k = 0;
  for (let p = 0; p < s.n; p++) if ((s.basePop[p] > 0 || s.owner[p] >= 0) && inScope(s, p)) k++;
  return k;
}

// Victory is measured by what you CONQUERED, not by what you happen to hold. Additive so it is
// start-fair: a 3-province realm and an 18-province realm must both take the same absolute number of
// provinces, a big start never wins at t0 (gain is 0), and a small start cannot win by grabbing two
// neighbours. (The province game learned this same lesson; an absolute threshold favours big starts.)
export const GOAL_GAIN_FRAC = 0.3;

export function goalGain(s: ArmyState): number {
  return Math.round(GOAL_GAIN_FRAC * landProvinces(s));
}

// what the HUD shows AND what victory is tested against — one source, so they cannot drift.
// `gained` is deliberately NOT clamped: a realm below its start is the losing state to surface.
export function goalProgress(s: ArmyState, nation: number, startProv: number): { gained: number; goal: number } {
  return { gained: provinceCount(s, nation) - startProv, goal: goalGain(s) };
}

export function provinceCount(s: ArmyState, nation: number): number {
  let k = 0;
  for (let p = 0; p < s.n; p++) if (s.owner[p] === nation && inScope(s, p)) k++;
  return k;
}

// a nation's progress toward the SAME goal the player races for, measured from its own starting size.
export function nationProgress(s: ArmyState, nation: number): { gained: number; goal: number } {
  return { gained: provinceCount(s, nation) - (s.startCounts[nation] ?? 0), goal: goalGain(s) };
}

// the rival closest to winning — what the player is actually racing. Ties break on the lower polity id.
// Only nations that still hold land inside the theater are considered.
export function leadingRival(s: ArmyState, player: number): { nation: number; gained: number; goal: number } | null {
  const seen = new Set<number>();
  for (let p = 0; p < s.n; p++) {
    const o = s.owner[p];
    if (o >= 0 && o !== player && (!s.scope || s.scope[p] === 1)) seen.add(o);
  }
  let best: { nation: number; gained: number; goal: number } | null = null;
  for (const n of [...seen].sort((a, b) => a - b)) {
    const pr = nationProgress(s, n);
    if (!best || pr.gained > best.gained) best = { nation: n, ...pr };
  }
  return best;
}

// How far along the race a nation must be before anyone treats it as the leader. Derived from
// the goal rather than a flat province count, so it scales with the theater instead of needing
// per-map tuning: goal 27 -> 6, goal 7 -> 2. Below this a "lead" is noise -- one conquest on
// turn 1 made the player the whole world's target, and small realms, whose early growth spurt
// is how they survive at all, were the ones it hit.
export const LEAD_MIN_FRAC = 0.2;

// Who is winning the race — measured by conquest since each nation's own start, the same number the
// HUD shows. The PLAYER IS INCLUDED: a player running away with the game is the case this exists to
// cover. Size is deliberately not the metric — this game replaced an absolute goal with a start-fair
// one because size at t0 is an accident of the map, and a large nation that has gained nothing has
// not earned a coalition against it.
//
// `gained` must clear LEAD_MIN_FRAC of the goal, not just be positive. Live play showed `gained > 0`
// sets the bar at noise: the player was crowned leader at turn 1 for a single conquest, and a
// 4-province realm was flagged at +4 while a 29-province giant sitting at +3 was not — punishing
// exactly the early growth spurt a small realm needs to survive. Requiring a fifth of the goal means
// a lead has to be worth something before the world reacts to it. This still covers the t0 case:
// startCounts is snapshotted at init, so every nation's `gained` is exactly 0 at t0, and
// Math.ceil(LEAD_MIN_FRAC * goal) is at least 1 for any positive goal — so 0 always falls short and
// the tie-break never gets a chance to crown the lowest-id nation for no reason but its id.
//
// Ties -> lower polity id. -1 when nobody holds theater land, or when nobody clears the threshold.
export function raceLeader(s: ArmyState): number {
  const seen = new Set<number>();
  for (let p = 0; p < s.n; p++) {
    const o = s.owner[p];
    if (o >= 0 && (!s.scope || s.scope[p] === 1)) seen.add(o);
  }
  // Math.max(1, ...): a one-province theater makes goalGain(s) round down to 0, which would make
  // the guard above vacuous — every `gained >= 0` nation qualifies, including everyone at t0 — and
  // crown the lowest-id nation for no reason but its id, exactly the hole the comment above says is
  // closed. The floor keeps that guarantee true unconditionally instead of only for positive goals.
  const minGained = Math.max(1, Math.ceil(LEAD_MIN_FRAC * goalGain(s)));
  let best = -1, bestGained = minGained - 1;   // below-threshold gains never win, even by the tie-break
  for (const n of [...seen].sort((a, b) => a - b)) {
    const g = nationProgress(s, n).gained;
    if (g > bestGained) { bestGained = g; best = n; }
  }
  return best;
}

// standing among nations that still hold land; ties -> lower polity id ranks first.
export function nationRank(s: ArmyState, nation: number): { rank: number; of: number } {
  const alive: { id: number; k: number }[] = [];
  const seen = new Set<number>();
  for (let p = 0; p < s.n; p++) {
    const o = s.owner[p];
    if (o >= 0 && !seen.has(o) && inScope(s, p)) { seen.add(o); alive.push({ id: o, k: provinceCount(s, o) }); }
  }
  alive.sort((a, b) => b.k - a.k || a.id - b.id);
  const idx = alive.findIndex((x) => x.id === nation);
  return { rank: idx < 0 ? alive.length + 1 : idx + 1, of: alive.length };
}

export type Outcome =
  | { kind: "defeat" }
  | { kind: "victory" }
  | { kind: "outpaced"; by: number }
  | { kind: "horizon"; rank: number; of: number }
  | null;

// Checked before the player acts each turn, in this order: death first (it outranks everything),
// then the player's own conquest goal, then whether a rival got there first (the player wins any
// tie, since they act first within a turn), then the horizon.
export function outcome(s: ArmyState, nation: number, startProv: number): Outcome {
  if (provinceCount(s, nation) === 0) return { kind: "defeat" };
  const { gained, goal } = goalProgress(s, nation, startProv);
  if (gained >= goal) return { kind: "victory" };
  const lead = leadingRival(s, nation);
  if (lead && lead.gained >= lead.goal) return { kind: "outpaced", by: lead.nation };
  if (s.turn >= HORIZON) { const { rank, of } = nationRank(s, nation); return { kind: "horizon", rank, of }; }
  return null;
}
