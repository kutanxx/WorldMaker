// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";
import { createApp } from "./app";
import { encodeNames } from "./nameBook";

afterEach(() => { location.hash = ""; document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks(); });

// What a reader made here lives in the address and nowhere else — the world (its seed) and the names they
// gave its places. Measured on the live page (2026-10-08): "New world" rewrote the address in place, so Back
// left the site instead of returning to the world before; and a world whose places had been renamed was
// thrown away by it without a word — Back could not bring the names back, nor could the same seed.
const params = { ...DEFAULT_PARAMS, seed: 5 };
function open(hash = "", asked?: string) {
  localStorage.setItem("wm:lang", "en");
  location.hash = hash;
  const root = document.createElement("div");
  document.body.appendChild(root);
  createApp(root, params, asked);
  return root;
}
const seedBox = (root: HTMLElement) => root.querySelector<HTMLInputElement>(".controls input[type=number]")!;
const worldName = (root: HTMLElement) => root.querySelector("svg.world .world-name-text")!.textContent;
const newWorld = (root: HTMLElement) => root.querySelector<HTMLButtonElement>(".controls .random-seed")!.click();
// what the browser does on Back: the address goes back, and the page is told
const back = (hash: string) => { location.hash = hash; window.dispatchEvent(new PopStateEvent("popstate", { state: null })); };
const renamed = `seed=5&names=${encodeNames({ w: "Avalon" })}`;

describe("a new world is a place to come back to", () => {
  it("adds the new world to the history, and Back brings the world before it", () => {
    const root = open();
    const first = location.hash, title = document.title, entries = window.history.length;
    newWorld(root);
    expect(window.history.length, "the new world took the old one's place in the history").toBe(entries + 1);
    expect(location.hash).not.toBe(first);
    expect(document.title).not.toBe(title);
    back(first);
    expect(seedBox(root).value).toBe("5");
    expect(document.title).toBe(title);
  });

  it("makes no history of drawing the same world again", () => {
    const root = open();
    const entries = window.history.length;
    root.querySelector<HTMLButtonElement>(".controls .seed-group button")!.click();   // the seed in the box is this world's
    expect(window.history.length).toBe(entries);
  });

  it("brings back the names the reader gave, and the name the world was asked for", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const root = open(renamed);
    expect(worldName(root)).toBe("Avalon");
    const first = location.hash;
    newWorld(root);
    expect(worldName(root)).not.toBe("Avalon");
    back(first);
    expect(worldName(root), "Back brought the world without its names").toBe("Avalon");

    document.body.replaceChildren();
    const named = open("seed=Narnia", "Narnia");
    const asked = location.hash;
    newWorld(named);
    back(asked);
    expect(worldName(named)).toBe("Narnia");
  });
});

describe("leaving a world whose places were renamed", () => {
  it("asks first, says how many names and how to come back, and stays when the reader says no", () => {
    const ask = vi.spyOn(window, "confirm").mockReturnValue(false);
    const root = open(renamed);
    const entries = window.history.length, here = location.hash;
    newWorld(root);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0]).toMatch(/\b1\b/);
    expect(ask.mock.calls[0][0]).toMatch(/Back/);
    expect(worldName(root), "the world was thrown away though the reader said no").toBe("Avalon");
    expect(seedBox(root).value).toBe("5");
    expect(location.hash).toBe(here);
    expect(window.history.length).toBe(entries);
    ask.mockReturnValue(true);
    newWorld(root);
    expect(worldName(root)).not.toBe("Avalon");
  });

  it("does not ask about a world with no names of the reader's", () => {
    const ask = vi.spyOn(window, "confirm");
    const root = open();
    newWorld(root);
    expect(ask).not.toHaveBeenCalled();
  });

  it("puts a world setting back where it was when the reader stays", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const root = open(renamed);
    const dial = root.querySelector<HTMLInputElement>(".advanced input[name=townCount]")!;
    dial.value = "30";
    dial.dispatchEvent(new Event("input", { bubbles: true }));
    dial.dispatchEvent(new Event("change", { bubbles: true }));
    expect(worldName(root)).toBe("Avalon");
    expect(dial.value).toBe(String(params.townCount));
    expect(dial.closest(".advanced-row")!.querySelector("output")!.textContent).toBe(String(params.townCount));
  });

  it("puts the seed box back when the reader stays", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const root = open(renamed);
    seedBox(root).value = "77";
    root.querySelector<HTMLButtonElement>(".controls .seed-group button")!.click();
    expect(worldName(root)).toBe("Avalon");
    expect(seedBox(root).value).toBe("5");
  });
});

describe("the link is the way to keep a world", () => {
  const clipboard = () => {
    const writeText = vi.fn(async (_: string) => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    return writeText;
  };

  it("copies the address that opens this world again, names and all", async () => {
    const writeText = clipboard();
    const root = open(renamed);
    const copy = root.querySelector<HTMLButtonElement>(".controls .copy-link")!;
    expect(copy, "no way to copy the link").not.toBeNull();
    const idle = copy.textContent;
    copy.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(writeText).toHaveBeenCalledWith(location.href);
    expect(location.href).toContain("names=");
    expect(copy.textContent, "nothing said the link was copied").not.toBe(idle);
  });

  it("copies a town's plate as the plate's own address", async () => {
    const writeText = clipboard();
    const root = open();
    root.querySelector<HTMLButtonElement>(".city-list-item")!.click();
    root.querySelector<HTMLButtonElement>(".controls .copy-link")!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(writeText.mock.calls[0][0]).toMatch(/[#&]city=\d+/);
  });
});
