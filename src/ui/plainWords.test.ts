// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { DEFAULT_PARAMS } from "../types/world";
import { createApp } from "./app";

afterEach(() => { location.hash = ""; document.body.replaceChildren(); localStorage.clear(); });

function open(lang: "ko" | "en" = "ko") {
  localStorage.setItem("wm:lang", lang);
  const root = document.createElement("div");
  document.body.appendChild(root);
  createApp(root, { ...DEFAULT_PARAMS, seed: 5 });
  return root;
}
const box = (root: HTMLElement) => root.querySelector<HTMLInputElement>(".controls .seed-group input[type=number]")!;

// The bar held a bare number — "967042" — beside a button called "생성", next to "새 세계": two ways to make
// a world, and nothing to say what the number was (live, 2026-10-08). A name made into a world shows its
// seed there as well ("2996048455" for 아발론).
describe("the world's number says what it is", () => {
  it("is labelled where it stands, in the reader's language", () => {
    for (const lang of ["ko", "en"] as const) {
      const root = open(lang);
      const input = box(root);
      expect(input.labels?.length ?? 0, `${lang}: the number box has no label`).toBe(1);
      const label = input.labels![0];
      expect(label.textContent?.trim(), `${lang}: the label says nothing`).toBeTruthy();
      expect(root.querySelector(".seed-group")!.contains(label), `${lang}: the label is not beside the box`).toBe(true);
      document.body.replaceChildren();
    }
  });

  it("opens the world of a number typed and entered", () => {
    const root = open("en");
    const title = document.title;
    box(root).value = "77";
    box(root).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(document.title, "Enter in the box did nothing").not.toBe(title);
    expect(box(root).value).toBe("77");
  });
});

// The picture of today's world was capped by width only (620px), so a 1366x650 laptop window showed the
// card that makes a world 53px deep at its foot, and the other two ways in below the fold (live, 2026-10-08).
describe("the front page in a short window", () => {
  it("lets the window's height bound the picture, so the card it leads to stays in view", () => {
    const css = readFileSync("src/theme.css", "utf8");
    const at = css.indexOf(".landing-preview {");
    expect(css.slice(at, css.indexOf("}", at)), "the picture is not sized by the shared width").toMatch(/max-width:\s*var\(--preview-w\)/);
    const width = /--preview-w:\s*([^;]+);/.exec(css)?.[1] ?? "";
    expect(width, "the picture is sized by the width alone").toMatch(/vh/);
  });
});
