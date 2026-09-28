// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";
import { createApp } from "./app";
import { initialCity, initialNames, encodeParams } from "./urlState";
import { encodeNames } from "./nameBook";
import { generateWorld } from "../engine/world";
import { simulateHistory } from "../engine/history";
import { properName } from "./properName";
import { featureLabel, worldNameIn } from "../engine/featureLabel";
import { svgToString } from "./export";

// The reader's own names (nameBook.ts), kept in the link and written everywhere the world is: the map
// in every view, the town list, the plate, the tab's title, the gazetteer — as typed, in either language.
// Chosen from a demo: renamed where the name stands on the map, kept in the address.
const params = { ...DEFAULT_PARAMS, seed: 5 };
const world = generateWorld(params).world;
const history = simulateHistory(world, params.seed);
const town = 0;
const realm = history.snapshots[0].owner[world.cities[town].cell];
const book: Record<string, string> = { w: "새누리", [`t${town}`]: "아르델", [`r${realm}`]: "마바사", g0: "은빛 바다", v0: "은하강", c0: "하나" };
const visible = (el: Element) => [...el.querySelectorAll("text, li, .city-fact-value, .city-name-text")].map((e) => e.textContent ?? "").join(" | ");
const tick = () => new Promise((r) => setTimeout(r, 0));
const blobText = (b: Blob) => new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsText(b); });

afterEach(() => { location.hash = ""; localStorage.removeItem("wm:lang"); });

