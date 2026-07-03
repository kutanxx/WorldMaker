// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderStub } from "./playMain";

describe("renderStub", () => {
  it("renders the coming-soon placeholder and a home link", () => {
    const root = document.createElement("div");
    renderStub(root);
    expect(root.textContent).toContain("제국");
    const home = root.querySelector("a.home-link");
    expect(home?.getAttribute("href")).toBe("index.html");
  });
});
