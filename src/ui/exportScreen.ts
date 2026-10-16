/**
 * The files: what a reader means by "export" is the map in front of them — the world at the year and view
 * the scrubber is showing, the whole of it or the region they zoomed to on its own page, or the town plate
 * they are looking at; and the world's data and gazetteer. Out of createApp's closure (design review
 * 2026-10-15), with the screen handed in as getters: the state is the app's, the files are made here.
 */
import type { WorldState } from "./worldState";
import { fileStem, plateOf, townNameOf, townsIn, unfoundedAt } from "./worldState";
import { renderWorld, type MapView, type MapStyle } from "./svgWorldRenderer";
import { renderCity, fitTitle } from "./svgCityRenderer";
import { fillSlot } from "./mapSlot";
import { worldToJSON, svgToString, svgToPngBlob, downloadBlob } from "./export";
import { worldToGazetteer } from "../engine/gazetteer";
import { forPrint } from "./inkStyle";
import { layOutLabelsForExport } from "./exportLabels";
import { type Page, pageOf, putOnPage, fitRiverNames } from "./regionPage";
import { clearMarks, clearCastleName, placeRoadEnds } from "./deconflict";
import { KM_PER_UNIT } from "./scaleBar";
import { polityLabeller, properName } from "./properName";
import { worldNameIn } from "../engine/featureLabel";
import { t, type Lang } from "./i18n";
import type { ZoomPan } from "./zoomPan";

export interface ExportCtx {
  /** the app's root (`export-choosing` goes on it while the menu is open) and the bar's export group (its busy state, the menu) */
  root: HTMLElement;
  exportGroup: HTMLElement;
  ws: () => WorldState;
  lang: () => Lang;
  view: () => MapView;
  style: () => MapStyle;
  yearIndex: () => number;
  /** which screen is showing: a town's id, or null for the world */
  openCityId: () => number | null;
  worldZoom: () => ZoomPan | null;
}

/** a file's drawing: carries its own name and pixel size, since a city's proportions are nothing like the world's */
export interface ScreenExport { svg: SVGSVGElement; name: string; width: number; height: number }

export interface Exporter {
  writeJson(): void;
  writeGazetteer(): void;
  writePng(page?: Page): Promise<void>;
  writeSvg(page?: Page): Promise<void>;
  /** zoomed in on the world, ask whether the file is the whole map or the part on screen; else write it */
  ask(trigger: HTMLButtonElement, write: (page?: Page) => void): void;
  closeChoice(): void;
}

// A world map's PNG is for print, in colour or in ink: 3000px across, ten inches at 300dpi, whether it holds
// the whole map or a region of it (regionPage.ts). The screen's own 1000 came out 8.5cm wide in print.
const PRINT_PX = 3000;
const CITY_PNG_SCALE = 2;   // a city is drawn small; at 1:1 its 7px ward names come out unreadable

