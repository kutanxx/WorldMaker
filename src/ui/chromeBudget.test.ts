// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { measureChrome, fitChrome, CHROME_AIR } from "./chromeBudget";

// jsdom lays nothing out, so each box says where it is
const boxAt = (top: number, bottom: number): HTMLElement => {
  const el = document.createElement("div");
  el.getBoundingClientRect = () => ({ top, bottom, height: bottom - top, left: 0, right: 100, width: 100, x: 0, y: top, toJSON() {} }) as DOMRect;
  return el;
};

// ★ The map's height was "the window, less 290px" — a number measured once, at 1440x900, with a
// mouse and a one-row toolbar. Measured since: a Korean toolbar wraps to two rows on a 1366x650
// laptop window, an English one at 1366x768, and a tablet's 44px controls add 24px — each time the
// card ran 11-25px past the window and the chronicle's line was cut, and on a tablet in landscape
// the city plan lost its bottom 60px. What the page spends around the drawing is measured instead.
describe("measureChrome", () => {
  it("counts everything above the drawing and the card below it, and leaves some air", () => {
    const drawing = boxAt(145, 795), card = boxAt(134, 927);
    expect(measureChrome(drawing, card, 0)).toBe(145 + (927 - 795) + CHROME_AIR);
  });
  it("counts from the top of the page, not of the window", () => {
    const drawing = boxAt(45, 695), card = boxAt(34, 827);
    expect(measureChrome(drawing, card, 100)).toBe(145 + (827 - 695) + CHROME_AIR);
  });
  it("says nothing about a drawing that has not been laid out", () => {
    expect(measureChrome(boxAt(0, 0), boxAt(0, 0), 0)).toBeNull();
  });
  it("can be told what counts below the drawing, where the card goes on past what must be seen", () => {
    // the plate: its facts and key may run under it on a tall window; only the card's own edge counts
    expect(measureChrome(boxAt(230, 830), boxAt(134, 1100), 0, 11)).toBe(230 + 11 + CHROME_AIR);
  });
});

describe("fitChrome", () => {
  // the drawing's size follows the variable, the toolbar's width follows the drawing, and a toolbar
  // that wraps is taller — so a pass can change what the next one measures
  it("measures again until what it set holds", () => {
    const host = document.createElement("div");
    const seen = [300, 338, 338, 338];
    let i = 0;
    fitChrome(host, "--chrome", () => seen[i++]);
    expect(host.style.getPropertyValue("--chrome")).toBe("338px");
    expect(i, "it went on measuring after the value held").toBe(3);
  });
  it("gives up after a few passes rather than chase its own tail", () => {
    const host = document.createElement("div");
    let i = 0;
    fitChrome(host, "--chrome", () => 300 + (i++ % 2) * 40, 3);
    expect(i).toBe(3);
  });
  it("leaves the stylesheet's own number where there is nothing to measure", () => {
    const host = document.createElement("div");
    fitChrome(host, "--chrome", () => null);
    expect(host.style.getPropertyValue("--chrome")).toBe("");
  });
  it("never goes under a floor it is given", () => {
    const host = document.createElement("div");
    fitChrome(host, "--plate-chrome", () => 200, 3, 230);
    expect(host.style.getPropertyValue("--plate-chrome")).toBe("230px");
  });
});
