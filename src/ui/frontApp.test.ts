// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mountFrontApp, paintPlan, clickTarget } from "./frontApp";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { initFrontSim, setOwner, SEA, UNOWNED, TICK_HZ, tick } from "../engine/frontSim";
import { nationColor, PLAYER_COLOR } from "./nationPalette";

// vitest hoists this above the imports above; it wraps the real `tick` so calls can be counted
// without changing its behaviour. Both frontApp.ts and this file resolve the same mocked module, so
// counting calls here also counts the ticks the mounted app's own animation loop performs.
vi.mock("../engine/frontSim", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../engine/frontSim")>();
  return { ...actual, tick: vi.fn(actual.tick) };
});

describe("frontApp", () => {
  let root: HTMLElement;
  // mountFrontApp starts a real animation loop (jsdom's requestAnimationFrame genuinely fires on a
  // timer); leaving one running after a test finishes would keep ticking a detached DOM forever, for
  // the rest of the whole test run. Every test that mounts must capture and stop it.
  let dispose: (() => void) | undefined;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); dispose = undefined; (tick as any).mockClear?.(); });
  afterEach(() => { dispose?.(); root.remove(); });

  it("paints every land cell and leaves the sea alone", () => {
    const s = initFrontSim(generateWorld({ ...DEFAULT_PARAMS, seed: 11 }).world);
    const player = [...s.owner].find((o) => o >= 0)!;
    const plan = paintPlan(s, player);
    const land = [...Array(s.n).keys()].filter((c) => s.owner[c] !== SEA);
    expect(plan).toHaveLength(land.length);
    expect(plan.every((p) => s.owner[p.cell] !== SEA)).toBe(true);
    expect(plan.map((p) => p.cell)).toEqual(land);          // ascending, so redraws are stable
  });

  it("gives the player its own colour, distinct from unowned land and from rivals", () => {
    const s = initFrontSim(generateWorld({ ...DEFAULT_PARAMS, seed: 11 }).world);
    const nations = [...new Set([...s.owner].filter((o) => o >= 0))].sort((a, b) => a - b);
    const player = nations[0], rival = nations[1];
    const fill = (cell: number) => paintPlan(s, player).find((p) => p.cell === cell)!.fill;
    const mine = [...Array(s.n).keys()].find((c) => s.owner[c] === player)!;
    const theirs = [...Array(s.n).keys()].find((c) => s.owner[c] === rival)!;
    const empty = [...Array(s.n).keys()].find((c) => s.owner[c] === UNOWNED);
    expect(fill(mine)).not.toBe(fill(theirs));
    if (empty !== undefined) expect(fill(mine)).not.toBe(fill(empty));
    // Not just "distinct from its neighbours" — specifically the app-wide reserved player colour,
    // the same one playApp.ts and provinceApp.ts use. A plain nationColor(player) lookup would also
    // satisfy the assertions above (every palette entry is already distinct), so pin the exact value.
    expect(fill(mine)).toBe(PLAYER_COLOR);
    expect(fill(mine)).not.toBe(nationColor(player));
  });

  it("repaints as ownership changes", () => {
    const s = initFrontSim(generateWorld({ ...DEFAULT_PARAMS, seed: 11 }).world);
    const player = [...s.owner].find((o) => o >= 0)!;
    const cell = [...Array(s.n).keys()].find((c) => s.owner[c] !== SEA && s.owner[c] !== player)!;
    const before = paintPlan(s, player).find((p) => p.cell === cell)!.fill;
    setOwner(s, cell, player);
    expect(paintPlan(s, player).find((p) => p.cell === cell)!.fill).not.toBe(before);
  });

  it("mounts without a 2d context and still renders the HUD and the controls", () => {
    // jsdom has no canvas backend, so getContext returns null. Mounting must survive that, or none
    // of the input tests below could exist at all.
    dispose = mountFrontApp(root, { seed: 11 });
    expect(root.querySelector("canvas.front-map")).toBeTruthy();
    const hud = root.querySelector(".front-hud")!;
    expect(hud.textContent).toMatch(/\d/);
    expect(root.querySelector("input.front-commit")).toBeTruthy();
  });

  it("shows the pool against the cap, and the commit slider in both percent and troops", () => {
    dispose = mountFrontApp(root, { seed: 11 });
    const hud = root.querySelector(".front-hud")!.textContent!;
    expect(hud).toMatch(/\d+\s*\/\s*\d+/);                 // pool / cap
    const commit = root.querySelector(".front-commit-label")!.textContent!;
    expect(commit).toMatch(/%/);
    expect(commit).toMatch(/\(\d+\)/);                     // absolute troops in brackets
  });

  it("moving the slider changes the troops it says it will send", () => {
    dispose = mountFrontApp(root, { seed: 11 });
    const slider = root.querySelector("input.front-commit") as HTMLInputElement;
    const read = () => root.querySelector(".front-commit-label")!.textContent!;
    slider.value = "20";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    const low = read();
    slider.value = "80";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    expect(read()).not.toBe(low);
    expect(read()).toContain("80%");
  });

  describe("clickTarget", () => {
    it("returns null for sea", () => {
      const s = initFrontSim(generateWorld({ ...DEFAULT_PARAMS, seed: 11 }).world);
      const player = [...s.owner].find((o) => o >= 0)!;
      const sea = [...Array(s.n).keys()].find((c) => s.owner[c] === SEA)!;
      expect(clickTarget(s, player, sea)).toBeNull();
    });

    it("returns null for the player's own land", () => {
      const s = initFrontSim(generateWorld({ ...DEFAULT_PARAMS, seed: 11 }).world);
      const player = [...s.owner].find((o) => o >= 0)!;
      const mine = [...Array(s.n).keys()].find((c) => s.owner[c] === player)!;
      expect(clickTarget(s, player, mine)).toBeNull();
    });

    it("returns the rival's nation id for the rival's land", () => {
      const s = initFrontSim(generateWorld({ ...DEFAULT_PARAMS, seed: 11 }).world);
      const nations = [...new Set([...s.owner].filter((o) => o >= 0))].sort((a, b) => a - b);
      const player = nations[0], rival = nations[1];
      const theirs = [...Array(s.n).keys()].find((c) => s.owner[c] === rival)!;
      expect(clickTarget(s, player, theirs)).toBe(rival);
    });

    it("returns UNOWNED for unowned land", () => {
      const s = initFrontSim(generateWorld({ ...DEFAULT_PARAMS, seed: 11 }).world);
      const player = [...s.owner].find((o) => o >= 0)!;
      const empty = [...Array(s.n).keys()].find((c) => s.owner[c] === UNOWNED);
      if (empty === undefined) return; // this seed may have no unowned land; nothing to assert
      expect(clickTarget(s, player, empty)).toBe(UNOWNED);
    });

    it("returns null for a cell index out of range", () => {
      const s = initFrontSim(generateWorld({ ...DEFAULT_PARAMS, seed: 11 }).world);
      const player = [...s.owner].find((o) => o >= 0)!;
      expect(clickTarget(s, player, -1)).toBeNull();
      expect(clickTarget(s, player, s.n)).toBeNull();
    });
  });

  describe("animation loop", () => {
    // jsdom's requestAnimationFrame genuinely fires on a real timer (verified separately), which
    // makes it unsuitable for a deterministic test of the loop's own control flow: we replace it
    // with a spy that hands back the queued callback, so the test drives frames by calling that
    // callback directly instead of waiting on real time. Restored after every test so later tests in
    // this file still get the real (or jsdom's) requestAnimationFrame.
    let liveSpies: { mockRestore: () => void }[] = [];
    afterEach(() => { liveSpies.forEach((sp) => sp.mockRestore()); liveSpies = []; });

    function stubRaf() {
      const queued: FrameRequestCallback[] = [];
      let nextId = 1;
      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame")
        .mockImplementation((cb) => { queued.push(cb); return nextId++; });
      const cafSpy = vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
      liveSpies.push(rafSpy, cafSpy);
      return { queued, rafSpy, cafSpy };
    }

    it("clamps a huge elapsed gap instead of catching up thousands of ticks in one frame", () => {
      const { queued } = stubRaf();
      dispose = mountFrontApp(root, { seed: 11 });
      const frame = queued[queued.length - 1];
      // `last` is only established inside `if (last)`, and 0 is falsy — priming with frame(0) would
      // never set it, leaving every later frame() a no-op that skips the tick loop entirely and
      // passes for the wrong reason. A genuine nonzero timestamp is required to prime the loop.
      frame(1000);                 // establishes `last`; no ticks yet, acc starts at 0
      (tick as any).mockClear();
      const gapMs = 10 * 60 * 1000;               // ten minutes, as after a backgrounded tab
      const unclampedTicks = Math.floor(gapMs / (1000 / TICK_HZ));
      frame(1000 + gapMs);
      // Unclamped this gap is thousands of ticks (unclampedTicks); the clamp caps elapsed time to
      // MAX_FRAME_MS before it reaches the accumulator, so only a couple of ticks actually fire.
      // Counting real (unmocked-behaviour) calls to `tick` counts real simulation steps — each call
      // increments the state's own `tick` counter — so this cannot pass just because the loop never ran.
      expect(unclampedTicks).toBeGreaterThan(1000);
      expect((tick as any).mock.calls.length).toBeGreaterThan(0);
      expect((tick as any).mock.calls.length).toBeLessThan(10);
    });

    it("stops the loop so a second mount does not leave the first one running", () => {
      const { queued, cafSpy } = stubRaf();
      const disposeFirst = mountFrontApp(root, { seed: 11 });
      const firstFrame = queued[queued.length - 1];
      const scheduledBeforeStop = queued.length;

      disposeFirst();
      expect(cafSpy).toHaveBeenCalled();

      // A frame already queued before stop() can still fire in a real browser (the cancel and the
      // callback can race); the loop must not act on it or reschedule itself if it does.
      (tick as any).mockClear();
      firstFrame(1000);
      expect((tick as any).mock.calls.length).toBe(0);
      expect(queued.length).toBe(scheduledBeforeStop); // no further frame was scheduled

      dispose = mountFrontApp(root, { seed: 12 }); // the second instance is unaffected
    });
  });
});
