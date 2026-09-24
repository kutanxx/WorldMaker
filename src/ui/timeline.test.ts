// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTimeline } from "./timeline";
import type { History } from "../engine/history";

function fakeHistory(frames: number): History {
  return {
    years: (frames - 1) * 10,
    polities: [],
    events: [],
    snapshots: Array.from({ length: frames }, (_, i) => ({ year: i * 10, owner: new Int32Array(0) })),
    economicZones: [], cityFoundings: [],
  };
}

describe("createTimeline", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires onIndex with the slider index and updates the year readout", () => {
    const seen: number[] = [];
    const t = createTimeline(fakeHistory(6), (i) => seen.push(i));
    const slider = t.element.querySelector("input") as HTMLInputElement;
    slider.value = "3";
    slider.dispatchEvent(new Event("input"));
    expect(seen).toEqual([3]);
    expect((t.element.querySelector(".timeline-year") as HTMLElement).textContent).toBe("30년");
  });

  it("play advances the index each step and stops at the last frame", () => {
    const seen: number[] = [];
    const t = createTimeline(fakeHistory(4), (i) => seen.push(i));
    const btn = t.element.querySelector("button") as HTMLButtonElement;
    btn.click();
    vi.advanceTimersByTime(1300); // steps at 300/600/900 -> 1,2,3 ; 1200 -> stop
    expect(seen).toEqual([1, 2, 3]);
    expect(btn.textContent).toBe("▶");
  });

  // ★ A step the caller asks to stay on is stayed on: the caption under the scrubber changed on 360
  // of 612 steps when played — half a second a line — so the player stops on the big news for as
  // long as it takes to read it. A step with nothing to read keeps the old pace.
  it("stays on a step for as long as it is asked to, and no less than a step", () => {
    const seen: number[] = [];
    const dwell = (i: number) => (i === 1 ? 2000 : 0);
    const t = createTimeline(fakeHistory(4), (i) => seen.push(i), undefined, undefined, dwell);
    (t.element.querySelector("button") as HTMLButtonElement).click();
    vi.advanceTimersByTime(300);
    expect(seen, "the first step came late").toEqual([1]);
    vi.advanceTimersByTime(1900);
    expect(seen, "the player left the big news before it could be read").toEqual([1]);
    vi.advanceTimersByTime(100);
    expect(seen).toEqual([1, 2]);
    vi.advanceTimersByTime(300);
    expect(seen).toEqual([1, 2, 3]);
  });

  it("reads the frame it starts on too, so the first news is not passed over", () => {
    const seen: number[] = [];
    const t = createTimeline(fakeHistory(4), (i) => seen.push(i), undefined, undefined, (i) => (i === 0 ? 1500 : 0));
    (t.element.querySelector("button") as HTMLButtonElement).click();
    vi.advanceTimersByTime(1400);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(seen).toEqual([1]);
  });

  it("destroy clears a running timer", () => {
    const seen: number[] = [];
    const t = createTimeline(fakeHistory(10), (i) => seen.push(i));
    (t.element.querySelector("button") as HTMLButtonElement).click();
    vi.advanceTimersByTime(600);
    const after = seen.length;
    t.destroy();
    vi.advanceTimersByTime(3000);
    expect(seen.length).toBe(after);
  });

  it("formats the year through the injected formatter", () => {
    const t = createTimeline(fakeHistory(3), () => {}, (y) => `Year ${y}`);
    const slider = t.element.querySelector("input") as HTMLInputElement;
    slider.value = "2";
    slider.dispatchEvent(new Event("input"));
    expect((t.element.querySelector(".timeline-year") as HTMLElement).textContent).toBe("Year 20");
  });

  it("accepts a bare snapshots object (the SimState shape)", () => {
    const t = createTimeline({ snapshots: [{ year: 0 }, { year: 10 }] }, () => {});
    expect((t.element.querySelector(".timeline-year") as HTMLElement).textContent).toBe("0년");
  });
});
