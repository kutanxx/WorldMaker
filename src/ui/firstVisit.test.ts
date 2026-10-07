// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { DEFAULT_PARAMS } from "../types/world";
import { createApp } from "./app";

afterEach(() => { location.hash = ""; document.body.replaceChildren(); localStorage.clear(); });

function open(lang: "ko" | "en" = "ko") {
  localStorage.setItem("wm:lang", lang);
  const root = document.createElement("div");
  document.body.appendChild(root);
  const app = createApp(root, { ...DEFAULT_PARAMS, seed: 5 });
  return { root, app };
}

// What the map does was said only in tooltips: that a town's dot opens its plan, that the wheel zooms,
// that ▶ plays five hundred years, that a renamed place is kept in the link — and a reader who arrives by a
// shared link never sees the front page's words either (audit, 2026-10-08). Help where the work is, offered
// once and put away for good, is what a first visit is given (research: Azgaar's status line, NN/g).
describe("a first visit is told how the map is used", () => {
  it("says it above the map, and says that the towns open", () => {
    const { root } = open("ko");
    const hint = root.querySelector(".stage .first-hint");
    expect(hint, "nothing said to a first visit").not.toBeNull();
    expect(hint!.textContent).toMatch(/도면/);
    expect(hint!.textContent).toMatch(/링크/);
    // above the drawing, not on it
    expect(hint!.compareDocumentPosition(root.querySelector(".map-frame")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is put away for good once closed", () => {
    const { root } = open("en");
    const close = root.querySelector<HTMLButtonElement>(".first-hint button")!;
    expect(close.getAttribute("aria-label"), "the close button says nothing").toBeTruthy();
    close.click();
    expect(root.querySelector(".first-hint"), "still there after closing").toBeNull();
    document.body.replaceChildren();
    const again = document.createElement("div");
    document.body.appendChild(again);
    createApp(again, { ...DEFAULT_PARAMS, seed: 6 });
    expect(again.querySelector(".first-hint"), "back on the next visit").toBeNull();
  });

  it("stays off a town's plate", () => {
    const { root, app } = open("ko");
    app.openCity(0);
    expect(root.querySelector(".stage .first-hint")).toBeNull();
  });
});

// A link to a world pasted into KakaoTalk or Discord showed a bare title: no description, no picture, no
// icon (the browser asked for /favicon.ico and got a 404). The part after # never reaches a server, so every
// world shares one card — the site's — and it has to be in the HTML the server sends.
describe("a shared link shows what the site is", () => {
  const card = (file: string) => {
    const html = readFileSync(file, "utf8");
    const meta = (attr: string, key: string) => new RegExp(`<meta\\s+${attr}="${key}"\\s+content="([^"]+)"`).exec(html)?.[1];
    return { html, meta };
  };
  for (const file of ["index.html", "map.html"]) {
    it(`gives ${file} a title, a description, a picture and an icon`, () => {
      const { html, meta } = card(file);
      expect(meta("name", "description"), "no description").toBeTruthy();
      expect(meta("property", "og:title"), "no card title").toBeTruthy();
      expect(meta("property", "og:description"), "no card description").toBeTruthy();
      expect(meta("property", "og:image"), "the card's picture is not an absolute address").toMatch(/^https:\/\/kutanxx\.github\.io\/WorldMaker\/og\.png$/);
      expect(meta("name", "twitter:card")).toBe("summary_large_image");
      expect(html, "no icon").toMatch(/<link\s+rel="icon"\s+href="[^"]*favicon\.svg"/);
    });
  }

  it("has the picture the cards point at, at the size cards are drawn", () => {
    expect(existsSync("public/og.png"), "no og.png beside the site").toBe(true);
    const png = readFileSync("public/og.png");
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
    expect(existsSync("public/favicon.svg"), "no favicon.svg beside the site").toBe(true);
  });
});
