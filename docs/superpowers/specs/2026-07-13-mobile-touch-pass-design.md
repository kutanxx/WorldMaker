# Mobile Touch Pass — Design

**Date:** 2026-07-13 · **Scope:** all three HTML entries (one line each) + play-mode touch ergonomics. **Origin:** the last open item (of 6) from the self-feedback pass — "간편하게 때우기" positioning demands a usable phone experience; the game has never been touch-tested.

**Measured evidence (browser pane at 375×812, which emulates a real phone against this page):**
- No `<meta name="viewport">` in ANY html entry → layout viewport renders at **981px** and phones scale everything to ~38%: the advance button is ~12pt tall on a 375pt phone, a neighbor chip ~7pt (Apple minimum: 44pt). This is the root cause of mobile unusability.
- With a 375px layout (post-meta), natural control sizes are: advance 112×32, stance 74×30, invest 110×30, howto-next 81×30, neighbor chip 77×19 — all under the 44px touch guideline; the chip severely so.
- 11+ pieces of guidance live ONLY in hover `title` attributes (stance multipliers, neighbor-relation factors, goal conditions, meter explanations, invest/advance hints, daily badge) — invisible on touch.
- The narrow (<1100px) fallback stack already exists and is well-ordered (panel → goals → map → dilemma → command bar → banner → chronicle); it simply never engages on phones today because of the missing meta.

**Explicitly out of scope (rejected/deferred):**
- **Pinch zoom on the play map** (user-confirmed defer): `zoomPan` has no pinch, and its `touch-action: none` would eat page scrolling over a full-width map. Revisit after a real-phone feel-pass.
- Per-element tooltip popovers (11 separate wirings), long-press handlers (iOS selection conflicts).
- Version A (map.html) touch optimization beyond the meta line — it stays a desktop-first tool.

## 1. Viewport meta (the unblocking fix)

Add to the `<head>` of `index.html`, `play.html`, `map.html`:

```html
    <meta name="viewport" content="width=device-width, initial-scale=1" />
```

Effect: phones lay out at device width; the existing narrow stack and all `@media (max-width…)` rules finally apply. Desktop unaffected. Regression guard: a file-based sanity test greps all three entry files for `name="viewport"` (jsdom never loads these files, so test via `readFileSync`).

## 2. Touch targets + gesture hygiene — `@media (pointer: coarse)` only

New CSS block in `src/theme.css`, scoped so desktop is untouched:

```css
@media (pointer: coarse) {
  button, .nation-choice { touch-action: manipulation; }
  /* lift sub-44px controls to a tappable size */
  .play-actions button, .stance-seg button, .invest-seg button,
  .dilemma button, .howto-next, .howto-start, .help-btn, .lang-toggle,
  .btn-play-again, .btn-new-world, .reign-export {
    min-height: 44px; padding-top: 8px; padding-bottom: 8px;
  }
  .neighbor-chip { min-height: 40px; display: inline-flex; align-items: center; padding: 6px 10px; }
  .timeline-slider { height: 32px; }
  .timeline-play { min-width: 44px; min-height: 44px; }
}
```

(The implementer verifies each selector against the real class names in `playApp.ts`/`theme.css` — the list above is intent, the classes must be confirmed; e.g. the stance row's actual container class. `touch-action: manipulation` kills the double-tap-zoom delay on controls without disabling page scroll.)

## 3. Tap-strip tooltips — new module `src/ui/tipStrip.ts`

One delegated listener replaces 11+ individual hover tooltips on touch devices:

```ts
export function installTipStrip(root: HTMLElement, coarse?: boolean): () => void
```

- `coarse` defaults to `matchMedia("(pointer: coarse)").matches` guarded by try/catch (jsdom lacks a real implementation → default false there); tests pass `true` explicitly. When false, install is a no-op returning a no-op disposer.
- Behavior: a `click` listener (delegation) on `root` finds `(e.target as Element).closest("[title]")`; if found and the title is non-empty, shows the text in a `.tip-strip` — a fixed strip at the bottom of the viewport (`position: fixed; bottom: 8px; left: 8px; right: 8px; z-index` above the HUD, `pointer-events: none` so it never blocks taps). Re-tapping another titled element replaces the text. Auto-hides after 4 s (`TIP_MS = 4000`, timer reset on each show).
- The strip is additive: buttons keep performing their actions; the strip explains them after the fact — good enough for bonus-information tooltips.
- The disposer removes the listener and the strip element (used by tests; the app installs once per `createPlayApp` and never disposes).
- Map SVG `<title>` elements are naturally excluded (`closest("[title]")` matches attribute selectors, not `<title>` children) — intended: the command-bar status line already mirrors target info.
- Scope: play mode only (`createPlayApp` installs it on its root). The landing/map pages keep native behavior.

## 4. Testing

- `src/ui/tipStrip.test.ts` (jsdom, fake timers): tap on a titled element shows its text in `.tip-strip`; auto-hides after 4 s; tap on an untitled element does not show (and hides nothing prematurely); empty `title=""` skipped; `coarse: false` installs nothing; disposer removes the strip.
- `src/viewportMeta.test.ts` (node env): `readFileSync` each of `index.html`, `play.html`, `map.html` and assert `name="viewport"` present.
- `playApp.test.ts`: one wiring test — `createPlayApp` root has a tip strip installed when coarse is forced… wiring is internal; instead assert via DOM: after `createPlayApp(root, 1)`, `document.querySelector(".tip-strip")` exists only under forced-coarse conditions. Since `createPlayApp` can't take a test flag without API noise, the wiring test instead verifies `installTipStrip` is exported and behaviorally covered by its own unit tests, and the playApp wiring is a one-line call reviewed by inspection + the live check. (Decision: no `createPlayApp` signature change for testability — YAGNI.)
- CSS/live: at 375×812 reload → `window.innerWidth` flips 981 → 375 (the pane honors the new meta — this is the live proof), no horizontal overflow (`document.documentElement.scrollWidth === 375`), stack order intact, console clean. Final acceptance on the user's real phone after deploy (the pane cannot emulate `pointer: coarse` media).

## 5. Risks

- The viewport meta also affects Version A (map.html) on phones: the map tool will now render at device width (with its own `max-width:100%` svg rules) instead of a shrunk desktop page. Verify it loads and scrolls at 375px in the live check; deeper phone UX for the tool stays out of scope.
- `touch-action: manipulation` on buttons is safe (doesn't affect scroll); we deliberately do NOT set `touch-action: none` anywhere.
- The 44px bumps can reflow the desktop layout only if a coarse-pointer desktop device exists (touch laptops report coarse for touch input but fine for the mouse; the media query targets the PRIMARY pointer, so touch-screen laptops with trackpads stay on the desktop layout).
