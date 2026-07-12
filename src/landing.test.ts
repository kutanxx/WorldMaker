// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { redirectTarget, renderChooser } from "./landing";

describe("redirectTarget", () => {
  it("forwards a param-shaped seed hash to map.html", () => {
    const blob = "#" + btoa(JSON.stringify({
      seed: 42, width: 1000, height: 700, cellCount: 4000,
      seaLevel: 0.3, mountainLevel: 0.55, polityCount: 8, townCount: 20,
    }));
    expect(redirectTarget(blob)).toBe("map.html" + blob);
  });
  it("returns null for an empty hash (show the chooser)", () => {
    expect(redirectTarget("")).toBeNull();
    expect(redirectTarget("#")).toBeNull();
  });
  it("returns null for a non-param hash", () => {
    expect(redirectTarget("#not-a-seed")).toBeNull();
  });
});

describe("renderChooser", () => {
  it("renders two choice cards linking to map.html and play.html", () => {
    const root = document.createElement("div");
    renderChooser(root);
    const hrefs = Array.from(root.querySelectorAll("a.choice-card")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("map.html");
    expect(hrefs).toContain("play.html");
  });
});

import { nameTargets } from "./landing";
import { hashStringToSeed } from "./engine/rng";
import { decodeParams } from "./ui/urlState";

describe("nameTargets", () => {
  it("routes a name to play (string hash, URL-encoded) and map (numeric blob, same world)", () => {
    const t = nameTargets("Narnia")!;
    expect(t.play).toBe("play.html#seed=Narnia");
    expect(decodeParams(t.map.replace(/^map\.html/, "")).seed).toBe(hashStringToSeed("Narnia"));
    const ko = nameTargets("나니아")!;
    expect(ko.play).toBe("play.html#seed=" + encodeURIComponent("나니아"));
  });
  it("empty/whitespace names route nowhere", () => {
    expect(nameTargets("")).toBeNull();
    expect(nameTargets("   ")).toBeNull();
  });
});

describe("renderChooser name input", () => {
  it("renders the name input and both start buttons", () => {
    const root = document.createElement("div");
    renderChooser(root);
    expect(root.querySelector(".name-seed")).not.toBeNull();
    expect(root.querySelector(".name-play")).not.toBeNull();
    expect(root.querySelector(".name-map")).not.toBeNull();
  });
});

describe("renderChooser daily button", () => {
  it("renders the daily button carrying today's UTC date", () => {
    const root = document.createElement("div");
    renderChooser(root);
    const btn = root.querySelector(".name-daily") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain(new Date().toISOString().slice(0, 10));
  });
});
