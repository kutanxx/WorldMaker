// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";
import { createApp } from "./app";
import { hashStringToSeed } from "../engine/rng";
import { initialCity, decodeParams } from "./urlState";

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
    expect(onScreen.querySelector(".province-legend"), "no key on screen").not.toBeNull();

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
