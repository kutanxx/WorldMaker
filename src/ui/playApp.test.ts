// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createPlayApp } from "./playApp";

describe("playApp", () => {
  it("shows a nation picker, then mounts the play screen on selection", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    const choices = root.querySelectorAll(".nation-choice");
    expect(choices.length).toBeGreaterThan(0);
    (choices[0] as HTMLButtonElement).click();
    expect(root.querySelector("svg.world")).not.toBeNull();     // live map
    expect(root.querySelector(".play-panel")).not.toBeNull();   // nation panel
    expect(root.querySelector(".btn-attack")).not.toBeNull();   // attack action
    expect(root.querySelector(".btn-advance")).not.toBeNull();  // advance year
  });

  it("advancing a year updates the year readout", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const yearBefore = root.querySelector(".play-year")!.textContent;
    (root.querySelector(".btn-advance") as HTMLButtonElement).click();
    expect(root.querySelector(".play-year")!.textContent).not.toBe(yearBefore);
  });
});
