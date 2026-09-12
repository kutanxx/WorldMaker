// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";
import { createApp } from "./app";
import { COMPASS_STRIP } from "./svgCityRenderer";
import { hashStringToSeed } from "../engine/rng";
import { initialCity, decodeParams } from "./urlState";
import { generateWorld } from "../engine/world";
import { simulateHistory } from "../engine/history";
import { snapOwnersToProvinces } from "./provinceLayer";
import { properName } from "./properName";

const small = { ...DEFAULT_PARAMS, width: 300, height: 300, cellCount: 400, townCount: 6 };

// The address is shared state in jsdom: a test that leaves `#...&city=2` behind makes the next
// createApp open onto a city plate, and the one after it finds no world map to click.
afterEach(() => { location.hash = ""; });

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
    // the year, not the Korean spelling of it: the readout is in the reader's language now, and
    // this used to pin "500년" whatever the toggle said
    expect((root.querySelector(".timeline-year") as HTMLElement).textContent).toContain("500");
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
    expect((root.querySelector(".timeline-year") as HTMLElement).textContent).toContain("500");
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

  // Three call sites build these layers: the first render, and the two the year scrubber uses. The
  // scrubber's pair was missed when the legends were given headings, so the map's key reverted to
  // English the moment a reader touched the timeline. Anything the scrubber rebuilds has to be
  // checked at the scrubber, not only at first paint.
  it("keeps the legend in the reader's language after the year is scrubbed", () => {
    const root = document.createElement("div");
    createApp(root, small);
    (root.querySelector(".lang-toggle") as HTMLButtonElement).click(); // en -> ko
    const political = [...root.querySelectorAll(".view-toggle button")].find((b) => /정치/.test(b.textContent || "")) as HTMLButtonElement;
    political.click();
    expect(root.querySelector(".nation-legend .legend-title")?.textContent).toBe("나라");
    const slider = root.querySelector(".timeline input[type=range]") as HTMLInputElement;
    slider.value = slider.max;
    slider.dispatchEvent(new Event("input"));
    expect(root.querySelector(".nation-legend .legend-title")?.textContent).toBe("나라");
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

  // The screen and the file were filled by two different pieces of code, and they had drifted: the
  // export replaced the overlay with a POLITICAL layer for every view that was not culture, so
  // exporting the province view produced a map with no provinces in it. The province key had the
  // same shape of bug from the other side — renderWorld drew one, and the timeline rebuilt the
  // layer without it a moment later, so it never reached the screen.
  it("exports the province view WITH its provinces, and shows its key on screen", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    createApp(root, { ...DEFAULT_PARAMS, seed: 5 });
    await new Promise((r) => setTimeout(r, 0));
    // an earlier test in this file persists a language choice, so the toggle may read either word
    const btn = [...root.querySelectorAll("button")].find((b) => /provinces|영토/i.test(b.textContent ?? ""))!;
    expect(btn, "no province view to switch to").toBeDefined();
    btn.click();
    await new Promise((r) => setTimeout(r, 0));

    const onScreen = root.querySelector("svg.world")!;
    expect(onScreen.querySelectorAll(".province-fill").length, "no provinces on screen").toBeGreaterThan(5);
    // the key stands on the map beside its chip, in its own sheet — off the drawing, which is what
    // the zoom moves
    expect(root.querySelector(".legend-fold .legend-sheet .province-legend"), "no key on screen").not.toBeNull();

    const svgBtn = [...root.querySelectorAll("button")].find((b) => b.textContent === "SVG")!;
    const file = await captureDownload(() => svgBtn.click());
    expect(file, "the export produced nothing").not.toBeNull();
    expect(file!.text, "the exported province map has no provinces").toContain("province-fill");
    expect(file!.text, "the exported province map has no key").toContain("province-legend");
    root.remove();
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

// Until the markers were given a focusable target the page had no focusable element at all
// (`document.querySelectorAll('[tabindex]').length === 0` on the live site), so the city plans —
// the best thing the map has — could not be reached by keyboard at all.
describe("a city opens from the keyboard", () => {
  it("opens on Enter and on Space, from the marker's target", async () => {
    for (const key of ["Enter", " "]) {
      location.hash = "";                       // the previous pass left a city in the address
      const root = document.createElement("div");
      document.body.appendChild(root);
      createApp(root, { ...DEFAULT_PARAMS, seed: 5 });
      await new Promise((r) => setTimeout(r, 0));
      const hit = root.querySelector(".marker-hit") as SVGElement;
      expect(hit, "no focusable marker target").not.toBeNull();
      hit.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
      expect(root.querySelector("svg.city"), `${key} did not open the city`).not.toBeNull();
      root.remove();
    }
  });
});

// "start from a name" and then the name was hashed to a seed and thrown away: an outside review
// typed "아발론" and the world came back called "The Old Lands".
describe("a world the reader named", () => {
  it("is called what it was asked to be called, and keeps the name in the address", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    createApp(root, { ...DEFAULT_PARAMS, seed: hashStringToSeed("Avalon") }, "Avalon");
    await new Promise((r) => setTimeout(r, 0));
    expect(root.querySelector(".world-name-text")?.textContent).toBe("Avalon");
    expect(location.hash).toBe("#seed=Avalon");
    root.remove();
  });

  it("lets go of the name when the reader asks for a different world", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const app = createApp(root, { ...DEFAULT_PARAMS, seed: hashStringToSeed("Avalon") }, "Avalon");
    await new Promise((r) => setTimeout(r, 0));
    app.regenerate({ ...DEFAULT_PARAMS, seed: 4242 });
    await new Promise((r) => setTimeout(r, 0));
    expect(root.querySelector(".world-name-text")?.textContent).not.toBe("Avalon");
    expect(location.hash).not.toBe("#seed=Avalon");
    root.remove();
  });
});

// Opening a city changed nothing in the address, so the plate could not be shared or bookmarked
// and the browser's Back button left the site rather than returning to the world map.
describe("a city is a place you can come back to", () => {
  it("puts the city in the address when it opens", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    createApp(root, { ...DEFAULT_PARAMS, seed: 5 });
    await new Promise((r) => setTimeout(r, 0));
    const before = location.hash;
    (root.querySelector(".marker-hit") as SVGElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(root.querySelector(".city-name-text"), "did not open a city").not.toBeNull();
    expect(location.hash).not.toBe(before);
    expect(initialCity(location.hash)).not.toBeNull();
    root.remove();
  });

  it("comes back to the world when the browser goes back", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    createApp(root, { ...DEFAULT_PARAMS, seed: 5 });
    await new Promise((r) => setTimeout(r, 0));
    const worldHash = location.hash;
    (root.querySelector(".marker-hit") as SVGElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(root.querySelector(".city-name-text")).not.toBeNull();
    location.hash = worldHash;                       // what the browser does on Back
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    await new Promise((r) => setTimeout(r, 0));
    expect(root.querySelector(".city-name-text"), "still on the city plate").toBeNull();
    expect(root.querySelector(".marker-hit"), "the world map did not come back").not.toBeNull();
    root.remove();
  });

  it("opens straight onto the plate when the link names a city", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    location.hash = "seed=5&city=2";
    createApp(root, { ...DEFAULT_PARAMS, seed: 5 });
    await new Promise((r) => setTimeout(r, 0));
    expect(root.querySelector(".city-name-text"), "a shared city link opened the world map").not.toBeNull();
    root.remove();
  });
});

