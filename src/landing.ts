import "./theme.css";
import { dailyName, dailyTarget } from "./ui/daily";
import { detectLang, saveLang } from "./ui/lang";
import { t, type Lang } from "./ui/i18n";

import { initialParams, initialSeedName } from "./ui/urlState";
import { generateWorld } from "./engine/world";
import { renderWorld } from "./ui/svgWorldRenderer";
import type { WorldParams } from "./types/world";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

// A share URL is a hash whose base64 payload is JSON carrying a finite numeric `seed`
// (the shape `urlState.encodeParams` produces). Anything else (empty, non-base64, or JSON
// without a seed) is not a seed link → show the chooser instead of forwarding.
export function redirectTarget(hash: string): string | null {
  const raw = hash.replace(/^#/, "");
  if (raw.length === 0) return null;
  try {
    const parsed = JSON.parse(atob(raw)) as { seed?: unknown };
    if (parsed && typeof parsed.seed === "number" && Number.isFinite(parsed.seed)) {
      return "map.html#" + raw;
    }
    return null;
  } catch {
    return null;
  }
}

// "Narnia" → a shareable map URL. The name is hashed to a seed, so the same word always opens the
// same world. It used to also return a `play` target; the games it pointed at are gone.
//
// The link carries the NAME, not the hash of it. The seed is the same either way — map.html reads
// `#seed=Narnia` and hashes it exactly as this used to — but the word survives the trip, so the
// world can be called what it was asked to be called instead of being handed a generated name.
export function nameTargets(name: string): { map: string } | null {
  const t = name.trim();
  if (t.length === 0) return null;
  return { map: "map.html#seed=" + encodeURIComponent(t) };
}

/**
 * The chooser, in ONE language. It used to print every line twice — "세계의 이름으로 시작 · start
 * from a name", "🗺 세계 만들기 · Create" — so neither language read well, while the tagline and the
 * card were English only. The map page has remembered a reader's choice in `wm:lang` since the
 * onboarding pass; this reads the same key, so choosing Korean there is choosing it here.
 *
 * `storage` and `navLang` are injected so the choice can be tested without touching the real
 * localStorage, and because reading it can throw outright in privacy mode.
 */
export function renderChooser(root: HTMLElement, storage?: StorageLike | null, navLang?: string): void {
  const store = storage === undefined ? undefined : storage;
  const lang: Lang = store === undefined ? detectLang(navLang) : detectLang(navLang, store);
  const s = (k: string) => t(lang, k);
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

  root.innerHTML = `
    <div class="landing-hero">
      <h1 class="app-title">WorldMaker</h1>
      <p class="landing-tagline">${esc(s("landingTagline"))}</p>
      <button class="landing-lang" type="button">${lang === "ko" ? "EN" : "한국어"}</button>
    </div>
    <div class="landing-preview" hidden></div>
    <div class="landing">
      <a class="choice-card" href="map.html">
        <div class="choice-icon">🗺</div>
        <div class="choice-title">${esc(s("landingCardTitle"))}</div>
        <p class="choice-desc">${esc(s("landingCardDesc"))}</p>
      </a>
    </div>
    <div class="landing-name">
      <input class="name-seed" maxlength="40" placeholder="${esc(s("landingNamePlaceholder"))}" />
      <button class="name-map">🗺 ${esc(s("landingCreate"))}</button>
    </div>
    <div class="landing-daily">
      <button class="name-daily">🗓 ${esc(s("landingDaily"))} — ${dailyName(new Date()).slice(6)}</button>
      <p class="landing-daily-sub">${esc(s("landingDailySub"))}</p>
    </div>`;

  const input = root.querySelector(".name-seed") as HTMLInputElement;
  const go = () => {
    const target = nameTargets(input.value);
    if (target) location.assign(target.map);
  };
  (root.querySelector(".name-map") as HTMLButtonElement).addEventListener("click", go);
  (root.querySelector(".name-daily") as HTMLButtonElement).addEventListener("click", () => location.assign(dailyTarget(new Date())));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  (root.querySelector(".landing-lang") as HTMLButtonElement).addEventListener("click", () => {
    const next: Lang = lang === "ko" ? "en" : "ko";
    if (store === undefined) saveLang(next); else saveLang(next, store);
    const hadPreview = !!root.querySelector(".landing-preview-link");
    renderChooser(root, storage, navLang);
    // Re-rendering rewrites innerHTML, which throws away the map the deferred draw had already put
    // in the slot. Nothing else puts it back, so switching language used to blank today's world off
    // the page — and it is redrawn rather than moved so its legend and compass follow the reader
    // into the new language.
    if (hadPreview) fillPreview(root, new Date(), next);
  });
}

/**
 * The world the preview draws — which must be the world the daily button OPENS, not one that
 * merely looks like it. `map.html#seed=daily-…` resolves through `initialParams`/`initialSeedName`,
 * so those are what the preview resolves through too. Building it any other way would leave two
 * paths making "the same" world, and this codebase has been bitten by that shape twice already.
 */
export function previewParams(day: Date): WorldParams {
  return initialParams("#seed=" + dailyName(day));
}
/**
 * What the preview world is called — nothing, deliberately. The daily key is a machine key, so it
 * is not handed to the generator as a title (see `initialSeedName`, which drops it for the same
 * reason); the world gets its own name and the DATE goes in the caption beside it, which is where
 * a date belongs.
 */
export function previewTitle(day: Date): string | undefined {
  return initialSeedName("#seed=" + dailyName(day)) ?? undefined;
}

/**
 * Draw today's world into the slot. Called AFTER the chooser is on screen — a front page that
 * waits on a world generator before painting anything is worse than one with no picture on it.
 */
export function fillPreview(root: HTMLElement, day: Date, lang: Lang = "en"): void {
  const slot = root.querySelector(".landing-preview") as HTMLElement | null;
  if (!slot) return;
  const { world } = generateWorld(previewParams(day), previewTitle(day));
  const link = document.createElement("a");
  link.className = "landing-preview-link";
  link.href = dailyTarget(day);
  link.setAttribute("aria-label", `${t(lang, "landingPreviewOf")} — ${t(lang, "landingPreviewOpen")}`);
  link.appendChild(renderWorld(world, "terrain", [], lang));
  const cap = document.createElement("p");
  cap.className = "landing-preview-cap";
  cap.textContent = `${t(lang, "landingPreviewOf")} · ${dailyName(day).slice(6)} — ${world.name}`;
  slot.replaceChildren(link, cap);
  slot.hidden = false;
}

const root = document.getElementById("landing");
if (root) {
  const target = redirectTarget(location.hash);
  if (target) location.replace(target);
  else {
    renderChooser(root);
    // after the paint, never before it
    const draw = () => fillPreview(root, new Date(), detectLang());
    if (typeof requestIdleCallback === "function") requestIdleCallback(draw, { timeout: 1200 });
    else setTimeout(draw, 0);
  }
}
