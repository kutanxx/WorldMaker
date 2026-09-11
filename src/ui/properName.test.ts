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

// Two languages, two devices, for the same problem. Korean has no case, so it says the word — on
// the map as well, where 왕국 is two characters. English has case, and the word measured 2.04x the
// label on a map that already spends its width carefully, so on the map the typography carries it
// (see theme.css) and the word is spent only where there is no typography to read: a list, a panel.
describe("polityLabeller across the two languages", () => {
  const forms = new Map([[0, { form: "kingdom" as const, since: 0 }]]);
  it("leaves an English map label as the bare name", () => {
    expect(polityLabeller("en", forms as never)(0, "Grathggau")).toBe("Grathggau");
  });
  it("spells the kind of state out where a list or a panel asks for it", () => {
    expect(polityLabeller("en", forms as never, true)(0, "Grathggau")).toBe("Grathggau Kingdom");
  });
  it("says the word in Korean either way — it is the only device Korean has here", () => {
    expect(polityLabeller("ko", forms as never)(0, "Ceusdu")).toContain("왕국");
    expect(polityLabeller("ko", forms as never, true)(0, "Ceusdu")).toContain("왕국");
  });
  it("falls back to the bare name when the realm's form is not known", () => {
    expect(polityLabeller("en", undefined, true)(0, "Grathggau")).toBe("Grathggau");
  });
});