// The timeline was created without a formatYear, so it fell back to the Korean default and an
// English reader saw "500년" on the scrubber. The document's own language never changed either:
// map.html declares lang="ko" and it stayed that way whatever the toggle said, which is what a
// screen reader and a translation tool go by.
describe("the language toggle changes the language", () => {
  const yearText = (root: HTMLElement) => root.querySelector(".timeline-year")?.textContent ?? "";
  it("writes the year in the reader's language, and tells the document which one it is", async () => {
    localStorage.setItem("wm:lang", "en");
    const root = document.createElement("div");
    document.body.appendChild(root);
    createApp(root, { ...DEFAULT_PARAMS, seed: 5 });
    await new Promise((r) => setTimeout(r, 0));
    expect(yearText(root), "the scrubber is still in Korean").not.toContain("년");
    expect(document.documentElement.lang).toBe("en");

    const btn = [...root.querySelectorAll("button")].find((b) => /한국어|English/.test(b.textContent ?? ""))!;
    btn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(yearText(root)).toContain("년");
    expect(document.documentElement.lang).toBe("ko");
    root.remove();
    localStorage.removeItem("wm:lang");
  });
});

// Every one of these already worked: the URL hash carries seaLevel, mountainLevel, polityCount,
// cellCount and townCount, and generateWorld reads them. There was simply no way to reach them from
// the page, so a reader could only ever have the one world shape the defaults describe.
describe("the world's own dials", () => {
  const open = async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    createApp(root, { ...DEFAULT_PARAMS, seed: 5 });
    await new Promise((r) => setTimeout(r, 0));
    return root;
  };

  it("offers the settings the engine already reads, folded away until asked for", async () => {
    const root = await open();
    const panel = root.querySelector("details.advanced");
    expect(panel, "no advanced settings at all").not.toBeNull();
    expect((panel as HTMLDetailsElement).open, "the panel should start folded").toBe(false);
    const names = [...panel!.querySelectorAll("input[type=range]")].map((i) => i.getAttribute("name"));
    for (const k of ["seaLevel", "mountainLevel", "polityCount", "townCount", "cellCount"]) {
      expect(names, `${k} is not offered`).toContain(k);
    }
    root.remove();
  });

  it("builds a different world when a dial is moved", async () => {
    const root = await open();
    const before = root.querySelectorAll(".markers [data-city]").length;
    const towns = root.querySelector('input[name=townCount]') as HTMLInputElement;
    towns.value = String(Number(towns.max));
    towns.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    const after = root.querySelectorAll(".markers [data-city]").length;
    expect(after, `cities ${before} -> ${after}`).toBeGreaterThan(before);
    root.remove();
  });

  it("keeps the dials in the link, so a shared world is the same world", async () => {
    const root = await open();
    const sea = root.querySelector('input[name=seaLevel]') as HTMLInputElement;
    sea.value = "0.45";
    sea.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(decodeParams(location.hash).seaLevel).toBeCloseTo(0.45, 5);
    root.remove();
  });
});

// The readable link and the dials are two features that meet badly: `#seed=Narnia` says the seed
// and nothing else, so moving a dial on a NAMED world would leave the address describing a world
// the reader is no longer looking at, and a reload would quietly undo the change.
describe("a named world that has been tuned", () => {
  it("gives up the readable link rather than lose the settings", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    createApp(root, { ...DEFAULT_PARAMS, seed: hashStringToSeed("Avalon") }, "Avalon");
    await new Promise((r) => setTimeout(r, 0));
    expect(location.hash).toBe("#seed=Avalon");
    const sea = root.querySelector('input[name=seaLevel]') as HTMLInputElement;
    sea.value = "0.45";
    sea.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(decodeParams(location.hash).seaLevel, "the tuning is not in the address").toBeCloseTo(0.45, 5);
    expect(decodeParams(location.hash).seed).toBe(hashStringToSeed("Avalon"));
    root.remove();
  });
});