describe("the reader's names", () => {
  it("opens a world under the names its link carries, and writes them everywhere", async () => {
    localStorage.setItem("wm:lang", "ko");
    location.hash = encodeParams(params).slice(1) + "&names=" + encodeNames(book);
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const app = createApp(root, params);
      await tick();
      const was = {
        town: properName("ko", world.cities[town].name), region: featureLabel(world.regions[0].label, "ko"),
        river: featureLabel(world.rivers[0].label, "ko"), world: worldNameIn(world, "ko"),
      };
      const text = visible(root);
      for (const name of ["아르델", "은빛 바다", "은하강", "새누리"]) expect(text, name).toContain(name);
      for (const [what, old] of Object.entries(was)) expect(text, `the ${what} kept its old name ${old}`).not.toContain(old);
      expect(document.title).toContain("새누리");
      expect(text.includes("⁠"), "a mark left in the page").toBe(false);
      ([...root.querySelectorAll(".view-toggle button")].find((b) => /정치/.test(b.textContent ?? "")) as HTMLButtonElement).click();
      await tick();
      expect(visible(root)).toContain("마바사");
      app.openCity(town);
      await tick();
      expect(root.querySelector(".city-name-text")?.textContent).toBe("아르델");
      expect(visible(root)).toContain("마바사");
      // the plate's own address carries the names too
      expect(initialNames(location.hash)).toEqual(book);
      expect(initialCity(location.hash)).toBe(town);
      // ...and the gazetteer is written with them, and without the mark
      let md = "";
      const orig = URL.createObjectURL, revoke = URL.revokeObjectURL, click = HTMLAnchorElement.prototype.click;
      URL.createObjectURL = ((b: Blob) => { if (b.type === "text/markdown") blobText(b).then((t) => { md = t; }); return "blob:x"; }) as typeof URL.createObjectURL;
      URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
      HTMLAnchorElement.prototype.click = function () {};
      try {
        (root.querySelector(".controls button.gazetteer") as HTMLButtonElement).click();
        for (let k = 0; k < 200 && !md; k++) await new Promise((r) => setTimeout(r, 5));
      } finally { URL.createObjectURL = orig; URL.revokeObjectURL = revoke; HTMLAnchorElement.prototype.click = click; }
      expect(md).toContain("아르델");
      expect(md).toContain("마바사");
      expect(md.includes("⁠"), "a mark left in the gazetteer").toBe(false);
    } finally {
      root.remove();
    }
  }, 30000);

  it("renames a town where its name stands, and keeps the name in the link", async () => {
    location.hash = encodeParams(params).slice(1);
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      createApp(root, params);
      await tick();
      const pen = root.querySelector(".rename-toggle") as HTMLButtonElement;
      expect(pen, "no way to rename").not.toBeNull();
      expect(pen.getAttribute("aria-pressed")).toBe("false");
      const label = () => root.querySelector(`svg.world text.city-label[data-name='t${town}']`) as SVGTextElement;
      const editor = () => root.querySelector(".name-editor") as HTMLInputElement | null;
      const was = label().textContent!;
      pen.click();
      expect(pen.getAttribute("aria-pressed")).toBe("true");
      // while renaming, a town's name does not open its plate: it opens a box to type in
      label().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(root.querySelector("svg.world"), "a click on a name opened the plate while renaming").not.toBeNull();
      expect(editor(), "no box to type in").not.toBeNull();
      expect(editor()!.value).toBe(was);
      // Escape leaves it as it was
      editor()!.value = "Nope";
      editor()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(editor()).toBeNull();
      expect(label().textContent).toBe(was);
      // Enter keeps it — as typed, and in the link
      label().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      editor()!.value = "Rivendell";
      editor()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await tick();
      expect(label().textContent).toBe("Rivendell");
      expect(root.querySelector(".city-list")?.textContent).toContain("Rivendell");
      expect(initialNames(location.hash)).toEqual({ [`t${town}`]: "Rivendell" });
      expect(root.querySelector(".rename-toggle")!.getAttribute("aria-pressed"), "renaming stopped at the redraw").toBe("true");
      // an empty box gives the name back, and takes it out of the link
      label().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      editor()!.value = "";
      editor()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await tick();
      expect(label().textContent).toBe(was);
      expect(initialNames(location.hash)).toEqual({});
      // off again: the name opens the plate, as it always has
      (root.querySelector(".rename-toggle") as HTMLButtonElement).click();
      label().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(root.querySelector("svg.city"), "the name no longer opens its plate").not.toBeNull();
    } finally {
      root.remove();
    }
  }, 30000);

  it("renames a town from its plate's title, and the world keeps it", async () => {
    location.hash = encodeParams(params).slice(1);
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const app = createApp(root, params);
      await tick();
      app.openCity(town);
      // zoomed in first: the plate is drawn again under the new name, at the view the reader was at
      (root.querySelector(".stage.plate .map-zoom-controls .zoom-in") as HTMLButtonElement).click();
      const view = root.querySelector("svg.city")!.getAttribute("viewBox");
      (root.querySelector(".rename-toggle") as HTMLButtonElement).click();
      (root.querySelector(".city-name-text") as SVGTextElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const editor = root.querySelector(".name-editor") as HTMLInputElement;
      expect(editor, "no box on the plate").not.toBeNull();
      editor.value = "새 이름";
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await tick();
      expect(root.querySelector(".city-name-text")?.textContent).toBe("새 이름");
      expect(root.querySelector("svg.city")!.getAttribute("viewBox"), "the plate lost the reader's zoom").toBe(view);
      app.showWorld();
      await tick();
      expect(root.querySelector(`svg.world text.city-label[data-name='t${town}']`)?.textContent).toBe("새 이름");
    } finally {
      root.remove();
    }
  }, 30000);

  // Korean is typed through an input method, and its last syllable is still being put together when Enter
  // is pressed: that Enter finishes the syllable, and the name is kept once it is written — not before.
  it("keeps a name typed through an input method once its last syllable is written", async () => {
    location.hash = encodeParams(params).slice(1);
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      createApp(root, params);
      await tick();
      (root.querySelector(".rename-toggle") as HTMLButtonElement).click();
      const label = () => root.querySelector(`svg.world text.city-label[data-name='t${town}']`) as SVGTextElement;
      label().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const editor = root.querySelector(".name-editor") as HTMLInputElement;
      editor.value = "아르";
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }));
      expect(root.querySelector(".name-editor"), "closed on a syllable not yet written").not.toBeNull();
      editor.value = "아르델";
      editor.dispatchEvent(new Event("compositionend", { bubbles: true }));
      await tick();
      expect(root.querySelector(".name-editor")).toBeNull();
      expect(label().textContent).toBe("아르델");
    } finally {
      root.remove();
    }
  }, 30000);

  // The keys the map's names carry are for renaming on the screen; a downloaded map is as it was.
  it("leaves what each name names out of a downloaded map", async () => {
    location.hash = encodeParams(params).slice(1);
    const root = document.createElement("div");
    document.body.appendChild(root);
    let svg = "";
    const orig = URL.createObjectURL, revoke = URL.revokeObjectURL, click = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = ((b: Blob) => { if (b.type === "image/svg+xml") blobText(b).then((t) => { svg = t; }); return "blob:x"; }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
    HTMLAnchorElement.prototype.click = function () {};
    try {
      createApp(root, params);
      await tick();
      expect(root.querySelector("svg.world [data-name]"), "the screen's names carry their keys").not.toBeNull();
      ([...root.querySelectorAll(".export-group button")].find((b) => b.textContent === "SVG") as HTMLButtonElement).click();
      for (let k = 0; k < 400 && !svg; k++) await new Promise((r) => setTimeout(r, 5));
      expect(svg.length).toBeGreaterThan(1000);
      expect(svg.includes("data-name"), "a name's key went into the file").toBe(false);
    } finally {
      URL.createObjectURL = orig; URL.revokeObjectURL = revoke; HTMLAnchorElement.prototype.click = click;
      root.remove();
    }
  }, 30000);

  // A plate keeps room across its top for its town's name, measured from the name (city.ts, the title's
  // tablet). Laid out under the reader's name, a renamed town's hamlets and fields would move: the plan
  // is the town's and stays as it was, and only its title is the reader's.
  it("keeps a renamed town's plan as it was: only its title changes", async () => {
    const plan = async (hash: string) => {
      location.hash = hash;
      const root = document.createElement("div");
      document.body.appendChild(root);
      try {
        const app = createApp(root, params);
        await tick();
        app.openCity(town);
        await tick();
        const svg = root.querySelector("svg.city")!.cloneNode(true) as SVGSVGElement;
        for (const el of svg.querySelectorAll("g.city-name, text, title")) el.remove();
        return svgToString(svg);
      } finally {
        root.remove();
      }
    };
    const was = await plan(encodeParams(params).slice(1));
    const renamed = await plan(encodeParams(params).slice(1) + "&names=" + encodeNames({ [`t${town}`]: "Q".repeat(40) }));
    expect(was.length).toBeGreaterThan(1000);
    expect(renamed === was, "the plan moved under the new name").toBe(true);
  }, 30000);

  it("starts a new world with its own names", async () => {
    location.hash = encodeParams(params).slice(1) + "&names=" + encodeNames(book);
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const app = createApp(root, params);
      await tick();
      app.regenerate({ ...params, seed: 6 });
      await tick();
      expect(initialNames(location.hash)).toEqual({});
      expect(visible(root)).not.toContain("아르델");
    } finally {
      root.remove();
    }
  }, 30000);
});
