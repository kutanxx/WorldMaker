// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";

// jsdom has no canvas to draw a PNG with: what reaches the drawing step is what is checked, and the files
// are caught at the download
const drawn: { svg: SVGSVGElement; width: number; height: number }[] = [];
const saved: { name: string; blob: Blob }[] = [];
vi.mock("./export", async (original) => ({
  ...(await original<typeof import("./export")>()),
  svgToPngBlob: vi.fn(async (svg: SVGSVGElement, width: number, height: number) => { drawn.push({ svg, width, height }); return new Blob(); }),
  downloadBlob: vi.fn((name: string, blob: Blob) => { saved.push({ name, blob }); }),
}));
const { createApp } = await import("./app");

afterEach(() => { location.hash = ""; drawn.length = 0; saved.length = 0; document.body.replaceChildren(); });

const text = (b: Blob) => new Promise<string>((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(fr.error);
  fr.readAsText(b);
});
const until = async (done: () => boolean) => { for (let k = 0; k < 400 && !done(); k++) await new Promise((r) => setTimeout(r, 5)); };
const button = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll<HTMLButtonElement>(".export-group > button")].find((b) => b.textContent === label)!;
const numbers = (box: string | null) => (box ?? "").split(/[\s,]+/).map(Number);

function open() {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const app = createApp(root, { ...DEFAULT_PARAMS, seed: 1 });
  return { root, app, map: () => root.querySelector<SVGSVGElement>("svg.world")! };
}

