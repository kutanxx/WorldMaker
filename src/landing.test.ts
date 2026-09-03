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
    // The five games this landing used to offer are gone; nothing here may point at one again by
    // accident, since the pages themselves no longer exist and a card would be a dead link.
    for (const dead of ["play.html", "playProvince.html", "playArmy.html", "playFront.html"]) {
      expect(hrefs).not.toContain(dead);
    }
  });
});

import { nameTargets } from "./landing";
import { hashStringToSeed } from "./engine/rng";
import { decodeParams } from "./ui/urlState";

describe("nameTargets", () => {
  it("routes a name to the map it names, the same world every time", () => {
    const t = nameTargets("Narnia")!;
    expect(decodeParams(t.map.replace(/^map\.html/, "")).seed).toBe(hashStringToSeed("Narnia"));
    const ko = nameTargets("나니아")!;
    expect(decodeParams(ko.map.replace(/^map\.html/, "")).seed).toBe(hashStringToSeed("나니아"));
  });
  it("empty/whitespace names route nowhere", () => {
    expect(nameTargets("")).toBeNull();
    expect(nameTargets("   ")).toBeNull();
  });
});

describe("renderChooser name input", () => {
  it("renders the name input and the one button left to press", () => {
    const root = document.createElement("div");
    renderChooser(root);
    expect(root.querySelector(".name-seed")).not.toBeNull();
    expect(root.querySelector(".name-map")).not.toBeNull();
    // "▶ Play" opened a game that no longer exists; a name now only ever opens a map.
    expect(root.querySelector(".name-play")).toBeNull();
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

describe("daily framing copy", () => {
  it("explains the shared-world promise under the daily button", () => {
    const root = document.createElement("div");
    renderChooser(root);
    const sub = root.querySelector(".landing-daily-sub");
    expect(sub).not.toBeNull();
    expect(sub!.textContent).toContain("UTC");
  });
});
