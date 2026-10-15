import type { WorldParams } from "../types/world";
import { DEFAULT_PARAMS } from "../types/world";
import { waysInUse } from "../engine/worldRoads";
import { renderWorld, restyleTowns, type MapView, type MapStyle } from "./svgWorldRenderer";
import { renderCity, CITY_LEGEND_ROW, CITY_LEGEND_TEXT, fitTitle } from "./svgCityRenderer";
import { floorScaleCaption } from "./scaleBar";
import { worldFingerprint } from "../engine/fingerprint";
import { randomSeed, initialCity, initialNames, initialParams, initialSeedName } from "./urlState";
import { NAME_MAX, type NameBook } from "./nameBook";
import { hashStringToSeed } from "../engine/rng";
import { renderChronicleCaption } from "./chronicle";
import { createTimeline, type Timeline } from "./timeline";
import { attachZoomPan, type ZoomPan } from "./zoomPan";
import { deconflictLabels, clearMarks, clearCastleName, coveredBy, placeRoadEnds } from "./deconflict";
import { applyLabelScale, applyMarkerScale, floorLabelSize, worldLabelFloor } from "./labelScale";
import { type Lang, t } from "./i18n";
import { makeFold, readFoldPref, writeFoldPref, type Fold } from "./fold";
import { legendSheet, placeLegend, scrollbarWidth } from "./legendSheet";
import { icon, sign } from "./icons";
import { measureChrome, fitChrome, oneRowWidth } from "./chromeBudget";
import { LEGEND_ROW } from "./renderer";
import { detectLang, saveLang } from "./lang";
import { rememberWorld } from "./recentWorlds";
import { properName, polityLabeller } from "./properName";
import { worldNameIn } from "../engine/featureLabel";
import { makeWorldState, setNames, sameWorld, worldHash, namesPart, unfoundedAt, townsIn, plateOf, townNameOf, cityOrder, type WorldState, type TownsIn } from "./worldState";
import { createToolbar } from "./toolbar";
import { createRenameEditor } from "./renameEditor";
import { fillSlot } from "./mapSlot";
import { createExporter } from "./exportScreen";
import { plateFactsPanel } from "./plateFacts";

export interface App {
  regenerate(p: WorldParams): void;
  openCity(cityId: number): void;
  showWorld(): void;
}

/**
 * The map page: the bar (toolbar.ts), the world screen and the town plate (here), and what they share.
 *
 * What depends on the world alone is the world's state (worldState.ts); the files (exportScreen.ts), the
 * name box (renameEditor.ts), the overlay slot (mapSlot.ts) and a plate's facts (plateFacts.ts) each stand
 * on their own with the screen handed in. What is left here is the two screens and the page's chrome
 * around them — the part that owns the document (design review 2026-10-15, "app.ts").
 *
 * @param askedName what the reader called this world, when they arrived by naming one. The landing
 * page invites them to "start from a name" and the name used to be hashed to a seed and discarded,
 * so a world asked to be "아발론" came back called "The Old Lands". It is kept for as long as it
 * is true — a fresh seed is a different world and takes a name of its own.
 */
