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
    economicZones: [],
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
});
