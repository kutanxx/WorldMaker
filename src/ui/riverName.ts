// Where a river's name stands — the world map sets it at the river's middle (svgWorldRenderer.ts), and a
// region's page again where the river crosses it (regionPage.ts).

/** A river's name size: between the settlements' and the regions', larger for more water. */
export const riverNameSize = (flux: number): number => 9 + Math.min(3, flux / 60);

/**
 * A river's name at point `i` of its course: lifted half its size off the water toward the upper side and
 * turned along the flow — the hydrographic convention — never upside-down.
 */
export function riverNameAt(path: [number, number][], i: number, fs: number): { x: number; y: number; deg: number } {
  const mid = path[i];
  const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (deg > 90) deg -= 180; else if (deg < -90) deg += 180; // keep it readable
  // offset perpendicular to the flow, toward the upper side
  let nx = -dy / len, ny = dx / len; if (ny > 0) { nx = -nx; ny = -ny; }
  return { x: mid[0] + nx * fs * 0.5, y: mid[1] + ny * fs * 0.5, deg };
}