export function createApp(root: HTMLElement, initial: WorldParams = DEFAULT_PARAMS, askedName?: string): App {
  root.innerHTML = "";
  let lang: Lang = detectLang();
  // The reader's own names for this world's places (nameBook.ts), kept in the address beside it: read
  // from the link the page was opened with — when that link is this world.
  const params: WorldParams = { ...initial };
  let ws: WorldState = makeWorldState(params, askedName ?? null, sameWorld(initialParams(location.hash), params) ? initialNames(location.hash) : {});
  const bar = createToolbar({
    params, lang: () => lang,
    // a dial released: the world it asks for — and back where it was if the reader chose to stay
    onDial: (key, value) => regenerate({ ...ws.params, [key]: value }),
  });
  const { controls, backBtn, randomBtn, seedInput, regenBtn, terrainBtn, politicalBtn, cultureBtn, provinceBtn, inkBtn, exportGroup, jsonBtn, pngBtn, svgBtn, gazBtn, langBtn, fingerprintCode } = bar;
  const stage = document.createElement("div");
  stage.className = "stage";
  root.append(controls, stage);
  root.appendChild(bar.advanced);

  let timeline: Timeline | null = null;
  let timelineStrip: HTMLElement | null = null;   // the scrubber and the chronicle caption, moved as one
  let worldZoom: ZoomPan | null = null;
  let cityZoom: ZoomPan | null = null;
  let currentYearIndex = 0;
  // in colour, or in one ink on white paper for print (inkStyle.ts) — every view, the scrubber and the files
  let mapStyle: MapStyle = "colour";
  let currentView: MapView = "terrain";
  let openCityId: number | null = null; // which screen is showing (null = world)
  const zoomLabels = () => ({ zoomIn: t(lang, "zoomIn"), zoomOut: t(lang, "zoomOut"), reset: t(lang, "zoomReset") });

  bar.applyLang();
  langBtn.addEventListener("click", () => {
    lang = lang === "en" ? "ko" : "en";
    saveLang(lang);
    bar.applyLang();
    // re-render the live screen — in place: a language is not a place to go back to, and a push
    // here gave Back one more stop per press, at the same plate in the other language. The zoom holds
    // through it, as it does through a view or the ink: a region framed for a file stays framed.
    if (openCityId !== null) openCity(openCityId, "replace", cityZoom?.viewBox()); else showWorld(worldZoom?.viewBox());
  });

  function setView(v: MapView): void {
    if (v === currentView) return;
    currentView = v;
    showWorld(worldZoom?.viewBox()); // re-render at the current year in the new view, zoomed where it was
  }
  terrainBtn.addEventListener("click", () => setView("terrain"));
  politicalBtn.addEventListener("click", () => setView("political"));
  cultureBtn.addEventListener("click", () => setView("culture"));
  provinceBtn.addEventListener("click", () => setView("province"));
  inkBtn.addEventListener("click", () => {
    mapStyle = mapStyle === "ink" ? "colour" : "ink";
    inkBtn.setAttribute("aria-pressed", String(mapStyle === "ink"));
    inkBtn.classList.toggle("active", mapStyle === "ink");
    showWorld(worldZoom?.viewBox());
  });
  backBtn.addEventListener("click", () => backToWorld());
  // whether a name on the map opens a box to type in (see addRenameToggle)
  let renaming = false;

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
  // by window (labelScale.ts): 10px beside a wide window's map, 8 under a narrow one's — read at every
  // relayout, so a window resized across the narrow line takes the other floor with its next layout
  const WORLD_LABEL_FLOOR = () => worldLabelFloor(isNarrowWindow());
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
  // ...and so does the column beside a short, wide window's map, which the card's one-row bar widens
  // (477px at 1366x650, against the 210 it was built for).
  const SIDE_WIDE = 360;
  const sideIsWide = (): boolean => (stage.querySelector<HTMLElement>(".map-side")?.clientWidth ?? 0) >= SIDE_WIDE;
  const keyColumns = (): number => (isNarrowWindow() || sideIsWide() ? 2 : 1);

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
  // The card is let grow to a one-row bar (`--bar-w`, see oneRowWidth). A narrow window folds its bar
  // on purpose and focus mode has none; both keep the map's own measure. The 12 is the room the
  // language toggle keeps from the rest — its `margin-left: auto` is nought at the bar's own width.
  const BAR_SPARE = 12;
  const fitBarWidth = (): void => {
    const w = isNarrowWindow() || document.body.classList.contains("map-focus") ? null : oneRowWidth(controls);
    if (w === null) root.style.removeProperty("--bar-w");
    else root.style.setProperty("--bar-w", `${w + BAR_SPARE}px`);
  };
  const fitWorldChrome = (): void => {
    fitBarWidth();
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
    fitBarWidth();
    const plate = stage.querySelector<SVGSVGElement>("svg.city");
    if (!plate || document.body.classList.contains("map-focus")) return;
    // what counts under a plan is only its card's own edge: its facts and key may run on below it
    // where the window is tall, as they always have
    const cs = getComputedStyle(stage);
    const edge = (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    fitChrome(root, "--plate-chrome", () => measureChrome(plate, stage, window.scrollY, edge), 3, PLATE_RESERVE_FLOOR);
  };
  /**
   * ★ What the map does, said once where the map is. It was said only in tooltips — that a town's dot opens
   * its plan, that the wheel zooms, that ▶ plays five hundred years, that a renamed place is kept in the
   * link — and a reader who arrives by a shared link never sees the front page's words either (audit,
   * 2026-10-08). Help where the work is, offered once and put away for good: Azgaar's status line does the
   * same, and help shown up front and in the way is what readers skip (NN/g). It costs the map its height
   * while it stands, and gives it back when closed.
   */
  const HINT_KEY = "wm:hint";
  const hintWanted = (): boolean => { try { return localStorage.getItem(HINT_KEY) !== "off"; } catch { return true; } };
  function addFirstHint(): void {
    if (!hintWanted()) return;
    const bar = document.createElement("div");
    bar.className = "first-hint";
    bar.setAttribute("role", "note");
    const words = document.createElement("span");
    // two sentences, one for each place the list stands: under a narrow window it is BELOW the map and a
    // finger pinches, and the desktop's "list on the right" was simply wrong there (design review, item 14)
    words.textContent = t(lang, isNarrowWindow() ? "firstHintNarrow" : "firstHint");
    const close = document.createElement("button");
    close.type = "button";
    close.appendChild(icon("close", 12));
    close.setAttribute("aria-label", t(lang, "firstHintClose"));
    close.title = t(lang, "firstHintClose");
    close.addEventListener("click", () => {
      try { localStorage.setItem(HINT_KEY, "off"); } catch { /* privacy mode: closed for this page only */ }
      bar.remove();
      refitChrome();
    });
    bar.append(words, close);
    stage.prepend(bar);
  }

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
  // Unread, the key opens beside a wide window's map where the column has the room (measured live at
  // 1440x900: ~300px of it empty under the town list at year 0, while the colours went unexplained). It
  // stays folded under a narrow window's map, where it would cost the map its height, and beside a short
  // one's: the column is the map's height, 322px at 1366x650, and the key's 283 left the town list its head
  // and no row. 760 tall is where the key, the list's head and four rows fit beside a two-row bar.
  // A reader's choice wins.
  const TALL = "(min-height: 760px)";
  const legendRoom = (): boolean => !isNarrowWindow() && (typeof matchMedia !== "function" || matchMedia(TALL).matches);
  function readLegendPref(): boolean {
    try {
      const v = localStorage.getItem(LEGEND_KEY);
      return v === null ? legendRoom() : v === "on";
    } catch { return legendRoom(); }
  }
  /** has the reader folded or opened the key themselves (then theirs is the answer, whatever the room) */
  function legendPrefSet(): boolean {
    try { return localStorage.getItem(LEGEND_KEY) !== null; } catch { return false; }
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
    if (on) sign(focusBtn, "close", t(lang, "focusExit")); else focusBtn.textContent = t(lang, "focusEnter");
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

  /**
   * Renaming (nameBook.ts): while it is on, a name on the map opens a box where it stands, in place of the
   * place it names. It stands on the map it works on, under the map-only chip, on the world and on a
   * plate alike. In the toolbar it took the English bar to two rows (1093px of 1035 at 1440x900), and
   * there it would have been gone in the map-only view, where the map is biggest. Measured over 12
   * worlds it stood on no town; the names of seas step out from under it as from under the other chip.
   */
  function addRenameToggle(frame: HTMLElement): void {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rename-toggle";
    sign(b, "pencil", t(lang, "renameToggle"));
    b.title = t(lang, "renameTitle");
    b.setAttribute("aria-pressed", String(renaming));
    b.classList.toggle("active", renaming);
    b.addEventListener("click", () => setRenaming(!renaming));
    frame.appendChild(b);
  }

  function setRenaming(on: boolean): void {
    renaming = on;
    for (const b of stage.querySelectorAll(".rename-toggle")) {
      b.setAttribute("aria-pressed", String(on));
      b.classList.toggle("active", on);
    }
    root.classList.toggle("renaming", on);
    if (!on) editor.close(true);
  }

  // city cell -> the <span> naming its realm in the list, refilled whenever the year changes
  const realmCells = new Map<number, HTMLElement>();
  // city id -> its row in the list, and the list's section, whose head counts the rows the year shows
  const listRows = new Map<number, HTMLLIElement>();
  let listFold: Fold | null = null;

  function showCityRealms(towns: TownsIn): void {
    if (realmCells.size === 0) return;
    // The list is a column of realm NAMES — a label, not a sentence — so it takes the same
    // government suffix the map does, through the same seam. Built once outside the loop: every
    // city in the list shares one labeller, and a fresh closure per row bought nothing but a
    // Map.get(id) repeated once per row instead of once per year.
    // `spellForm`: this column is the one place a reader is shown two invented words side by side
    // (`Korkgor  Grathggau`) with nothing to say which is the country — no legend, no typography,
    // not even a column heading. The map does not ask for it; see polityLabeller.
    const labelOf = polityLabeller(lang, ws.governmentForms, true);
    for (const [cell, el] of realmCells) {
      const o = towns.owner[cell];
      const realm = o >= 0 ? ws.history.polities[o]?.name : undefined;
      el.textContent = realm === undefined ? "" : labelOf(o, realm);
    }
    // ...and which towns are the year's capitals: set as capitals, and at the head of the list, as the
    // map stars them. Rows move only when the order changes (a capital falls, a free city rises), and
    // the row the keyboard is on keeps it.
    const world = ws.generated.world;
    const seat = (id: number) => towns.seats.has(world.cities[id]?.cell ?? -1);
    for (const [id, li] of listRows) li.querySelector(".city-list-item")?.classList.toggle("is-capital", seat(id));
    const order = [...listRows.keys()].sort((a, b) => cityOrder(lang, world.cities[a], world.cities[b], seat));
    const ul = listRows.values().next().value?.parentElement;
    if (!ul || order.every((id, k) => ul.children[k] === listRows.get(id))) return;
    const focused = document.activeElement;
    ul.append(...order.map((id) => listRows.get(id)!));
    if (focused instanceof HTMLElement && ul.contains(focused) && document.activeElement !== focused) focused.focus({ preventScroll: true });
  }

  // The chronicle said a town was founded in year 140 and the town was on the map from year 0, so
  // five hundred years of history had nothing to show but borders moving. Scrubbing hides the
  // towns not yet founded rather than redrawing the map: the markers are already in the document.
  function showFoundedCities(svg: SVGSVGElement, yearIndex: number): void {
    const hidden = unfoundedAt(ws, yearIndex);
    const world = ws.generated.world;
    for (const el of svg.querySelectorAll<SVGElement>(".markers [data-city]")) {
      const id = Number(el.getAttribute("data-city"));
      el.style.display = hidden.has(id) ? "none" : "";
    }
    // ...and the roads and sea routes between them: the ones on the cheapest way between two towns
    // standing this year, through the sites of towns still to come (waysInUse). renderWorld drew every
    // way once for the screen; the exported map is drawn for its year by the same rule.
    const inUse = waysInUse(world.roads, world.seaRoutes ?? [], (id) => !hidden.has(id));
    for (const el of svg.querySelectorAll<SVGElement>(".roads [data-road]")) {
      el.style.display = inUse.roads[Number(el.getAttribute("data-road"))] ? "" : "none";
    }
    for (const el of svg.querySelectorAll<SVGElement>(".sea-routes [data-sea]")) {
      el.style.display = inUse.sea[Number(el.getAttribute("data-sea"))] ? "" : "none";
    }
    // ...and a free port's diamond with its town: it stood alone on empty land where the chronicle
    // founds the town centuries later (6 of 12 worlds at year 0, 5 still at year 300)
    const unbuilt = new Set(world.cities.filter((c) => hidden.has(c.id)).map((c) => c.cell));
    for (const el of svg.querySelectorAll<SVGElement>(".econ-zones [data-zone]")) {
      el.style.display = unbuilt.has(Number(el.getAttribute("data-zone"))) ? "none" : "";
    }
    // ★ ...and the list beside it. It offered every town at every year while the map hid the ones
    // not founded: world 1 opens at year 0 with its 8 capitals on the map and 28 towns in the list,
    // each wearing a realm, and over twelve worlds 170 of 336 towns were listed in a year before
    // they stood (92 still at year 200). Asked whether to hide them or grey them out, the reader
    // chose the list that matches the map. A row keeps its place and returns to it, so a town
    // arrives where capitals-then-size puts it, and the head counts what the list shows.
    let shown = 0;
    for (const [id, li] of listRows) {
      li.hidden = hidden.has(id);
      if (!li.hidden) shown++;
    }
    // "8 / 28": what stands now of what there will be — "Cities 8" read as a small world at year 0, and the
    // second number is the one sign on arrival that the scrubber has a history to show (design review, item 18)
    const all = world.cities.length;
    listFold?.setCount(shown, all);
    if (listFold) listFold.head.title = t(lang, "cityCountHint").replace("{a}", String(shown)).replace("{b}", String(all));
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
    const world = worldNameIn(ws.generated.world, lang);
    document.title = city
      ? `${properName(lang, city.name)} · ${world} — WorldMaker`
      : `${world} — WorldMaker`;
  }

  // Whether the keyboard has lost its place: focus on <body>, or on an element the screen change
  // just threw away. `hidden` names one more that is still in the document but no longer shown.
  function focusLost(hidden?: Element): boolean {
    const a = document.activeElement;
    return !a || a === document.body || !a.isConnected || a === hidden;
  }

  // ── Renaming ──────────────────────────────────────────────────────────────────────────────────────
  // The box a name is typed into (renameEditor.ts); a name kept is written here, where the screens are.
  const editor = createRenameEditor({ stage, lang: () => lang, ws: () => ws, renaming: () => renaming, onKeep: setName });

  /** Write a name into the book, the world and the address, and draw the screen again with it. */
  function setName(key: string, typed: string): void {
    const name = Array.from(typed.trim()).slice(0, NAME_MAX).join("");
    const next: NameBook = { ...ws.names };
    if (!name || name === editor.bornName(key)) delete next[key]; else next[key] = name;
    if (next[key] === ws.names[key]) return;
    setNames(ws, next);
    fingerprintCode.textContent = worldFingerprint(ws.generated.world, ws.history);
    // the same screen, at the zoom and the year the reader was at
    if (openCityId !== null) openCity(openCityId, "replace", cityZoom?.viewBox());
    else showWorld(worldZoom?.viewBox());
    // ...and kept for them in this browser, as the link that opens it with its names (recentWorlds.ts) — or
    // let go, when the last of them was given back
    rememberWorld({
      key: worldHash(ws), url: `map.html#${worldHash(ws)}${namesPart(ws)}`,
      name: worldNameIn(ws.generated.world, lang), count: Object.keys(ws.names).length, at: Date.now(),
    });
  }
  // The files (exportScreen.ts): the map in front of the reader, the world's data, the gazetteer.
  const files = createExporter({
    root, exportGroup,
    ws: () => ws, lang: () => lang, view: () => currentView, style: () => mapStyle,
    yearIndex: () => currentYearIndex, openCityId: () => openCityId, worldZoom: () => worldZoom,
  });

  /** @param restore the zoom to draw the map at (ZoomPan.viewBox), when it is drawn again in place */
  function showWorld(restore?: string): void {
    editor.close(false);
    fingerprintCode.textContent = worldFingerprint(ws.generated.world, ws.history);
    const was = openCityId;
    openCityId = null;
    setTitle();
    controls.classList.remove("plate");
    stage.classList.remove("plate");
    root.classList.remove("plate-screen");
    timeline?.destroy();
    stage.innerHTML = "";
    // the view that is showing, said as well as coloured (aria-pressed, as the ink and map-only chips say it)
    for (const [b, v] of [[terrainBtn, "terrain"], [politicalBtn, "political"], [cultureBtn, "culture"], [provinceBtn, "province"]] as const) {
      b.classList.toggle("active", currentView === v);
      b.setAttribute("aria-pressed", String(currentView === v));
    }
    const world = ws.generated.world;
    const svg = renderWorld(world, currentView, ws.history.economicZones.map((z) => z.cell), lang, new Set(), ws.colorOf, polityLabeller(lang, ws.governmentForms), mapStyle);
    const cityIdOf = (el: Element | null) => {
      const id = el?.getAttribute("data-city");
      return id !== null && id !== undefined && id !== "" ? Number(id) : null;
    };
    svg.addEventListener("click", (e) => {
      if (renaming) return;   // the stage opens a name's box instead
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
      // renaming, the town's name opens for typing, as a click on it would
      if (renaming) editor.open(`t${id}`, editor.nameShownAt(`t${id}`) ?? (e.target as Element), e.target as Element);
      else openCity(id);
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
    addRenameToggle(frame);

    // The best thing this map has is behind its markers, and until the reader knows a marker leads
    // somewhere there is nothing to tell them so. A list is the signal: it says "there are cities
    // here" by existing, it is reachable by keyboard for free, and it does not need anyone to hit
    // a dot. Capitals first, then by size, because that is the order a reader cares about.
    //
    // Under a narrow window it folds, because there the list is not beside the map but under it:
    // on a phone the list and the chronicle came to 641px against a 225px map. Folded, the head
    // still carries the count — "Cities 23" says towns are there, which is the one job the list
    // was added to do.
    listFold = makeFold({
      title: t(lang, "cityList"), count: world.cities.length,
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
    listRows.clear();
    // (in the order of year zero; the year drawn puts its own capitals first — showCityRealms)
    const ordered = [...world.cities].sort((a, b) =>
      cityOrder(lang, a, b, (id) => world.cities[id]?.isCapital ?? false));
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
      listRows.set(c.id, li);
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
    // a first visit is told how the map is used, above it (see addFirstHint)
    addFirstHint();
    cityZoom?.destroy(); cityZoom = null;
    worldZoom?.destroy();
    // What the page's own controls cover of the map — the focus chip and the +/−/↺ mount — asked
    // afresh on every pass, since what they cover changes with the window. At rest the names of
    // areas step out from under them (see deconflictLabels).
    const underControls = () => coveredBy(svg, frame.querySelectorAll(":scope > .focus-toggle, :scope > .rename-toggle, :scope > .map-zoom-controls"));
    // Zooming holds the lettering at its on-screen size and then asks deconflictLabels what fits
    // now. That is the whole of the "more names as you lean in" behaviour: the land spreads out,
    // the words do not, and the room that opens up is filled from the priority order the pass
    // already has — nation, capital, region, river, town. No per-tier zoom thresholds to tune.
    // Coalesced to one pass per frame: a wheel gesture fires dozens of scale changes.
    let relayout = 0, pendingScale = 1;
    worldZoom = attachZoomPan(svg, frame, {
      restore,
      labels: zoomLabels(),
      onScale: (scale) => {
        pendingScale = scale;   // the newest scale of the gesture, not the one that scheduled the frame
        if (relayout) return;
        relayout = requestAnimationFrame(() => {
          relayout = 0;
          applyLabelScale(svg, pendingScale, WORLD_LABEL_FLOOR());
          applyMarkerScale(svg, pendingScale);
          deconflictLabels(svg, pendingScale, { clear: underControls() });
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
    const caption = renderChronicleCaption(world, ws.history, lang);

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
      const snap = ws.history.snapshots[index];
      fillSlot(slot, currentView, index, ws, lang, mapStyle);
      // the towns as they stand this year: their stars, their names' rank and what they say on hover
      const towns = townsIn(ws, index, lang);
      restyleTowns(svg, world, lang, towns.at);
      showFoundedCities(svg, index);
      showCityRealms(towns);
      caption.setYear(snap.year);
      // Scrubbing a year replaces the political layer, so its labels arrive at their base size.
      // Bring them to whatever zoom the reader is at before working out what fits, or a nation's
      // name would come back full-size on a map zoomed to 8x.
      const z = worldZoom?.scale() ?? 1;
      applyLabelScale(svg, z, WORLD_LABEL_FLOOR());
      applyMarkerScale(svg, z);
      deconflictLabels(svg, z, { clear: underControls() }); // hide colliding lower-priority labels, and those the zoom has not earned yet
      // ⚠ After `fillSlot`, always: outside terrain the key is drawn INSIDE the slot that was just
      // replaced, so every scrub hands back a new key and the one standing under the map is stale.
      placeLegend(svg, sheet, true, 1, keyColumns());
    };

    // ...in the reader's language. Without this the timeline took its own Korean default and an
    // English reader was shown "500년" on the scrubber.
    timeline = createTimeline(ws.history, renderYear, (y) => t(lang, "year").replace("{y}", String(y)),
      { play: t(lang, "play"), pause: t(lang, "pause"), year: t(lang, "timelineYear") }, caption.dwellAt);
    timelineStrip = document.createElement("div");
    timelineStrip.className = "timeline-strip";
    timelineStrip.append(timeline.element, caption.element);
    stage.append(timelineStrip);
    applyWidth();                       // before the first year, so the key starts where it belongs
    // measured with the caption holding its line, and before the year is drawn: the names' 8px
    // floor is worked out from the size the drawing ends up
    caption.setYear(ws.history.snapshots[currentYearIndex].year);
    fitWorldChrome();
    // ★ A short window folds the key (the column is short), but a short WIDE one has the column wide: at
    // 1366x650 it stood 477x415 with the key folded and eight towns in it, its lower half empty (the
    // user, 2026-10-13: "오른쪽 칸이 너무 비어 보이는데"). Its width is known only now, laid out; there
    // the key opens in two columns. Unless the reader has said otherwise — and nothing is remembered.
    if (!legendPrefSet() && frame.classList.contains("legend-off") && sideIsWide()) {
      syncLegend(true);
      placeLegend(svg, sheet, true, 1, keyColumns());
    }
    // The scale bar is drawn in map units too, and at 1440x900 its two lines came out 7.8 and 6.8px:
    // held at the names' minimum, for the size the drawing ended up (and again when the window changes)
    floorScaleCaption(svg, WORLD_LABEL_FLOOR().minPx);
    relayoutLabels = () => {
      const z = worldZoom?.scale() ?? 1;
      floorScaleCaption(svg, WORLD_LABEL_FLOOR().minPx);
      applyLabelScale(svg, z, WORLD_LABEL_FLOOR());
      applyMarkerScale(svg, z);
      deconflictLabels(svg, z, { clear: underControls() });
      // the column is wider or narrower now, and the key may want one column or two
      placeLegend(svg, sheet, true, 1, keyColumns());
    };
    timeline.setIndex(currentYearIndex); // renders the current year in the current view
    // replaceState, not location.hash: re-rendering the same world is not a place to come back to,
    // and every view switch used to push one
    window.history.replaceState(null, "", "#" + worldHash(ws) + namesPart(ws));
    // ...and the keyboard comes back to where the reader left for the plate: the town's own row,
    // or the list's head if the row is folded away or not founded in this year. The way back it
    // was on is hidden on the world, so focus had fallen to <body> (see openCity).
    if (was !== null && focusLost(backBtn)) {
      const row = listRows.get(was);
      const shown = row && !row.hidden && listFold?.section.classList.contains("is-open");
      ((shown ? row.querySelector("button") : null) ?? listFold?.head)?.focus({ preventScroll: true });
    }
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
  function openCity(cityId: number, record: "push" | "replace" | "none" = "push", restore?: string): void {
    const marker = ws.generated.world.cities.find((c) => c.id === cityId);
    if (!marker) return;
    editor.close(false);
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
    const url = "#" + worldHash(ws) + "&city=" + cityId + namesPart(ws);
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
    const layout = plateOf(ws, marker);
    const citySvg = renderCity(layout, lang, { keyOutside: true, townName: townNameOf(ws), townId: cityId });
    // a town's name written where a road leaves the plate opens that town, as the neighbours beside it
    // do (a drag that ends on one is not a click: the zoom swallows it)
    citySvg.addEventListener("click", (e) => {
      if (renaming) return;   // the stage opens a name's box instead
      const to = (e.target as Element).closest?.("[data-city]")?.getAttribute("data-city");
      if (to) openCity(Number(to));
    });
    const frame = document.createElement("div");
    frame.className = "map-frame";
    frame.appendChild(citySvg);
    addFocusToggle(frame);
    addRenameToggle(frame);

    // The plate's key opens by default, where the world map's stays folded: a terrain key annotates
    // a map whose places are also named, but a plate's quarters have nothing but their colour.
    const keySheet = legendSheet();
    // ★ Two columns, wherever the key stands. Under a narrow plate they fit at ㉗'s size; beside a
    // desktop's plate they do not, and the key is drawn smaller until they do — 30-32 rows (554px) stood
    // in a fold of 451px at 1440x900 and 257px at 1366x650, a scroll nobody notices (plate review,
    // 2026-10-15) — but never under 10px type: below that it keeps one readable column.
    const PLATE_KEY_MIN_PX = 10;
    // ★ What is said about the plate comes after it, the facts over the key, in one column: beside
    // the drawing where the page has room for a column, under it — a caption — where it does not.
    // In a 1366x650 laptop window the facts stood ABOVE the drawing, two lines of them under the way
    // back and a two-row toolbar: 293px of chrome over a plate 334px tall, smaller than a phone's.
    // ⚠ Beside the frame, never inside it: the frame is what the floating controls hang off.
    const side = document.createElement("div");
    side.className = "plate-side";
    // ★ ...and the key is fitted to the HEIGHT the column leaves it, not to its width alone: the column
    // is the plate's height (`.plate-side`, theme.css), the facts keep theirs, and the key's fold takes
    // what is left — from the top of its body to the foot of the column, less the fold's own padding.
    // Fitted to the width alone it stood 249px tall where it had 427 and still earned a scrollbar on
    // alternate opens (user report, 2026-10-15; the mechanism is in legendSheet.ts). Under a narrow
    // window the column is `display: contents`, has no box, and the stack scrolls as a page: no limit.
    const keyRoomH = (): number => {
      const foot = side.getBoundingClientRect().bottom;
      if (!(foot > 0)) return 0;
      const cs = getComputedStyle(keyFold.section);
      const below = (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
      return foot - keyFold.body.getBoundingClientRect().top - below;
    };
    const placePlateKey = () => placeLegend(citySvg, keySheet, true, LEGEND_ROW / CITY_LEGEND_ROW, 2,
      { minScale: PLATE_KEY_MIN_PX / CITY_LEGEND_TEXT, roomH: keyRoomH(), gutter: scrollbarWidth() });
    const keyFold = makeFold({
      title: t(lang, "legendPlate"), open: readFoldPref(CITY_KEY_FOLD_KEY, true),
      onToggle: (on) => {
        writeFoldPref(CITY_KEY_FOLD_KEY, on);
        // measured again now that it has a width — see the world key's fold
        if (on) placePlateKey();
      },
    });
    keyFold.section.classList.add("legend-fold");
    keyFold.body.appendChild(keySheet);
    // ㉗'s one size, arrived at from the other direction: the plate's key is drawn in 11-unit rows
    // because the plate is drawn big. Standing it at 1:1 would put an 11px row beside the world
    // map's 17px one on the same phone.
    placePlateKey();

    // ⚠ One watcher, dropped on the way out — see the leak note in showWorld.
    dropWidthWatch?.();
    const narrowNow = typeof matchMedia === "function" ? matchMedia(NARROW) : null;
    const replate = () => { if (openCityId === cityId) openCity(cityId, "none"); };
    narrowNow?.addEventListener("change", replate);
    dropWidthWatch = () => { narrowNow?.removeEventListener("change", replate); dropWidthWatch = null; };

    // what is said about the plate (plateFacts.ts), over the key, in the column made above
    const panel = plateFactsPanel(ws, marker, layout, lang, currentYearIndex, (id) => openCity(id));
    side.append(panel, keyFold.section);
    stage.append(frame, side);
    // ...and fitted again now that it stands in the page: the fit above ran before the card was in
    // the document, with no room to measure, so the plate's key came out a compact block (271px of
    // a 324px measure on a phone) where the world's spans its panel.
    placePlateKey();
    // ★ ...and once more when the web fonts land, if they have not yet: the fit measures the key's words,
    // and on a cold load it measured them in the fallback face — 129 units of two columns against 123 in
    // Gowun Batang, a 10.7px key that stood 11.1 the next time its fold was opened (1440x900, 2026-10-15).
    const fonts = document.fonts;
    if (fonts && fonts.status !== "loaded") {
      void fonts.ready.then(() => {
        if (openCityId === cityId && keySheet.isConnected && keyFold.section.classList.contains("is-open")) placePlateKey();
      });
    }
    // and sized by what the page actually spends around it, before its names are floored
    relayoutLabels = null;
    fitPlateChrome();
    worldZoom?.destroy(); worldZoom = null;
    cityZoom?.destroy();
    // the ward names hold their size here for the same reason the world's names do
    let cityRelayout = 0, cityScale = 1;
    // ★ The zoom's buttons go on the plate BEFORE its names are laid out, at the view it opens with, so
    // the names can keep out from under them: put on after, they stood on a road's destination on 7 of
    // 34 plates at 1440x900 (measured live, 2026-09-28). The view the reader had zoomed to, when the
    // plate is drawn again in place, comes back once the names are laid out.
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
    // the plan's own names have to be laid out too — it is in the document by now, so they can
    // be measured
    //
    // ★ Before they are laid out, they are sized for the window this plate actually got. The plate
    // takes whatever room is left, and its names are drawn in map units, so a small window shrinks
    // the lettering with the drawing: measured on a 390x844 phone, 336px across for 494 units put a
    // 7-unit ward name at 4.8px on screen — against 18px for the SAME word in the key standing
    // under it. Floored first, culled after, so `deconflictLabels` measures the names as they will
    // be read. A desktop plate is already past the floor (10.2px at 720px), so it is untouched.
    floorLabelSize(citySvg, ".ward-label, .road-end", PLATE_NAME_MIN_PX);
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
    // ...and where each road goes, beside its road where it leaves the plate, off the plate's own name —
    // and out from under what the page floats over it: the chips in one corner, the zoom in the other
    placeRoadEnds(citySvg, { clear: coveredBy(citySvg, frame.querySelectorAll(":scope > .focus-toggle, :scope > .rename-toggle, :scope > .map-zoom-controls")) });
    deconflictLabels(citySvg);
    if (restore) cityZoom.restore(restore);
    // ★ The keyboard goes with the reader. Opening a plate throws away the screen they were on — the
    // list row, the dot or the neighbour chip they pressed — and focus fell to <body>, so the next
    // Tab started over at the top of the page (measured live, 2026-09-25). It lands on the way back,
    // the plate's first control. A plate a link opened at load leaves focus where the page put it.
    if (record !== "replace" && focusLost()) backBtn.focus({ preventScroll: true });
  }

  /**
   * Make the world `p` and show it.
   *
   * ★ A new world is a place in the history. It used to take the old one's place in the address, so Back
   * left the site instead of returning to the world before — and with it every name the reader had given
   * there, since the names live in that address and nowhere else (measured live, 2026-10-08: renamed, then
   * "New world", and neither Back nor the same seed brought them back). So a reader's "new world" is pushed,
   * and Back (`how: "back"`, from popstate) rebuilds the world before from its address, names and all.
   * Leaving a world whose places were renamed asks first, and says how to come back.
   * @returns false when the reader chose to stay
   */
  function regenerate(p: WorldParams, how: "push" | "back" = "push", back?: { names: NameBook; title: string | null }): boolean {
    const another = !sameWorld(p, ws.params);
    const renamed = Object.keys(ws.names).length;
    if (another && how === "push" && renamed > 0 && !window.confirm(t(lang, "leaveRenamed").replace("{n}", String(renamed)))) return false;
    // a new world starts with its own names; the same world made again keeps the reader's
    const names = another ? back?.names ?? {} : ws.names;
    // a new seed is a new world, and it is not the one the reader named — unless it is the one they named,
    // come back to
    const title = back ? back.title : (p.seed !== hashStringToSeed(ws.title ?? "") ? null : ws.title);
    ws = makeWorldState(p, title, names);
    bar.showParams(ws.params);
    currentYearIndex = 0;
    // a new place in the history (showWorld then writes the same address over it)
    if (another && how === "push") window.history.pushState(null, "", "#" + worldHash(ws) + namesPart(ws));
    showWorld();
    return true;
  }

  regenBtn.addEventListener("click", () => {
    if (!regenerate({ ...ws.params, seed: Number(seedInput.value) })) seedInput.value = String(ws.params.seed);
  });
  randomBtn.addEventListener("click", () => regenerate({ ...ws.params, seed: randomSeed() }));
  jsonBtn.addEventListener("click", () => files.writeJson());
  pngBtn.addEventListener("click", () => files.ask(pngBtn, files.writePng));
  svgBtn.addEventListener("click", () => files.ask(svgBtn, files.writeSvg));
  gazBtn.addEventListener("click", () => files.writeGazetteer());

  // follow the browser: Back off a plate returns to the world, Forward opens it again
  window.addEventListener("popstate", () => {
    // a screen that has been taken out of the document does not answer the browser any more
    if (!root.isConnected) return;
    // ...and Back past a new world is the world before it, made again from its address as it was left: its
    // dials, its names, and the name it was asked for
    if (location.hash.length > 1) {
      const there = initialParams(location.hash);
      if (!sameWorld(there, ws.params)) {
        regenerate(there, "back", { names: initialNames(location.hash), title: initialSeedName(location.hash) });
      }
    }
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
