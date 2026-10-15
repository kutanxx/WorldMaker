import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// ★ The page's colours are named once (design review 2026-10-15: 53 hex colours sat in theme.css with no
// token among them). The tokens on :root cover every colour used more than once; a colour used once stays a
// literal beside the rule that owns it. The value behind a token is the colour the contrasts were measured
// for, so these are pinned too.
const css = () => readFileSync("src/theme.css", "utf8");
/** the stylesheet without its comments: a colour named in a comment is a word, not a declaration */
const code = () => css().replace(/\/\*[\s\S]*?\*\//g, "");
const root = () => { const c = code(); const at = c.indexOf(":root {"); return c.slice(at, c.indexOf("}", at)); };

describe("the page's colours are tokens", () => {
  const PINNED: [string, string][] = [
    ["--page", "#e8dcc0"], ["--panel", "#f6efdd"], ["--paper", "#f3ead2"], ["--paper-hover", "#e7d9b6"],
    ["--ink", "#3c2f1c"], ["--muted", "#6b5d42"], ["--line", "#cbb784"], ["--line-2", "#b7a071"],
    ["--gold", "#d8b25a"], ["--primary", "#7a5a2f"], ["--primary-text", "#efe7d2"], ["--accent", "#7a2f2f"],
  ];
  it("declares each on :root with the colour its contrast was measured for", () => {
    for (const [name, value] of PINNED) expect(root(), name).toMatch(new RegExp(`${name}:\\s*${value};`));
  });

  it("writes a recurring colour nowhere else", () => {
    const body = code().replace(root(), "");
    for (const [name, value] of PINNED) {
      expect(body.toLowerCase().includes(value), `${value} is written out where ${name} should stand`).toBe(false);
    }
    // the two parchments that were the same by accident are one token now
    expect(body.toLowerCase().includes("#f6efdc")).toBe(false);
  });

  it("leaves no colour used twice without a token", () => {
    const body = code().replace(root(), "");
    const counts = new Map<string, number>();
    for (const m of body.matchAll(/#[0-9a-f]{6}\b/gi)) counts.set(m[0].toLowerCase(), (counts.get(m[0].toLowerCase()) ?? 0) + 1);
    const twice = [...counts].filter(([, n]) => n > 1).map(([c]) => c);
    expect(twice, "written out more than once").toEqual([]);
    // ...and the tokens are used: the ink and the panel's edge are the two most-used colours on the page
    expect((body.match(/var\(--ink\)/g) ?? []).length).toBeGreaterThanOrEqual(10);
    expect((body.match(/var\(--line\)/g) ?? []).length).toBeGreaterThanOrEqual(10);
  });
});
