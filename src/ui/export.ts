import type { World } from "../types/world";
import type { History } from "../engine/history";
import { buildDynasties } from "../engine/dynasty";
import { naturalHistory } from "../engine/naturalHistory";

/**
 * The world, and the history that happened to it.
 *
 * This used to serialize `world` alone: geography, cultures, provinces, rivers and the EIGHT realms
 * of year zero, with no snapshots, no events and no rulers. A reader taking their world into their
 * own tool lost five centuries and was never told. The map export carries the scrubbed year and the
 * gazetteer carries the whole chronicle, so a JSON without the history made the three exports tell
 * three different stories.
 *
 * Structural, not narrated: the chronicle's SENTENCES are language-bound and belong to the
 * gazetteer, so what travels here is the data they are rendered from — including the natural
 * history, which is invented at render time and would otherwise be the one part of the story the
 * machine-readable export could not reach.
 *
 * `history` is optional so a world can still be dumped on its own.
 */
export function worldToJSON(world: World, history?: History): string {
  if (!history) return JSON.stringify(world);
  const dynasties: Record<number, unknown> = {};
  for (const [id, reigns] of buildDynasties(world, history)) dynasties[id] = reigns;
  return JSON.stringify({
    ...world,
    history: {
      years: history.years,
      polities: history.polities,
      events: history.events,
      economicZones: history.economicZones,
      cityFoundings: history.cityFoundings,
      // typed arrays serialize as objects keyed by index; a plain array is what a consumer expects
      snapshots: history.snapshots.map((s) => ({ year: s.year, owner: [...s.owner] })),
      dynasties,
      naturalHistory: naturalHistory(world, history, "en")
        .map(({ year, kind, cityId, polityId }) => ({ year, kind, cityId, polityId })),
    },
  });
}

export function svgToString(svg: SVGSVGElement): string {
  return new XMLSerializer().serializeToString(svg);
}

export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function svgToPngBlob(svg: SVGSVGElement, width: number, height: number): Promise<Blob> {
  const data = svgToString(svg);
  const svgBlob = new Blob([data], { type: "image/svg+xml" });
  const url = URL.createObjectURL(svgBlob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no 2d context"));
      ctx.scale(dpr, dpr);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("svg image load failed"));
    };
    img.src = url;
  });
}
