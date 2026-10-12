import { describe, it, expect, afterEach, vi } from "vitest";
import { dsin, dcos, dtan, datan, datan2, dacos, dasin, dexp, dlog, dpow, dcbrt, dhypot } from "./dmath";

// The language leaves the last digits of Math.sin, cos, tan, atan2, exp, log, pow, cbrt and hypot to each
// browser's engine, and they differ (measured 2026-10-12: Node 24, Chrome 152 and Firefox 156 each disagree
// with the others), so a town plate came out differently in each. dmath computes them with nothing but
// + − × ÷ and sqrt, which every engine must do exactly the same — so a world and its plates are the same
// everywhere the same link is opened.

let s = 987654321;
const rnd = () => { s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) | 0; return (s >>> 0) / 4294967296; };
const close = (a: number, b: number, rel = 4e-16) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

describe("dmath agrees with the engine's own functions to the last digit or two", () => {
  it("sin and cos, over the angles the generator uses and far beyond", () => {
    for (let i = 0; i < 20000; i++) {
      const x = (rnd() - 0.5) * (i % 4 === 0 ? 2000 : 20);
      expect(close(dsin(x), Math.sin(x)), `sin ${x}`).toBe(true);
      expect(close(dcos(x), Math.cos(x)), `cos ${x}`).toBe(true);
    }
    expect(dsin(0)).toBe(0); expect(dcos(0)).toBe(1);
  });
  it("tan, atan, atan2, asin, acos", () => {
    for (let i = 0; i < 20000; i++) {
      const a = (rnd() - 0.5) * 400, b = (rnd() - 0.5) * 400, u = rnd() * 2 - 1;
      expect(close(datan2(a, b), Math.atan2(a, b)), `atan2 ${a} ${b}`).toBe(true);
      expect(close(datan(a / 37), Math.atan(a / 37)), `atan ${a}`).toBe(true);
      expect(close(dacos(u), Math.acos(u), 1e-15), `acos ${u}`).toBe(true);
      expect(close(dasin(u), Math.asin(u), 1e-15), `asin ${u}`).toBe(true);
      const t = (rnd() - 0.5) * 3;
      expect(close(dtan(t), Math.tan(t), 1e-15), `tan ${t}`).toBe(true);
    }
    for (const [y, x, want] of [[0, 1, 0], [0, -1, Math.PI], [1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2], [0, 0, 0]] as const) {
      expect(datan2(y, x)).toBeCloseTo(want, 15);
    }
  });
  it("exp, log, pow, cbrt, hypot", () => {
    for (let i = 0; i < 20000; i++) {
      const x = (rnd() - 0.5) * 60, p = rnd() * 1000 + 1e-6, q = (rnd() - 0.5) * 6;
      expect(close(dexp(x), Math.exp(x), 1e-15), `exp ${x}`).toBe(true);
      expect(close(dlog(p), Math.log(p), 1e-15), `log ${p}`).toBe(true);
      expect(close(dpow(p, q), Math.pow(p, q), 1e-13), `pow ${p} ${q}`).toBe(true);
      expect(close(dcbrt(x * 9), Math.cbrt(x * 9), 1e-15), `cbrt ${x}`).toBe(true);
      const a = (rnd() - 0.5) * 900, b = (rnd() - 0.5) * 900;
      expect(close(dhypot(a, b), Math.hypot(a, b), 1e-15), `hypot ${a} ${b}`).toBe(true);
    }
    expect(dexp(0)).toBe(1); expect(dlog(1)).toBe(0); expect(dpow(2, 10)).toBe(1024); expect(dpow(0, 3)).toBe(0);
    expect(dpow(5, 0)).toBe(1); expect(dcbrt(27)).toBe(3); expect(dhypot(3, 4)).toBe(5); expect(dhypot(1, 2, 2)).toBe(3);
  });
});

describe("dmath never asks the engine", () => {
  afterEach(() => vi.restoreAllMocks());
  it("computes every function with the engine's transcendental functions taken away", () => {
    for (const k of ["sin", "cos", "tan", "atan", "atan2", "asin", "acos", "exp", "log", "pow", "cbrt", "hypot", "expm1", "log1p", "log2"] as const) {
      vi.spyOn(Math, k).mockImplementation(() => { throw new Error(`dmath called Math.${k}`); });
    }
    expect(() => [dsin(1.3), dcos(-7), dtan(0.4), datan(3), datan2(-2, -5), dasin(0.3), dacos(-0.8), dexp(2.5), dlog(7), dpow(3.3, 0.7), dcbrt(-8.5), dhypot(3, 5)]).not.toThrow();
  });
});

// ...and nothing that decides what a world or a plate looks like may ask the engine either: every file the
// map is computed or drawn by uses dmath. (Math.sqrt, Math.round, Math.floor, Math.abs and the like are
// exact everywhere and stay.)
describe("nothing on the map is computed with the engine's own transcendental functions", () => {
  it("leaves no Math.sin, cos, tan, atan, atan2, asin, acos, exp, log, pow, cbrt or hypot in the source", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".ts") && !p.endsWith(".test.ts") && !p.endsWith("dmath.ts")) files.push(p); } };
    walk("src");
    const found: string[] = [];
    const re = /Math\.(sin|cos|tan|atan2|atan|asin|acos|exp|expm1|log|log1p|log2|log10|pow|cbrt|hypot|sinh|cosh|tanh)\s*\(/g;   // a call (a comment may name one)
    for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(re)) found.push(`${f}: ${m[0]}`);
    expect(found, found.slice(0, 12).join("\n")).toEqual([]);
  });
});
