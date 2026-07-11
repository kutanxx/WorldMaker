# String Seeds — "Narnia" makes a world (Minecraft seed-culture benchmark)

**Date:** 2026-07-11
**Status:** Approved design

## Why

Seed sharing is a proven culture (Minecraft: named seeds, catalog sites, "same seed = same world" as a social contract). Our differentiator is shareable procedural worlds; `hashStringToSeed` (FNV-1a) has been implemented+tested in `src/engine/rng.ts` since Phase 1 and NEVER used. This is UI plumbing only.

## Behavior

- **play.html**: `#seed=<value>` — if `<value>` parses as a positive finite integer, use it as today (full back-compat); else if it is a non-empty string (after trim; `URLSearchParams` has ALREADY percent-decoded it — `parseSeedValue` must NOT decode again or a literal "%20" in a name breaks), use `hashStringToSeed(value)`. Non-ASCII names (한글 등) work — `hashStringToSeed` hashes UTF-16 char codes. The hash is left AS TYPED so `play.html#seed=Narnia` is the shareable URL. Empty/whitespace value → random seed (today's fallback).
- **Landing page (`index.html` / `src/landing.ts`)**: a small "세계의 이름으로 시작 / Start from a name" input + two buttons: [▶ 플레이] → `play.html#seed=<encodeURIComponent(name)>`; [🗺 지도] → `map.html#<blob>` where the blob is `encodeParams({...DEFAULT_PARAMS, seed: hashStringToSeed(name)})` (Version A's numeric blob format is UNCHANGED — the name is consumed at routing time). Empty input → buttons do nothing.
- Same name ⇒ same world, everywhere, deterministically (FNV-1a is pure).
- The existing legacy-annals key `wm:legacy:<seed>` uses the NUMERIC seed, so a named world's reigns accumulate under its hash — consistent whether visitors arrive by name or number.

## API

New pure helper in `src/ui/urlState.ts` (single source of truth, both entry points use it):

```ts
// "731" -> 731 · "Narnia" -> hashStringToSeed("Narnia") · ""/garbage -> null
export function parseSeedValue(raw: string | null): number | null;
```

(Positive-integer detection: `/^\d+$/` + `Number` + `> 0` + `Number.isSafeInteger`; anything else non-empty → `hashStringToSeed(trimmed)`; null/empty/whitespace → null.)

`src/playMain.ts` swaps its ad-hoc `Number(...)` parse for `parseSeedValue(new URLSearchParams(location.hash.slice(1)).get("seed")) ?? randomSeed()`.

`src/landing.ts` gains the input row (rendered alongside the two existing chooser cards) with i18n-free bilingual placeholder text (`세계의 이름 / world name` — the landing page has no lang toggle; one bilingual literal matches its existing style).

## Non-goals

String seeds inside Version A's params blob (numeric format unchanged); showing the typed name inside the play UI (the URL carries it); a seed browser/catalog; migrating `wm:legacy` keys.

## Testing

1. `parseSeedValue` unit: numeric string → that number; `"Narnia"` → `hashStringToSeed("Narnia")` (same value twice = determinism); `""`/`"   "`/null → null; `"0"`/`"-3"` → treated as strings (hash), since only positive integers pass the numeric path — DECISION: `"0"` and `"-3"` hash as text rather than being invalid, keeping "any non-empty text works".
2. landing DOM: typing a name and clicking play navigates to `play.html#seed=Narnia` (assert on the anchor/href or location mock per the existing landing.test.ts pattern); empty input → no navigation.
3. playMain: hash `#seed=Narnia` boots the same world as `#seed=<hashStringToSeed("Narnia")>` (compare world names via two createPlayApp mounts or assert the seed passed through — follow playMain.test's existing seam).

## Sources

- [Minecraft World seed — wiki (same seed = same world, sharing culture)](https://minecraft.wiki/w/Seed_(world_generation))