// A plate carried its name and nothing else, and the only way off it was back to the world map to
// hunt for another four-pixel dot.
describe("a plate tells you where you are and where you can go", () => {
  it("says what kind of town it is, whose it is, and how big", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    createApp(root, { ...DEFAULT_PARAMS, seed: 5 });
    await new Promise((r) => setTimeout(r, 0));
    (root.querySelector(".marker-hit") as SVGElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    const panel = root.querySelector(".city-facts");
    expect(panel, "the plate says nothing about its town").not.toBeNull();
    expect(panel!.querySelectorAll(".city-fact").length).toBeGreaterThanOrEqual(4);
    expect(panel!.textContent).toMatch(/\d/);           // a population band
    root.remove();
  });

  it("walks from one town to the town next door", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    createApp(root, { ...DEFAULT_PARAMS, seed: 5 });
    await new Promise((r) => setTimeout(r, 0));
    (root.querySelector(".marker-hit") as SVGElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    const first = root.querySelector(".city-name-text")?.textContent;
    const neighbour = root.querySelector(".city-facts .neighbour") as HTMLButtonElement;
    expect(neighbour, "no way on to the next town").not.toBeNull();
    neighbour.click();
    await new Promise((r) => setTimeout(r, 0));
    const second = root.querySelector(".city-name-text")?.textContent;
    expect(second).not.toBe(first);
    expect(neighbour.textContent).toContain(second!);   // it went where it said it would
    root.remove();
  });
});

// The city plans are the best thing this map has and they sat behind four-pixel dots. Enlarging the
// dots' targets helped whoever already knew to aim at one; nothing told a first-time reader that
// there was anything to aim at.
describe("the cities announce themselves", () => {
  it("lists every city beside the map, capitals first", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    createApp(root, { ...DEFAULT_PARAMS, seed: 5 });
    await new Promise((r) => setTimeout(r, 0));
    const items = [...root.querySelectorAll(".city-list-item")];
    expect(items.length).toBe(28);
    const caps = items.filter((b) => b.classList.contains("is-capital"));
    expect(caps.length).toBeGreaterThan(1);
    // every capital comes before every other town
    const lastCap = items.lastIndexOf(caps[caps.length - 1]);
    expect(items.slice(0, lastCap + 1).every((b) => b.classList.contains("is-capital"))).toBe(true);
    root.remove();
  });

  // I1: the list renders Hangul through `properName` but nothing asserted the result actually WAS
  // Hangul — deleting `properName(` from app.ts:370 left every other test green while a Korean
  // reader saw a Latin name in the list beside a Korean map.
  it("names the city list in the reader's language", () => {
    localStorage.setItem("wm:lang", "en"); // pin the starting language; the toggle below leaves it ko
    const root = document.createElement("div");
    document.body.appendChild(root);
    createApp(root, small);
    const hasLatin = (s: string) => /[A-Za-z]/.test(s);
    const namesEn = [...root.querySelectorAll(".city-list-name")].map((el) => el.textContent ?? "");
    expect(namesEn.length).toBeGreaterThan(0);
    for (const n of namesEn) expect(hasLatin(n), `"${n}" has no Latin letter in English`).toBe(true);
    (root.querySelector(".lang-toggle") as HTMLButtonElement).click(); // en -> ko
    const namesKo = [...root.querySelectorAll(".city-list-name")].map((el) => el.textContent ?? "");
    expect(namesKo.length).toBe(namesEn.length);
    for (const n of namesKo) expect(hasLatin(n), `"${n}" has a Latin letter on the Korean list`).toBe(false);
    root.remove();
    localStorage.removeItem("wm:lang");
  });

  // M7: the tiebreaker sorted by the Latin `c.name`, a string the Korean reader never sees, while
  // the button renders `properName(lang, c.name)` — so same-size Korean towns could land in an
  // order that has nothing to do with what is actually printed on the list.
  it("sorts the Korean city list by the name it renders, not the Latin name underneath", () => {
    localStorage.setItem("wm:lang", "ko");
    const root = document.createElement("div");
    document.body.appendChild(root);
    const params = { ...DEFAULT_PARAMS, seed: 5 };
    createApp(root, params);
    const { world } = generateWorld(params);
    const byId = new Map(world.cities.map((c) => [c.id, c]));
    const items = [...root.querySelectorAll(".city-list-item")];
    // walk runs of consecutive items sharing (isCapital, size) — exactly the groups M7's tiebreak
    // orders — and check each run's rendered names are non-decreasing under localeCompare
    let groupsChecked = 0;
    for (let i = 0; i < items.length; ) {
      const c0 = byId.get(Number(items[i].getAttribute("data-city")))!;
      let j = i;
      const names: string[] = [];
      while (j < items.length) {
        const c = byId.get(Number(items[j].getAttribute("data-city")))!;
        if (c.isCapital !== c0.isCapital || c.size !== c0.size) break;
        const rendered = items[j].querySelector(".city-list-name")!.textContent ?? "";
        expect(rendered, `city ${c.id}`).toBe(properName("ko", c.name)); // the group is keyed right
        names.push(rendered);
        j++;
      }
      if (names.length > 1) {
        groupsChecked++;
        for (let k = 1; k < names.length; k++) {
          expect(names[k].localeCompare(names[k - 1]), `"${names[k - 1]}" then "${names[k]}"`).toBeGreaterThanOrEqual(0);
        }
      }
      i = j;
    }
    expect(groupsChecked, "no same-size group to check the tiebreak on").toBeGreaterThan(0);
    root.remove();
    localStorage.removeItem("wm:lang");
  });

  it("opens a plan from the list, without anyone hitting a dot", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    createApp(root, { ...DEFAULT_PARAMS, seed: 5 });
    await new Promise((r) => setTimeout(r, 0));
    const item = root.querySelectorAll(".city-list-item")[3] as HTMLButtonElement;
    const name = item.querySelector(".city-list-name")!.textContent;
    item.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(root.querySelector(".city-name-text")?.textContent).toBe(name);
    root.remove();
  });
});

