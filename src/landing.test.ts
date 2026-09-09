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
import { initialParams } from "./ui/urlState";

describe("nameTargets", () => {
  // the link used to be a base64 payload, which is why the name it was made from could not be
  // read back out of it; it is the readable form now and initialParams reads both
  it("routes a name to the map it names, the same world every time", () => {
    const t = nameTargets("Narnia")!;
    expect(initialParams(t.map.replace(/^map\.html/, "")).seed).toBe(hashStringToSeed("Narnia"));
    const ko = nameTargets("나니아")!;
    expect(initialParams(ko.map.replace(/^map\.html/, "")).seed).toBe(hashStringToSeed("나니아"));
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

// The input says "start from a name", and the name was used as a seed and then thrown away: an
// outside review typed "아발론" and the world came out called "The Old Lands". The name has to
// survive the trip, so the link carries it in a form the map can read back.
describe("a named world is called by its name", () => {
  it("carries the name in the link, not just its hash", () => {
    expect(nameTargets("Avalon")!.map).toBe("map.html#seed=Avalon");
    expect(nameTargets(" 아발론 ")!.map).toBe("map.html#seed=" + encodeURIComponent("아발론"));
    expect(nameTargets("  ")).toBeNull();
  });
  it("still opens the same world it always did for a given name", () => {
    const target = nameTargets("Narnia")!.map;
    expect(initialParams(target.slice(target.indexOf("#"))).seed).toBe(hashStringToSeed("Narnia"));
  });
});
