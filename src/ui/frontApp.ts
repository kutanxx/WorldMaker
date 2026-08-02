import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import {
  initFrontSim, tick, aiStep, startAttack, outcome, maxTroops, regenPerTick,
  SEA, UNOWNED, TICK_HZ, type FrontState,
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
// null when the click should do nothing: out of range, sea, or the player's own land.
export function clickTarget(s: FrontState, player: number, cell: number): number | null {
  if (cell < 0 || cell >= s.n) return null;
  const o = s.owner[cell];
  if (o === SEA || o === player) return null;
  return o;
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

  function renderHud(): void {
    const pool = Math.round(s.troops[player]);
    const cap = Math.round(maxTroops(s, player));
    const rate = Math.round(regenPerTick(s, player) * TICK_HZ);
    const oc = outcome(s, player);
    hud.textContent =
      `병력 ${pool} / ${cap} · +${rate}/s · 영토 ${s.tiles[player]}` +
      (oc ? ` · ${oc.kind === "victory" ? "승리" : oc.kind === "defeat" ? "패배" : "추월당함"}` : "");
    label.textContent = `${slider.value}% (${Math.round(s.troops[player] * commit)})`;
  }

  slider.addEventListener("input", () => { commit = Number(slider.value) / 100; renderHud(); });

  canvas.addEventListener("click", (ev) => {
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((ev.clientY - rect.top) / rect.height) * canvas.height;
    let hit = -1;
    for (let c = 0; c < s.n; c++) {
      const path = paths[c];
      if (path && ctx.isPointInPath(path, x, y)) { hit = c; break; }
    }
    // Hit-testing only; clickTarget owns the decision of what the click means.
    const target = clickTarget(s, player, hit);
    if (target === null) return;
    startAttack(s, player, target, commit);
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
