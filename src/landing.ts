import "./theme.css";
import { hashStringToSeed } from "./engine/rng";
import { encodeParams } from "./ui/urlState";
import { DEFAULT_PARAMS } from "./types/world";
import { dailyName, dailyTarget } from "./ui/daily";

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

// "Narnia" → shareable targets: play keeps the NAME in the URL; map converts to the numeric
// params blob Version A already understands (same hashStringToSeed world either way).
export function nameTargets(name: string): { play: string; map: string } | null {
  const t = name.trim();
  if (t.length === 0) return null;
  return {
    play: "play.html#seed=" + encodeURIComponent(t),
    map: "map.html" + encodeParams({ ...DEFAULT_PARAMS, seed: hashStringToSeed(t) }),
  };
}

export function renderChooser(root: HTMLElement): void {
  root.innerHTML = `
    <div class="landing-hero">
      <h1 class="app-title">WorldMaker</h1>
      <p class="landing-tagline">A procedural fantasy atlas &amp; chronicle</p>
    </div>
    <div class="landing">
      <a class="choice-card" href="map.html">
        <div class="choice-icon">🗺</div>
        <div class="choice-title">Create a World</div>
        <p class="choice-desc">Generate a random fantasy world — explore its map, cities, rivers, history, and gazetteer.</p>
        <div class="choice-sub">세계 지도 만들기</div>
      </a>
      <a class="choice-card" href="play.html">
        <div class="choice-icon">🏛</div>
        <div class="choice-title">Play an Empire</div>
        <p class="choice-desc">Rule a nation, advance the years, and shape the fate of your realm.</p>
        <div class="choice-sub">제국 플레이</div>
      </a>
    </div>
    <div class="landing-name">
      <input class="name-seed" maxlength="40" placeholder="세계의 이름으로 시작 · start from a name (e.g. Narnia)" />
      <button class="name-play">▶ Play</button>
      <button class="name-map">🗺 Map</button>
    </div>
    <div class="landing-daily">
      <button class="name-daily">🗓 오늘의 세계 · Daily World — ${dailyName(new Date()).slice(6)}</button>
      <p class="landing-daily-sub">매일 자정(UTC) 새로운 세계 — 모두가 오늘 같은 세계에 도전합니다 · One shared world each day</p>
    </div>`;

  const input = root.querySelector(".name-seed") as HTMLInputElement;
  const go = (kind: "play" | "map") => {
    const t = nameTargets(input.value);
    if (t) location.assign(t[kind]);
  };
  (root.querySelector(".name-play") as HTMLButtonElement).addEventListener("click", () => go("play"));
  (root.querySelector(".name-map") as HTMLButtonElement).addEventListener("click", () => go("map"));
  (root.querySelector(".name-daily") as HTMLButtonElement).addEventListener("click", () => location.assign(dailyTarget(new Date())));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") go("play"); });
}

const root = document.getElementById("landing");
if (root) {
  const target = redirectTarget(location.hash);
  if (target) location.replace(target);
  else renderChooser(root);
}
