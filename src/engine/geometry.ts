export type Point = [number, number];
export type Polygon = Point[];
export type Segment = [Point, Point];
export type Polyline = Point[];

export function signedArea(p: Polygon): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function area(p: Polygon): number {
  return Math.abs(signedArea(p));
}

export function centroid(p: Polygon): Point {
  if (p.length === 0) return [0, 0];
  const a = signedArea(p);
  if (Math.abs(a) < 1e-9) {
    let sx = 0, sy = 0;
    for (const [x, y] of p) { sx += x; sy += y; }
    return [sx / p.length, sy / p.length];
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    const cross = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

export function bbox(p: Polygon): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of p) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function perimeter(p: Polygon): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    s += Math.hypot(x2 - x1, y2 - y1);
  }
  return s;
}

export function pointInPolygon(pt: Point, poly: Polygon): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function cross(o: Point, a: Point, b: Point): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

export function convexHull(pts: Point[]): Polygon {
  const p = pts.slice().sort((u, v) => (u[0] === v[0] ? u[1] - v[1] : u[0] - v[0]));
  if (p.length < 3) return p.slice();
  const lower: Point[] = [];
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
    lower.push(pt);
  }
  const upper: Point[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
    upper.push(pt);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function ensureCCW(poly: Polygon): Polygon {
  return signedArea(poly) < 0 ? poly.slice().reverse() : poly;
}

export function clipToConvex(subject: Polygon, clip: Polygon): Polygon {
  const c = ensureCCW(clip);
  let output: Point[] = subject.slice();
  for (let i = 0; i < c.length; i++) {
    const a = c[i];
    const b = c[(i + 1) % c.length];
    const input = output;
    output = [];
    const inside = (p: Point) => cross(a, b, p) >= -1e-9;
    for (let j = 0; j < input.length; j++) {
      const cur = input[j];
      const prev = input[(j + input.length - 1) % input.length];
      const curIn = inside(cur);
      const prevIn = inside(prev);
      if (curIn) {
        if (!prevIn) output.push(lineIntersect(prev, cur, a, b));
        output.push(cur);
      } else if (prevIn) {
        output.push(lineIntersect(prev, cur, a, b));
      }
    }
    if (output.length === 0) return [];
  }
  return output;
}

function lineIntersect(p1: Point, p2: Point, a: Point, b: Point): Point {
  const A1 = p2[1] - p1[1];
  const B1 = p1[0] - p2[0];
  const C1 = A1 * p1[0] + B1 * p1[1];
  const A2 = b[1] - a[1];
  const B2 = a[0] - b[0];
  const C2 = A2 * a[0] + B2 * a[1];
  const det = A1 * B2 - A2 * B1;
  if (Math.abs(det) < 1e-12) return p2;
  return [(B2 * C1 - B1 * C2) / det, (A1 * C2 - A2 * C1) / det];
}

export function splitByLine(poly: Polygon, a: Point, b: Point): Polygon[] {
  const side = (p: Point) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const pos: Point[] = [];
  const neg: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const nxt = poly[(i + 1) % poly.length];
    const sc = side(cur);
    const sn = side(nxt);
    if (sc >= 0) pos.push(cur);
    if (sc <= 0) neg.push(cur);
    if ((sc > 0 && sn < 0) || (sc < 0 && sn > 0)) {
      const t = sc / (sc - sn);
      const ip: Point = [cur[0] + t * (nxt[0] - cur[0]), cur[1] + t * (nxt[1] - cur[1])];
      pos.push(ip);
      neg.push(ip);
    }
  }
  const out: Polygon[] = [];
  if (pos.length >= 3) out.push(pos);
  if (neg.length >= 3) out.push(neg);
  return out;
}

