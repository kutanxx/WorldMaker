import "./theme.css";
import { dailyName, dailyTarget } from "./ui/daily";
import { detectLang, saveLang } from "./ui/lang";
import { t, type Lang } from "./ui/i18n";

import { initialParams, initialSeedName } from "./ui/urlState";
import { generateWorld } from "./engine/world";
import { simulateHistory } from "./engine/history";
import { renderWorld } from "./ui/svgWorldRenderer";
import { deconflictLabels } from "./ui/deconflict";
import { applyLabelScale, applyMarkerScale } from "./ui/labelScale";
import { floorScaleCaption } from "./ui/scaleBar";
import { readRecent, forgetWorld, clearRecent, whenSaid, RECENT_SHOW } from "./ui/recentWorlds";
import { worldNameIn } from "./engine/featureLabel";
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
      <a class="choice-card primary" href="map.html">
        <div class="choice-icon">🗺</div>
        <div class="choice-title">${esc(s("landingCardTitle"))}</div>
        <p class="choice-desc">${esc(s("landingCardDesc"))}</p>
      </a>
    </div>
    <div class="landing-name">
      <input class="name-seed" maxlength="40" placeholder="${esc(s("landingNamePlaceholder"))}" />
      <button class="name-map">🗺 ${esc(s("landingCreate"))}</button>
    </div>
    <section class="landing-recent"></section>
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
  fillRecent(root.querySelector(".landing-recent") as HTMLElement, lang, store);
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
 * The worlds the reader named (recentWorlds.ts), under the ways in: nothing on a first visit, the newest
 * five after, each line the link that opens its world with its names, each one removable, and a word that
 * they live in this browser only. A name is the reader's own text — set as words, never as markup.
 */
function fillRecent(slot: HTMLElement | null, lang: Lang, storage: StorageLike | null | undefined): void {
  if (!slot) return;
  const store = storage === undefined ? undefined : storage;
  const worlds = readRecent(store).slice(0, RECENT_SHOW);
  slot.replaceChildren();
  if (!worlds.length) return;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const again = () => fillRecent(slot, lang, storage);
  const head = el("div", "recent-head");
  const clear = el("button", "recent-clear", t(lang, "recentClear"));
  clear.type = "button";
  clear.addEventListener("click", () => {
    if (!window.confirm(t(lang, "recentClearAsk"))) return;
    clearRecent(store);
    again();
  });
  head.append(el("h2", undefined, t(lang, "recentTitle")), clear);
  const list = el("ul");
  const now = Date.now();
  for (const w of worlds) {
    const li = el("li");
    const a = el("a", undefined, w.name);
    a.href = w.url;
    const meta = el("span", "recent-meta", `${t(lang, "recentNames").replace("{n}", String(w.count))} · ${whenSaid(w.at, now, lang)}`);
    const drop = el("button", "recent-forget", "✕");
    drop.type = "button";
    drop.title = t(lang, "recentForget");
    drop.setAttribute("aria-label", `${t(lang, "recentForget")} — ${w.name}`);
    drop.addEventListener("click", () => { forgetWorld(w.key, store); again(); });
    li.append(a, meta, drop);
    list.appendChild(li);
  }
  slot.append(head, list, el("p", "recent-note", t(lang, "recentNote")));
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
  const params = previewParams(day);
  const { world } = generateWorld(params, previewTitle(day));
  // ★ The map as it opens, which is its first year: the towns standing then, the roads between them and the
  // free ports among them. Drawn from the world alone it showed every town the chronicle will ever found —
  // 28 on 2026-10-07's world, against the 14 the map it opens had.
  const history = simulateHistory(world, params.seed);
  const first = history.snapshots[0].year;
  const unfounded = new Set(history.cityFoundings.filter((f) => f.year > first).map((f) => f.cityId));
  const link = document.createElement("a");
  link.className = "landing-preview-link";
  link.href = dailyTarget(day);
  link.setAttribute("aria-label", `${t(lang, "landingPreviewOf")} — ${t(lang, "landingPreviewOpen")}`);
  // ★ A picture inside a link is a picture. The world renderer makes every town a control so the
  // map page can be driven from the keyboard — `role="button"`, `tabindex="0"` — and this page
  // appends that same drawing inside ONE anchor: measured on the live front page, 28 of its 34
  // focus stops were those dots, none of them doing anything, and both buttons that do something
  // came after them. The label the link already carries is what a reader needs here.
  const picture = renderWorld(world, "terrain", history.economicZones.map((z) => z.cell), lang, unfounded);
  picture.setAttribute("aria-hidden", "true");
  // ...and without the map's key, which stood on a corner of the picture — measured on the live front
  // page, a town and its name under it (2026-09-28). The map it opens keeps its key beside the map.
  picture.querySelector(".legend")?.remove();
  for (const el of picture.querySelectorAll('[role="button"], [tabindex]')) {
    el.removeAttribute("role");
    el.removeAttribute("tabindex");
  }
  link.appendChild(picture);
  const cap = document.createElement("p");
  cap.className = "landing-preview-cap";
  cap.textContent = `${t(lang, "landingPreviewOf")} · ${dailyName(day).slice(6)} — ${worldNameIn(world, lang)}`;
  slot.replaceChildren(link, cap);
  slot.hidden = false;
  // ...and its names set the way the map sets them at rest, now that the picture has a size to set them for:
  // no smaller than the map's floor, then the ones that do not fit put away. Drawn raw, 9 pairs of its 46
  // names stood on each other and a sea's name hung past the frame (live, 2026-10-08).
  floorScaleCaption(picture, PREVIEW_LABEL_FLOOR);
  applyLabelScale(picture, 1, { minPx: PREVIEW_LABEL_FLOOR });
  applyMarkerScale(picture, 1);
  deconflictLabels(picture, 1);
}

// the world map's own floor for a name on screen (app.ts WORLD_LABEL_FLOOR)
const PREVIEW_LABEL_FLOOR = 8;

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
