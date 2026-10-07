// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";
import { createApp } from "./app";
import { encodeParams } from "./urlState";
import { readRecent } from "./recentWorlds";

afterEach(() => { location.hash = ""; document.body.replaceChildren(); localStorage.clear(); });

const params = { ...DEFAULT_PARAMS, seed: 5 };
const tick = () => new Promise((r) => setTimeout(r, 0));

// The list keeps what a reader would lose: a world they put names on, kept as the link that opens it with
// them. Recorded when a name is kept, and let go when the last one is given back.
describe("a world the reader names is kept for them", () => {
  it("goes on the list when a place in it is renamed, and off it when every name is given back", async () => {
    localStorage.setItem("wm:lang", "en");
    location.hash = encodeParams(params).slice(1);
    const root = document.createElement("div");
    document.body.appendChild(root);
    createApp(root, params);
    await tick();
    expect(readRecent(), "a world nobody named is on the list").toEqual([]);
    const label = () => root.querySelector("svg.world text.city-label[data-name='t0']") as SVGTextElement;
    const editor = () => root.querySelector(".name-editor") as HTMLInputElement;
    (root.querySelector(".rename-toggle") as HTMLButtonElement).click();
    label().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    editor().value = "Rivendell";
    editor().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await tick();
    const kept = readRecent();
    expect(kept.length).toBe(1);
    expect(kept[0].count).toBe(1);
    expect(kept[0].url, "the line does not open the world with its names").toBe("map.html" + location.hash);
    expect(kept[0].name).toBe(document.title.split(" — ")[0]);
    label().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    editor().value = "";
    editor().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await tick();
    expect(readRecent(), "a world with no names left stayed on the list").toEqual([]);
  }, 30000);
});
