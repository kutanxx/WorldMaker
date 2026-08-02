import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import {
  initFrontSim, tick, aiStep, startAttack, cancelAttack, outcome, maxTroops, regenPerTick,
  goalGain, gainOf, SEA, UNOWNED, TICK_HZ, type FrontState,
} from "../engine/frontSim";
import { nationColor, PLAYER_COLOR } from "./nationPalette";

const PLAYER_FILL = PLAYER_COLOR;
const EMPTY_FILL = "#c8bfa6";

// What to draw, separated from drawing it. jsdom has no canvas backend, so this is the only part of
// rendering that can be tested — and it is the part where a mistake would actually be visible.
// Ascending cell order so a repaint never depends on iteration order.
export function paintPlan(s: FrontState, player: number): { cell: number; fill: string }[] {
  const out: { cell: number; fill: string }[] = [];
  for (let c = 0; c < s.n; c++) {
    const o = s.owner[c];
    if (o === SEA) continue;
    out.push({ cell: c, fill: o === player ? PLAYER_FILL : o === UNOWNED ? EMPTY_FILL : nationColor(o) });
  }
  return out;
}

// What a click on a cell means, separated from the hit-testing that finds the cell. jsdom's
// getContext("2d") is always null, which makes ctx.isPointInPath untestable — but the decision of
// what a click DOES (attack, or nothing) does not need a canvas at all, so it is pulled out here the
// same way paintPlan pulls the paint decision out of draw(). Returns the nation id to attack, or
// null when the click should do nothing: out of range, sea, the player's own land, or the game
// already being over. The outcome check lives HERE rather than in each event handler so both the
// left-click (attack) and right-click (cancel) paths go inert together, for free, by sharing this
// one function — and so the guard can be tested without a canvas at all: a click on a real rival
// cell against a state that already has an outcome must still return null.
export function clickTarget(s: FrontState, player: number, cell: number): number | null {
  if (outcome(s, player)) return null;
  if (cell < 0 || cell >= s.n) return null;
  const o = s.owner[cell];
  if (o === SEA || o === player) return null;
  return o;
}

// The player's own live fronts, ascending by target so the HUD reads in a stable order even though
// `s.attacks` itself can reshuffle (re-committing against an existing front splices it out and
// re-pushes at the end). Troops rounded for display only — the engine keeps the exact float.
export function playerFronts(s: FrontState, player: number): { target: number; pool: number }[] {
  return s.attacks
    .filter((a) => a.attacker === player)
    .map((a) => ({ target: a.target, pool: Math.round(a.pool) }))
    .sort((a, b) => a.target - b.target);
}

// The rival actually being raced toward the same goal, mirroring `leadingRival` in armySim.ts for
// the identical HUD problem — that function lives in the engine because armySim's goal is scoped to
// a theater; frontSim has no such scope, and the constraint here is "do not touch frontSim.ts", so
// the equivalent is built from frontSim's exported primitives (`gainOf`) instead of duplicated there.
// Ascending nation id with a strict `>` so ties go to the lower id, same tie-break as armySim's.
// Dead nations (no tiles) are not a rival worth naming.
export function leadingRival(s: FrontState, player: number): { nation: number; gained: number } | null {
  let best: { nation: number; gained: number } | null = null;
  for (let n = 0; n < s.tiles.length; n++) {
    if (n === player || s.tiles[n] === 0) continue;
    const gained = gainOf(s, n);
    if (!best || gained > best.gained) best = { nation: n, gained };
  }
  return best;
}

// A backgrounded tab can deliver a `now - last` gap of minutes when it resumes. Without a clamp,
// the catch-up loop below would try to simulate the entire gap synchronously in one frame — ten
// minutes is 6,000 ticks, each an O(cells) border scan — and lock up the tab on resume. A tab that
// was away must not try to relive the time it missed, so cap how much elapsed time ever reaches the
// accumulator; the rest is simply lost, same as a dropped frame.
const MAX_FRAME_MS = 250; // a handful of ticks at TICK_HZ, never the whole background gap

