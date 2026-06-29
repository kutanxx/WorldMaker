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
});
