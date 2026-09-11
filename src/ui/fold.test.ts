// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { makeFold, readFoldPref, writeFoldPref } from "./fold";

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe("makeFold", () => {
  it("makes the title the control, so the way to close a section is where the way to open it was", () => {
    const f = makeFold({ title: "Cities", open: false });
    expect(f.head.tagName).toBe("BUTTON");
    expect(f.head.textContent).toContain("Cities");
    expect(f.head.getAttribute("aria-expanded")).toBe("false");
    expect(f.section.contains(f.head)).toBe(true);
    expect(f.section.contains(f.body)).toBe(true);
  });

  it("opens and closes on the head, and says which it is", () => {
    const f = makeFold({ title: "Cities", open: false });
    f.head.click();
    expect(f.section.classList.contains("is-open")).toBe(true);
    expect(f.head.getAttribute("aria-expanded")).toBe("true");
    f.head.click();
    expect(f.section.classList.contains("is-open")).toBe(false);
    expect(f.head.getAttribute("aria-expanded")).toBe("false");
  });

  it("reports the new state, so a caller can remember it", () => {
    const seen: boolean[] = [];
    const f = makeFold({ title: "Cities", open: false, onToggle: (on) => seen.push(on) });
    f.head.click();
    f.head.click();
    expect(seen).toEqual([true, false]);
  });

  // A button is not a heading. The panels this replaces were an <h2> and an <h3>, and a reader
  // moving by headings must still find them — at the level they had.
  it("keeps the heading the title used to be", () => {
    const f = makeFold({ title: "Chronicle", open: true, level: 3 });
    const h = f.head.querySelector(".fold-title")!;
    expect(h.getAttribute("role")).toBe("heading");
    expect(h.getAttribute("aria-level")).toBe("3");
  });

  // Folded, the head is all that is left of the section. "Cities" alone does not say there are
  // twenty-three of them, and the list existed to say that towns are there at all.
  it("carries a count, so a folded head still says what is inside", () => {
    const f = makeFold({ title: "Cities", open: false, count: 23 });
    expect(f.head.textContent).toContain("23");
  });

  it("leaves the count out when there is nothing to count", () => {
    const f = makeFold({ title: "Key", open: false });
    expect(f.head.querySelector(".fold-count")).toBeNull();
  });

  // Wide windows show these sections outright: the head has nothing to do, and a control that
  // does nothing should not take a tab stop.
  it("can stand down to a plain heading when the section is not foldable", () => {
    const f = makeFold({ title: "Cities", open: false });
    f.setFoldable(false);
    expect(f.head.disabled).toBe(true);
    expect(f.section.classList.contains("is-open")).toBe(true);
    f.setFoldable(true);
    expect(f.head.disabled).toBe(false);
    expect(f.section.classList.contains("is-open")).toBe(false); // back to what it was
  });
});

describe("fold preferences", () => {
  it("remembers a section a reader put away", () => {
    writeFoldPref("wm:fold:cities", false);
    expect(readFoldPref("wm:fold:cities", true)).toBe(false);
    writeFoldPref("wm:fold:cities", true);
    expect(readFoldPref("wm:fold:cities", false)).toBe(true);
  });

  it("falls back to the default when nothing was stored", () => {
    expect(readFoldPref("wm:fold:never-set", true)).toBe(true);
    expect(readFoldPref("wm:fold:never-set", false)).toBe(false);
  });

  // Storage throws outright in privacy mode. A page that will not paint because a preference
  // could not be read is a worse bug than a section in the wrong state.
  it("survives storage that refuses to answer", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    expect(() => writeFoldPref("wm:fold:cities", true)).not.toThrow();
    expect(readFoldPref("wm:fold:cities", true)).toBe(true);
  });
});