export function mountFrontApp(root: HTMLElement, opts: { seed?: number } = {}): () => void {
  const seed = opts.seed ?? 1;
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
  const s = initFrontSim(world);
  const player = [...s.owner].find((o) => o >= 0) ?? 0;
  let commit = 0.2;

  root.innerHTML = "";
  const hud = document.createElement("div");
  hud.className = "front-hud";
  root.appendChild(hud);

  const canvas = document.createElement("canvas");
  canvas.className = "front-map";
  canvas.width = world.grid.width;
  canvas.height = world.grid.height;
  root.appendChild(canvas);

  const bar = document.createElement("div");
  bar.className = "front-controls";
  const label = document.createElement("span");
  label.className = "front-commit-label";
  const slider = document.createElement("input");
  slider.className = "front-commit";
  slider.type = "range";
  slider.min = "1"; slider.max = "100"; slider.value = "20";
  bar.append(slider, label);
  root.appendChild(bar);

  // One Path2D per cell, built once: rebuilding 4,000 paths every frame is the cost this game
  // cannot afford, and it is the reason this page is canvas rather than SVG.
  // jsdom has no Path2D constructor at all (not just a null 2d context), and this loop runs
  // unconditionally at mount time — so it must tolerate the class itself being absent, the same
  // way `ctx` below tolerates being null. Nothing reads `paths` when `ctx` is null anyway.
  const hasPath2D = typeof Path2D === "function";
  const paths: (Path2D | null)[] = [];
  for (let c = 0; c < s.n; c++) {
    if (!hasPath2D) { paths.push(null); continue; }
    const p = new Path2D();
    const poly = world.grid.polygons[c];
    if (poly && poly.length) {
      p.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) p.lineTo(poly[i][0], poly[i][1]);
      p.closePath();
    }
    paths.push(p);
  }

  const ctx = canvas.getContext("2d");   // null under jsdom; everything below must tolerate that

  function draw(): void {
    if (!ctx) return;
    for (const { cell, fill } of paintPlan(s, player)) {
      const path = paths[cell];
      if (!path) continue;
      ctx.fillStyle = fill;
      ctx.fill(path);
    }
  }

  // Display name for a nation id, including the UNOWNED case that both the front list and the
  // rival line can hit — unowned land has no polity entry to fall back on.
  function nationLabel(n: number): string {
    return n === UNOWNED ? "미개척지" : world.polities[n]?.name ?? String(n);
  }

  function renderHud(): void {
    const pool = Math.round(s.troops[player]);
    const cap = Math.round(maxTroops(s, player));
    const rate = Math.round(regenPerTick(s, player) * TICK_HZ);
    const goal = goalGain(s);
    const gained = gainOf(s, player);
    const gainStr = `${gained >= 0 ? "+" : ""}${gained}`;
    const fronts = playerFronts(s, player);
    // Compact by design: a one-line HUD, not a panel — so the label carries "how many" and "against
    // whom", and the parenthesised list carries "how many troops are out" per front.
    const frontSeg = fronts.length
      ? ` · 전선 ${fronts.length}곳: ${fronts.map((f) => `${nationLabel(f.target)} ${f.pool}`).join(", ")}`
      : "";
    const rival = leadingRival(s, player);
    const rivalSeg = rival
      ? ` · 추격 ${nationLabel(rival.nation)} ${rival.gained >= 0 ? "+" : ""}${rival.gained}/${goal}`
      : "";
    const oc = outcome(s, player);
    hud.textContent =
      `병력 ${pool} / ${cap} · +${rate}/s · 영토 ${s.tiles[player]} · 정복 ${gainStr}/${goal}` +
      `${frontSeg}${rivalSeg}` +
      (oc ? ` · ${oc.kind === "victory" ? "승리" : oc.kind === "defeat" ? "패배" : "추월당함"}` : "");
    label.textContent = `${slider.value}% (${Math.round(s.troops[player] * commit)})`;
    // The map's own CSS class defaults to cursor: pointer; once there is an outcome a click does
    // nothing (clickTarget already refuses), so the pointer cursor becomes a lie inviting a click
    // that goes nowhere. An empty string falls back to that class rule when the game is still live.
    canvas.style.cursor = oc ? "default" : "";
  }

  slider.addEventListener("input", () => { commit = Number(slider.value) / 100; renderHud(); });

  // Shared by the left-click (attack) and right-click (cancel) handlers below, so the coordinate
  // math that converts a DOM event into a cell id exists exactly once.
  function hitTest(ev: MouseEvent): number {
    if (!ctx) return -1;
    const rect = canvas.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((ev.clientY - rect.top) / rect.height) * canvas.height;
    for (let c = 0; c < s.n; c++) {
      const path = paths[c];
      if (path && ctx.isPointInPath(path, x, y)) return c;
    }
    return -1;
  }

  canvas.addEventListener("click", (ev) => {
    // Hit-testing only; clickTarget owns the decision of what the click means — including refusing
    // once the game has an outcome, so there is nothing more to gate here.
    const target = clickTarget(s, player, hitTest(ev));
    if (target === null) return;
    startAttack(s, player, target, commit);
    renderHud();
  });

  // The natural undo affordance for a commitment that is otherwise irrevocable: right-click a
  // target you are attacking to call its troops home. preventDefault always fires so the browser's
  // own context menu never covers the map, win or lose; clickTarget's outcome check is what makes
  // the cancel itself a no-op once the game is over.
  canvas.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    const target = clickTarget(s, player, hitTest(ev));
    if (target === null) return;
    cancelAttack(s, player, target);
    renderHud();
  });

  renderHud();
  draw();

  // Real time lives here and nowhere else: the loop decides WHEN to step, the engine decides WHAT a
  // step is. An accumulator keeps the simulation rate fixed regardless of framerate, which is what
  // keeps a replay of the same commands identical.
  let last = 0, acc = 0;
  let rafHandle: number | null = null;
  let stopped = false;
  function frame(now: number): void {
    if (stopped) return; // a frame already queued before stop() must not resurrect the loop
    if (last) {
      acc += Math.min(now - last, MAX_FRAME_MS);
      const step = 1000 / TICK_HZ;
      while (acc >= step) { aiStep(s, player); tick(s); acc -= step; }
      renderHud();
      draw();
    }
    last = now;
    rafHandle = !outcome(s, player) && typeof requestAnimationFrame === "function"
      ? requestAnimationFrame(frame)
      : null;
  }
  if (typeof requestAnimationFrame === "function") rafHandle = requestAnimationFrame(frame);

  // Stops the loop for good: reaching an outcome does this on its own (frame() stops rescheduling),
  // but nothing previously let a caller do it early. Without this, mounting twice — a restart
  // button, or a second mount in a test — leaves the first simulation's loop ticking forever against
  // a now-detached DOM.
  function stop(): void {
    if (stopped) return;
    stopped = true;
    if (rafHandle !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
  return stop;
}
