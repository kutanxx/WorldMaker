// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";
import { createApp } from "./app";

const small = { ...DEFAULT_PARAMS, width: 300, height: 300, cellCount: 400, townCount: 6 };

describe("createApp", () => {
  it("renders a world svg on init", () => {
    const root = document.createElement("div");
    createApp(root, small);
    expect(root.querySelector("svg.world")).not.toBeNull();
  });
  it("opens a city view when a marker is clicked", () => {
    const root = document.createElement("div");
    const app = createApp(root, small);
    app.openCity(0);
    expect(root.querySelector("svg.city")).not.toBeNull();
    expect(root.querySelector("svg.world")).toBeNull();
  });
  it("returns to the world view", () => {
    const root = document.createElement("div");
    const app = createApp(root, small);
    app.openCity(0);
    app.showWorld();
    expect(root.querySelector("svg.world")).not.toBeNull();
    expect(root.querySelector("svg.city")).toBeNull();
  });
  it("clicking a marker circle opens that city", () => {
    const root = document.createElement("div");
    createApp(root, small);
    const circle = root.querySelector(".markers circle") as SVGElement;
    circle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector("svg.city")).not.toBeNull();
  });
  // this used to look for the label "Export SVG", which pinned the wording rather than the offer.
  // The three formats are one segmented control now; what matters is that SVG is on it.
  it("offers an SVG export", () => {
    const root = document.createElement("div");
    createApp(root, small);
    const labels = Array.from(root.querySelectorAll(".export-group button")).map((b) => b.textContent);
    expect(labels).toContain("SVG");
  });
  it("exposes a gazetteer (markdown) export button", () => {
    const root = document.createElement("div");
    createApp(root, small);
    expect(root.querySelector(".controls button.gazetteer")).not.toBeNull();
    const labels = Array.from(root.querySelectorAll(".controls button")).map((b) => b.textContent);
    expect(labels.some((l) => l?.includes("Gazetteer"))).toBe(true);
  });
  it("has a random-seed button that rerolls to a new seed", () => {
    const root = document.createElement("div");
    createApp(root, { ...small, seed: 7 });
    const seedInput = root.querySelector('.controls input[type=number]') as HTMLInputElement;
    expect(seedInput.value).toBe("7");
    const btn = root.querySelector(".controls button.random-seed") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    btn.click();
    // reroll set a fresh finite seed (almost surely different from 7) and re-rendered the world
    expect(Number.isInteger(Number(seedInput.value))).toBe(true);
    expect(root.querySelector("svg.world")).not.toBeNull();
  });
  it("has a home link in the controls that returns to the landing chooser", () => {
    const root = document.createElement("div");
    createApp(root, small);
    const home = root.querySelector(".controls a.home");
    expect(home).not.toBeNull();
    expect(home!.getAttribute("href")).toBe("index.html");
    // the word moved to the tooltip when the toolbar ran out of room; the house is the visible part,
    // but the link must still SAY what it is to a hover or a screen reader
    expect(home!.textContent).toContain("🏠");
    expect(home!.getAttribute("title")).toMatch(/Home|홈/);
  });
  it("shows a timeline and a political layer over the world", () => {
    const root = document.createElement("div");
    createApp(root, small);
    expect(root.querySelector(".timeline input[type=range]")).not.toBeNull();
    expect(root.querySelector(".political-slot .border")).not.toBeNull();
  });
  it("scrubbing the timeline updates the year readout", () => {
    const root = document.createElement("div");
    createApp(root, small);
    const slider = root.querySelector(".timeline input[type=range]") as HTMLInputElement;
    slider.value = slider.max; // last frame = year 500
    slider.dispatchEvent(new Event("input"));
    expect((root.querySelector(".timeline-year") as HTMLElement).textContent).toBe("500년");
  });
  it("defaults to terrain view (no territory fills)", () => {
    const root = document.createElement("div");
    createApp(root, small);
    expect(root.querySelector("svg.world.view-terrain")).not.toBeNull();
    expect(root.querySelector(".political-slot .territory")).toBeNull();
  });
  it("toggling to 정치 fills and labels nations; back to 지형 clears them", () => {
    const root = document.createElement("div");
    createApp(root, small);
    const btns = Array.from(root.querySelectorAll(".view-toggle button")) as HTMLButtonElement[];
    const political = btns.find((b) => b.textContent === "Political")!;
    const terrain = btns.find((b) => b.textContent === "Terrain")!;
    political.click();
    expect(root.querySelector("svg.world.view-political")).not.toBeNull();
    expect(root.querySelector(".political-slot .territory")).not.toBeNull();
    expect(root.querySelector(".nation-label")).not.toBeNull();
    terrain.click();
    expect(root.querySelector(".political-slot .territory")).toBeNull();
  });
  it("has a 문화 view toggle that shows culture areas", () => {
    const root = document.createElement("div");
    createApp(root, small);
    const btn = Array.from(root.querySelectorAll(".view-toggle button")).find((b) => b.textContent === "Culture") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    expect(root.querySelector("svg.world.view-culture")).not.toBeNull();
    expect(root.querySelector(".culture .culture-area")).not.toBeNull();
    expect(root.querySelector(".political-slot .territory")).toBeNull();
  });
  it("keeps the scrubbed year when switching views", () => {
    const root = document.createElement("div");
    createApp(root, small);
    const slider = root.querySelector(".timeline input[type=range]") as HTMLInputElement;
    slider.value = slider.max;
    slider.dispatchEvent(new Event("input"));
    (Array.from(root.querySelectorAll(".view-toggle button")).find((b) => b.textContent === "Political") as HTMLButtonElement).click();
    expect((root.querySelector(".timeline-year") as HTMLElement).textContent).toBe("500년");
  });
  it("mounts zoom controls on the world map and again on a city drilldown", () => {
    const root = document.createElement("div");
    createApp(root, { seed: 1, width: 1000, height: 700, cellCount: 4000, seaLevel: 0.3, mountainLevel: 0.55, polityCount: 8, townCount: 20 });
    const stage = root.querySelector(".stage")!;
    expect(stage.querySelector(".map-zoom-controls")).not.toBeNull(); // world map
    const marker = stage.querySelector("[data-city]") as SVGElement;
    marker.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(stage.querySelector("svg.city")).not.toBeNull();          // drilled down
    expect(stage.querySelector(".map-zoom-controls")).not.toBeNull(); // city map controls
  });
  it("anchors zoom controls to a frame wrapping the map svg (world + city)", () => {
    const root = document.createElement("div");
    createApp(root, { seed: 1, width: 1000, height: 700, cellCount: 4000, seaLevel: 0.3, mountainLevel: 0.55, polityCount: 8, townCount: 20 });
    const stage = root.querySelector(".stage")!;
    const worldFrame = stage.querySelector(".map-frame")!;
    expect(worldFrame.querySelector("svg")).not.toBeNull();
    expect(worldFrame.querySelector(".map-zoom-controls")).not.toBeNull();
    (stage.querySelector("[data-city]") as SVGElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const cityFrame = stage.querySelector(".map-frame")!;
    expect(cityFrame.querySelector("svg.city")).not.toBeNull();
    expect(cityFrame.querySelector(".map-zoom-controls")).not.toBeNull();
  });

  it("draws nation borders at the same place in the political and province views (whole-province ownership)", () => {
    const root = document.createElement("div");
    createApp(root, small);
    const btns = [...root.querySelectorAll(".view-toggle button")] as HTMLButtonElement[];
    const province = btns.find((b) => /Provinces|영토/.test(b.textContent || ""))!;
    const political = btns.find((b) => b.textContent === "Political")!;
    province.click();
    const provBorder = root.querySelector(".province .nation-border")?.getAttribute("d");
    political.click();
    const polBorder = root.querySelector(".political-slot .border")?.getAttribute("d");
    expect(provBorder).toBeTruthy();
    expect(polBorder).toBe(provBorder); // same snapped ownership → identical border geometry across views
  });

  it("has a Provinces view toggle that switches the map to the province layer", () => {
    const root = document.createElement("div");
    createApp(root, small);
    const btns = [...root.querySelectorAll(".view-toggle button")] as HTMLButtonElement[];
    const prov = btns.find((b) => /Provinces|영토/.test(b.textContent || ""));
    expect(prov).not.toBeUndefined();
    prov!.click();
    expect(root.querySelector("svg .province")).not.toBeNull();
  });
});

