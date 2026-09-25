import type { WorldParams, GeneratedWorld } from "../types/world";
import { DEFAULT_PARAMS } from "../types/world";
import { generateWorld } from "../engine/world";
import { renderWorld, politicalOpts, type MapView } from "./svgWorldRenderer";
import { renderCity, CITY_LEGEND_ROW, fitTitle } from "./svgCityRenderer";
import { generateCityLayout, cityContext } from "../engine/city";
import { cityFacts } from "./cityFacts";
import { KM_PER_UNIT, floorScaleCaption } from "./scaleBar";
import { encodeParams, randomSeed, initialCity } from "./urlState";
import { hashStringToSeed } from "../engine/rng";
import { worldToJSON, svgToString, svgToPngBlob, downloadBlob } from "./export";
import { worldToGazetteer } from "../engine/gazetteer";
import { simulateHistory } from "../engine/history";
import { assignNationColors, nationColor } from "./nationPalette";
import { classifyGovernments, type GovernmentForm } from "../engine/government";
import { renderChronicleCaption } from "./chronicle";
import { createTimeline, type Timeline } from "./timeline";
import { attachZoomPan, type ZoomPan } from "./zoomPan";
import { politicalLayer } from "./politicalLayer";
import { cultureLayer } from "./cultureLayer";
import { provinceLayer, snapOwnersToProvinces } from "./provinceLayer";
import { deconflictLabels, clearMarks, clearCastleName } from "./deconflict";
import { applyLabelScale, applyMarkerScale, floorLabelSize } from "./labelScale";
import { layOutLabelsForExport } from "./exportLabels";
import { type Lang, t } from "./i18n";
import { makeFold, readFoldPref, writeFoldPref } from "./fold";
import { legendSheet, placeLegend } from "./legendSheet";
import { measureChrome, fitChrome } from "./chromeBudget";
import { LEGEND_ROW } from "./renderer";
import { detectLang, saveLang } from "./lang";
import { properName, polityLabeller } from "./properName";
import { worldNameIn } from "../engine/featureLabel";

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
  // What kind of state each realm was (kingdom / republic / empire), read off the same record the
  // chronicle already reads it from. One map per world, like `nationColors` — a realm's form does
  // not change as the scrubber moves, so this is computed once and handed to `polityLabeller`
  // wherever a realm's name is drawn as a label rather than read inside a sentence.
  let governmentForms: Map<number, GovernmentForm> = classifyGovernments(generated.world, history);
  let timeline: Timeline | null = null;
  let timelineStrip: HTMLElement | null = null;   // the scrubber and the chronicle caption, moved as one
  let worldZoom: ZoomPan | null = null;
  let cityZoom: ZoomPan | null = null;
  let currentYearIndex = 0;
  let currentView: MapView = "terrain";
  let lang: Lang = detectLang();
  let openCityId: number | null = null; // which screen is showing (null = world)
  const zoomLabels = () => ({ zoomIn: t(lang, "zoomIn"), zoomOut: t(lang, "zoomOut"), reset: t(lang, "zoomReset") });

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
  // World-only: on a plate it threw the plate AND its world away, and Back then left the address on
  // the old world with the new one on screen.
  const randomBtn = document.createElement("button");
  randomBtn.className = "random-seed primary world-only";
  // ★ The way off a plate, in the bar with the page's other way off a screen. It was a bar of its
  // own across the whole card — 1093px wide at 1440x900, 336 on a phone, the biggest control on the
  // page — standing between the toolbar and the drawing: an accident of the card becoming a flex
  // column (and later a grid), never a decision. It shows only on a plate (`plate-only`).
  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "plate-back plate-only";
  backBtn.addEventListener("click", () => backToWorld());
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
  /**
   * What a phone keeps out, and what folds away behind one control.
   *
   * Measured on a live 375x812 phone: the title and the toolbar came to 236px — 29% of the screen,
   * above a map 225px tall. The controls outweighed the thing they control. So the toolbar gets the
   * treatment the panels under the map got. What stays out is what a phone actually does here: go
   * home, roll a new world, and choose which map you are looking at. What folds is what a phone can
   * do least with — a numeric seed box that summons a number pad, three file downloads and a
   * markdown one, and a language toggle you set once.
   *
   * `world-only` is a second axis, not a smaller one: on a city plate the view toggles switch a map
   * that is not on screen and the seed box builds a world you would be leaving the plate to see.
   * Both stay on a wide window, where there is room and they read as a way back.
   */
  seedGroup.classList.add("secondary", "world-only");
  viewToggle.classList.add("world-only");
  exportGroup.classList.add("secondary");
  gazBtn.classList.add("secondary");
  langBtn.classList.add("secondary");
  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "more-toggle";
  // ⚠ The LABEL carries the state, not only the title: measured on a phone, the button read
  // "더 보기" whether the controls were shown or hidden, and the word for the open state lived in
  // `title` — which a touch screen never shows. A button says what pressing it does.
  const syncMore = (on: boolean) => {
    controls.classList.toggle("more-open", on);
    moreBtn.setAttribute("aria-expanded", String(on));
    moreBtn.textContent = t(lang, on ? "lessToggle" : "moreToggle");
    moreBtn.title = t(lang, on ? "moreHide" : "moreShow");
  };
  moreBtn.addEventListener("click", () => syncMore(!controls.classList.contains("more-open")));
  // ★ The fold's control goes BEFORE the zones it unfolds. It used to be last, so everything it
  // revealed was inserted in front of it: measured at 390x844, pressing it moved the button 56px
  // right and 100px down, and a second press in the same place landed on the view toggle. What a
  // disclosure opens belongs BELOW its own control, and in a wrapping bar "below" is "after".
  // ★ ...and the primary goes ahead of everything the fold reveals, for the same reason. The seed
  // box used to stand in front of the die, so opening the fold at 390x844 moved "새 세계" from x=76
  // to x=216 — the one control that must never move under a thumb. On a wide window the zone reads
  // the same either way round: the die, then the way to a particular world.
  controls.append(homeBtn, backBtn, randomBtn, seedGroup, viewToggle, moreBtn, exportGroup, gazBtn, langBtn);
  syncMore(false);
  root.appendChild(advanced);

  // set every UI string from the current language (called on init and on language toggle)
  function applyLang(): void {
    moreBtn.textContent = t(lang, controls.classList.contains("more-open") ? "lessToggle" : "moreToggle");
    moreBtn.title = t(lang, controls.classList.contains("more-open") ? "moreHide" : "moreShow");
    // the document's own language, which is what a screen reader and a translation tool go by:
    // map.html declares lang="ko" and it used to stay that way whatever the toggle said
    document.documentElement.lang = lang;
    advancedSummary.textContent = t(lang, "advanced");
    for (const d of dialRows) d.name.textContent = t(lang, d.key as never);
    homeBtn.textContent = t(lang, "home");
    backBtn.textContent = "← " + t(lang, "backToWorld");
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
    // re-render the live screen — in place: a language is not a place to go back to, and a push
    // here gave Back one more stop per press, at the same plate in the other language
    if (openCityId !== null) openCity(openCityId, "replace"); else showWorld();
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
  // The panels under the map fold on a narrow window, and the same bargain applies: a reader who
  // put the chronicle away did not mean "until the next world".
  const CITIES_FOLD_KEY = "wm:fold:cities";
  // Below this a ward's name is not small, it is a smudge: 4.8px was what a phone measured. What it
  // costs is names — over 28 towns on a 336px plate, 4.6% of them were culled as overlapping at
  // 4.8px against 24.5% at 9px — and what it buys is that the ones left can be read. The survivors
  // are the landmarks (they outrank plain quarters in the cull), and the rest arrive on a pinch.
  const PLATE_NAME_MIN_PX = 9;
  // The plate's own name is its heading — on a phone the ONLY place the town's name is shown — so it
  // is never smaller than a heading: 16, over the facts' 13 (it measured 12.2px on a 390px phone).
  // Its north and its scale caption are signs, held at the world map's 8.
  const PLATE_TITLE_MIN_PX = 16;
  const PLATE_SIGN_MIN_PX = 8;
  // ★ The world map's floor, which it never had: measured over 12 seeds on a 390x844 phone its
  // names stood at a median 4.4px (3.5 at the smallest) against 15 on a desktop. The floor is paid
  // for in names — the cull hides what no longer fits — and 8 was chosen from the measured trade:
  // terrain 202 -> 169 names at rest (-16%, capitals 91 -> 84), political 265 -> 222; 9px would
  // cost a quarter of them. What it hides comes back on a pinch. A desktop map is past it already.
  const WORLD_LABEL_FLOOR = { minPx: 8 };
  const CITY_KEY_FOLD_KEY = "wm:fold:cityKey";
  /**
   * Where the map stops being able to carry its own furniture. The same line the town list already
   * stacks on, so there is ONE width at which this page changes shape rather than two.
   * ⚠ jsdom has no `matchMedia` at all, and a missing one must read as the WIDE layout — that is
   * what every other test in app.test.ts measures.
   */
  const NARROW = "(max-width: 900px)";
  const isNarrowWindow = (): boolean =>
    typeof matchMedia === "function" && matchMedia(NARROW).matches;
  // A key standing UNDER its drawing on a narrow window has the width for two columns; one standing
  // in the 210px column beside a wide window's map does not (see legendSheet.ts).
  const keyColumns = (): number => (isNarrowWindow() ? 2 : 1);

  /**
   * ★ What the page spends around the drawing, MEASURED and handed to the stylesheet (see
   * chromeBudget.ts): the world map's `--chrome`, the plan's `--plate-chrome`, both on #app. The fixed
   * 290 and 230 were right at 1440x900 with a mouse and a one-row toolbar and wrong on a two-row
   * toolbar (Korean on a 1366x650 laptop window, English at 1366x768) and on a tablet's 44px
   * controls — the card ran past the window and the chronicle's line, or the plan's bottom, was cut.
   */
  // The plan's side column is proved against this reserve (layout.test): the chrome above a plate
  // always holds the title and the bar — the way back is in the bar now, and the facts stand beside
  // or under the drawing — and it is never let under it. Measured: 149 on a phone, 168 at 1440x900.
  const PLATE_RESERVE_FLOOR = 150;
  const fitWorldChrome = (): void => {
    const frame = stage.querySelector<HTMLElement>(".map-with-list > .map-frame");
    // A narrow window stacks the key and the town list under the map, and there the map is sized
    // by the window's width anyway; focus mode sizes itself. Both get the stylesheet's own number.
    if (!frame || isNarrowWindow() || document.body.classList.contains("map-focus")) {
      root.style.removeProperty("--chrome");
      return;
    }
    fitChrome(root, "--chrome", () => measureChrome(frame, stage));
  };
  const fitPlateChrome = (): void => {
    const plate = stage.querySelector<SVGSVGElement>("svg.city");
    if (!plate || document.body.classList.contains("map-focus")) return;
    // what counts under a plan is only its card's own edge: its facts and key may run on below it
    // where the window is tall, as they always have
    const cs = getComputedStyle(stage);
    const edge = (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    fitChrome(root, "--plate-chrome", () => measureChrome(plate, stage, window.scrollY, edge), 3, PLATE_RESERVE_FLOOR);
  };
  // the screen that is showing lays its names out again for its new size (set by showWorld)
  let relayoutLabels: (() => void) | null = null;
  const refitChrome = (): void => {
    if (openCityId !== null) fitPlateChrome(); else fitWorldChrome();
    relayoutLabels?.();
  };
  // Once, for the app: a window that is resized, and the web fonts arriving (the title's Cinzel sets
  // the height of the row above the bar), both change what the page spends.
  let refitFrame = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(refitFrame);
    refitFrame = requestAnimationFrame(refitChrome);
  });
  void document.fonts?.ready.then(() => refitChrome());
  /** drops the world screen's width watcher; see the listener leak note in showWorld */
  let dropWidthWatch: (() => void) | null = null;
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
    const was = document.body.classList.contains("map-focus");
    document.body.classList.toggle("map-focus", on);
    // leaving it, the page's chrome is back — measure it again (every render also calls this, to
    // start out of focus, and measures for itself once it is built)
    if (was && !on) refitChrome();
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
  // The realms whose ground is smaller than a province and must survive the snap. Built once: it is
  // a property of the history, not of the year being looked at.
  const freeRealms = new Set(history.polities.filter((p) => p.free).map((p) => p.id));

  function showCityRealms(yearIndex: number): void {
    if (realmCells.size === 0) return;
    const world = generated.world;
    const owner = snapOwnersToProvinces(world.grid.count, world.provinceOf, world.provinces,
                                        history.snapshots[yearIndex].owner, freeRealms);
    // The list is a column of realm NAMES — a label, not a sentence — so it takes the same
    // government suffix the map does, through the same seam. Built once outside the loop: every
    // city in the list shares one labeller, and a fresh closure per row bought nothing but a
    // Map.get(id) repeated once per row instead of once per year.
    // `spellForm`: this column is the one place a reader is shown two invented words side by side
    // (`Korkgor  Grathggau`) with nothing to say which is the country — no legend, no typography,
    // not even a column heading. The map does not ask for it; see polityLabeller.
    const labelOf = polityLabeller(lang, governmentForms, true);
    for (const [cell, el] of realmCells) {
      const o = owner[cell];
      const realm = o >= 0 ? history.polities[o]?.name : undefined;
      el.textContent = realm === undefined ? "" : labelOf(o, realm);
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
      const snapped = snapOwnersToProvinces(world.grid.count, world.provinceOf, world.provinces, snap.owner, freeRealms);
      slot.replaceChildren(politicalLayer(world.grid, snapped, history.polities, politicalOpts(view, lang, colorOf, polityLabeller(lang, governmentForms))));
    }
  }

  /**
   * What the tab says it is holding.
   *
   * Nothing set this before, so map.html's static title rode every screen: a world never carried
   * its own name, a plate never named its town, and two tabs of this site were told apart by
   * nothing — while the address is shareable down to `&city=3`. A title is the one line a bookmark
   * keeps. ⚠ The distinguishing word goes FIRST: a tab truncates from the right, so "WorldMaker —
   * ..." would be all any of them showed.
   */
  function setTitle(city?: { name: string }): void {
    const world = worldNameIn(generated.world, lang);
    document.title = city
      ? `${properName(lang, city.name)} · ${world} — WorldMaker`
      : `${world} — WorldMaker`;
  }

  function showWorld(): void {
    openCityId = null;
    setTitle();
    controls.classList.remove("plate");
    stage.classList.remove("plate");
    root.classList.remove("plate-screen");
    timeline?.destroy();
    stage.innerHTML = "";
    terrainBtn.classList.toggle("active", currentView === "terrain");
    politicalBtn.classList.toggle("active", currentView === "political");
    cultureBtn.classList.toggle("active", currentView === "culture");
    provinceBtn.classList.toggle("active", currentView === "province");
    const svg = renderWorld(generated.world, currentView, history.economicZones.map((z) => z.cell), lang, new Set(), colorOf, polityLabeller(lang, governmentForms));
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
    //
    // ★ And it stands BESIDE the map, at every width, with no chip on the drawing at all. A key on
    // the map covers the map: measured over 12 seeds, the key and its chip stood on a town in 11 of
    // 336 towns, one of them a capital, and SIX of the twelve worlds had at least one town under
    // the key — against nought for the zoom controls and nought for the focus button, which are
    // small and live in the corners the land does not reach. There is no corner that is reliably
    // empty, because the land is different every time. The column beside the map is 210px that the
    // page has already spent, so the key costs the drawing nothing there; under the map it would
    // cost height, which is the one thing the map is short of (the whole reason focus mode exists).
    const legendOn = readLegendPref();
    frame.classList.toggle("legend-off", !legendOn);
    const sheet = legendSheet();
    const legendFold = makeFold({
      // ⚠ Opening is when the key can first be MEASURED: folded, every word is 0 wide, and the fit
      // made then left five realm names running into the second column on a phone.
      title: t(lang, "legendToggle"), open: legendOn,
      onToggle: (on) => { setLegend(on); if (on) placeLegend(svg, sheet, true, 1, keyColumns()); },
    });
    legendFold.section.classList.add("legend-fold");
    legendFold.body.appendChild(sheet);
    // `legend-off` is the one state, and the fold's head is the one control. They are kept in step
    // here so the remembered preference and the fold cannot disagree about whether the key is out.
    const syncLegend = (on: boolean) => {
      frame.classList.toggle("legend-off", !on);
      legendFold.setOpen(on);
    };
    const setLegend = (on: boolean) => { syncLegend(on); writeLegendPref(on); };
    syncLegend(legendOn);
    // ⚠ The fold goes BESIDE the frame, never inside it. `.map-frame` is what the zoom controls
    // and the focus button are absolutely positioned against, so anything added inside it grows the
    // box they are measured from: with the fold in there, a live phone put the zoom controls 104px
    // BELOW the map, floating over the key instead of over the drawing.

    addFocusToggle(frame);

    // The best thing this map has is behind its markers, and until the reader knows a marker leads
    // somewhere there is nothing to tell them so. A list is the signal: it says "there are cities
    // here" by existing, it is reachable by keyboard for free, and it does not need anyone to hit
    // a dot. Capitals first, then by size, because that is the order a reader cares about.
    //
    // Under a narrow window it folds, because there the list is not beside the map but under it:
    // on a phone the list and the chronicle came to 641px against a 225px map. Folded, the head
    // still carries the count — "Cities 23" says towns are there, which is the one job the list
    // was added to do.
    const listFold = makeFold({
      title: t(lang, "cityList"), count: generated.world.cities.length,
      // ★ Foldable at every width now, at the reader's asking: "도시 목록도 접었다 피는게 괜찮지
      // 않을까". Unread, it opens on a desktop and stays folded on a phone (where it and the
      // chronicle once came to 641px under a 225px map); once the reader has an opinion, that wins.
      open: readFoldPref(CITIES_FOLD_KEY, !isNarrowWindow()),
      onToggle: (on) => writeFoldPref(CITIES_FOLD_KEY, on),
    });
    const list = listFold.section;
    list.classList.add("city-list");
    const ul = document.createElement("ul");
    realmCells.clear();
    // The tiebreaker sorts by the name actually ON THE BUTTON, not the underlying Latin `c.name` —
    // in Korean that RENDERS as `properName(lang, c.name)`, and sorting by the untransliterated name
    // instead put same-size Korean towns in an order that reads as arbitrary to the reader who never
    // sees the Latin form at all.
    const ordered = [...generated.world.cities].sort((a, b) =>
      Number(b.isCapital) - Number(a.isCapital) || b.size - a.size
      || properName(lang, a.name).localeCompare(properName(lang, b.name)));
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
    listFold.body.appendChild(ul);

    const withList = document.createElement("div");
    withList.className = "map-with-list";
    // ★ The key and the list share a column, and a FLEX column at that: folded, the list must give
    // its room back to nothing — in the grid rows this used to live in, a folded section still
    // stretched to fill its row and left a panel with a head and a hole under it. Under a narrow
    // window the wrapper is `display: contents`, so the two sections stack with the map exactly as
    // they did before it existed.
    const side = document.createElement("div");
    side.className = "map-side";
    side.append(legendFold.section, list);
    withList.append(frame, side);
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
      labels: zoomLabels(),
      onScale: (scale) => {
        pendingScale = scale;   // the newest scale of the gesture, not the one that scheduled the frame
        if (relayout) return;
        relayout = requestAnimationFrame(() => {
          relayout = 0;
          applyLabelScale(svg, pendingScale, WORLD_LABEL_FLOOR);
          applyMarkerScale(svg, pendingScale);
          deconflictLabels(svg, pendingScale);
        });
      },
    });

    // ★ The chronicle is a CAPTION under the scrubber, not a panel under the map. It used to be the
    // whole list — 48 rows on seed 3, always open on a wide window — and the reader it was built
    // for, asked whether they read it, said no. The reduction is measured: history is bursty, 43.5
    // events over 51 scrub steps with 54% of the steps empty and runs of 34 empty steps, so a
    // caption of "this year's events" would be blank more often than not. It carries the last line
    // forward instead, and says how many others shared that year. The whole chronicle is still a
    // click away in the gazetteer, which builds its own and always did.
    const caption = renderChronicleCaption(generated.world, history, lang);

    // Wide windows show all three sections outright and their heads stand down to plain headings;
    // narrow ones fold them and take the key off the map. Watched, not read once: a window is
    // resized and a phone is rotated.
    //
    // ⚠ jsdom has no `matchMedia` at all. A missing one must read as the WIDE layout — that is the
    // one every other test in app.test.ts measures.
    const narrow = typeof matchMedia === "function" ? matchMedia(NARROW) : null;
    const isNarrow = isNarrowWindow;
    const applyWidth = () => {
      const n = isNarrow();
      // the list folds at every width; only the head's manners used to change with the window
      // ★ The key comes off the drawing at every width and stands in the fold beside the map. It
      // used to be drawn inside the SVG on wide windows, and the SVG is what the zoom moves —
      // measured at 1440x900, two presses of `+` left the key 294px off the left edge of the frame
      // at twice its size, with no way back but zooming out. Off the drawing it also stops
      // shrinking with the map (it was drawn at x0.93 there, and at x0.32 on a phone).
      placeLegend(svg, sheet, true, 1, keyColumns());
      // The scrubber moves the MAP, so under a narrow window it goes directly under the drawing.
      // Stacking the sections had left it between the town list and the chronicle — the one control
      // the map cannot be read without, stranded in the middle of the things that annotate it.
      // Moved rather than re-laid-out: at a wide width it is a full-stage row under everything, and
      // CSS cannot put it in two different parents. The strip carries the chronicle's caption with
      // it: the sentence belongs to the year the scrubber is holding, so the two never separate.
      if (timelineStrip) {
        if (n) withList.insertBefore(timelineStrip, side);
        else stage.appendChild(timelineStrip);
      }
    };
    // ⚠ One listener, dropped when this screen goes. Hanging one off each frame leaked a listener
    // on every regenerate and every trip to a city plate and back — the same trap the Escape
    // handler above was moved out of.
    dropWidthWatch?.();
    narrow?.addEventListener("change", applyWidth);
    dropWidthWatch = () => { narrow?.removeEventListener("change", applyWidth); dropWidthWatch = null; };

    const slot = svg.querySelector(".political-slot") as SVGGElement;
    const renderYear = (index: number): void => {
      currentYearIndex = index;
      const snap = history.snapshots[index];
      fillSlot(slot, currentView, index);
      showFoundedCities(svg, index);
      showCityRealms(index);
      caption.setYear(snap.year);
      // Scrubbing a year replaces the political layer, so its labels arrive at their base size.
      // Bring them to whatever zoom the reader is at before working out what fits, or a nation's
      // name would come back full-size on a map zoomed to 8x.
      const z = worldZoom?.scale() ?? 1;
      applyLabelScale(svg, z, WORLD_LABEL_FLOOR);
      applyMarkerScale(svg, z);
      deconflictLabels(svg, z); // hide colliding lower-priority labels, and those the zoom has not earned yet
      // ⚠ After `fillSlot`, always: outside terrain the key is drawn INSIDE the slot that was just
      // replaced, so every scrub hands back a new key and the one standing under the map is stale.
      placeLegend(svg, sheet, true, 1, keyColumns());
    };

    // ...in the reader's language. Without this the timeline took its own Korean default and an
    // English reader was shown "500년" on the scrubber.
    timeline = createTimeline(history, renderYear, (y) => t(lang, "year").replace("{y}", String(y)),
      { play: t(lang, "play"), pause: t(lang, "pause") }, caption.dwellAt);
    timelineStrip = document.createElement("div");
    timelineStrip.className = "timeline-strip";
    timelineStrip.append(timeline.element, caption.element);
    stage.append(timelineStrip);
    applyWidth();                       // before the first year, so the key starts where it belongs
    // measured with the caption holding its line, and before the year is drawn: the names' 8px
    // floor is worked out from the size the drawing ends up
    caption.setYear(history.snapshots[currentYearIndex].year);
    fitWorldChrome();
    relayoutLabels = () => {
      const z = worldZoom?.scale() ?? 1;
      applyLabelScale(svg, z, WORLD_LABEL_FLOOR);
      applyMarkerScale(svg, z);
      deconflictLabels(svg, z);
    };
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

  /** How many plate entries the one showing sits on top of (0 on the world, or on a linked plate). */
  function plateDepth(): number {
    const d = (window.history.state as { depth?: unknown } | null)?.depth;
    return typeof d === "number" && d > 0 ? d : 0;
  }

  /**
   * The way off a plate goes to the WORLD, in one step. It used to walk the history back one entry,
   * and every town reached through the neighbour chips is an entry: measured live, A → B → A and
   * then the button went to B, and again to A. The browser's own Back still walks plate by plate.
   * A plate opened straight from a link has nothing behind it here, and simply shows the world.
   */
  function backToWorld(): void {
    const depth = plateDepth();
    if (depth > 0) window.history.go(-depth);
    else showWorld();
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
    setTitle(marker);
    controls.classList.add("plate");
    // The card says which screen it is holding, because on a narrow window the stylesheet has to
    // reorder it: measured on a 390x844 phone, 319px of chrome stood above a drawing 313px tall,
    // and the fact strip is 134px of that. Under the drawing it is a caption, which is what it is.
    stage.classList.add("plate");
    // ...and the page says it too: a plate sizes its card by its own chrome (theme.css, --plate-page)
    // and has no use for the world's settings under it
    root.classList.add("plate-screen");
    dropWidthWatch?.();   // the world screen's sections are about to be thrown away
    const url = "#" + worldHash() + "&city=" + cityId;
    // ★ How many plates this one stands on top of, counted in the entry itself: the town next door
    // is a history entry too, so "back to the world" is that many steps, not one (see backToWorld).
    const depth = plateDepth();
    if (record === "push") window.history.pushState({ city: cityId, depth: depth + 1 }, "", url);
    else if (record === "replace") window.history.replaceState({ city: cityId, depth }, "", url);
    timeline?.destroy();
    stage.innerHTML = "";
    // A plate the reader opens is a new page, and it opens at the top — where its way back is. Opened
    // from far down a phone's town list it kept that scroll, clamped: the toolbar off the top. (Back
    // returns the world to where the list was left; the browser keeps that scroll with its entry.)
    if (record === "push") { document.documentElement.scrollTop = 0; document.body.scrollTop = 0; }
    // The plate's key never stood ON the drawing — it has a 108-unit strip of its own — so the
    // trouble here was size, not room: 568 units drawn 321px wide is x0.565, and the district key
    // measured 7.0px type and a 4.5px swatch on a real phone, for quarters that are told apart by
    // colour alone and carry no labels. Taken off the plate it stands under it at 1:1, and the
    // strip shrinks to the compass that is all that is left in it, which hands the town back 15%
    // of its width.
    //
    // ★ It now comes off at EVERY width, for the reason the world map's key did (㊽): the key was
    // inside the SVG, and the SVG is what the zoom moves — measured at 1440x900, two presses of `+`
    // put the plate's key at (1234,-60) off the top of a frame that starts at 231, at twice its
    // size. Whatever is in the drawing belongs to the drawing and travels with it.
    //
    // ⚠ The strip's width is baked into the plate's viewBox, so unlike the world map this cannot be
    // fixed by moving a node: the plate is rendered without the strip from the start.
    const layout = generateCityLayout(cityContext(marker), params.seed);
    const citySvg = renderCity(layout, lang, { keyOutside: true });
    const frame = document.createElement("div");
    frame.className = "map-frame";
    frame.appendChild(citySvg);
    addFocusToggle(frame);

    // The plate's key opens by default, where the world map's stays folded: a terrain key annotates
    // a map whose places are also named, but a plate's quarters have nothing but their colour.
    const keySheet = legendSheet();
    const keyFold = makeFold({
      title: t(lang, "legendPlate"), open: readFoldPref(CITY_KEY_FOLD_KEY, true),
      onToggle: (on) => {
        writeFoldPref(CITY_KEY_FOLD_KEY, on);
        // measured again now that it has a width — see the world key's fold
        if (on) placeLegend(citySvg, keySheet, true, LEGEND_ROW / CITY_LEGEND_ROW, keyColumns());
      },
    });
    keyFold.section.classList.add("legend-fold");
    keyFold.body.appendChild(keySheet);
    // ㉗'s one size, arrived at from the other direction: the plate's key is drawn in 11-unit rows
    // because the plate is drawn big. Standing it at 1:1 would put an 11px row beside the world
    // map's 17px one on the same phone.
    placeLegend(citySvg, keySheet, true, LEGEND_ROW / CITY_LEGEND_ROW, keyColumns());

    // ⚠ One watcher, dropped on the way out — see the leak note in showWorld.
    dropWidthWatch?.();
    const narrowNow = typeof matchMedia === "function" ? matchMedia(NARROW) : null;
    const replate = () => { if (openCityId === cityId) openCity(cityId, "none"); };
    narrowNow?.addEventListener("change", replate);
    dropWidthWatch = () => { narrowNow?.removeEventListener("change", replate); dropWidthWatch = null; };

    // A plate carried its name and nothing else, and there was no way off it but back to the world
    // map to hunt for another dot. The facts are the ones the world can actually answer for — the
    // founding year an outside review asked for is not among them: the chronicle founds towns the
    // atlas never draws (19 of 19 on seed 1), which is its own bug and not something to paper over.
    // The plate answers for the year the reader scrubbed to, and says which year that was: the
    // world map has a scrubber to carry that, and a plate does not.
    // ★ ...unless the town was not there yet. The list offers every town at every year while the
    // map hides the ones not founded, and measured over 336 towns at year 0 — where every world
    // starts — 170 plates said "Realm — X · 0 AY" over "Founded — 360 AY". Such a plate answers for
    // the first year its town stood; the realm line says which year that is.
    const founded = history.cityFoundings.find((f) => f.cityId === cityId)?.year;
    let factIndex = currentYearIndex;
    if (founded !== undefined && history.snapshots[factIndex].year < founded) {
      const standing = history.snapshots.findIndex((s) => s.year >= founded);
      if (standing >= 0) factIndex = standing;
    }
    const snapNow = history.snapshots[factIndex];
    const facts = cityFacts(generated.world, marker, layout, lang, KM_PER_UNIT, history.cityFoundings,
      { owner: snapNow.owner, polities: history.polities, year: snapNow.year }, governmentForms);
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

    // ★ What is said about the plate comes after it, the facts over the key, in one column: beside
    // the drawing where the page has room for a column, under it — a caption — where it does not.
    // In a 1366x650 laptop window the facts stood ABOVE the drawing, two lines of them under the way
    // back and a two-row toolbar: 293px of chrome over a plate 334px tall, smaller than a phone's.
    // ⚠ Beside the frame, never inside it: the frame is what the floating controls hang off.
    const side = document.createElement("div");
    side.className = "plate-side";
    side.append(panel, keyFold.section);
    stage.append(frame, side);
    // ...and fitted again now that it stands in the page: the fit above ran before the card was in
    // the document, with no room to measure, so the plate's key came out a compact block (271px of
    // a 324px measure on a phone) where the world's spans its panel.
    placeLegend(citySvg, keySheet, true, LEGEND_ROW / CITY_LEGEND_ROW, keyColumns());
    // and sized by what the page actually spends around it, before its names are floored
    relayoutLabels = null;
    fitPlateChrome();
    worldZoom?.destroy(); worldZoom = null;
    cityZoom?.destroy();
    // the ward names hold their size here for the same reason the world's names do
    let cityRelayout = 0, cityScale = 1;
    // the plan's own names have to be laid out too — it is in the document by now, so they can
    // be measured
    //
    // ★ Before they are laid out, they are sized for the window this plate actually got. The plate
    // takes whatever room is left, and its names are drawn in map units, so a small window shrinks
    // the lettering with the drawing: measured on a 390x844 phone, 336px across for 494 units put a
    // 7-unit ward name at 4.8px on screen — against 18px for the SAME word in the key standing
    // under it. Floored first, culled after, so `deconflictLabels` measures the names as they will
    // be read. A desktop plate is already past the floor (10.2px at 720px), so it is untouched.
    floorLabelSize(citySvg, ".ward-label", PLATE_NAME_MIN_PX);
    // The rest of what the plate writes shrank the same way: the town's own name 12.2px on a phone,
    // its north 4.8px, its scale 4.6px. The name is the plate's heading, so it gets a heading's size.
    floorLabelSize(citySvg, ".city-name-text", PLATE_TITLE_MIN_PX);
    floorLabelSize(citySvg, ".compass-n", PLATE_SIGN_MIN_PX);
    floorScaleCaption(citySvg, PLATE_SIGN_MIN_PX);
    fitTitle(citySvg);
    // ...and set beside the sign at their place rather than on it, at the size they will be read —
    // the castle's name off the castle it names
    clearMarks(citySvg);
    clearCastleName(citySvg);
    deconflictLabels(citySvg);
    cityZoom = attachZoomPan(citySvg, frame, {
      labels: zoomLabels(),
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
    governmentForms = classifyGovernments(generated.world, history);
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
        layOutLabelsForExport(svg, (s) => { fitTitle(s); clearMarks(s); clearCastleName(s); });
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
    const svg = renderWorld(generated.world, currentView, history.economicZones.map((z) => z.cell), lang, unfoundedAt(currentYearIndex), colorOf, polityLabeller(lang, governmentForms));
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
