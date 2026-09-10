import type { WorldParams, GeneratedWorld } from "../types/world";
import { DEFAULT_PARAMS } from "../types/world";
import { generateWorld } from "../engine/world";
import { renderWorld, politicalOpts, type MapView } from "./svgWorldRenderer";
import { renderCity } from "./svgCityRenderer";
import { generateCityLayout, cityContext } from "../engine/city";
import { cityFacts } from "./cityFacts";
import { KM_PER_UNIT } from "./scaleBar";
import { encodeParams, randomSeed, initialCity } from "./urlState";
import { hashStringToSeed } from "../engine/rng";
import { worldToJSON, svgToString, svgToPngBlob, downloadBlob } from "./export";
import { worldToGazetteer } from "../engine/gazetteer";
import { simulateHistory } from "../engine/history";
import { assignNationColors, nationColor } from "./nationPalette";
import { renderChronicle, applyChronicleYear } from "./chronicle";
import { createTimeline, type Timeline } from "./timeline";
import { attachZoomPan, type ZoomPan } from "./zoomPan";
import { politicalLayer } from "./politicalLayer";
import { cultureLayer } from "./cultureLayer";
import { provinceLayer, snapOwnersToProvinces } from "./provinceLayer";
import { deconflictLabels } from "./deconflict";
import { applyLabelScale, applyMarkerScale } from "./labelScale";
import { layOutLabelsForExport } from "./exportLabels";
import { type Lang, t } from "./i18n";
import { detectLang, saveLang } from "./lang";
import { properName } from "./properName";

export interface App {
  regenerate(p: WorldParams): void;
  openCity(cityId: number): void;
  showWorld(): void;
}


/**
 * @param askedName what the reader called this world, when they arrived by naming one. The landing
 * page invites them to "start from a name" and the name used to be hashed to a seed and discarded,
 * so a world asked to be "아발론" came back called "The Old Lands". It is kept for as long as it
 * is true — a fresh seed is a different world and takes a name of its own.
 */
