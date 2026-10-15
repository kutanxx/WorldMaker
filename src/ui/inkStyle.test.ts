// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { renderWorld } from "./svgWorldRenderer";
import { svgToString } from "./export";
import { displayBiomes } from "./displayBiome";
import { ALPINE, TAIGA, TEMPERATE_FOREST, TROPICAL, WETLAND, DESERT } from "../engine/biome";
import { pointInPolygon } from "../engine/geometry";
import { INK, PAPER, forPrint, inkMarks, TOWN_CLEARING, MARK_RISE } from "./inkStyle";

const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
const fnv = (s: string) => { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h >>> 0; };
const inked = (view: "terrain" | "political" | "culture" | "province" = "terrain", lang: "ko" | "en" = "ko") =>
  renderWorld(world, view, [], lang, new Set(), undefined, undefined, "ink");

// The black-and-white print map is a second way of drawing the same map. Pinned before it was built:
// the colour map comes out byte for byte as it did, in every view.
// ...and since renaming (nameBook.ts) every name says what it names in a `data-name` attribute, which
// is all the colour map gained: hashed with those taken out, it is still the same map to the byte.
// ...and since 2026-09-28 every view's key ends with the marks drawn over the ground (settlementKey.ts —
// a capital, a town; no free port here, where no zones are passed), which moved all four hashes: they were
// [1017043680, 3220428649, 1509237278, 3613793555]. With the keys taken out as well, the four came out
// the same before and after that change (probe `colourmap`, run on the commit before), and they are pinned
// here too, so the next change to a key can show it touched nothing else.
describe("the colour map, untouched by the ink style", () => {
  it("draws world 1 exactly as it did, in every view", () => {
    const keyless: number[] = [];
    const hashes = (["terrain", "political", "culture", "province"] as const).map((v) => {
      const svg = renderWorld(world, v, [], "ko");
      const named = svg.querySelectorAll("[data-name]");
      expect(named.length, v).toBeGreaterThan(0);
      for (const el of named) el.removeAttribute("data-name");
      const full = fnv(svgToString(svg));
      for (const el of svg.querySelectorAll(".legend")) el.remove();
      keyless.push(fnv(svgToString(svg)));
      return full;
    });
    // 2026-10-08: the province view's Korean words changed — "영토" became "행정 구역" (the view's name, its
    // description in <desc>, its key's title, "구역 경계") — and only its two hashes moved, from 1237781876 /
    // 4294735063. Proved by substitution: the new drawing with the old words put back hashes to exactly those.
    // 2026-10-12: the map RESTYLED — rivers as tapering curves that end on the coast, the ground's painted marks
    // (peaks, hills, trees, tufts, dots) for the chevrons, lighter biome washes, ripples round the coast, an
    // engraved frame, a sixteen-point rose, the title's ornaments, the paper's browned edges, the Korean face in
    // the key's title. Every view moved, keys and all (were keyless [391966426, 872358456, 1667286081,
    // 2501423208], full [4282211430, 427055371, 1972975115, 3969858647]). Proved by subtraction
    // (.claude/probes/restyle.ts): with those layers taken out, the biome fills blanked and the face's name put
    // back, the old and new maps hash the same in all four views, colour and ink — and with their keys left in,
    // the same but for the terrain key, which now draws each ground's marks on its swatch and has a row for hills.
    // (Then the frame took a paper mat over everything outside its inner rule — a port plate's sea showed round
    // it — and every view moved again, colour and ink; with the frame taken out, as restyle.ts does, nothing
    // else did. Were full [2174265014, 454917732, 347861692, 1096912656], keyless [2534590636, 4051381434,
    // 2451977897, 1352958026], ink [1227265283, 663341094, 1528629615, 4017222218].)
    // (Then — "세계 지도에서 도시 점 위치가 잘 안보이는데" — a town's mark grew and took a ring of the paper, its name
    // stepped right to clear it, the ground's marks kept off every town, and the keys' marks with them: with the
    // towns' layer, the marks and the keys taken out (restyle.ts, EXTRA=":scope > .markers"), nothing else moved.
    // Were full [3173089081, 4265279183, 2636380727, 2647918915], keyless [3579962823, 1867888997, 3390429026,
    // 3960239445], ink [2366848923, 370124978, 1707344935, 1616361766].)
    expect(keyless, "the map moved, not only its key").toEqual([3438479088, 3512652036, 2969924679, 237570426]);
    expect(hashes).toEqual([3854388807, 578052463, 327942045, 2330132253]);
  });
});

