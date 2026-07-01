import type { WorldParams, GeneratedWorld } from "../types/world";
import { DEFAULT_PARAMS } from "../types/world";
import { generateWorld } from "../engine/world";
import { renderWorld } from "./svgWorldRenderer";
import { renderCity } from "./svgCityRenderer";
import { generateCityLayout, cityContext } from "../engine/city";
import { encodeParams } from "./urlState";
import { worldToJSON, svgToString, svgToPngBlob, downloadBlob } from "./export";
import { simulateHistory } from "../engine/history";
import { renderChronicle } from "./chronicle";

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
    stage.innerHTML = "";
    const svg = renderWorld(generated.world);
    svg.addEventListener("click", (e) => {
      const target = e.target as Element;
      const id = target.getAttribute("data-city");
      if (id !== null && id !== "") openCity(Number(id));
    });
    stage.appendChild(svg);
    stage.appendChild(renderChronicle(history));
    location.hash = encodeParams(params).slice(1);
  }

  function openCity(cityId: number): void {
    const marker = generated.world.cities.find((c) => c.id === cityId);
    if (!marker) return;
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

  regenBtn.addEventListener("click", () => regenerate({ ...params, seed: Number(seedInput.value) }));
  jsonBtn.addEventListener("click", () =>
    downloadBlob("world.json", new Blob([worldToJSON(generated.world)], { type: "application/json" }))
  );
  pngBtn.addEventListener("click", async () => {
    try {
      const svg = renderWorld(generated.world);
      const blob = await svgToPngBlob(svg, params.width, params.height);
      downloadBlob("world.png", blob);
    } catch (e) {
      console.error("PNG export failed", e);
    }
  });
  svgBtn.addEventListener("click", () => {
    const svg = renderWorld(generated.world);
    downloadBlob("world.svg", new Blob([svgToString(svg)], { type: "image/svg+xml" }));
  });

  showWorld();
  return { regenerate, openCity, showWorld };
}