export function createApp(root: HTMLElement, initial: WorldParams = DEFAULT_PARAMS, askedName?: string): App {
  let worldTitle: string | null = askedName ?? null;
  root.innerHTML = "";

  const controls = document.createElement("div");
  controls.className = "controls";
  const stage = document.createElement("div");
  stage.className = "stage";
  root.append(controls, stage);

  let params: WorldParams = { ...initial };
  let generated: GeneratedWorld = generateWorld(params, worldTitle ?? undefined);
  let history = simulateHistory(generated.world, params.seed);
  // One colouring per world, shared by the first paint, the scrubber and the export. Indexing the
  // palette by id draws id 12 exactly like id 0, and civil-war fragments take the high ids while
  // appearing beside the parent they broke from — so the border between them vanished on 7 of the
  // 12 measured seeds. See `assignNationColors`.
  let nationColors = assignNationColors(generated.world.grid.neighbors, history.snapshots.map((s) => s.owner));
  const colorOf = (id: number): string => nationColors.get(id) ?? nationColor(id);
  let timeline: Timeline | null = null;
  let worldZoom: ZoomPan | null = null;
  let cityZoom: ZoomPan | null = null;
  let currentYearIndex = 0;
  let currentView: MapView = "terrain";
  let lang: Lang = detectLang();
  let openCityId: number | null = null; // which screen is showing (null = world)

  const homeBtn = document.createElement("a"); // back to the landing chooser (index.html — relative for the Pages subpath)
  homeBtn.className = "home";
  homeBtn.setAttribute("href", "index.html");
  // The seed box and its button are ONE control: the button applies the number beside it. Measured
  // apart, they read as two rival ways to make a world sitting next to a third (the die), all in
  // the same colour — and the one called "Generate" is the one that does nothing visible when the
  // seed has not been edited, because it re-runs the world already on screen.
  const seedGroup = document.createElement("div");
  seedGroup.className = "seed-group";
  const seedInput = document.createElement("input");
  seedInput.type = "number";
  seedInput.value = String(params.seed);
  const regenBtn = document.createElement("button");
  seedGroup.append(seedInput, regenBtn);
  // The primary action, and the only one in the bar: a die always yields a world you have not seen.
  const randomBtn = document.createElement("button");
  randomBtn.className = "random-seed primary";
  // One control, not three buttons each repeating the verb: the formats name themselves and the
  // download arrow says what the group does. See the note in theme.css for what that bought.
  const exportGroup = document.createElement("div");
  exportGroup.className = "export-group";
  const exportIcon = document.createElement("span");
  exportIcon.className = "export-icon";
  exportIcon.textContent = "⬇";
  const jsonBtn = document.createElement("button");
  const pngBtn = document.createElement("button");
  const svgBtn = document.createElement("button");
  exportGroup.append(exportIcon, jsonBtn, pngBtn, svgBtn);
  const gazBtn = document.createElement("button");
  gazBtn.className = "gazetteer";
  const langBtn = document.createElement("button");
  langBtn.className = "lang-toggle";
  const viewToggle = document.createElement("div");
  viewToggle.className = "view-toggle";
  const terrainBtn = document.createElement("button");
  const politicalBtn = document.createElement("button");
  const cultureBtn = document.createElement("button");
  const provinceBtn = document.createElement("button");
  viewToggle.append(terrainBtn, politicalBtn, cultureBtn, provinceBtn);
  // The engine has read all of these from the URL since it was written — seaLevel, mountainLevel,
  // polityCount, townCount, cellCount — and there was no way to reach any of them from the page, so
  // a reader could only ever have the one world the defaults describe. Folded away, because the
  // toolbar's own lesson is that a control costs a row whether it is used or not.
  const advanced = document.createElement("details");
  advanced.className = "advanced";
  const advancedSummary = document.createElement("summary");
  advanced.appendChild(advancedSummary);
  const dials: { key: keyof WorldParams; min: number; max: number; step: number }[] = [
    { key: "seaLevel", min: 0.15, max: 0.55, step: 0.01 },
    { key: "mountainLevel", min: 0.4, max: 0.8, step: 0.01 },
    { key: "polityCount", min: 2, max: 12, step: 1 },
    { key: "townCount", min: 4, max: 60, step: 1 },
    { key: "cellCount", min: 1200, max: 9000, step: 200 },
  ];
  const dialRows = dials.map(({ key, min, max, step }) => {
    const row = document.createElement("label");
    row.className = "advanced-row";
    const name = document.createElement("span");
    const input = document.createElement("input");
    input.type = "range";
    input.name = key;
    input.min = String(min); input.max = String(max); input.step = String(step);
    input.value = String(params[key]);
    const read = document.createElement("output");
    read.textContent = String(params[key]);
    input.addEventListener("input", () => { read.textContent = input.value; });
    // regenerate on release, not on every pixel of the drag: a world is a second of work
    input.addEventListener("change", () => regenerate({ ...params, [key]: Number(input.value) }));
    row.append(name, input, read);
    advanced.appendChild(row);
    return { key, name, input, read };
  });
  // Ordered by what a reader is doing, in three zones the CSS separates by space rather than by
  // size: make a world, look at it, take it away. The language toggle and the home link are
  // furniture and sit at the two ends.
  controls.append(homeBtn, seedGroup, randomBtn, viewToggle, exportGroup, gazBtn, langBtn);
  root.appendChild(advanced);

  // set every UI string from the current language (called on init and on language toggle)
  function applyLang(): void {
    // the document's own language, which is what a screen reader and a translation tool go by:
    // map.html declares lang="ko" and it used to stay that way whatever the toggle said
    document.documentElement.lang = lang;
    advancedSummary.textContent = t(lang, "advanced");
    for (const d of dialRows) d.name.textContent = t(lang, d.key as never);
    homeBtn.textContent = t(lang, "home");
    homeBtn.title = t(lang, "homeLabel"); // the house carries it; the word cost the toolbar a second row
    regenBtn.textContent = t(lang, "generate");
    randomBtn.textContent = "🎲 " + t(lang, "newWorld");
    jsonBtn.textContent = t(lang, "exportJson");
    pngBtn.textContent = t(lang, "exportPng");
    svgBtn.textContent = t(lang, "exportSvg");
    exportIcon.title = t(lang, "exportLabel"); // the verb, said once for the group
    gazBtn.textContent = "📜 " + t(lang, "gazetteer");
    terrainBtn.textContent = t(lang, "terrain");
    politicalBtn.textContent = t(lang, "political");
    cultureBtn.textContent = t(lang, "culture");
    provinceBtn.textContent = t(lang, "province");
    langBtn.textContent = t(lang, "langToggle");
  }
  applyLang();
  langBtn.addEventListener("click", () => {
    lang = lang === "en" ? "ko" : "en";
    saveLang(lang);
    applyLang();
    if (openCityId !== null) openCity(openCityId); else showWorld(); // re-render the live screen
  });

  function setView(v: MapView): void {
    if (v === currentView) return;
    currentView = v;
    showWorld(); // re-render at the current year in the new view
  }
  terrainBtn.addEventListener("click", () => setView("terrain"));
  politicalBtn.addEventListener("click", () => setView("political"));
  cultureBtn.addEventListener("click", () => setView("culture"));
  provinceBtn.addEventListener("click", () => setView("province"));

  /**
   * What goes in the map's overlay slot for a given view and year. One place decides, because it
   * used to be two and they had drifted: the export path replaced the slot with a political layer
   * for EVERY view that was not culture, so exporting the province view produced a map with no
   * provinces in it — and the province key that renderWorld draws never survived to the screen,
   * because the timeline rebuilt the layer without it a moment later.
   */
  // Which towns the chronicle has not founded by the year on the scrubber. The capitals are the
  // seats the world starts with and are never held back.
  function unfoundedAt(yearIndex: number): Set<number> {
    const year = history.snapshots[yearIndex]?.year ?? 0;
    const out = new Set<number>();
    for (const f of history.cityFoundings) if (f.year > year) out.add(f.cityId);
    return out;
  }

  // The chronicle said a town was founded in year 140 and the town was on the map from year 0, so
  // five hundred years of history had nothing to show but borders moving. Scrubbing hides the
  // towns not yet founded rather than redrawing the map: the markers are already in the document.
  // Whether the map's key is unfolded. Storage can throw outright in privacy mode, and a front
  // page that will not paint because a preference could not be read is a worse bug than a legend
  // in the wrong state.
  const LEGEND_KEY = "wm:legend";
  function readLegendPref(): boolean {
    try { return localStorage.getItem(LEGEND_KEY) === "on"; } catch { return false; }
  }
  function writeLegendPref(on: boolean): void {
    try { localStorage.setItem(LEGEND_KEY, on ? "on" : "off"); } catch { /* privacy mode */ }
  }

  /**
   * Focus mode: the drawing takes the window and the page's chrome steps out. Both the world map
   * and the city plate get the control, because both are sized by the vertical room the chrome
   * leaves them and both are the reason someone is here.
   *
   * Not remembered — a reload that dropped a reader onto a chrome-less screen with no memory of
   * asking for it is a worse surprise than pressing a button twice — so every new screen starts
   * out of it. The Escape handler is registered ONCE for the app: hanging one off each frame
   * leaked a document listener on every regenerate and every trip to a plate and back.
   */
  let focusBtn: HTMLButtonElement | null = null;
  function applyFocus(on: boolean): void {
    document.body.classList.toggle("map-focus", on);
    if (!focusBtn) return;
    focusBtn.setAttribute("aria-pressed", String(on));
    focusBtn.textContent = t(lang, on ? "focusExit" : "focusEnter");
    focusBtn.title = t(lang, on ? "focusExitHint" : "focusEnterHint");
  }
  function addFocusToggle(frame: HTMLElement): void {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "focus-toggle";
    b.addEventListener("click", () => applyFocus(!document.body.classList.contains("map-focus")));
    frame.appendChild(b);
    focusBtn = b;
    applyFocus(false);
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("map-focus")) applyFocus(false);
  });

  // city cell -> the <span> naming its realm in the list, refilled whenever the year changes
  const realmCells = new Map<number, HTMLElement>();

  // The list must name the realm the MAP shows holding the town, so it reads the same
  // province-snapped ownership the political layer paints from — not the raw snapshot, which can
  // disagree with the picture at a province's edge.
  function showCityRealms(yearIndex: number): void {
    if (realmCells.size === 0) return;
    const world = generated.world;
    const owner = snapOwnersToProvinces(world.grid.count, world.provinceOf, world.provinces,
                                        history.snapshots[yearIndex].owner);
    for (const [cell, el] of realmCells) {
      const o = owner[cell];
      const realm = o >= 0 ? history.polities[o]?.name : undefined;
      el.textContent = realm === undefined ? "" : properName(lang, realm);
    }
  }

  function showFoundedCities(svg: SVGSVGElement, yearIndex: number): void {
    const hidden = unfoundedAt(yearIndex);
    for (const el of svg.querySelectorAll<SVGElement>(".markers [data-city]")) {
      const id = Number(el.getAttribute("data-city"));
      el.style.display = hidden.has(id) ? "none" : "";
    }
  }

  function fillSlot(slot: SVGGElement, view: MapView, yearIndex: number): void {
    const world = generated.world;
    const snap = history.snapshots[yearIndex];
    if (view === "culture") {
      slot.replaceChildren(cultureLayer(world.grid, world.cultureOf, world.cultures, lang)); // time-independent
    } else if (view === "province") {
      // provinces are geography (time-independent); nation borders track the scrubbed year via snap.owner
      slot.replaceChildren(provinceLayer(world.grid, world.provinceOf, world.provinces, { owner: snap.owner, legend: true, lang }));
    } else {
      // nation ownership snapped to whole provinces so terrain/political borders match the province view
      const snapped = snapOwnersToProvinces(world.grid.count, world.provinceOf, world.provinces, snap.owner);
      slot.replaceChildren(politicalLayer(world.grid, snapped, history.polities, politicalOpts(view, lang, colorOf)));
    }
  }

  function showWorld(): void {
    openCityId = null;
    timeline?.destroy();
    stage.innerHTML = "";
    terrainBtn.classList.toggle("active", currentView === "terrain");
    politicalBtn.classList.toggle("active", currentView === "political");
    cultureBtn.classList.toggle("active", currentView === "culture");
    provinceBtn.classList.toggle("active", currentView === "province");
    const svg = renderWorld(generated.world, currentView, history.economicZones.map((z) => z.cell), lang, new Set(), colorOf);
    const cityIdOf = (el: Element | null) => {
      const id = el?.getAttribute("data-city");
      return id !== null && id !== undefined && id !== "" ? Number(id) : null;
    };
    svg.addEventListener("click", (e) => {
      const id = cityIdOf(e.target as Element);
      if (id !== null) openCity(id);
    });
    // ...and by keyboard. The markers are the only way into the city plans, and until they were
    // given a target with tabindex the page had no focusable element at all: a keyboard could not
    // reach a city map by any route. Enter and Space are what a role="button" promises.
    svg.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const id = cityIdOf(e.target as Element);
      if (id === null) return;
      e.preventDefault();
      openCity(id);
    });
    const frame = document.createElement("div");
    frame.className = "map-frame";
    frame.appendChild(svg);

    // The key is map furniture: useful once, then in the way of the corner of the world it covers.
    // It folds, and the choice is remembered — a reader who put it away did not mean "until the
    // next world". Only the SCREEN is affected: an exported map builds its own SVG and no
    // stylesheet travels with it, so a downloaded map always carries its key.
    const legendOn = readLegendPref();
    frame.classList.toggle("legend-off", !legendOn);
    const legendBtn = document.createElement("button");
    legendBtn.type = "button";
    legendBtn.className = "legend-toggle";
    legendBtn.textContent = t(lang, "legendToggle");
    const syncLegend = (on: boolean) => {
      frame.classList.toggle("legend-off", !on);
      legendBtn.setAttribute("aria-expanded", String(on));
      legendBtn.title = t(lang, on ? "legendHide" : "legendShow");
    };
    syncLegend(legendOn);
    legendBtn.addEventListener("click", () => {
      const on = frame.classList.contains("legend-off");
      syncLegend(on);
      writeLegendPref(on);
    });
    frame.appendChild(legendBtn);

    addFocusToggle(frame);

    // The best thing this map has is behind its markers, and until the reader knows a marker leads
    // somewhere there is nothing to tell them so. A list is the signal: it says "there are cities
    // here" by existing, it is reachable by keyboard for free, and it does not need anyone to hit
    // a dot. Capitals first, then by size, because that is the order a reader cares about.
    const list = document.createElement("aside");
    list.className = "city-list";
    const listTitle = document.createElement("h2");
    listTitle.textContent = t(lang, "cityList");
    list.appendChild(listTitle);
    const ul = document.createElement("ul");
    realmCells.clear();
    const ordered = [...generated.world.cities].sort((a, b) =>
      Number(b.isCapital) - Number(a.isCapital) || b.size - a.size || a.name.localeCompare(b.name));
    for (const c of ordered) {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.className = "city-list-item" + (c.isCapital ? " is-capital" : "");
      b.setAttribute("data-city", String(c.id));
      const nm = document.createElement("span"); nm.className = "city-list-name"; nm.textContent = properName(lang, c.name);
      // Filled by `renderYear`, not from `world.polityOf`: that is the ownership of YEAR ZERO, and
      // the map, legend, scrubber and chronicle beside this list are all in the scrubbed year. It
      // used to print the founding realm forever — 68% of towns wore the wrong realm at year 500,
      // and 52% wore one that no longer existed.
      const rm = document.createElement("span"); rm.className = "city-list-realm";
      realmCells.set(c.cell, rm);
      b.append(nm, rm);
      b.title = t(lang, "cityListHint");
      b.addEventListener("click", () => openCity(c.id));
      li.appendChild(b);
      ul.appendChild(li);
    }
    list.appendChild(ul);

    const withList = document.createElement("div");
    withList.className = "map-with-list";
    withList.append(frame, list);
    stage.appendChild(withList);
    cityZoom?.destroy(); cityZoom = null;
    worldZoom?.destroy();
    // Zooming holds the lettering at its on-screen size and then asks deconflictLabels what fits
    // now. That is the whole of the "more names as you lean in" behaviour: the land spreads out,
    // the words do not, and the room that opens up is filled from the priority order the pass
    // already has — nation, capital, region, river, town. No per-tier zoom thresholds to tune.
    // Coalesced to one pass per frame: a wheel gesture fires dozens of scale changes.
    let relayout = 0, pendingScale = 1;
    worldZoom = attachZoomPan(svg, frame, {
      onScale: (scale) => {
        pendingScale = scale;   // the newest scale of the gesture, not the one that scheduled the frame
        if (relayout) return;
        relayout = requestAnimationFrame(() => {
          relayout = 0;
          applyLabelScale(svg, pendingScale);
          applyMarkerScale(svg, pendingScale);
          deconflictLabels(svg, pendingScale);
        });
      },
    });

    const chronicle = renderChronicle(generated.world, history, lang);
    const slot = svg.querySelector(".political-slot") as SVGGElement;
    const renderYear = (index: number): void => {
      currentYearIndex = index;
      const snap = history.snapshots[index];
      fillSlot(slot, currentView, index);
      showFoundedCities(svg, index);
      showCityRealms(index);
      applyChronicleYear(chronicle, snap.year);
      // Scrubbing a year replaces the political layer, so its labels arrive at their base size.
      // Bring them to whatever zoom the reader is at before working out what fits, or a nation's
      // name would come back full-size on a map zoomed to 8x.
      const z = worldZoom?.scale() ?? 1;
      applyLabelScale(svg, z);
      applyMarkerScale(svg, z);
      deconflictLabels(svg, z); // hide colliding lower-priority labels, and those the zoom has not earned yet
    };

    // ...in the reader's language. Without this the timeline took its own Korean default and an
    // English reader was shown "500년" on the scrubber.
    timeline = createTimeline(history, renderYear, (y) => t(lang, "year").replace("{y}", String(y)));
    stage.append(timeline.element, chronicle);
    timeline.setIndex(currentYearIndex); // renders the current year in the current view
    // replaceState, not location.hash: re-rendering the same world is not a place to come back to,
    // and every view switch used to push one
    window.history.replaceState(null, "", "#" + worldHash());
  }

  // (window.history, not history — the chronicle is called `history` in this scope)
  //
  // a named world keeps its name in the address, so a reload or a shared link still opens the
  // world the reader asked for rather than a stranger with the same seed
  function worldHash(): string {
    // ...but only while the name still describes the whole world. `#seed=Avalon` says the seed and
    // nothing else, so once a dial has been moved the readable form would leave the address
    // describing a world the reader is not looking at, and a reload would quietly undo the change.
    // The name is worth having; it is not worth being wrong.
    const tuned = (Object.keys(DEFAULT_PARAMS) as (keyof WorldParams)[])
      .some((k) => k !== "seed" && params[k] !== DEFAULT_PARAMS[k]);
    return worldTitle !== null && !tuned
      ? "seed=" + encodeURIComponent(worldTitle)
      : encodeParams(params).slice(1);
  }

  /**
   * @param record how the address should follow. "push" for a reader opening a plate — it is a
   * place, so it goes on the history stack and Back returns to the world map instead of leaving
   * the site. "replace" for a plate opened straight from a shared link: the address must still say
   * which city (showWorld has just rewritten it to the world's own form) but there is nothing
   * behind it to go back to. "none" when we are only following the history, not making it.
   */
  function openCity(cityId: number, record: "push" | "replace" | "none" = "push"): void {
    const marker = generated.world.cities.find((c) => c.id === cityId);
    if (!marker) return;
    openCityId = cityId;
    const url = "#" + worldHash() + "&city=" + cityId;
    if (record === "push") window.history.pushState({ city: cityId }, "", url);
    else if (record === "replace") window.history.replaceState({ city: cityId }, "", url);
    timeline?.destroy();
    stage.innerHTML = "";
    const back = document.createElement("button");
    back.textContent = "← " + t(lang, "backToWorld");
    // walk the history back when we made an entry to walk back to; a plate opened straight from a
    // shared link has none, and simply shows the world
    back.addEventListener("click", () => {
      if ((window.history.state as { city?: number } | null)?.city !== undefined) window.history.back();
      else showWorld();
    });
    const layout = generateCityLayout(cityContext(marker), params.seed);
    const citySvg = renderCity(layout, lang);
    const frame = document.createElement("div");
    frame.className = "map-frame";
    frame.appendChild(citySvg);
    addFocusToggle(frame);

    // A plate carried its name and nothing else, and there was no way off it but back to the world
    // map to hunt for another dot. The facts are the ones the world can actually answer for — the
    // founding year an outside review asked for is not among them: the chronicle founds towns the
    // atlas never draws (19 of 19 on seed 1), which is its own bug and not something to paper over.
    // The plate answers for the year the reader scrubbed to, and says which year that was: the
    // world map has a scrubber to carry that, and a plate does not.
    const snapNow = history.snapshots[currentYearIndex];
    const facts = cityFacts(generated.world, marker, layout, lang, KM_PER_UNIT, history.cityFoundings,
      { owner: snapNow.owner, polities: history.polities, year: snapNow.year });
    const panel = document.createElement("div");
    panel.className = "city-facts";
    const row = (label: string, value: string) => {
      const d = document.createElement("div");
      d.className = "city-fact";
      const k = document.createElement("span"); k.className = "city-fact-key"; k.textContent = label;
      const v = document.createElement("span"); v.className = "city-fact-value"; v.textContent = value;
      d.append(k, v);
      return d;
    };
    panel.append(
      row(t(lang, "factKind"), facts.kind),
      row(t(lang, "factRealm"), facts.year === null
        ? (facts.realm ?? t(lang, "factUnclaimed"))
        : `${facts.realm ?? t(lang, "factUnclaimed")} · ${t(lang, "year").replace("{y}", String(facts.year))}`),
      row(t(lang, "factPeople"), `${facts.rank} · ${facts.population}`),
      row(t(lang, "factFounded"), facts.founded === null
        ? t(lang, "factAncient")
        : t(lang, "year").replace("{y}", String(facts.founded))),
    );
    const near = document.createElement("div");
    near.className = "city-fact city-neighbours";
    const nearKey = document.createElement("span");
    nearKey.className = "city-fact-key";
    nearKey.textContent = t(lang, "factNear");
    near.appendChild(nearKey);
    const nearList = document.createElement("span");
    nearList.className = "city-fact-value";
    for (const n of facts.neighbours) {
      const b = document.createElement("button");
      b.className = "neighbour";
      b.textContent = `${n.name} · ${n.km}km`;
      b.addEventListener("click", () => openCity(n.id));
      nearList.appendChild(b);
    }
    near.appendChild(nearList);
    panel.appendChild(near);

    stage.append(back, panel, frame);
    worldZoom?.destroy(); worldZoom = null;
    cityZoom?.destroy();
    // the ward names hold their size here for the same reason the world's names do
    let cityRelayout = 0, cityScale = 1;
    // the plan's own names have to be laid out too — it is in the document by now, so they can
    // be measured
    deconflictLabels(citySvg);
    cityZoom = attachZoomPan(citySvg, frame, {
      onScale: (scale) => {
        cityScale = scale;
        if (cityRelayout) return;
        cityRelayout = requestAnimationFrame(() => {
          cityRelayout = 0;
          applyLabelScale(citySvg, cityScale);
          deconflictLabels(citySvg);
        });
      },
    });
  }

  function regenerate(p: WorldParams): void {
    params = { ...p };
    seedInput.value = String(params.seed);
    for (const d of dialRows) { d.input.value = String(params[d.key]); d.read.textContent = String(params[d.key]); }
    // a new seed is a new world, and it is not the one the reader named
    if (params.seed !== hashStringToSeed(worldTitle ?? "")) worldTitle = null;
    generated = generateWorld(params, worldTitle ?? undefined);
    history = simulateHistory(generated.world, params.seed);
    nationColors = assignNationColors(generated.world.grid.neighbors, history.snapshots.map((s) => s.owner));
    currentYearIndex = 0;
    showWorld();
  }

  // What a reader means by "export" is the map in front of them. Drilled into a city, that is the
  // city — the buttons used to render the world regardless, so the one thing the drilldown produces
  // could not be saved at all. Carries its own name and pixel size, since a city's proportions are
  // its own and nothing like the world's.
  interface ScreenExport { svg: SVGSVGElement; name: string; width: number; height: number }

  const CITY_PNG_SCALE = 2;   // a city is drawn small; at 1:1 its 7px ward names come out unreadable

  function exportScreenSvg(): ScreenExport {
    if (openCityId !== null) {
      const marker = generated.world.cities.find((c) => c.id === openCityId);
      if (marker) {
        const svg = renderCity(generateCityLayout(cityContext(marker), params.seed), lang);
        layOutLabelsForExport(svg);
        const [, , w, h] = (svg.getAttribute("viewBox") || "0 0 1000 700").split(/[\s,]+/).map(Number);
        return {
          svg, name: marker.name.replace(/[^\w-]+/g, "_") || "city",
          width: Math.round(w * CITY_PNG_SCALE), height: Math.round(h * CITY_PNG_SCALE),
        };
      }
    }
    return { svg: exportWorldSvg(), name: "world", width: params.width, height: params.height };
  }

  // Export the world at the year + view the timeline is currently showing.
  function exportWorldSvg(): SVGSVGElement {
    const svg = renderWorld(generated.world, currentView, history.economicZones.map((z) => z.cell), lang, unfoundedAt(currentYearIndex), colorOf);
    fillSlot(svg.querySelector(".political-slot") as SVGGElement, currentView, currentYearIndex);
    // This is a fresh render that has never been in the document, so its labels have never been laid
    // out against each other — left alone, every name in the world goes into the file, stacked.
    layOutLabelsForExport(svg);
    return svg;
  }

  // The embedded Cinzel woff2 (~20 KB) is only needed when exporting, so it lives in a lazy chunk —
  // keeps the initial map bundle lean for the majority who never export.
  async function exportScreenSvgWithFonts(): Promise<ScreenExport> {
    const out = exportScreenSvg();
    const { embedExportFonts } = await import("./exportFont");
    embedExportFonts(out.svg); // standalone SVG/PNG carry the Cinzel display face (no external stylesheet)
    return out;
  }

  regenBtn.addEventListener("click", () => regenerate({ ...params, seed: Number(seedInput.value) }));
  randomBtn.addEventListener("click", () => regenerate({ ...params, seed: randomSeed() }));
  jsonBtn.addEventListener("click", () =>
    downloadBlob("world.json", new Blob([worldToJSON(generated.world, history)], { type: "application/json" }))
  );
  pngBtn.addEventListener("click", async () => {
    try {
      const { svg, name, width, height } = await exportScreenSvgWithFonts();
      downloadBlob(`${name}.png`, await svgToPngBlob(svg, width, height));
    } catch (e) {
      console.error("PNG export failed", e);
    }
  });
  svgBtn.addEventListener("click", async () => {
    const { svg, name } = await exportScreenSvgWithFonts();
    downloadBlob(`${name}.svg`, new Blob([svgToString(svg)], { type: "image/svg+xml" }));
  });
  gazBtn.addEventListener("click", () => {
    // The exported document follows the language the user is reading the app in — a Korean
    // session was producing an English gazetteer with Korean chronicle lines inside it.
    const md = worldToGazetteer(generated.world, history, lang);
    const fname = (generated.world.name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "gazetteer") + ".md";
    downloadBlob(fname, new Blob([md], { type: "text/markdown" }));
  });

  // follow the browser: Back off a plate returns to the world, Forward opens it again
  window.addEventListener("popstate", () => {
    // a screen that has been taken out of the document does not answer the browser any more
    if (!root.isConnected) return;
    const id = initialCity(location.hash);
    if (id === null) { if (openCityId !== null) showWorld(); return; }
    if (id !== openCityId) openCity(id, "none");
  });

  // read before showWorld, which rewrites the address to the world's own form
  const linked = initialCity(location.hash);
  showWorld();
  // ...and a link that names a city opens onto its plate rather than the world map
  if (linked !== null) openCity(linked, "replace");
  return { regenerate, openCity, showWorld };
}