// A novelist's map goes to a printer in one ink on white paper. The reader chose, from a preview, the
// illustrated style — water lines round the coast, shaded peaks, hills, trees, marsh and desert marks
// — over plain line work, and white paper over cream.
describe("the ink map", () => {
  const svg = inked();

  it("is drawn in one ink on white paper, in every view", () => {
    for (const view of ["terrain", "political", "culture", "province"] as const) {
      const map = view === "terrain" ? svg : inked(view);
      expect(map.classList.contains("ink"), view).toBe(true);
      const seen = new Set<string>();
      for (const el of map.querySelectorAll("*")) for (const a of ["fill", "stroke", "stop-color"]) {
        const v = el.getAttribute(a);
        if (v !== null) seen.add(v.toLowerCase());
      }
      // (the towns take clicks through an invisible paint, which is no colour)
      expect([...seen].filter((c) => ![INK, PAPER, "none", "transparent"].includes(c)), view).toEqual([]);
    }
  });

  it("rings the coast with three water lines, out in the sea", () => {
    const rings = [...svg.querySelectorAll(".waterlines path")];
    expect(rings.map((r) => r.getAttribute("stroke"))).toEqual([INK, PAPER, INK, PAPER, INK, PAPER]);
    const widths = rings.map((r) => Number(r.getAttribute("stroke-width")));
    for (let k = 1; k < widths.length; k++) expect(widths[k], `ring ${k}`).toBeLessThan(widths[k - 1]);
  });

  // Every mark stands where the world has what it stands for: a peak on each mountain cell, trees on a
  // forest's, a tuft on a marsh's, dots on a desert's — never out over the sea or past its own cell.
  it("keeps every mark off the towns, and only those", () => {
    const all = [...inkMarks({ ...world, cities: [] }).children].length;
    const near = (x: number, y: number) => world.cities.some((c) => Math.abs(x - c.x) < TOWN_CLEARING && y - c.y > -TOWN_CLEARING && y - c.y < TOWN_CLEARING + MARK_RISE);
    const kept = [...svg.querySelectorAll<SVGElement>(".ink-marks [data-x]")];
    for (const m of kept) expect(near(Number(m.getAttribute("data-x")), Number(m.getAttribute("data-y")))).toBe(false);
    const cleared = [...inkMarks({ ...world, cities: [] }).children].filter((m) => near(Number(m.getAttribute("data-x")), Number(m.getAttribute("data-y")))).length;
    expect(cleared).toBeGreaterThan(0);
    expect(kept.length).toBe(all - cleared);
  });

  it("marks each kind of ground where the world has it", () => {
    const shown = displayBiomes(world.grid, world.biome);
    const count = (b: number) => shown.filter((x, i) => x === b && world.terrain[i] !== 0).length;
    // (counted on the world without its towns: every town stands in a clearing the marks keep off — below)
    const bare = inkMarks({ ...world, cities: [] });
    const marks = (cls: string) => [...bare.querySelectorAll(`.${cls}`)];
    expect(marks("ink-peak").length).toBe(count(ALPINE));
    expect(marks("ink-tree").length).toBe(2 * count(TEMPERATE_FOREST) + 2 * count(TAIGA) + 3 * count(TROPICAL));
    expect(marks("ink-marsh").length).toBe(count(WETLAND));
    expect(marks("ink-dune").length).toBe(3 * count(DESERT));
    let checked = 0;
    for (const m of svg.querySelectorAll(".ink-marks [data-cell]")) {
      const cell = Number(m.getAttribute("data-cell"));
      const at = [Number(m.getAttribute("data-x")), Number(m.getAttribute("data-y"))] as [number, number];
      expect(pointInPolygon(at, world.grid.polygons[cell] as [number, number][]), `a mark outside cell ${cell}`).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("draws the marks back to front, so the nearer stands over the farther", () => {
    const ys = [...svg.querySelectorAll(".ink-marks > [data-y]")].map((m) => Number(m.getAttribute("data-y")));
    expect(ys.length).toBeGreaterThan(1000);
    for (let k = 1; k < ys.length; k++) expect(ys[k]).toBeGreaterThanOrEqual(ys[k - 1]);
  });

  it("draws the same marks every time", () => {
    expect(svgToString(inked())).toBe(svgToString(svg));
  });

  // A region of the map, exported, is drawn at its own page's scale (regionExport.ts): its marks come
  // denser and smaller. Pinned before that was built: the whole map, which is what every screen and every
  // unzoomed file draws, comes out byte for byte as it did, in every view (names' `data-name` taken out,
  // as the colour map's pin does).
  it("draws world 1's whole ink map exactly as it did, in every view", () => {
    const keyless: number[] = [];
    const hashes = (["terrain", "political", "culture", "province"] as const).map((v) => {
      const map = inked(v);
      for (const el of map.querySelectorAll("[data-name]")) el.removeAttribute("data-name");
      const full = fnv(svgToString(map));
      for (const el of map.querySelectorAll(".legend")) el.remove();
      keyless.push(fnv(svgToString(map)));
      return full;
    });
    // (pinned with their keys taken out as well, as the colour map's are, so the next change to a key can show
    // it touched nothing else — read on the commit before the realms' and the peoples' ink keys were made)
    expect(keyless, "the ink map moved, not only its key").toEqual([292007065, 3737655174, 1348684571, 1189182329]);
    // (the province view's ink map re-pinned with the colour map's, for the same words: was 2924723875, and the
    // new drawing with the old words put back hashes to exactly that)
    // (2026-10-12: re-pinned with the colour map's restyle — the ink map took its rivers, frame, rose and title
    // ornaments; its marks came out byte for byte as they were (.claude/probes/inkmarks.ts). Was [737587710,
    // 3864053538, 182143499, 3970976761].)
    // (2026-10-15: the realms' and the peoples' views gained a key in ink — the border and the marks, where the key
    // of colours used to be dropped — and only those two moved, from 3737655174 and 1348684571, which were also
    // their keyless hashes: the ink map had no key there. Keyless, all four are as they were.)
    expect(hashes).toEqual([3989428746, 3450551405, 703491356, 3120728551]);   // (the towns' marks and clearings, as above)
  });

  // The colour key lists colours, which an ink map does not have: the ink key lists its marks, drawn as
  // the map draws them, and the road and the sea route in ink.
  it("keys its marks, not the colours it no longer has", () => {
    for (const lang of ["ko", "en"] as const) {
      const map = inked("terrain", lang);
      const rows = [...map.querySelectorAll(".legend .legend-row")];
      const words = rows.map((r) => r.querySelector("text")?.textContent);
      // (and under them the settlements' marks — see "the ink key names the settlements' marks" below)
      expect(words, lang).toEqual(lang === "ko"
        ? ["고산", "언덕", "숲", "타이가", "열대", "습지", "사막", "길", "뱃길", "수도", "도시", "자유무역항"].filter((w) => words.includes(w))
        : ["Alpine", "Hills", "Forest", "Taiga", "Tropical", "Wetland", "Desert", "Road", "Sea route", "Capital", "Town", "Free port"].filter((w) => words.includes(w)));
      expect(words.length, lang).toBeGreaterThanOrEqual(6);
      for (const r of rows) expect(r.querySelector("rect[fill]:not([fill='none'])"), `${lang}: a colour swatch`).toBeNull();
    }
  });

  // The print file is the map drawn three times over. Its marks and water lines are drawn in map units
  // and grow with it; the coast, the rivers, the roads and the borders are pinned to the screen and did
  // not — measured in the 3000px file, the coast came out no heavier than its own water lines and the
  // rivers as hairlines. Printed larger, they are thickened by as much.
  it("thickens the lines pinned to the screen by as much as the map is printed larger", () => {
    const map = inked();
    const pinned = [...map.querySelectorAll("[vector-effect='non-scaling-stroke'][stroke-width]")];
    const before = pinned.map((e) => Number(e.getAttribute("stroke-width")));
    const free = map.querySelector(".waterlines path")!, freeW = free.getAttribute("stroke-width");
    expect(pinned.length).toBeGreaterThan(5);
    forPrint(map, 3);
    pinned.forEach((e, k) => expect(Number(e.getAttribute("stroke-width")), e.getAttribute("class") ?? "").toBeCloseTo(before[k] * 3, 6));
    expect(free.getAttribute("stroke-width"), "a line drawn in map units grows by itself").toBe(freeW);
  });

  // A realm in ink is its border, not a fill: dashed, heavy, and on a band of paper so it reads through
  // the trees it crosses.
  it("draws the realms as borders over the marks, on a band of paper", () => {
    const map = inked("political");
    const kids = [...map.children].map((c) => c.getAttribute("class") ?? "");
    expect(kids.indexOf("political-slot")).toBeGreaterThan(kids.indexOf("ink-marks"));
    const borders = [...map.querySelectorAll(".political-slot .border")];
    expect(borders.length).toBeGreaterThan(0);
    for (const b of borders) {
      expect(b.getAttribute("stroke-dasharray"), "a border not dashed").toBeTruthy();
      const halo = b.previousElementSibling;
      expect(halo?.getAttribute("stroke"), "no paper under a border").toBe(PAPER);
      expect(Number(halo?.getAttribute("stroke-width"))).toBeGreaterThan(Number(b.getAttribute("stroke-width")));
    }
    for (const t of map.querySelectorAll(".political-slot .territory")) expect(t.getAttribute("fill")).toBe("none");
  });
});

// ...and the ink key ends with the same marks as the colour keys (svgWorldRenderer.test.ts), in ink as the
// ink map draws them: the star and the dot in ink, the free port's diamond paper-white in an ink edge.
describe("the ink key names the settlements' marks", () => {
  it("closes with a capital, a town and a free port, drawn in ink", () => {
    const map = renderWorld(world, "terrain", [world.cities[0].cell], "ko", new Set(), undefined, undefined, "ink");
    const rows = [...map.querySelectorAll(".legend .legend-row")];
    expect(rows.slice(-3).map((r) => r.querySelector("text")?.textContent)).toEqual(["수도", "도시", "자유무역항"]);
    const diamond = map.querySelector(".legend .free-port-key .free-port-diamond");
    expect(diamond?.getAttribute("fill")).toBe(PAPER);
    expect(diamond?.getAttribute("stroke")).toBe(INK);
    expect(map.querySelector(".legend .capital-key")?.getAttribute("fill")).toBe(INK);
  });
});

// The realms' and the peoples' keys are keys of colours, and in ink they were simply dropped — so the sheet
// beside the map opened as an empty panel (design review 2026-10-15, 🔴 1: measured on the page, the terrain
// key 13 rows, the provinces' 9, the realms' and the peoples' 0). In ink each lists what the map draws
// instead: its border, dashed on its band of paper, then the marks every key ends with.
describe("the ink key of the realms and of the peoples", () => {
  const border = (map: SVGSVGElement) => map.querySelector(".political-slot .border, .political-slot .culture-border");

  it("lists the border and the settlements' marks, not the colours it no longer has", () => {
    for (const [view, word] of [["political", { ko: "국경", en: "Border" }], ["culture", { ko: "문화 경계", en: "Boundary" }]] as const) {
      for (const lang of ["ko", "en"] as const) {
        const map = inked(view, lang);
        const key = map.querySelector(".political-slot .legend");
        expect(key, `${view} ${lang}: no key in the slot`).not.toBeNull();
        const rows = [...key!.querySelectorAll(".legend-row")];
        expect(rows.map((r) => r.querySelector("text")?.textContent), `${view} ${lang}`)
          .toEqual(lang === "ko" ? [word.ko, "수도", "도시"] : [word.en, "Capital", "Town"]);
        for (const r of rows) expect(r.querySelector("rect[fill]:not([fill='none'])"), `${view} ${lang}: a colour swatch`).toBeNull();
        // the border's row draws the border as the map draws it: in ink, dashed as the map's is, on paper
        const line = key!.querySelector(".border-key line[stroke-dasharray]");
        expect(line?.getAttribute("stroke"), `${view} ${lang}: the border's line`).toBe(INK);
        expect(line?.getAttribute("stroke-dasharray")).toBe(border(map)?.getAttribute("stroke-dasharray"));
        expect(line?.previousElementSibling?.getAttribute("stroke"), "no paper under the border's line").toBe(PAPER);
      }
    }
  });

  it("stands where the colour key stood, under the same title", () => {
    const colour = renderWorld(world, "political", [], "ko").querySelector(".nation-legend .legend-panel rect")!;
    const ink = inked("political");
    const bottom = (r: Element) => Number(r.getAttribute("y")) + Number(r.getAttribute("height"));
    expect(bottom(ink.querySelector(".nation-legend .legend-panel rect")!)).toBeCloseTo(bottom(colour), 6);
    expect(ink.querySelector(".nation-legend .legend-title")?.textContent).toBe("나라");
  });

  it("ends with the free port where the map draws free ports", () => {
    const map = renderWorld(world, "culture", [world.cities[0].cell], "ko", new Set(), undefined, undefined, "ink");
    const words = [...map.querySelectorAll(".political-slot .legend .legend-row")].map((r) => r.querySelector("text")?.textContent);
    expect(words).toEqual(["문화 경계", "수도", "도시", "자유무역항"]);
    expect(map.querySelector(".political-slot .legend .free-port-diamond")?.getAttribute("fill")).toBe(PAPER);
  });
});
