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
  it("exposes an SVG export button", () => {
    const root = document.createElement("div");
    createApp(root, small);
    const labels = Array.from(root.querySelectorAll(".controls button")).map((b) => b.textContent);
    expect(labels).toContain("Export SVG");
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
