// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";

// jsdom has no canvas: the drawing step is held until the test lets it finish, and the files are caught at
// the download
let finishDrawing: (() => void)[] = [];
const saved: string[] = [];
vi.mock("./export", async (original) => ({
  ...(await original<typeof import("./export")>()),
  svgToPngBlob: vi.fn(() => new Promise<Blob>((res) => finishDrawing.push(() => res(new Blob())))),
  downloadBlob: vi.fn((name: string) => { saved.push(name); }),
}));
const { createApp } = await import("./app");

afterEach(() => { location.hash = ""; saved.length = 0; finishDrawing = []; document.body.replaceChildren(); localStorage.clear(); });

const until = async (done: () => boolean) => { for (let k = 0; k < 400 && !done(); k++) await new Promise((r) => setTimeout(r, 5)); };
function open(lang: "en" | "ko" = "en") {
  localStorage.setItem("wm:lang", lang);
  const root = document.createElement("div");
  document.body.appendChild(root);
  const app = createApp(root, { ...DEFAULT_PARAMS, seed: 1 });
  const button = (label: string) => [...root.querySelectorAll<HTMLButtonElement>(".controls button")].find((b) => b.textContent?.includes(label))!;
  return { root, app, button };
}

// A PNG takes a second or three to draw (1.5-1.8s for the whole map, 3.4s for a region in ink, measured
// live) and nothing on the page moved while it did: pressed again, it wrote the file twice.
describe("a file being written", () => {
  it("says so while it is written, and is written once however often it is pressed", async () => {
    const { root, button } = open();
    const group = root.querySelector(".export-group")!;
    button("PNG").click();
    await until(() => finishDrawing.length > 0);
    expect(group.getAttribute("aria-busy"), "nothing says a file is on its way").toBe("true");
    button("PNG").click();
    button("SVG").click();
    await new Promise((r) => setTimeout(r, 30));
    finishDrawing.forEach((f) => f());
    await until(() => saved.length > 0);
    await new Promise((r) => setTimeout(r, 30));
    expect(saved, "pressed three times, written more than once").toEqual(["Sodend.png"]);
    expect(group.getAttribute("aria-busy"), "still busy after the file was written").not.toBe("true");
  }, 20000);
});

// Every map file was world.png / world.svg / world.json, so a second world's file came down as
// "world (1).png" — while the gazetteer alone took the world's name, and in Latin letters on a Korean page.
describe("a file is named for what it holds", () => {
  const press = async (button: (l: string) => HTMLButtonElement, label: string) => {
    const n = saved.length;
    button(label).click();
    await until(() => finishDrawing.length > 0 || saved.length > n);
    finishDrawing.forEach((f) => f()); finishDrawing = [];
    await until(() => saved.length > n);
    return saved[saved.length - 1];
  };

  it("takes the world's name, in the reader's language", async () => {
    const { button } = open("ko");
    expect(await press(button, "PNG")).toBe("소덴드.png");
    expect(await press(button, "SVG")).toBe("소덴드.svg");
    expect(await press(button, "JSON")).toBe("소덴드.json");
    expect(await press(button, "📜")).toBe("소덴드.md");
  }, 20000);

  it("says the view, the year and the ink when they are not the map's first", async () => {
    const { root, button } = open("ko");
    ([...root.querySelectorAll<HTMLButtonElement>(".view-toggle button")].find((b) => b.textContent === "정치")!).click();
    const slider = root.querySelector(".timeline-slider") as HTMLInputElement;
    slider.value = "25";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    expect(await press(button, "PNG")).toBe("소덴드_정치_250년.png");
    (root.querySelector(".ink-toggle") as HTMLButtonElement).click();
    expect(await press(button, "SVG")).toBe("소덴드_정치_250년_흑백.svg");
  }, 20000);

  it("names a town's plate for its town and its world", async () => {
    const { app, button } = open("ko");
    app.openCity(1);
    expect(await press(button, "PNG")).toBe("소덴드_카아그.png");
  }, 20000);

  it("names it in English for an English reader", async () => {
    const { button } = open("en");
    expect(await press(button, "PNG")).toBe("Sodend.png");
  }, 20000);
});

// On a town's plate the PNG and SVG are the plate, and the JSON was still the world's data — one bar,
// two answers to "what am I saving".
describe("the world's data file", () => {
  it("is offered on the world map only", () => {
    const { root, app } = open();
    const json = () => [...root.querySelectorAll<HTMLButtonElement>(".export-group > button")].find((b) => b.textContent === "JSON")!;
    app.openCity(1);
    expect(json().classList.contains("world-only"), "the plate offers the world's data as its own").toBe(true);
  });
});