// The chronicle says a town was founded in year 140 and the town was on the map from year 0, so the
// timeline had nothing to show for five hundred years of history but moving borders.
describe("the towns arrive as the chronicle founds them", () => {
  it("shows fewer cities at the beginning than at the end", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    createApp(root, { ...DEFAULT_PARAMS, seed: 1 });
    await new Promise((r) => setTimeout(r, 0));
    const shown = () => new Set([...root.querySelectorAll<SVGElement>(".markers .marker-hit")]
      .filter((e) => e.style.display !== "none")
      .map((e) => e.getAttribute("data-city"))).size;
    const slider = root.querySelector(".timeline input[type=range]") as HTMLInputElement;
    slider.value = "0";
    slider.dispatchEvent(new Event("input"));
    await new Promise((r) => setTimeout(r, 0));
    const atStart = shown();
    slider.value = slider.max;
    slider.dispatchEvent(new Event("input"));
    await new Promise((r) => setTimeout(r, 0));
    const atEnd = shown();
    expect(atEnd, `year 0 showed ${atStart}, year 500 showed ${atEnd}`).toBeGreaterThan(atStart);
    // and the capitals are there from the first year — they are the seats the world starts with
    expect(atStart).toBeGreaterThanOrEqual(8);
    root.remove();
  });
});

// The political view drew id 12 in exactly the colour of id 0, so two realms with a border between
// them were often painted identically and the border read as no border at all — 7 of 12 seeds on
// the province-snapped map a reader is actually shown (8 of 12 by raw ownership, which is not what
// gets drawn; measuring the wrong one of the two is what let a first cut of this test pass with
// the wiring removed). `assignNationColors` fixes the colouring; this pins that the APP actually hands it to the
// renderer, which is the half a unit test cannot see.
describe("the political map never paints two neighbours the same colour", () => {
  // Seed 2, not seed 1. The app paints ownership SNAPPED TO PROVINCES, and on the painted map
  // seed 1 never has two same-coloured realms touching — a first cut of this test used it and
  // passed with the wiring deliberately removed. Seed 2 collides at year 130, realms 1 and 13.
  const full = { ...DEFAULT_PARAMS, seed: 2 };

  const fillsByPolity = (root: HTMLElement) => {
    const m = new Map<number, string>();
    for (const p of root.querySelectorAll("path.territory")) {
      const id = Number(p.getAttribute("data-polity"));
      const f = p.getAttribute("fill");
      if (!Number.isNaN(id) && f) m.set(id, f);
    }
    return m;
  };

  it("gives adjacent realms different fills, at the end of the history as well as the start", () => {
    const root = document.createElement("div");
    createApp(root, full);
    const political = (Array.from(root.querySelectorAll(".view-toggle button")) as HTMLButtonElement[])
      .find((b) => b.textContent === "Political")!;
    political.click();

    const { world } = generateWorld(full);
    const history = simulateHistory(world, full.seed);
    const slider = root.querySelector(".timeline-slider") as HTMLInputElement;
    expect(slider).not.toBeNull();

    let comparisons = 0;
    // EVERY snapshot, not a sample: seed 1's collision was at year 460, and a first cut of this
    // test that looked at the first, middle and last year passed with the wiring deliberately
    // removed. A colour clash lives in one decade of five centuries.
    for (let yearIndex = 0; yearIndex < history.snapshots.length; yearIndex++) {
      slider.value = String(yearIndex);
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      const fills = fillsByPolity(root);
      // the app snaps ownership to whole provinces before painting, so the borders to check are
      // the SNAPPED ones — raw ownership has neighbours the reader is never shown
      // The same `keep` the app passes: a free city's ground is smaller than a province, and it is
      // held out of the snap so the map, this list and the gazetteer stop giving two answers to
      // "who holds this town". Without it this expectation names the empire around a free city and
      // the list — correctly — names the free city.
      const freeRealms = new Set(history.polities.filter((p) => p.free).map((p) => p.id));
      const owner = snapOwnersToProvinces(world.grid.count, world.provinceOf, world.provinces,
                                          history.snapshots[yearIndex].owner, freeRealms);
      for (let i = 0; i < owner.length; i++) {
        const a = owner[i];
        if (a < 0 || !fills.has(a)) continue;
        for (const nb of world.grid.neighbors[i]) {
          const b = owner[nb];
          if (b < 0 || b === a || !fills.has(b)) continue;
          expect(fills.get(a), `year index ${yearIndex}: realms ${a} and ${b} share a fill`).not.toBe(fills.get(b));
          comparisons++;
        }
      }
    }
    expect(comparisons).toBeGreaterThan(100);   // real borders were compared, not an empty map
  });
});