// A reader who has drilled into a city and presses "export" means the city in front of them. The
// buttons rendered the world regardless, so the one thing the drilldown produces could not be saved.
describe("export follows the screen", () => {
  // jsdom's Blob has no .text(); FileReader is what it does have.
  const blobText = (b: Blob) => new Promise<string>((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(fr.error);
    fr.readAsText(b);
  });

  async function captureDownload(fn: () => void): Promise<{ name: string; text: string } | null> {
    const created: Blob[] = [];
    const names: string[] = [];
    const url = URL.createObjectURL, revoke = URL.revokeObjectURL;
    URL.createObjectURL = ((b: Blob) => { created.push(b); return "blob:stub"; }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) { names.push(this.download); };
    // Wait for the download, not for the clock. The export's async tail is dominated by a dynamic
    // import() of the font module: measured at 27ms once the module is cached and 64ms cold, against
    // a budget that used to be a flat 60ms. That made the result a coin toss on whether some earlier
    // test file had already warmed Vite's transform cache -- green here, red on every CI run since
    // the test was written (six deploys blocked). Polling is fast when the export is fast and still
    // correct when the runner is slow.
    try {
      fn();
      const deadline = Date.now() + 5000;
      while (!created.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
    } finally {
      URL.createObjectURL = url; URL.revokeObjectURL = revoke;
      HTMLAnchorElement.prototype.click = click;
    }
    return created.length ? { name: names[names.length - 1], text: await blobText(created[created.length - 1]) } : null;
  }

  it("writes the city a reader is looking at, not the world behind it", async () => {
    const root = document.createElement("div");
    const app = createApp(root, small);
    app.openCity(0);
    const svgBtn = [...root.querySelectorAll("button")].find((b) => /SVG/i.test(b.textContent || ""))!;
    const got = await captureDownload(() => svgBtn.click());
    expect(got).not.toBeNull();
    const text = got!.text;
    expect(text).toContain('class="city"');
    expect(text).not.toContain("coastline");
  });

  // The three export buttons each repeated the word "export": 325px of toolbar in Korean, 274 in
  // English, for one idea said three times. The toolbar has 1014px to work with (#app is capped at
  // 1040 and the window's width never enters into it), so it wrapped in BOTH languages -- by 32px in
  // Korean, 128 in English, which put the language toggle alone on a second row. They are one
  // segmented control now, the pattern the view toggle already uses, and the verb is carried once.
  it("offers the three formats as one group, each still writing its own file", async () => {
    const root = document.createElement("div");
    createApp(root, small);
    const group = root.querySelector(".export-group");
    expect(group).not.toBeNull();
    const btns = [...group!.querySelectorAll("button")];
    expect(btns.map((b) => b.textContent)).toEqual(["JSON", "PNG", "SVG"]);
    // the word "export" is said once for the group, not once per button
    expect(group!.textContent).not.toMatch(/내보내기|Export/);
    for (const [i, ext] of [[0, "json"], [2, "svg"]] as const) {
      const got = await captureDownload(() => btns[i].click());
      expect(got, ext).not.toBeNull();
      expect(got!.name).toMatch(new RegExp(`\.${ext}$`));
    }
  });

  it("names the file after the city, so a folder of them can be told apart", async () => {
    const root = document.createElement("div");
    const app = createApp(root, small);
    app.openCity(0);
    const svgBtn = [...root.querySelectorAll("button")].find((b) => /SVG/i.test(b.textContent || ""))!;
    const got = await captureDownload(() => svgBtn.click());
    expect(got!.name).not.toBe("world.svg");
    expect(got!.name).toMatch(/^[\w-]+\.svg$/);
  });

  it("still writes the world when that is what is on screen", async () => {
    const root = document.createElement("div");
    const app = createApp(root, small);
    app.openCity(0);
    app.showWorld();
    const svgBtn = [...root.querySelectorAll("button")].find((b) => /SVG/i.test(b.textContent || ""))!;
    const got = await captureDownload(() => svgBtn.click());
    const text = got!.text;
    expect(text).toContain('class="world');
    expect(got!.name).toBe("world.svg");
  });
});
