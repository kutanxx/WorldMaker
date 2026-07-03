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
import { politicalLayer } from "./politicalLayer";
import { cultureLayer } from "./cultureLayer";
import { type Lang, t } from "./i18n";

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
  let currentYearIndex = 0;
  let currentView: MapView = "terrain";
  let lang: Lang = "en";
  let openCityId: number | null = null; // which screen is showing (null = world)

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
  viewToggle.append(terrainBtn, politicalBtn, cultureBtn);
  controls.append(seedInput, regenBtn, randomBtn, jsonBtn, pngBtn, svgBtn, gazBtn, viewToggle, langBtn);

  // set every UI string from the current language (called on init and on language toggle)
  function applyLang(): void {
    regenBtn.textContent = t(lang, "generate");
    randomBtn.textContent = "🎲 " + t(lang, "randomSeed");
    jsonBtn.textContent = t(lang, "exportJson");
    pngBtn.textContent = t(lang, "exportPng");
    svgBtn.textContent = t(lang, "exportSvg");
    gazBtn.textContent = "📜 " + t(lang, "gazetteer");
    terrainBtn.textContent = t(lang, "terrain");
    politicalBtn.textContent = t(lang, "political");
    cultureBtn.textContent = t(lang, "culture");
    langBtn.textContent = t(lang, "langToggle");
  }
  applyLang();
  langBtn.addEventListener("click", () => {
    lang = lang === "en" ? "ko" : "en";
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

  function showWorld(): void {
    openCityId = null;
    timeline?.destroy();
    stage.innerHTML = "";
    terrainBtn.classList.toggle("active", currentView === "terrain");
    politicalBtn.classList.toggle("active", currentView === "political");
    cultureBtn.classList.toggle("active", currentView === "culture");
    const svg = renderWorld(generated.world, currentView, history.economicZones.map((z) => z.cell), lang);
    svg.addEventListener("click", (e) => {
      const target = e.target as Element;
      const id = target.getAttribute("data-city");
      if (id !== null && id !== "") openCity(Number(id));
    });
    stage.appendChild(svg);

    const chronicle = renderChronicle(history);
    const slot = svg.querySelector(".political-slot") as SVGGElement;
    const world = generated.world;
    const renderYear = (index: number): void => {
      currentYearIndex = index;
      const snap = history.snapshots[index];
      if (currentView === "culture") {
        slot.replaceChildren(cultureLayer(world.grid, world.cultureOf, world.cultures)); // time-independent
      } else {
        slot.replaceChildren(politicalLayer(world.grid, snap.owner, history.polities, politicalOpts(currentView)));
      }
      applyChronicleYear(chronicle, snap.year);
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
    stage.append(back, renderCity(layout, lang));
  }

  function regenerate(p: WorldParams): void {
    params = { ...p };
    seedInput.value = String(params.seed);
    generated = generateWorld(params);
    history = simulateHistory(generated.world, params.seed);
    currentYearIndex = 0;
    showWorld();
  }

  // Export the world at the year + view the timeline is currently showing.
  function exportWorldSvg(): SVGSVGElement {
    const svg = renderWorld(generated.world, currentView, history.economicZones.map((z) => z.cell), lang);
    if (currentView !== "culture") { // culture layer is static; renderWorld already mounted it
      const slot = svg.querySelector(".political-slot") as SVGGElement;
      const snap = history.snapshots[currentYearIndex];
      slot.replaceChildren(politicalLayer(generated.world.grid, snap.owner, history.polities, politicalOpts(currentView)));
    }
    return svg;
  }

  regenBtn.addEventListener("click", () => regenerate({ ...params, seed: Number(seedInput.value) }));
  randomBtn.addEventListener("click", () => regenerate({ ...params, seed: randomSeed() }));
  jsonBtn.addEventListener("click", () =>
    downloadBlob("world.json", new Blob([worldToJSON(generated.world)], { type: "application/json" }))
  );
  pngBtn.addEventListener("click", async () => {
    try {
      const blob = await svgToPngBlob(exportWorldSvg(), params.width, params.height);
      downloadBlob("world.png", blob);
    } catch (e) {
      console.error("PNG export failed", e);
    }
  });
  svgBtn.addEventListener("click", () => {
    downloadBlob("world.svg", new Blob([svgToString(exportWorldSvg())], { type: "image/svg+xml" }));
  });
  gazBtn.addEventListener("click", () => {
    const md = worldToGazetteer(generated.world, history);
    const fname = (generated.world.name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "gazetteer") + ".md";
    downloadBlob(fname, new Blob([md], { type: "text/markdown" }));
  });

  showWorld();
  return { regenerate, openCity, showWorld };
}