export function pointSegDist(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  if (L2 < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

// true when two simple polygons overlap: a vertex of one inside the other, or crossing edges
export function polysOverlap(a: Polygon, b: Polygon): boolean {
  for (const p of a) if (pointInPolygon(p, b)) return true;
  for (const p of b) if (pointInPolygon(p, a)) return true;
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i], a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      if (segmentsIntersect(a1, a2, b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return false;
}

export function insetPolygon(poly: Polygon, d: number): Polygon {
  const c = centroid(poly);
  return poly.map(([x, y]) => {
    const dx = c[0] - x;
    const dy = c[1] - y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return [x, y] as Point;
    const move = Math.min(d, len * 0.9);
    return [x + (dx / len) * move, y + (dy / len) * move] as Point;
  });
}

// true edge-normal inward offset for a CONVEX polygon: move each edge inward by d along its
// inward normal, then re-intersect consecutive offset edges. Falls back to the radial
// insetPolygon if the result degenerates (tiny/collapsed ward). Ward polygons are convex
// (Voronoi cell clipped to a disc), so this gives a uniform street gap unlike the radial shrink.
export function insetConvex(poly: Polygon, d: number): Polygon {
  // strip duplicate/near-duplicate consecutive vertices (e.g. a closed ring whose last point
  // repeats the first, as clipToConvex can emit) — a zero-length edge has no normal, which
  // otherwise forces the radial insetPolygon fallback for the WHOLE ward below.
  const clean: Polygon = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const prev = clean[clean.length - 1];
    if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 1e-6) clean.push(p);
  }
  if (clean.length > 1) {
    const first = clean[0], last = clean[clean.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6) clean.pop();
  }
  poly = clean;
  const n = poly.length;
  if (n < 3) return poly;
  const c = centroid(poly);
  const lineOf = (a: Point, b: Point): { p: Point; dir: Point } | null => {
    let ex = b[0] - a[0], ey = b[1] - a[1];
    const L = Math.hypot(ex, ey);
    if (L < 1e-9) return null;
    ex /= L; ey /= L;
    let nx = -ey, ny = ex;
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    if ((c[0] - mx) * nx + (c[1] - my) * ny < 0) { nx = -nx; ny = -ny; } // point inward
    return { p: [a[0] + nx * d, a[1] + ny * d], dir: [ex, ey] };
  };
  const lines: ({ p: Point; dir: Point } | null)[] = [];
  for (let i = 0; i < n; i++) lines.push(lineOf(poly[i], poly[(i + 1) % n]));
  const intersect = (l1: { p: Point; dir: Point }, l2: { p: Point; dir: Point }): Point | null => {
    const denom = l1.dir[0] * l2.dir[1] - l1.dir[1] * l2.dir[0];
    if (Math.abs(denom) < 1e-9) return null;
    const t = ((l2.p[0] - l1.p[0]) * l2.dir[1] - (l2.p[1] - l1.p[1]) * l2.dir[0]) / denom;
    return [l1.p[0] + l1.dir[0] * t, l1.p[1] + l1.dir[1] * t];
  };
  const out: Polygon = [];
  for (let i = 0; i < n; i++) {
    const l1 = lines[(i - 1 + n) % n], l2 = lines[i];
    if (!l1 || !l2) return insetPolygon(poly, d);
    const pt = intersect(l1, l2);
    if (!pt) return insetPolygon(poly, d);
    out.push(pt);
  }
  // degenerate guard: collapsed/flipped polygon → radial fallback
  if (out.length < 3 || Math.abs(area(out)) < 1 || !pointInPolygon(centroid(out), poly)) return insetPolygon(poly, d);
  // pinch guard: at a vertex whose two source edges are short/near-collinear (or where the ward
  // is simply narrow across a "waist"), the mitered offset vertex sits a full d away from its OWN
  // two source edges yet can land much closer than d to some OTHER edge across the pinch — a
  // corner-only defect, not a whole-ward one. Nudge just that vertex further toward the centroid
  // until it clears every edge by d (capped so it can't cross past the centroid), instead of
  // discarding the correct edge-offset for the rest of the ward's vertices.
  for (let i = 0; i < n; i++) {
    let p = out[i];
    for (let guard = 0; guard < 8; guard++) {
      let worst = Infinity;
      for (let j = 0; j < n; j++) worst = Math.min(worst, pointSegDist(p, poly[j], poly[(j + 1) % n]));
      if (worst >= d - 1e-6) break;
      const dx = c[0] - p[0], dy = c[1] - p[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) break;
      const step = Math.min(len, (d - worst) + 0.25);
      p = [p[0] + (dx / len) * step, p[1] + (dy / len) * step];
    }
    out[i] = p;
  }
  return out;
}
