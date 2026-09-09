// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { redirectTarget, renderChooser, previewParams, previewTitle, fillPreview } from "./landing";
import { dailyTarget } from "./ui/daily";
import { initialSeedName } from "./ui/urlState";

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

// The front page said everything twice — "세계의 이름으로 시작 · start from a name",
// "🗺 세계 만들기 · Create", "🗓 오늘의 세계 · Daily World" — so neither language read well, while
// the tagline and the card were English only. And the map page has had a language toggle that
// remembers the choice in `wm:lang` since 07-12f: a reader who picked Korean there came back to a
// front page that had never heard of it.
describe("the landing speaks one language, and the one the reader already chose", () => {
  const store = (v?: string) => {
    const m = new Map<string, string>();
    if (v) m.set("wm:lang", v);
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, x: string) => void m.set(k, x), map: m };
  };

  it("renders Korean for a reader who chose Korean on the map page", () => {
    const root = document.createElement("div");
    renderChooser(root, store("ko"));
    expect(root.textContent).toContain("세계 만들기");
    expect(root.textContent).not.toContain("Create a World");
  });

  it("renders English for a reader who chose English, with no Korean left in it", () => {
    const root = document.createElement("div");
    renderChooser(root, store("en"));
    expect(root.textContent).toContain("Create a World");
    // ...except the toggle, which names the language it switches TO in that language's own script,
    // the way the map page's has always done. That is the point of it, not a leak.
    root.querySelector(".landing-lang")!.remove();
    expect(root.textContent).not.toMatch(/[가-힣]/);
  });

  it("falls back to the browser's language when nothing was chosen", () => {
    const root = document.createElement("div");
    renderChooser(root, store(), "ko-KR");
    expect(root.textContent).toMatch(/[가-힣]/);
  });

  // Caught in a real browser, not here: the toggle re-renders by rewriting innerHTML, which wipes
  // the preview the deferred draw had already put in the slot — and nothing put it back, so
  // switching language blanked today's world off the page. A test that only compared text missed it.
  it("keeps today's world on the page after the language is switched", () => {
    const root = document.createElement("div");
    renderChooser(root, store("en"));
    fillPreview(root, new Date("2026-09-09T00:00:00Z"), "en");
    expect(root.querySelector(".landing-preview-link")).not.toBeNull();
    (root.querySelector(".landing-lang") as HTMLButtonElement).click();
    expect(root.querySelector(".landing-preview-link"), "the map vanished on toggle").not.toBeNull();
    expect(root.textContent).toContain("세계 만들기");
  });

  it("remembers the choice for the map page to pick up", () => {
    const s = store("en");
    const root = document.createElement("div");
    renderChooser(root, s);
    const toggle = root.querySelector(".landing-lang") as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    toggle.click();
    expect(s.map.get("wm:lang")).toBe("ko");
    expect(root.textContent).toContain("세계 만들기");   // and it re-rendered in the new language
  });
});

// The front page of a map generator showed no map. The one it shows now is not decoration: it is
// TODAY'S world, generated from the same seed and the same params `map.html` will use when the
// daily button is pressed — so the picture is a promise the click keeps. Generating it any other
// way would put a second world-building path next to the real one, which is the drift this
// codebase has already been bitten by twice.
describe("the landing shows today's world, and shows the one it links to", () => {
  it("builds the preview from exactly what the daily link resolves to", () => {
    const day = new Date("2026-09-09T00:00:00Z");
    const target = dailyTarget(day);                       // "map.html#seed=daily-2026-09-09"
    const hash = target.slice(target.indexOf("#"));
    // what map.html itself would build from that link
    expect(previewParams(day)).toEqual(initialParams(hash));
    expect(previewTitle(day)).toBe(initialSeedName(hash) ?? undefined);
    expect(previewTitle(day), "a daily key is not a world's name").toBeUndefined();
  });

  it("is the same world on the same day and a different one the next", () => {
    const a = previewParams(new Date("2026-09-09T00:00:00Z"));
    const b = previewParams(new Date("2026-09-09T23:59:00Z"));
    const c = previewParams(new Date("2026-09-10T00:00:00Z"));
    expect(a.seed).toBe(b.seed);
    expect(a.seed).not.toBe(c.seed);
  });

  it("leaves a slot for it that starts hidden, so the chooser paints before the map is built", () => {
    const root = document.createElement("div");
    renderChooser(root);
    const slot = root.querySelector(".landing-preview") as HTMLElement;
    expect(slot).not.toBeNull();
    expect(slot.hasAttribute("hidden")).toBe(true);
  });

  it("fills the slot with a map that opens today's world", () => {
    const root = document.createElement("div");
    renderChooser(root);
    fillPreview(root, new Date("2026-09-09T00:00:00Z"));
    const slot = root.querySelector(".landing-preview") as HTMLElement;
    expect(slot.hasAttribute("hidden")).toBe(false);
    expect(slot.querySelector("svg.world")).not.toBeNull();
    expect(slot.querySelector("a")!.getAttribute("href")).toBe(dailyTarget(new Date("2026-09-09T00:00:00Z")));
  });
});
