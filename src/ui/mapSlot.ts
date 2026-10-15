/**
 * What goes in the map's overlay slot for a given view and year. One place decides, because it used to be
 * two and they had drifted: the export path replaced the slot with a political layer for EVERY view that
 * was not culture, so exporting the province view produced a map with no provinces in it — and the
 * province key that renderWorld draws never survived to the screen, because the timeline rebuilt the layer
 * without it a moment later. (Out of createApp's closure, 2026-10-15: the screen and the export both call it.)
 */
import type { WorldState } from "./worldState";
import { politicalOpts, type MapView, type MapStyle } from "./svgWorldRenderer";
import { politicalLayer, keepOffOf } from "./politicalLayer";
import { cultureLayer } from "./cultureLayer";
import { provinceLayer, snapOwnersToProvinces } from "./provinceLayer";
import { settlementKeyRows } from "./settlementKey";
import { inkSlot } from "./inkStyle";
import { polityLabeller } from "./properName";
import type { Lang } from "./i18n";

export function fillSlot(slot: SVGGElement, view: MapView, yearIndex: number, ws: WorldState, lang: Lang, style: MapStyle): void {
  const world = ws.generated.world;
  const snap = ws.history.snapshots[yearIndex];
  // every key ends with the marks drawn over the ground, as renderWorld's own do (settlementKey.ts)
  const freePorts = ws.history.economicZones.length > 0;
  if (view === "culture") {
    slot.replaceChildren(cultureLayer(world.grid, world.cultureOf, world.cultures, lang, settlementKeyRows(lang, freePorts))); // time-independent
  } else if (view === "province") {
    // provinces are geography (time-independent); nation borders track the scrubbed year via snap.owner
    slot.replaceChildren(provinceLayer(world.grid, world.provinceOf, world.provinces, { owner: snap.owner, colorOf: ws.colorOf, legend: true, lang, roads: world.roads.length > 0, seaRoutes: (world.seaRoutes?.length ?? 0) > 0, keyRows: settlementKeyRows(lang, freePorts) }));
  } else {
    // nation ownership snapped to whole provinces so terrain/political borders match the province view
    const snapped = snapOwnersToProvinces(world.grid.count, world.provinceOf, world.provinces, snap.owner, ws.freeRealms);
    slot.replaceChildren(politicalLayer(world.grid, snapped, ws.history.polities, politicalOpts(view, lang, ws.colorOf, polityLabeller(lang, ws.governmentForms), freePorts, keepOffOf(world.grid.points, world.roads, world.cities))));
  }
  // the year's layer arrives in its colours; on an ink map it goes into ink with the rest
  if (style === "ink") inkSlot(slot, lang);
}