// The map, its legend, the scrubber and the chronicle all live in the year the reader has scrubbed
// to. The city list beside them did not: it read `world.polityOf`, the ownership of YEAR ZERO, and
// never changed. Measured over six seeds at year 500: 114 of 168 towns were labelled with a realm
// that no longer held them, and 88 with a realm that no longer existed at all. On seed 2 the legend
// read Lialtrin/Varkthem/Stumvin/Muthfas while the list beside it read Melaelae/Skyrnfafr/Viorloar,
// with "500 AY" printed between the two.
describe("the city list is in the same century as the map", () => {
  const params = { ...DEFAULT_PARAMS, seed: 2 };

  const openAtYear = (yearIndex: number) => {
    const root = document.createElement("div");
    createApp(root, params);
    const slider = root.querySelector(".timeline-slider") as HTMLInputElement;
    slider.value = String(yearIndex);
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    return root;
  };
  const listed = (root: HTMLElement) =>
    [...root.querySelectorAll(".city-list-item")].map((b) => ({
      id: Number(b.getAttribute("data-city")),
      realm: (b.querySelector(".city-list-realm") as HTMLElement).textContent ?? "",
    }));

  it("names, for every town, the realm that holds it in the scrubbed year", () => {
    const { world } = generateWorld(params);
    const history = simulateHistory(world, params.seed);
    let checked = 0;
    for (const yearIndex of [0, 25, history.snapshots.length - 1]) {
      const root = openAtYear(yearIndex);
      // The same `keep` the app passes: a free city's ground is smaller than a province, and it is
      // held out of the snap so the map, this list and the gazetteer stop giving two answers to
      // "who holds this town". Without it this expectation names the empire around a free city and
      // the list — correctly — names the free city.
      const freeRealms = new Set(history.polities.filter((p) => p.free).map((p) => p.id));
      const owner = snapOwnersToProvinces(world.grid.count, world.provinceOf, world.provinces,
                                          history.snapshots[yearIndex].owner, freeRealms);
      for (const { id, realm } of listed(root)) {
        const city = world.cities.find((c) => c.id === id)!;
        const o = owner[city.cell];
        const expected = o >= 0 ? history.polities[o].name : "";
        // The cell NAMES that realm and, in English, says what kind of state it is — the column has
        // no legend and no typography to read that from (see polityLabeller). Asserting the exact
        // string would only restate the labeller; what this test is for is WHICH realm is named.
        // `=== name` or `name + " "`, not `startsWith`: one realm's name can be another's prefix.
        const names = (cell: string) => cell === expected || cell.startsWith(expected + " ");
        expect(names(realm), `year index ${yearIndex}, ${city.name}: "${realm}" is not ${expected || "(unclaimed)"}`).toBe(true);
        if (expected) expect(realm, `${city.name}: no kind of state named`).toMatch(/ (Kingdom|Empire|Free City)$/);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(60);
  });

  it("never names a realm that has already fallen", () => {
    const { world } = generateWorld(params);
    const history = simulateHistory(world, params.seed);
    const lastIndex = history.snapshots.length - 1;
    const root = openAtYear(lastIndex);
    const standing = new Set<string>();
    for (const o of history.snapshots[lastIndex].owner) if (o >= 0) standing.add(history.polities[o].name);
    // the cell carries the kind of state after the name now; the realm is the part before it
    const named = listed(root).map((r) => r.realm.replace(/ (Kingdom|Empire|Free City)$/, "")).filter(Boolean);
    expect(named.length).toBeGreaterThan(10);
    for (const n of named) expect(standing, `"${n}" no longer exists in 500 AY`).toContain(n);
  });
});

// The terrain key sits in the map's bottom-left corner and most readers know what a green patch is
// by the second look. It is furniture, so it folds away — and stays folded, because a reader who
// put it away did not mean "until the next world".
describe("the map's legend folds away", () => {
  const open = () => {
    const root = document.createElement("div");
    createApp(root, { ...DEFAULT_PARAMS, seed: 2 });
    return root;
  };
  const legendVisible = (root: HTMLElement) => !root.querySelector(".map-frame")!.classList.contains("legend-off");

  beforeEach(() => { try { localStorage.removeItem("wm:legend"); } catch { /* private mode */ } });
  const legendHead = (root: HTMLElement) => root.querySelector(".legend-fold .fold-head") as HTMLButtonElement;

  beforeEach(() => { try { localStorage.removeItem("wm:legend"); } catch { /* private mode */ } });

  it("starts folded, with a control to unfold it", () => {
    const root = open();
    expect(legendHead(root)).not.toBeNull();
    expect(legendVisible(root)).toBe(false);
    expect(root.querySelector(".legend-fold .legend-sheet .legend"), "the key is drawn, only folded").not.toBeNull();
  });

  it("unfolds and folds again on the control", () => {
    const root = open();
    const btn = legendHead(root);
    btn.click();
    expect(legendVisible(root)).toBe(true);
    btn.click();
    expect(legendVisible(root)).toBe(false);
  });

  it("remembers that it was unfolded, into the next world", () => {
    const first = open();
    legendHead(first).click();
    expect(localStorage.getItem("wm:legend")).toBe("on");
    expect(legendVisible(open())).toBe(true);
  });

  // ⚠ Two things were wrong with the key on the map, and the second is why it is off the map now.
  // It was drawn INSIDE the SVG, which is what the zoom moves: at 1440x900, two presses of `+` put
  // it 294px off the left edge of the frame at twice its size. And a key on the map covers the map
  // — measured over 12 seeds it stood on a town in 11 of 336 towns, one a capital, and in SIX of
  // the twelve worlds. No corner is reliably empty, because the land is different every time.
  it("stands beside the map, never in the drawing the zoom moves", () => {
    const root = open();
    legendHead(root).click();
    expect(root.querySelector(".legend-fold .legend-sheet .legend"), "the key is not beside the map").not.toBeNull();
    expect(root.querySelector("svg.world .legend"), "the key is in the drawing the zoom moves").toBeNull();
    expect(root.querySelector(".map-frame .legend-sheet"), "the key is floating on the map again").toBeNull();
    // ...and nothing of the key's is on the drawing, folded or unfolded
    expect(root.querySelector(".map-frame .legend-toggle"), "a chip is back on the map").toBeNull();
  });

  it("says which way it will go", () => {
    const root = open();
    const btn = legendHead(root);
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    btn.click();
    expect(btn.getAttribute("aria-expanded")).toBe("true");
  });
});

// "지도가 화면 크게 나오면 좋을거 같은데". Widening the page could not answer it: the map is sized
// by the vertical room left after the title, the toolbar and the scrubber, so raising the width cap
// changes nothing while the height is what binds. The chrome has to go instead.
describe("the map can take the whole window", () => {
  const open = () => {
    const root = document.createElement("div");
    createApp(root, { ...DEFAULT_PARAMS, seed: 2 });
    return root;
  };
  const focused = () => document.body.classList.contains("map-focus");
  afterEach(() => document.body.classList.remove("map-focus"));

  it("offers the map a way to fill the screen, and starts out of it", () => {
    const root = open();
    expect(root.querySelector(".focus-toggle")).not.toBeNull();
    expect(focused()).toBe(false);
  });

  it("enters and leaves on the control", () => {
    const root = open();
    const btn = root.querySelector(".focus-toggle") as HTMLButtonElement;
    btn.click();
    expect(focused()).toBe(true);
    btn.click();
    expect(focused()).toBe(false);
  });

  it("leaves on Escape, which is where a reader's hand goes", () => {
    const root = open();
    (root.querySelector(".focus-toggle") as HTMLButtonElement).click();
    expect(focused()).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(focused()).toBe(false);
  });

  it("keeps the scrubber, because a map of one year is half the map", () => {
    const root = open();
    (root.querySelector(".focus-toggle") as HTMLButtonElement).click();
    expect(root.querySelector(".timeline")).not.toBeNull();
    expect(root.querySelector("svg.world")).not.toBeNull();
  });

  // Leaving the page in focus would strand a reader on a chrome-less screen after a reload.
  it("does not outlive the visit", () => {
    const root = open();
    (root.querySelector(".focus-toggle") as HTMLButtonElement).click();
    expect(focused()).toBe(true);
    open();                              // a fresh app on the same document
    expect(focused()).toBe(false);
  });
});

// Twelve controls at exactly the same weight, colour and size: measured at 1920x945, every one of
// them wore background #f3ead2, border #b7a071, weight 400, 14px — so "Generate" looked like "PNG",
// and at 71px it was the NARROWEST control in the bar apart from the home icon. A toolbar with no
// primary makes the reader read all of it, every time.
//
// Measuring also moved the answer: `Generate` re-runs the seed already in the box, so pressing it
// without editing the seed produces the same world and nothing visibly happens. The die is the
// control that always yields something new, so the die is the primary — and the seed box keeps its
// own button as the way to reach a particular world.
describe("the toolbar says which control is the main one", () => {
  it("has exactly one primary control, and it is the one that always makes a new world", () => {
    const root = document.createElement("div");
    createApp(root, small);
    const primary = Array.from(root.querySelectorAll(".controls .primary"));
    expect(primary.length).toBe(1);
    expect(primary[0].classList.contains("random-seed")).toBe(true);
  });

  it("keeps the seed box and its button as one control, not two rivals", () => {
    const root = document.createElement("div");
    createApp(root, small);
    const group = root.querySelector(".controls .seed-group")!;
    expect(group).not.toBeNull();
    expect(group.querySelector("input[type=number]")).not.toBeNull();
    expect(group.querySelector("button")).not.toBeNull();
    // and the die is NOT inside it: it belongs to the same zone but is its own action
    expect(group.querySelector(".random-seed")).toBeNull();
  });

  it("names the die by what it gives you, not by the machinery", () => {
    const root = document.createElement("div");
    createApp(root, small);
    const die = root.querySelector(".controls .random-seed")!;
    expect(die.textContent).toContain("New world");
    expect(die.textContent).not.toContain("seed");
  });
});

// ⚠ This described a panel that is gone. The chronicle stood under the map as every moment of the
// history — 48 rows on seed 3, always open on a wide window — and each row was a way INTO the map:
// clicking it moved the year. The reader it was built for, asked whether they read it, said no. So
// the panel is a one-line caption under the scrubber now, and the rows it indexed are in the
// gazetteer, which always built its own copy. What replaces this test is the caption's own rule:
// it says what had last happened by the year the map is drawn at, and it is never blank after the
// founding — measured, 54% of scrub steps have no event of their own, with runs of 34.
describe("the chronicle is a caption under the scrubber", () => {
  it("names what had last happened by the year the map is drawn at", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    createApp(root, { ...DEFAULT_PARAMS, seed: 5 });
    await new Promise((r) => setTimeout(r, 0));

    const caption = root.querySelector(".chronicle-caption") as HTMLElement;
    expect(caption, "no caption under the scrubber").not.toBeNull();
    expect(caption.closest(".timeline-strip"), "the caption is not with the scrubber it belongs to").not.toBeNull();
    expect(root.querySelector(".chronicle-event"), "the 48-row panel is back under the map").toBeNull();

    const slider = root.querySelector(".timeline input[type=range]") as HTMLInputElement;
    const said: string[] = [];
    for (const v of ["0", "10", "25", slider.max]) {
      slider.value = v;
      slider.dispatchEvent(new Event("input"));
      said.push(caption.textContent ?? "");
    }
    for (const line of said) expect(line.length, "a blank caption").toBeGreaterThan(0);
    expect(new Set(said).size, "the caption never changed across the whole history").toBeGreaterThan(1);
  });
});

// "500년을 감으로 긁는다" — the slider ran 0 to 500 with nothing written on it but the readout of
// wherever the thumb happened to be, so reaching a century meant hunting.
describe("the timeline says where the centuries are", () => {
  it("marks every century across the run", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    createApp(root, { ...DEFAULT_PARAMS, seed: 5 });
    await new Promise((r) => setTimeout(r, 0));
    const ticks = [...root.querySelectorAll(".timeline-tick")].map((t) => t.textContent);
    expect(ticks).toEqual(["0", "100", "200", "300", "400", "500"]);
    root.remove();
  });
});

