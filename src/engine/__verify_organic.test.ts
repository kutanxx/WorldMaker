import { it } from "vitest";
import { generateCityLayout, cityContext } from "./city";
import type { CityMarker } from "../types/world";

const mk = (over: Partial<CityMarker>): CityMarker => ({
  id: 2, cell: 0, x: 0, y: 0, name: "Veritown",
  polityId: 0, isCapital: true, size: 4, coastal: false, elevation: 0.5, ...over,
});

function curvaturePct(road: [number, number][]): number {
  if (road.length < 3) return 0;
  const a = road[0], b = road[road.length - 1];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  let m = 0;
  for (const p of road) {
    const d = Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len;
    if (d > m) m = d;
  }
  return (m / len) * 100;
}

it("VERIFY organic city metrics", () => {
  const rows: string[] = [];
  const cfgs: [string, Partial<CityMarker>][] = [
    ["coastal cap   ", { coastal: true, elevation: 0.4 }],
    ["inland plains ", { coastal: false, elevation: 0.45 }],
    ["hill fortress ", { coastal: false, elevation: 0.8 }],
    ["inland town   ", { coastal: false, elevation: 0.5, isCapital: false, size: 3 }],
  ];
  for (const [label, over] of cfgs) {
    for (const seed of [3, 7]) {
      const l = generateCityLayout(cityContext(mk(over)), seed);
      const rs = l.boundary.map((p) => Math.hypot(p[0] - 150, p[1] - 150));
      const radVar = (Math.max(...rs) / Math.min(...rs)).toFixed(2);
      const maxCurv = Math.max(0, ...l.mainRoads.map(curvaturePct)).toFixed(0);
      const segs = l.wall ? l.wall.segments.length : 0;
      const seaG = l.wall ? l.wall.seaGates.length : 0;
      const blds = l.wards.reduce((n, w) => n + w.buildings.length, 0);
      const moat = l.moat ? l.moat.length : 0;
      rows.push(
        `${label} s${seed} | arch=${l.archetype.id.padEnd(14)} radVar=${radVar} ` +
        `curv%=${maxCurv.padStart(3)} wallSeg=${segs} seaGate=${seaG} moat=${moat} bldgs=${blds}`
      );
    }
  }
  console.log("\n===== ORGANIC CITY VERIFY =====\n" + rows.join("\n") + "\n===============================");
});
