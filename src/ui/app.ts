import type { WorldParams, GeneratedWorld } from "../types/world";
import { DEFAULT_PARAMS } from "../types/world";
import { generateWorld } from "../engine/world";
import { renderWorld, politicalOpts, type MapView } from "./svgWorldRenderer";
import { renderCity } from "./svgCityRenderer";
import { generateCityLayout, cityContext } from "../engine/city";
import { encodeParams, randomSeed } from "./urlState";
import { worldToJSON, svgToString, svgToPngBlob, downloadBlob } from "./export";
import { worldToGazetteer } from "../engine/gazetteer";
import { simulateHistory } from "../engine/history";
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

export interface App {
  regenerate(p: WorldParams): void;
  openCity(cityId: number): void;
  showWorld(): void;
}


export function createApp(root: HTMLElement, initial: WorldParams = DEFAULT_PARAMS): App {
  root.innerHTML = "";

  const controls = document.createElement("div");
  controls.className = "controls";
  const stage = document.createElement("div");
  stage.className = "stage";
  root.append(controls, stage);

  let params: WorldParams = { ...initial };
  let generated: GeneratedWorld = generateWorld(params);
  let history = simulateHistory(generated.world, params.seed);
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
  const seedInput = document.createElement("input");
  seedInput.type = "number";
  seedInput.value = String(params.seed);
  const regenBtn = document.createElement("button");
  const randomBtn = document.createElement("button");
  randomBtn.className = "random-seed";
  const jsonBtn = document.createElement("button");
  const pngBtn = document.createElement("button");
  const svgBtn = document.createElement("button");
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
  controls.append(homeBtn, seedInput, regenBtn, randomBtn, jsonBtn, pngBtn, svgBtn, gazBtn, viewToggle, langBtn);

  // set every UI string from the current language (called on init and on language toggle)
  function applyLang(): void {
    homeBtn.textContent = t(lang, "home");
    regenBtn.textContent = t(lang, "generate");
    randomBtn.textContent = "🎲 " + t(lang, "randomSeed");
    jsonBtn.textContent = t(lang, "exportJson");
    pngBtn.textContent = t(lang, "exportPng");
    svgBtn.textContent = t(lang, "exportSvg");
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

  function showWorld(): void {
    openCityId = null;
    timeline?.destroy();
    stage.innerHTML = "";
    terrainBtn.classList.toggle("active", currentView === "terrain");
    politicalBtn.classList.toggle("active", currentView === "political");
    cultureBtn.classList.toggle("active", currentView === "culture");
    provinceBtn.classList.toggle("active", currentView === "province");
    const svg = renderWorld(generated.world, currentView, history.economicZones.map((z) => z.cell), lang);
    svg.addEventListener("click", (e) => {
      const target = e.target as Element;
      const id = target.getAttribute("data-city");
      if (id !== null && id !== "") openCity(Number(id));
    });
    const frame = document.createElement("div");
    frame.className = "map-frame";
    frame.appendChild(svg);
    stage.appendChild(frame);
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

    const chronicle = renderChronicle(history, lang);
    const slot = svg.querySelector(".political-slot") as SVGGElement;
    const world = generated.world;
    const renderYear = (index: number): void => {
      currentYearIndex = index;
      const snap = history.snapshots[index];
      if (currentView === "culture") {
        slot.replaceChildren(cultureLayer(world.grid, world.cultureOf, world.cultures)); // time-independent
      } else if (currentView === "province") {
        // provinces are geography (time-independent); nation borders track the scrubbed year via snap.owner
        slot.replaceChildren(provinceLayer(world.grid, world.provinceOf, world.provinces, { owner: snap.owner }));
      } else {
        // nation ownership snapped to whole provinces so terrain/political borders match the province view
        const snapped = snapOwnersToProvinces(world.grid.count, world.provinceOf, world.provinces, snap.owner);
        slot.replaceChildren(politicalLayer(world.grid, snapped, history.polities, politicalOpts(currentView)));
      }
      applyChronicleYear(chronicle, snap.year);
      // Scrubbing a year replaces the political layer, so its labels arrive at their base size.
      // Bring them to whatever zoom the reader is at before working out what fits, or a nation's
      // name would come back full-size on a map zoomed to 8x.
      const z = worldZoom?.scale() ?? 1;
      applyLabelScale(svg, z);
      applyMarkerScale(svg, z);
      deconflictLabels(svg, z); // hide colliding lower-priority labels, and those the zoom has not earned yet
    };

    timeline = createTimeline(history, renderYear);
    stage.append(timeline.element, chronicle);
    timeline.setIndex(currentYearIndex); // renders the current year in the current view
    location.hash = encodeParams(params).slice(1);
  }

  function openCity(cityId: number): void {
    const marker = generated.world.cities.find((c) => c.id === cityId);
    if (!marker) return;
    openCityId = cityId;
    timeline?.destroy();
    stage.innerHTML = "";
    const back = document.createElement("button");
    back.textContent = "← " + t(lang, "backToWorld");
    back.addEventListener("click", showWorld);
    const layout = generateCityLayout(cityContext(marker), params.seed);
    const citySvg = renderCity(layout, lang);
    const frame = document.createElement("div");
    frame.className = "map-frame";
    frame.appendChild(citySvg);
    stage.append(back, frame);
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
    generated = generateWorld(params);
    history = simulateHistory(generated.world, params.seed);
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
    const svg = renderWorld(generated.world, currentView, history.economicZones.map((z) => z.cell), lang);
    if (currentView !== "culture") { // culture layer is static; renderWorld already mounted it
      const slot = svg.querySelector(".political-slot") as SVGGElement;
      const snap = history.snapshots[currentYearIndex];
      slot.replaceChildren(politicalLayer(generated.world.grid, snap.owner, history.polities, politicalOpts(currentView)));
    }
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
    downloadBlob("world.json", new Blob([worldToJSON(generated.world)], { type: "application/json" }))
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

  showWorld();
  return { regenerate, openCity, showWorld };
}
