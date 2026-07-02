# Gazetteer (World Almanac) Export — Design

**Date:** 2026-07-01
**Status:** Approved
**Depends on:** Named world/geography (①), Culture layer (②), History engine — all merged.

## Goal

Turn everything the generator produces — world name, geographic regions, peoples,
realms, cities, and the 500-year chronicle — into one **readable Markdown document** a
novelist or GM can download and use. This is the payoff artifact that makes the
generated depth usable as prose, not just an on-screen map.

## Format

**Markdown (`.md`)** — readable as-is, portable, pastes into any writing/VTT tool;
strictly better than plain text (structure) or HTML (heavier, styling not our job)
for this purpose.

## Component — `src/engine/gazetteer.ts` (new, pure/DOM-free)

`worldToGazetteer(world: World, history: History): string` → a Markdown document.
Deterministic (same world+history → same string). Sections:

- **Title + overview:** `# {world.name}` then one line "{name} is a world of {N}
  realms and {M} peoples." (N = `world.polities.length`, M = `world.cultures.length`).
- **The Land:** one bullet per `world.regions` entry — `- **{name}** — {biome phrase}
  in the {compass}.` where the biome phrase maps the region `kind` (desert → "arid
  desert", alpine → "high mountains", ocean → "open sea", …) and `{compass}` is derived
  from the centroid vs the map centre (north/south × east/west, or "heart").
- **Peoples:** one bullet per culture — computed once from `cultureOf` + `biome`: each
  culture's cells give a centroid (→ compass) and a dominant biome (→ phrase):
  `- **{culture.name}** — a people of the {biome phrase} in the {compass}.`
- **Realms:** the year-0 realms (`world.polities`). Per polity: `### {name}` then
  "Seated at **{capital city name}**" + a list of its towns (cities with that
  `polityId`, non-capital). Cities grouped by `polityId`.
- **Free Ports:** if `history.economicZones` non-empty, a bullet per zone (`- **{name}**`).
- **Chronicle (Years 0–500):** `history.events` grouped by century (`### {century}s`
  headers) with each event's existing `text` as a bullet — the world's recorded history.

Framing: the document describes the world **at its dawn** (year 0 geography/peoples/
realms) followed by its **chronicle** (the forward history) — matching the app's model.

Helpers (private): `compass(cx, cy, w, h)` and `BIOME_PHRASE: Record<kind,string>`.

## Delivery — `src/ui/app.ts` + `src/ui/export.ts`

- `export.ts` already has `downloadBlob`. Add a "📜 가제티어" button in the controls
  (next to the export buttons) → `downloadBlob('{world.name}.md', new Blob([text],
  { type: "text/markdown" }))` where `text = worldToGazetteer(generated.world, history)`.
  File name sanitised (strip spaces/punctuation from the world name; fall back to
  "gazetteer").

## Non-goals (YAGNI)

HTML/PDF rendering, styling/themes, per-city descriptions beyond name, prose beyond
light templating, localisation. The document is data-driven Markdown; the user
converts/styles it downstream if they wish.

## Testing

- `gazetteer.test.ts`: `worldToGazetteer(generateWorld+simulateHistory)` starts with
  `# {world.name}`, contains every section header, contains at least one region name,
  one culture name, one polity name, and one chronicle event's text; is deterministic
  for a seed; handles a world with zero economic zones / empty regions without crashing.
- `app.test.ts`: a 가제티어 button exists in the controls.
- Full suite green; build clean.

## Verification

`preview_eval` can call `worldToGazetteer` and check the produced Markdown; the
download UX is exercised by the button test. No screenshot needed (it's text).
