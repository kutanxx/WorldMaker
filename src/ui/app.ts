import type { WorldParams, GeneratedWorld } from "../types/world";
import { DEFAULT_PARAMS } from "../types/world";
import { generateWorld } from "../engine/world";
import { renderWorld, politicalOpts, type MapView } from "./svgWorldRenderer";
import { renderCity } from "./svgCityRenderer";
import { generateCityLayout, cityContext } from "../engine/city";
import { encodeParams, randomSeed } from "./urlState";
import { worldToJSON, svgToString, svgToPngBlob, downloadBlob } from "./export";
import { simulateHistory } from "../engine/history";
import { renderChronicle, applyChronicleYear } from "./chronicle";
import { createTimeline, type Timeline } from "./timeline";
import { politicalLayer } from "./politicalLayer";

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

  const seedInput = document.createElement("input");
  seedInput.type = "number";
  seedInput.value = String(params.seed);
  const regenBtn = document.createElement("button");
  regenBtn.textContent = "Generate";
  const randomBtn = document.createElement("button");
  randomBtn.className = "random-seed";
  randomBtn.textContent = "🎲 랜덤 시드";
  const jsonBtn = document.createElement("button");
  jsonBtn.textContent = "Export JSON";
  const pngBtn = document.createElement("button");
  pngBtn.textContent = "Export PNG";
  const svgBtn = document.createElement("button");
  svgBtn.textContent = "Export SVG";
  const viewToggle = document.createElement("div");
  viewToggle.className = "view-toggle";
  const terrainBtn = document.createElement("button");
  terrainBtn.textContent = "지형";
  const politicalBtn = document.createElement("button");
  politicalBtn.textContent = "정치";
  viewToggle.append(terrainBtn, politicalBtn);
  controls.append(seedInput, regenBtn, randomBtn, jsonBtn, pngBtn, svgBtn, viewToggle);

  function setView(v: MapView): void {
    if (v === currentView) return;
    currentView = v;
    showWorld(); // re-render at the current year in the new view
  }
  terrainBtn.addEventListener("click", () => setView("terrain"));
  politicalBtn.addEventListener("click", () => setView("political"));

  function showWorld(): void {
    timeline?.destroy();
    stage.innerHTML = "";
    terrainBtn.classList.toggle("active", currentView === "terrain");
    politicalBtn.classList.toggle("active", currentView === "political");
    const svg = renderWorld(generated.world, currentView, history.economicZones.map((z) => z.cell));
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
      slot.replaceChildren(politicalLayer(world.grid, snap.owner, history.polities, politicalOpts(currentView)));
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
    timeline?.destroy();
    stage.innerHTML = "";
    const back = document.createElement("button");
    back.textContent = "Back to world";
    back.addEventListener("click", showWorld);
    const layout = generateCityLayout(cityContext(marker), params.seed);
    stage.append(back, renderCity(layout));
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
    const svg = renderWorld(generated.world, currentView, history.economicZones.map((z) => z.cell));
    const slot = svg.querySelector(".political-slot") as SVGGElement;
    const snap = history.snapshots[currentYearIndex];
    slot.replaceChildren(politicalLayer(generated.world.grid, snap.owner, history.polities, politicalOpts(currentView)));
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

  showWorld();
  return { regenerate, openCity, showWorld };
}
