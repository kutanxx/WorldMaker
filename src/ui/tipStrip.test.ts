// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installTipStrip, TIP_MS } from "./tipStrip";

describe("installTipStrip", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });

  function setup(coarse = true) {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const dispose = installTipStrip(root, coarse);
    return { root, dispose };
  }
  const strip = () => document.querySelector(".tip-strip") as HTMLElement | null;

  it("tapping a titled element shows its title in the strip", () => {
    const { root } = setup();
    const btn = document.createElement("button");
    btn.title = "공격 ×1.35 · 방어 ×0.8";
    root.appendChild(btn);
    btn.click();
    expect(strip()!.textContent).toBe("공격 ×1.35 · 방어 ×0.8");
    expect(strip()!.classList.contains("show")).toBe(true);
  });

  it("auto-hides after TIP_MS; a new tap resets the timer", () => {
    const { root } = setup();
    const btn = document.createElement("button");
    btn.title = "tip";
    root.appendChild(btn);
    btn.click();
    vi.advanceTimersByTime(TIP_MS - 100);
    expect(strip()!.classList.contains("show")).toBe(true);
    btn.click(); // reset
    vi.advanceTimersByTime(TIP_MS - 100);
    expect(strip()!.classList.contains("show")).toBe(true);
    vi.advanceTimersByTime(200);
    expect(strip()!.classList.contains("show")).toBe(false);
  });

  it("untitled and empty-title taps do nothing (and don't hide an active tip)", () => {
    const { root } = setup();
    const titled = document.createElement("button");
    titled.title = "keep me";
    const plain = document.createElement("button");
    const empty = document.createElement("button");
    empty.setAttribute("title", "");
    root.append(titled, plain, empty);
    titled.click();
    plain.click();
    empty.click();
    expect(strip()!.textContent).toBe("keep me");
    expect(strip()!.classList.contains("show")).toBe(true);
  });

  it("a tap on a child bubbles to the titled ancestor", () => {
    const { root } = setup();
    const chip = document.createElement("span");
    chip.title = "국경 3칸 접촉";
    const inner = document.createElement("b");
    inner.textContent = "👁";
    chip.appendChild(inner);
    root.appendChild(chip);
    inner.click();
    expect(strip()!.textContent).toBe("국경 3칸 접촉");
  });

  it("coarse=false installs nothing", () => {
    setup(false);
    expect(strip()).toBeNull();
  });

  it("dispose removes the strip and stops listening", () => {
    const { root, dispose } = setup();
    dispose();
    expect(strip()).toBeNull();
    const btn = document.createElement("button");
    btn.title = "tip";
    root.appendChild(btn);
    btn.click();
    expect(strip()).toBeNull();
  });
});