// A region of the map, for a chapter: zoomed in, the reader is asked whether the file is the whole map or the
// part on screen. Not zoomed, nothing is asked — the file is the whole map, as it always was. (FMG writes the
// visible part without asking, and a reader who expected the whole map got part of it — the reason to ask.)
describe("exporting what is on the screen", () => {
  it("writes the whole map at once when the map is not zoomed in", async () => {
    const { root } = open();
    button(root, "PNG").click();
    await until(() => drawn.length > 0);
    expect(root.querySelector(".export-choice"), "asked a question with nothing to choose").toBeNull();
    expect(drawn[0].svg.getAttribute("viewBox")).toBe("0 0 1000 700");
  }, 20000);

  it("asks, when zoomed in, whether to write the whole map or the part on screen", async () => {
    const { root } = open();
    (root.querySelector(".zoom-in") as HTMLButtonElement).click();
    button(root, "PNG").click();
    await new Promise((r) => setTimeout(r, 20));
    expect(drawn.length, "wrote a file before asking").toBe(0);
    const choice = root.querySelector(".export-choice")!;
    expect(choice, "no question").not.toBeNull();
    const items = [...choice.querySelectorAll<HTMLButtonElement>("button")];
    expect(items.map((b) => b.dataset.scope)).toEqual(["whole", "visible"]);
    expect(items[1].textContent, "the part on screen says how much ground it holds").toMatch(/\d+\s*[x×]\s*\d+\s*km/);
    expect(document.activeElement, "the question takes the keyboard").toBe(items[0]);
  }, 20000);

  it("writes the part on screen, at the print size, set on its own page", async () => {
    const { root, map } = open();
    (root.querySelector(".zoom-in") as HTMLButtonElement).click();
    (root.querySelector(".zoom-in") as HTMLButtonElement).click();
    const onScreen = numbers(map().getAttribute("viewBox"));
    button(root, "PNG").click();
    (root.querySelector(".export-choice [data-scope=visible]") as HTMLButtonElement).click();
    await until(() => drawn.length > 0);
    expect(root.querySelector(".export-choice"), "the question stayed open").toBeNull();
    const file = drawn[0];
    numbers(file.svg.getAttribute("viewBox")).forEach((v, i) => expect(v, `viewBox ${i}`).toBeCloseTo(onScreen[i], 1));
    expect([file.width, file.height]).toEqual([3000, 2100]);
    expect(file.svg.querySelector(":scope > .page-furniture"), "the key and the compass left behind").not.toBeNull();
  }, 20000);

  it("writes the whole map when that is what the reader picks, zoomed or not", async () => {
    const { root } = open();
    (root.querySelector(".zoom-in") as HTMLButtonElement).click();
    button(root, "PNG").click();
    (root.querySelector(".export-choice [data-scope=whole]") as HTMLButtonElement).click();
    await until(() => drawn.length > 0);
    expect(drawn[0].svg.getAttribute("viewBox")).toBe("0 0 1000 700");
    expect(drawn[0].svg.querySelector(".page-furniture")).toBeNull();
    expect([drawn[0].width, drawn[0].height]).toEqual([3000, 2100]);
  }, 20000);

  it("writes the part on screen as an SVG too", async () => {
    const { root, map } = open();
    (root.querySelector(".zoom-in") as HTMLButtonElement).click();
    const onScreen = numbers(map().getAttribute("viewBox"));
    button(root, "SVG").click();
    (root.querySelector(".export-choice [data-scope=visible]") as HTMLButtonElement).click();
    await until(() => saved.length > 0);
    expect(saved[0].name).toMatch(/\.svg$/);
    const box = numbers(/viewBox="([^"]+)"/.exec(await text(saved[0].blob))![1]);
    box.forEach((v, i) => expect(v, `viewBox ${i}`).toBeCloseTo(onScreen[i], 1));
  }, 20000);

  it("closes on Escape, writes nothing, and gives the keyboard back to the button", async () => {
    const { root } = open();
    (root.querySelector(".zoom-in") as HTMLButtonElement).click();
    const png = button(root, "PNG");
    png.click();
    const choice = root.querySelector(".export-choice") as HTMLElement;
    choice.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect(root.querySelector(".export-choice")).toBeNull();
    expect(drawn.length + saved.length).toBe(0);
    expect(document.activeElement).toBe(png);
  }, 20000);

  it("closes when the reader clicks elsewhere", async () => {
    const { root } = open();
    (root.querySelector(".zoom-in") as HTMLButtonElement).click();
    button(root, "PNG").click();
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(root.querySelector(".export-choice")).toBeNull();
    expect(drawn.length).toBe(0);
  }, 20000);

  // A region is framed by zooming, then drawn the way it is wanted — in ink for the book, or as the realms
  // stood — and written. Every one of those switches redrew the map at rest, so the region framed was lost
  // on the way to the file.
  it("keeps the region framed through a change of view, of ink and of language", async () => {
    const { root, map } = open();
    (root.querySelector(".zoom-in") as HTMLButtonElement).click();
    const framed = map().getAttribute("viewBox");
    expect(framed).not.toBe("0 0 1000 700");
    (root.querySelector(".ink-toggle") as HTMLButtonElement).click();
    expect(map().getAttribute("viewBox"), "the ink").toBe(framed);
    ([...root.querySelectorAll(".view-toggle button")].find((b) => /Political|정치/.test(b.textContent ?? "")) as HTMLButtonElement).click();
    expect(map().getAttribute("viewBox"), "the realms' view").toBe(framed);
    (root.querySelector(".lang-toggle") as HTMLButtonElement).click();
    expect(map().getAttribute("viewBox"), "the language").toBe(framed);
    (root.querySelector(".lang-toggle") as HTMLButtonElement).click();
  }, 20000);

  it("does not ask on a town's plate — a plate is written whole, as it always was", async () => {
    const { root, app } = open();
    app.openCity(0);
    const zoomIn = root.querySelector(".zoom-in") as HTMLButtonElement | null;
    zoomIn?.click();
    button(root, "PNG").click();
    // (waited for by what it is: an earlier test's file can still be on its way when this one starts)
    await until(() => drawn.some((d) => d.svg.classList.contains("city")));
    expect(root.querySelector(".export-choice")).toBeNull();
    expect(drawn.some((d) => d.svg.classList.contains("city")), "the plate never written").toBe(true);
  }, 20000);
});