export function createExporter(ctx: ExportCtx): Exporter {
  const { root, exportGroup } = ctx;

  function exportScreenSvg(page?: Page): ScreenExport {
    const ws = ctx.ws(), lang = ctx.lang(), world = ws.generated.world;
    const openCityId = ctx.openCityId();
    if (openCityId !== null) {
      const marker = world.cities.find((c) => c.id === openCityId);
      if (marker) {
        const svg = renderCity(plateOf(ws, marker), lang, { townName: townNameOf(ws) });
        layOutLabelsForExport(svg, (s) => { fitTitle(s); clearMarks(s); clearCastleName(s); placeRoadEnds(s); });
        const [, , w, h] = (svg.getAttribute("viewBox") || "0 0 1000 700").split(/[\s,]+/).map(Number);
        return {
          svg, name: fileStem([worldNameIn(world, lang), properName(lang, marker.name)]),
          width: Math.round(w * CITY_PNG_SCALE), height: Math.round(h * CITY_PNG_SCALE),
        };
      }
    }
    // ...and the world's file says what is not the map's first: the view, the year, the ink, a region
    const view = ctx.view(), style = ctx.style();
    const year = ws.history.snapshots[ctx.yearIndex()]?.year ?? 0;
    return {
      svg: exportWorldSvg(page),
      name: fileStem([
        worldNameIn(world, lang),
        view !== "terrain" && t(lang, view),
        year > 0 && t(lang, "year").replace("{y}", String(year)),
        style === "ink" && t(lang, "inkToggle"),
        style === "sepia" && t(lang, "sepiaToggle"),
        page && t(lang, "fileRegion"),
      ]),
      width: PRINT_PX, height: Math.round((PRINT_PX * ws.params.height) / ws.params.width),
    };
  }

  // Export the world at the year + view the timeline is currently showing — the whole of it, or the region
  // of it the reader had zoomed to, on its own page (regionPage.ts).
  function exportWorldSvg(page?: Page): SVGSVGElement {
    const ws = ctx.ws(), lang = ctx.lang(), view = ctx.view(), style = ctx.style(), yearIndex = ctx.yearIndex();
    const world = ws.generated.world;
    const svg = renderWorld(world, view, ws.history.economicZones.map((z) => z.cell), lang, unfoundedAt(ws, yearIndex), ws.colorOf, polityLabeller(lang, ws.governmentForms), style, page, townsIn(ws, yearIndex, lang).at);
    fillSlot(svg.querySelector(".political-slot") as SVGGElement, view, yearIndex, ws, lang, style);
    if (page) putOnPage(svg, page, world, lang);
    // This is a fresh render that has never been in the document, so its labels have never been laid
    // out against each other — left alone, every name in the world goes into the file, stacked.
    // (on a region's page, a river's name that would run past the edge moves along the river first)
    layOutLabelsForExport(svg, page ? (s) => fitRiverNames(s, page, world.rivers) : undefined, page?.z ?? 1);
    // what each name names is for renaming on the screen, not for the file
    for (const el of svg.querySelectorAll("[data-name]")) el.removeAttribute("data-name");
    return svg;
  }

  // The embedded Cinzel woff2 (~20 KB) is only needed when exporting, so it lives in a lazy chunk —
  // keeps the initial map bundle lean for the majority who never export.
  async function exportScreenSvgWithFonts(page?: Page): Promise<ScreenExport> {
    const out = exportScreenSvg(page);
    const { embedExportFonts } = await import("./exportFont");
    embedExportFonts(out.svg); // standalone SVG/PNG carry the Cinzel display face (no external stylesheet)
    return out;
  }

  /**
   * One file at a time, and the page says one is on its way. A PNG takes seconds to draw — measured live,
   * 1.5-1.8s for the whole map and 3.4s for a region in ink — and nothing on the page moved meanwhile, so a
   * reader who pressed again got the file twice. The busy look is let onto the screen before the drawing
   * starts, since the first of that drawing holds the page.
   */
  let writing = false;
  const oneFileAtATime = async (write: () => Promise<void>): Promise<void> => {
    if (writing) return;
    writing = true;
    exportGroup.setAttribute("aria-busy", "true");
    exportGroup.classList.add("busy");
    try {
      await new Promise<void>((r) => setTimeout(r, 40));
      await write();
    } finally {
      writing = false;
      exportGroup.removeAttribute("aria-busy");
      exportGroup.classList.remove("busy");
    }
  };
  const writePng = (page?: Page) => oneFileAtATime(async () => {
    try {
      const world = ctx.openCityId() === null;
      const { svg, name, width, height } = await exportScreenSvgWithFonts(page);
      // a world map's PNG is drawn PRINT_PX across (exportScreenSvg), and its screen-pinned lines with it —
      // the SVG is vector and keeps them as drawn
      if (world) forPrint(svg, width / ctx.ws().params.width);
      downloadBlob(`${name}.png`, await svgToPngBlob(svg, width, height));
    } catch (e) {
      console.error("PNG export failed", e);
    }
  });
  const writeSvg = (page?: Page) => oneFileAtATime(async () => {
    const { svg, name } = await exportScreenSvgWithFonts(page);
    downloadBlob(`${name}.svg`, new Blob([svgToString(svg)], { type: "image/svg+xml" }));
  });

  /**
   * Zoomed in on the world map, a file can be the whole map or the part on screen — a region for a book's
   * chapter — and the reader is asked which: FMG writes the visible part without asking, and a reader who
   * expected the whole map got part of it. Not zoomed in, or on a town's plate, there is nothing to ask and
   * the file is written as it always was.
   */
  let exportChoice: { menu: HTMLElement; trigger: HTMLButtonElement; away: (e: Event) => void } | null = null;
  function closeChoice(): void {
    if (!exportChoice) return;
    const { menu, trigger, away } = exportChoice;
    exportChoice = null;
    document.removeEventListener("pointerdown", away, true);
    trigger.setAttribute("aria-expanded", "false");
    menu.remove();
    root.classList.remove("export-choosing");
  }
  function ask(trigger: HTMLButtonElement, write: (page?: Page) => void): void {
    closeChoice();
    const lang = ctx.lang(), zoom = ctx.worldZoom();
    const page = ctx.openCityId() === null && zoom ? pageOf(zoom.viewBox(), ctx.ws().params.width) : null;
    if (!page) { write(); return; }
    const menu = document.createElement("div");
    menu.className = "export-choice";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", t(lang, "exportChoice"));
    const item = (scope: "whole" | "visible", label: string, detail?: string) => {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.dataset.scope = scope;
      b.textContent = label;
      if (detail) {
        const size = document.createElement("span");
        size.className = "export-choice-size";
        size.textContent = detail;
        b.append(size);
      }
      b.addEventListener("click", () => { closeChoice(); trigger.focus(); write(scope === "visible" ? page : undefined); });
      return b;
    };
    // how much ground the part on screen holds, which is what tells it from the whole
    const km = `${Math.round(page.w * KM_PER_UNIT)}×${Math.round(page.h * KM_PER_UNIT)} km`;
    menu.append(item("whole", t(lang, "exportWhole")), item("visible", t(lang, "exportVisible"), km));
    const items = [...menu.querySelectorAll<HTMLButtonElement>("button")];
    menu.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); closeChoice(); trigger.focus(); return; }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus();
    });
    // it closes as a menu does: elsewhere pressed, or the keyboard gone on to something else
    menu.addEventListener("focusout", (e) => { if (e.relatedTarget && !menu.contains(e.relatedTarget as Node)) closeChoice(); });
    const away = (e: Event) => { if (!menu.contains(e.target as Node)) closeChoice(); };
    document.addEventListener("pointerdown", away, true);
    exportGroup.appendChild(menu);
    // the map's chips stand in the corner the menu drops onto (theme.css .export-choosing): they step aside
    root.classList.add("export-choosing");
    trigger.setAttribute("aria-expanded", "true");
    exportChoice = { menu, trigger, away };
    items[0].focus();
  }

  return {
    writeJson() {
      const ws = ctx.ws(), lang = ctx.lang();
      downloadBlob(`${fileStem([worldNameIn(ws.generated.world, lang)])}.json`, new Blob([worldToJSON(ws.generated.world, ws.history)], { type: "application/json" }));
    },
    writeGazetteer() {
      // The exported document follows the language the user is reading the app in — a Korean
      // session was producing an English gazetteer with Korean chronicle lines inside it.
      const ws = ctx.ws(), lang = ctx.lang();
      const md = worldToGazetteer(ws.generated.world, ws.history, lang);
      downloadBlob(`${fileStem([worldNameIn(ws.generated.world, lang)])}.md`, new Blob([md], { type: "text/markdown" }));
    },
    writePng, writeSvg, ask, closeChoice,
  };
}
