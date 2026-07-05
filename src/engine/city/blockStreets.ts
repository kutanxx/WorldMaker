// Block-centric streets (Watabou-style): the city is partitioned into ward blocks and the
// streets are the gaps between them — i.e. the edges shared by two adjacent wards.
import type { Point, Polyline } from "../geometry";
import type { WardCell } from "./wards";

export interface StreetGraph {
  nodes: Point[];
  edges: [number, number][];
  segments: Polyline[];
}

const KEY = (p: Point) => `${Math.round(p[0] * 4)},${Math.round(p[1] * 4)}`; // 0.25px snap grid

// an edge shared by exactly two ward polygons is an interior street; an edge on the city
// perimeter belongs to one ward (the wall side) and is not a street.
export function extractStreets(wards: WardCell[]): StreetGraph {
  const seen = new Map<string, { a: Point; b: Point; n: number }>();
  for (const w of wards) {
    const poly = w.polygon;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ka = KEY(a), kb = KEY(b);
      if (ka === kb) continue;
      const key = ka < kb ? ka + "|" + kb : kb + "|" + ka;
      const rec = seen.get(key);
      if (rec) rec.n++;
      else seen.set(key, { a, b, n: 1 });
    }
  }
  const nodeIndex = new Map<string, number>();
  const nodes: Point[] = [];
  const nodeOf = (p: Point) => {
    const k = KEY(p);
    let idx = nodeIndex.get(k);
    if (idx === undefined) { idx = nodes.length; nodeIndex.set(k, idx); nodes.push(p); }
    return idx;
  };
  const edges: [number, number][] = [];
  const segments: Polyline[] = [];
  for (const { a, b, n } of seen.values()) {
    if (n !== 2) continue;
    const ia = nodeOf(a), ib = nodeOf(b);
    if (ia !== ib) { edges.push([ia, ib]); segments.push([a, b]); }
  }
  return { nodes, edges, segments };
}

export function classifyStreets(
  graph: StreetGraph, gates: Point[], centre: Point,
): { main: Polyline[]; minor: Polyline[] } {
  const { nodes, edges } = graph;
  if (nodes.length === 0) return { main: [], minor: [] };
  const nearestNode = (p: Point) => {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const d = (nodes[i][0] - p[0]) ** 2 + (nodes[i][1] - p[1]) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    return bi;
  };
  const adj: { to: number; edge: number }[][] = nodes.map(() => []);
  edges.forEach(([a, b], ei) => { adj[a].push({ to: b, edge: ei }); adj[b].push({ to: a, edge: ei }); });
  const wlen = (ei: number) => { const [a, b] = edges[ei]; return Math.hypot(nodes[a][0] - nodes[b][0], nodes[a][1] - nodes[b][1]); };
  const centreNode = nearestNode(centre);
  const mainEdge = new Set<number>();
  const stubs: Polyline[] = [];
  for (const gate of gates) {
    const start = nearestNode(gate);
    stubs.push([gate, nodes[start]]);                 // always connect the gate to the network
    const dist = new Array(nodes.length).fill(Infinity);
    const prevEdge = new Array(nodes.length).fill(-1);
    const prevNode = new Array(nodes.length).fill(-1);
    const done = new Array(nodes.length).fill(false);
    dist[start] = 0;
    for (let it = 0; it < nodes.length; it++) {
      let u = -1, bd = Infinity;
      for (let i = 0; i < nodes.length; i++) if (!done[i] && dist[i] < bd) { bd = dist[i]; u = i; }
      if (u === -1 || u === centreNode) break;
      done[u] = true;
      for (const { to, edge } of adj[u]) {
        const nd = dist[u] + wlen(edge);
        if (nd < dist[to]) { dist[to] = nd; prevEdge[to] = edge; prevNode[to] = u; }
      }
    }
    if (dist[centreNode] < Infinity && centreNode !== start) {
      let cur = centreNode;
      while (cur !== start && prevEdge[cur] !== -1) { mainEdge.add(prevEdge[cur]); cur = prevNode[cur]; }
    } else if (centreNode !== start) {
      stubs.push([nodes[start], centre]);             // fallback: disconnected graph
    }
  }
  const main: Polyline[] = [];
  const minor: Polyline[] = [];
  edges.forEach(([a, b], ei) => {
    const seg: Polyline = [nodes[a], nodes[b]];
    if (mainEdge.has(ei)) main.push(seg); else minor.push(seg);
  });
  return { main: [...main, ...stubs], minor };
}
