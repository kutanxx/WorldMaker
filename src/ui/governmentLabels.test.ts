// @vitest-environment jsdom
//
// Two of the five realm-label sites — the map's labels + legend (threaded through app.ts's
// `governmentForms`) and the city list's realm column (`showCityRealms`) — were wired but checked
// only by a manual browser pass. That pass could not even observe a live 공화국: measured on seed 1,
// the free city that IS a republic in the historical record gets swallowed into a neighbouring
// kingdom's province the moment ownership is snapped to whole provinces (the same snapping the map
// and city list both draw from) at every year the browser pass scrubbed to. So this file does not
// hunt for a seed/year that naturally leaves a republic standing — it constructs the case, by
// overriding `classifyGovernments`'s answer for three realms that ARE genuinely visible on the map at
// a fixed seed/year. The point is proving the map, legend and city list each consult whatever form
// `classifyGovernments` hands back, not that some seed happens to leave one of each standing.
import { describe, it, expect, vi, afterEach } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";
import { createApp } from "./app";
import { generateWorld } from "../engine/world";
import { simulateHistory } from "../engine/history";
import type { GovernmentForm } from "../engine/government";

// `wm:lang` is shared state in jsdom across tests in this file (localStorage persists a toggle), the
// same gotcha app.test.ts's own "an earlier test in this file persists a language choice" comment
// documents. Pinning "en" before each test — rather than always clicking the toggle once — is what
// keeps every test's "en -> ko" click meaning the same thing regardless of test order.
afterEach(() => { try { localStorage.removeItem("wm:lang"); } catch { /* private mode */ } });

const YEAR_INDEX = 13; // seed 1, year 130 — chosen because every realm visible here has real
// territory (>= MIN_LABEL_CELLS after province-snapping), so forcing three of their ids to
// kingdom/republic/empire exercises the wiring on realms the map would draw a label for regardless.

// Set by a test right before it calls `createApp`, so the mock below can force ONE specific realm
// id's form directly — independent of the YEAR_INDEX/snapping machinery those two describe blocks
// use. The city plate doesn't consult the snapped map at all (`app.ts` reads `cityFacts`'s owner
// straight off the un-snapped year-zero snapshot), so hunting for a "visible" realm the way the
// map/legend/city-list tests do would be answering a question the plate never asks. Applied AFTER
// the year-13 k/r/e forcing below so it always wins even if the ids happen to collide.
let forcedCityOwner: { id: number; form: GovernmentForm } | null = null;

vi.mock("../engine/government", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../engine/government")>();
  const { snapOwnersToProvinces } = await import("./provinceLayer");
  return {
    ...actual,
    classifyGovernments: (world: Parameters<typeof actual.classifyGovernments>[0], history: Parameters<typeof actual.classifyGovernments>[1]) => {
      const real = actual.classifyGovernments(world, history);
      const forced = new Map(real);
      const snap = history.snapshots[YEAR_INDEX];
      if (snap) {
        const snapped = snapOwnersToProvinces(world.grid.count, world.provinceOf, world.provinces, snap.owner);
        const counts = new Map<number, number>();
        for (const o of snapped) if (o >= 0) counts.set(o, (counts.get(o) ?? 0) + 1);
        const visible = [...counts.entries()].filter(([, c]) => c >= 25).map(([id]) => id).sort((a, b) => a - b);
        const [k, r, e] = visible;
        if (k !== undefined) forced.set(k, { form: "kingdom", since: null });
        if (r !== undefined) forced.set(r, { form: "republic", since: null });
        if (e !== undefined) forced.set(e, { form: "empire", since: snap.year });
      }
      if (forcedCityOwner) forced.set(forcedCityOwner.id, forcedCityOwner.form);
      return forced;
    },
  };
});

function openKoreanPoliticalAtYear13() {
  try { localStorage.setItem("wm:lang", "en"); } catch { /* private mode */ }
  const root = document.createElement("div");
  document.body.appendChild(root);
  createApp(root, { ...DEFAULT_PARAMS, seed: 1 });
  (root.querySelector(".lang-toggle") as HTMLButtonElement).click(); // en -> ko
  const political = [...root.querySelectorAll(".view-toggle button")]
    .find((b) => /정치|Political/.test(b.textContent || "")) as HTMLButtonElement;
  political.click();
  const slider = root.querySelector(".timeline input[type=range]") as HTMLInputElement;
  slider.value = String(YEAR_INDEX);
  slider.dispatchEvent(new Event("input"));
  return root;
}