// The phone was the first device this layout was ever opened on, and it showed two things that
// look like a key (a 46x55 smudge on the map and the chip beside it), no way to fold the panels,
// and 641px of town list and chronicle under a 225px map.
//
// jsdom has no `matchMedia` at all, so the app's own guard reports a wide window and every test
// above this point measures the layout it always measured. These stub one in.
describe("a window too narrow to carry the map's furniture", () => {
  const stubWidth = (narrow: boolean) => {
    (window as unknown as { matchMedia: unknown }).matchMedia = (media: string) => ({
      media, matches: narrow, addEventListener() {}, removeEventListener() {},
    });
  };
  afterEach(() => { delete (window as unknown as { matchMedia?: unknown }).matchMedia; });

  it("stands the key under the map instead of shrinking it onto one", () => {
    stubWidth(true);
    const root = document.createElement("div");
    createApp(root, small);
    expect(root.querySelector("svg.world .legend"), "the key is still on the map").toBeNull();
    expect(root.querySelector(".legend-sheet .legend")).not.toBeNull();
  });

  // ⚠ The trap: in every view but terrain the key is drawn inside `.political-slot`, and scrubbing
  // a year replaces that slot wholesale. Without a second placement the key walks back onto the
  // map the moment the reader touches the timeline.
  it("keeps the key off the map after a year is scrubbed", () => {
    stubWidth(true);
    const root = document.createElement("div");
    createApp(root, small);
    (([...root.querySelectorAll(".view-toggle button")]
      .find((b) => b.textContent === "Political")) as HTMLButtonElement).click();
    expect(root.querySelector(".legend-sheet .nation-legend")).not.toBeNull();
    const slider = root.querySelector(".timeline input[type=range]") as HTMLInputElement;
    slider.value = slider.max;
    slider.dispatchEvent(new Event("input"));
    expect(root.querySelectorAll(".legend").length, "the year left two keys behind").toBe(1);
    expect(root.querySelector("svg.world .legend"), "the key climbed back onto the map").toBeNull();
    expect(root.querySelector(".legend-sheet .nation-legend")).not.toBeNull();
  });

  it("folds the town list and the key, each under the title it already had", () => {
    stubWidth(true);
    const root = document.createElement("div");
    createApp(root, small);
    const heads = [...root.querySelectorAll(".fold-head")] as HTMLButtonElement[];
    const titled = (re: RegExp) => heads.find((h) => re.test(h.textContent || ""));
    expect(titled(/Cities/), "no folding town list").toBeTruthy();
    expect(titled(/Key/), "no folding key").toBeTruthy();   // the chronicle is a caption now, not a section
    for (const h of heads) expect(h.disabled, `${h.textContent} cannot be folded`).toBe(false);
    // Folded, the head is all that is left of the section: it has to say what is inside — and the
    // number has to be the towns actually in the list, not the `townCount` asked for (a 6-town
    // world lands 14 of them once capitals are seated).
    const rows = root.querySelectorAll(".city-list-item").length;
    expect(rows).toBeGreaterThan(0);
    expect(titled(/Cities/)!.querySelector(".fold-count")!.textContent).toBe(String(rows));
  });

  // The plate has the same disease: 568 units drawn 321px wide is x0.565, and the district key
  // measured 7.0px type with a 4.5px swatch on a real 375px screen. Its key is not ON the drawing
  // though — it has a 108-unit strip of its own — so taking it away leaves a near-empty column,
  // and the strip shrinks to the compass that is all that is left in it.
  it("takes the district key off a plate too, and gives the town the strip back", () => {
    stubWidth(true);
    const root = document.createElement("div");
    const app = createApp(root, small);
    app.openCity(0);
    const plate = root.querySelector("svg.city") as SVGSVGElement;
    expect(plate.querySelector(".legend") === null, "the key is still on the plate").toBe(true);
    expect(root.querySelector(".legend-sheet .legend") !== null, "no key standing under the plate").toBe(true);
    const width = Number(plate.getAttribute("viewBox")!.split(" ")[2]);
    expect(width).toBe(460 + COMPASS_STRIP);
  });

  // ⚠ This used to assert the opposite: a wide plate kept its key in a 108-unit strip of its own.
  // It comes off at every width now, for the reason the world map's key did — the key was inside
  // the SVG, and the SVG is what the zoom moves: two presses of `+` put the plate's key at (1234,
  // -60), off the top of a frame that starts at 231, at twice its size. The strip shrinks to the
  // compass either way, so there is one plate geometry now instead of two.
  it("takes the key off a wide plate too, leaving the strip to the compass", () => {
    stubWidth(false);
    const root = document.createElement("div");
    const app = createApp(root, small);
    app.openCity(0);
    const plate = root.querySelector("svg.city") as SVGSVGElement;
    expect(plate.querySelector(".legend") === null, "the key is still in the drawing the zoom moves").toBe(true);
    expect(Number(plate.getAttribute("viewBox")!.split(" ")[2])).toBe(460 + COMPASS_STRIP);
    expect(root.querySelector(".legend-sheet .legend") !== null, "no key standing under the plate").toBe(true);
  });

  // ⚠ `.map-frame` is the anchor for everything that FLOATS over the map: the zoom controls sit at
  // its bottom-right, the focus button at its top-right, the key's chip at its bottom-left. Anything
  // put INSIDE it grows the box those are measured from. The key's fold went in there first, and on
  // a live 375px phone it pushed the zoom controls 104px below the map, onto the key itself.
  it("keeps the key's fold outside the frame the map's floating controls hang off", () => {
    stubWidth(true);
    const root = document.createElement("div");
    createApp(root, small);
    expect(root.querySelector(".legend-fold") !== null, "no key fold at all").toBe(true);
    expect(root.querySelector(".map-frame .legend-fold") === null,
           "the fold is inside the frame; it will push the zoom controls off the map").toBe(true);
  });

  it("keeps the plate's key fold outside its frame too", () => {
    stubWidth(true);
    const root = document.createElement("div");
    const app = createApp(root, small);
    app.openCity(0);
    expect(root.querySelector(".legend-fold") !== null, "no key fold on the plate").toBe(true);
    expect(root.querySelector(".map-frame .legend-fold") === null,
           "the plate's fold is inside its frame; the zoom controls will follow it down").toBe(true);
  });

  // The scrubber moves the map, so on a narrow screen it belongs under the map — not stranded
  // between the town list and the chronicle, which is where stacking the sections had left it.
  it("puts the scrubber under the map, above the folding sections", () => {
    stubWidth(true);
    const root = document.createElement("div");
    createApp(root, small);
    // ⚠ `.map-frame` is ALSO an SVG <g> the renderer draws, so ask for the HTML boxes by tag.
    const order = [...root.querySelectorAll("div.map-frame, div.timeline, section.legend-fold, section.city-list")]
      .map((el) => (el.getAttribute("class") ?? "").split(" ")
        .find((c) => /^(map-frame|timeline|legend-fold|city-list)$/.test(c)));
    expect(order).toEqual(["map-frame", "timeline", "legend-fold", "city-list"]);
  });

  it("leaves the scrubber where it was on a wide window", () => {
    stubWidth(false);
    const root = document.createElement("div");
    createApp(root, small);
    const order = [...root.querySelectorAll("div.map-frame, div.timeline, section.city-list")]
      .map((el) => (el.getAttribute("class") ?? "").split(" ")
        .find((c) => /^(map-frame|timeline|city-list)$/.test(c)));
    expect(order).toEqual(["map-frame", "city-list", "timeline"]);
  });

  // Measured on a live phone: the title and toolbar came to 236px of an 812px screen — 29%, on a
  // map 225px tall. The controls outweighed the thing they control. The toolbar gets the treatment
  // the panels got: what a phone actually uses stays out, the rest folds behind one control.
  it("keeps only the phone's own actions out, and folds the rest behind one control", () => {
    stubWidth(true);
    const root = document.createElement("div");
    createApp(root, small);
    const controls = root.querySelector(".controls")!;
    const more = controls.querySelector(".more-toggle") as HTMLButtonElement;
    expect(more, "nothing to unfold the rest of the toolbar with").not.toBeNull();
    // the three that stay: home, a new world, and which map you are looking at
    for (const stays of [".home", ".random-seed", ".view-toggle"]) {
      expect(controls.querySelector(`${stays}.secondary`) === null, `${stays} was folded away`).toBe(true);
    }
    // and the ones a phone can do least with
    for (const folds of [".seed-group", ".export-group", ".gazetteer", ".lang-toggle"]) {
      expect(controls.querySelector(`${folds}.secondary`) !== null, `${folds} is not foldable`).toBe(true);
    }
  });

  it("unfolds and refolds the rest of the toolbar", () => {
    stubWidth(true);
    const root = document.createElement("div");
    createApp(root, small);
    const controls = root.querySelector(".controls")!;
    const more = controls.querySelector(".more-toggle") as HTMLButtonElement;
    expect(controls.classList.contains("more-open")).toBe(false);
    expect(more.getAttribute("aria-expanded")).toBe("false");
    more.click();
    expect(controls.classList.contains("more-open")).toBe(true);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    more.click();
    expect(controls.classList.contains("more-open")).toBe(false);
  });

  // A plate is not the world map: the view toggles switch a map that is not on screen, and the seed
  // box builds a world you would be leaving the plate to see.
  it("marks the world-only controls, and says which screen is showing", () => {
    stubWidth(true);
    const root = document.createElement("div");
    const app = createApp(root, small);
    const controls = root.querySelector(".controls")!;
    expect(controls.classList.contains("plate"), "the world map is flagged as a plate").toBe(false);
    app.openCity(0);
    expect(controls.classList.contains("plate"), "the plate is not flagged").toBe(true);
    for (const worldOnly of [".view-toggle", ".seed-group"]) {
      expect(controls.querySelector(`${worldOnly}.world-only`) !== null, `${worldOnly} is not marked world-only`).toBe(true);
    }
    app.showWorld();
    expect(controls.classList.contains("plate")).toBe(false);
  });

  it("leaves a wide window exactly as it was: key beside the map, panels open, heads standing down", () => {
    stubWidth(false);
    const root = document.createElement("div");
    createApp(root, small);
    // the key stands in the column beside the map at every width — only the town list and the
    // chronicle change their manners with the window
    expect(root.querySelector(".legend-fold .legend-sheet .legend")).not.toBeNull();
    expect(root.querySelector("svg.world .legend"), "the key is back in the drawing the zoom moves").toBeNull();
    const cities = [...root.querySelectorAll(".fold-head")]
      .find((h) => /Cities/.test(h.textContent || "")) as HTMLButtonElement;
    expect(cities.disabled, "a control that does nothing is taking a tab stop").toBe(true);
    expect(cities.closest(".fold")!.classList.contains("is-open")).toBe(true);
  });
});
