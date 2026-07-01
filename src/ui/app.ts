import type { WorldParams, GeneratedWorld } from "../types/world";
import { DEFAULT_PARAMS } from "../types/world";
import { generateWorld } from "../engine/world";
import { renderWorld } from "./svgWorldRenderer";
import { renderCity } from "./svgCityRenderer";
import { generateCityLayout, cityContext } from "../engine/city";
import { encodeParams } from "./urlState";
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

  const seedInput = document.createElement("input");
  seedInput.type = "number";
  seedInput.value = String(params.seed);
  const regenBtn = document.createElement("button");
  regenBtn.textContent = "Generate";
  const jsonBtn = document.createElement("button");
  jsonBtn.textContent = "Export JSON";
  const pngBtn = document.createElement("button");
  pngBtn.textContent = "Export PNG";
  const svgBtn = document.createElement("button");
  svgBtn.textContent = "Export SVG";
  controls.append(seedInput, regenBtn, jsonBtn, pngBtn, svgBtn);

  function showWorld(): void {
    timeline?.destroy();
    stage.innerHTML = "";
    const svg = renderWorld(generated.world);
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
      slot.replaceChildren(politicalLayer(world.grid, snap.owner, history.polities));
      applyChronicleYear(chronicle, snap.year);
    };

    timeline = createTimeline(history, renderYear);
    stage.append(timeline.element, chronicle);
    renderYear(0);
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
    showWorld();
  }

  // Export the world at the year the timeline is currently showing (not always year 0).
  function exportWorldSvg(): SVGSVGElement {
    const svg = renderWorld(generated.world);
    const slot = svg.querySelector(".political-slot") as SVGGElement;
    const snap = history.snapshots[currentYearIndex];
    slot.replaceChildren(politicalLayer(generated.world.grid, snap.owner, history.polities));
    return svg;
  }

  regenBtn.addEventListener("click", () => regenerate({ ...params, seed: Number(seedInput.value) }));
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
