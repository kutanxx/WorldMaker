// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";
import { generateWorld } from "../engine/world";
import { simulateHistory } from "../engine/history";
import { generateCityLayout, cityContext } from "../engine/city";
import { worldFingerprint, plateFingerprint } from "../engine/fingerprint";
import { createApp } from "./app";

afterEach(() => { location.hash = ""; document.body.replaceChildren(); localStorage.clear(); });

function open(lang: "ko" | "en") {
  localStorage.setItem("wm:lang", lang);
  const root = document.createElement("div");
  document.body.appendChild(root);
  createApp(root, { ...DEFAULT_PARAMS, seed: 1 });
  return root;
}

// Every browser computes a world from its number; the fingerprint is how a reader checks that another
// browser, another device, computed the same one. It stands where the world's settings are — the same
// number and settings, the same world — and says what to do with it; a town's plate shows its own.
describe("the page shows the fingerprints to compare", () => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
  const history = simulateHistory(world, 1);
  it("shows the world's fingerprint with the world's settings, and how to use it", () => {
    const root = open("ko");
    const box = root.querySelector(".advanced .fingerprint");
    expect(box, "no fingerprint by the settings").not.toBeNull();
    expect(box!.querySelector(".fingerprint-code")!.textContent).toBe(worldFingerprint(world, history));
    expect(box!.textContent).toMatch(/브라우저/);
  });
  it("says it in English too", () => {
    const root = open("en");
    expect(root.querySelector(".advanced .fingerprint")!.textContent).toMatch(/browser/i);
  });
  it("shows a plate's own fingerprint among its facts", () => {
    const root = open("ko");
    root.querySelector<SVGElement>('.marker-hit[data-city="0"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const value = root.querySelector(".city-fact-fingerprint .city-fact-value");
    expect(value, "no fingerprint on the plate").not.toBeNull();
    expect(value!.textContent).toBe(plateFingerprint(generateCityLayout(cityContext(world.cities[0]), 1)));
  });
});