describe("the map and its legend carry a realm's form of government", () => {
  it("labels every visible nation with one of 왕국/공화국/제국, all three represented", () => {
    const root = openKoreanPoliticalAtYear13();
    const labels = [...root.querySelectorAll(".nation-label")].map((e) => e.textContent ?? "");
    expect(labels.length, "no nation labels rendered — test setup is broken, not the wiring").toBeGreaterThan(2);
    for (const l of labels) expect(l, l).toMatch(/(왕국|공화국|제국)$/);
    expect(labels.some((l) => l.endsWith("왕국")), labels.join(", ")).toBe(true);
    expect(labels.some((l) => l.endsWith("공화국")), labels.join(", ")).toBe(true);
    expect(labels.some((l) => l.endsWith("제국")), labels.join(", ")).toBe(true);
    root.remove();
  });

  it("labels the legend rows the same way", () => {
    const root = openKoreanPoliticalAtYear13();
    const rows = [...root.querySelectorAll(".nation-legend text:not(.legend-title)")].map((e) => e.textContent ?? "");
    expect(rows.length).toBeGreaterThan(2);
    for (const l of rows) expect(l, l).toMatch(/(왕국|공화국|제국)$/);
    expect(rows.some((l) => l.endsWith("공화국")), rows.join(", ")).toBe(true);
  });
});

describe("the city list's realm column carries a realm's form of government", () => {
  it("labels every listed realm with one of 왕국/공화국/제국, all three represented", () => {
    const root = openKoreanPoliticalAtYear13();
    const realms = [...new Set([...root.querySelectorAll(".city-list-realm")].map((e) => e.textContent ?? ""))]
      .filter(Boolean);
    expect(realms.length, "no realms in the city list — test setup is broken, not the wiring").toBeGreaterThan(2);
    for (const l of realms) expect(l, l).toMatch(/(왕국|공화국|제국)$/);
    expect(realms.some((l) => l.endsWith("왕국")), realms.join(", ")).toBe(true);
    expect(realms.some((l) => l.endsWith("공화국")), realms.join(", ")).toBe(true);
    expect(realms.some((l) => l.endsWith("제국")), realms.join(", ")).toBe(true);
    root.remove();
  });
});

// The map/legend and city-list wiring above are each proven end-to-end through `createApp`. The
// third labelled-realm site, the city plate, was not: `cityFacts.test.ts` calls `cityFacts(...)`
// directly with a hand-built `forms` map, which pins `cityFacts`'s own parameter handling but never
// exercises `app.ts` (~line 493) actually threading the real `governmentForms` into that call. Drop
// that argument at the call site and every other test in this suite — including cityFacts.test.ts's
// own forms-map tests — stays green while the plate silently loses its 왕국/공화국/제국. This test
// forces a form onto the capital's own realm id (found by recomputing the world/history outside the
// app the same way app.test.ts's other correlation tests do — createApp's internals aren't reachable
// from here) and reads the rendered plate, not `cityFacts`'s return value, so it can only pass if the
// real wiring is intact.
describe("the city plate carries a realm's form of government", () => {
  afterEach(() => { forcedCityOwner = null; });

  it("labels the plate's realm line with 왕국/공화국/제국, not a bare transliteration", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const history = simulateHistory(world, 1);
    const city = world.cities[0]; // the capital: "in somebody's realm by construction" (cityFacts.test.ts)
    const owner = history.snapshots[0].owner[city.cell];
    expect(owner, "capital has no owner at year zero — test setup is broken, not the wiring").toBeGreaterThanOrEqual(0);
    forcedCityOwner = { id: owner, form: { form: "kingdom", since: null } };

    try { localStorage.setItem("wm:lang", "en"); } catch { /* private mode */ }
    const root = document.createElement("div");
    document.body.appendChild(root);
    const app = createApp(root, { ...DEFAULT_PARAMS, seed: 1 });
    (root.querySelector(".lang-toggle") as HTMLButtonElement).click(); // en -> ko
    app.openCity(city.id);

    const rows = [...root.querySelectorAll(".city-fact")].map((d) => ({
      key: d.querySelector(".city-fact-key")?.textContent ?? "",
      value: d.querySelector(".city-fact-value")?.textContent ?? "",
    }));
    const realmRow = rows.find((r) => r.key === "소속"); // ko for "factRealm" (i18n.ts)
    expect(realmRow, rows.map((r) => r.key).join(", ")).toBeDefined();
    expect(realmRow!.value, realmRow!.value).toMatch(/왕국/);
    root.remove();
  });
});
