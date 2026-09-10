import { describe, it, expect } from "vitest";
import { properName, polityLabeller, peopleLabel } from "./properName";
import type { GovernmentForm } from "../engine/government";

// This module is the seam every "a realm/people's name drawn as a LABEL" call site shares — the map,
// its legend, the city list, and the city plate all go through `polityLabeller`, and the culture
// view's map/legend go through `peopleLabel`. Until now it had no test of its own: the four call
// sites were checked only by a manual browser pass, so a change that broke the seam (e.g. dropping
// the `forms` argument somewhere, or wrapping an already-Korean string back through `toHangul`) had
// nothing automated to catch it before a reader saw a plain "케우스두" where "케우스두 왕국" belonged.
describe("properName", () => {
  it("transliterates for Korean and leaves English untouched", () => {
    expect(properName("ko", "Ceusdu")).toBe("케우스두");
    expect(properName("en", "Ceusdu")).toBe("Ceusdu");
  });
});

describe("polityLabeller", () => {
  const forms = new Map<number, GovernmentForm>([
    [1, { form: "kingdom", since: null }],
    [2, { form: "republic", since: null }],
    [3, { form: "empire", since: 120 }],
  ]);

  it("names a realm by its form of government, one word for each of the three", () => {
    const label = polityLabeller("ko", forms);
    expect(label(1, "Ceusdu")).toBe("케우스두 왕국");
    expect(label(2, "Hreir")).toBe("흐레이르 자유도시");
    expect(label(3, "Ceusdu")).toBe("케우스두 제국");
  });

  it("falls back to plain transliteration when the id's form is not known", () => {
    const label = polityLabeller("ko", forms);
    expect(label(999, "Ceusdu")).toBe("케우스두");
  });

  it("falls back to plain transliteration when no forms map is given at all", () => {
    const label = polityLabeller("ko");
    expect(label(1, "Ceusdu")).toBe("케우스두");
  });

  it("leaves English alone regardless of the forms map", () => {
    const label = polityLabeller("en", forms);
    expect(label(1, "Ceusdu")).toBe("Ceusdu");
  });
});

describe("peopleLabel", () => {
  it("marks a people with 인 for Korean, fused with no space", () => {
    expect(peopleLabel("ko", "Druthvrau")).toBe("드루스브라우인");
  });
  it("leaves English alone", () => {
    expect(peopleLabel("en", "Druthvrau")).toBe("Druthvrau");
  });
});
