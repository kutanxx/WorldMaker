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

// "Narnia" → a shareable map URL. The name is hashed to a seed, so the same word always opens the
// same world. It used to also return a `play` target; the games it pointed at are gone.
export function nameTargets(name: string): { map: string } | null {
  const t = name.trim();
  if (t.length === 0) return null;
  return { map: "map.html" + encodeParams({ ...DEFAULT_PARAMS, seed: hashStringToSeed(t) }) };
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
    </div>
    <div class="landing-name">
      <input class="name-seed" maxlength="40" placeholder="세계의 이름으로 시작 · start from a name (e.g. Narnia)" />
      <button class="name-map">🗺 세계 만들기 · Create</button>
    </div>
    <div class="landing-daily">
      <button class="name-daily">🗓 오늘의 세계 · Daily World — ${dailyName(new Date()).slice(6)}</button>
      <p class="landing-daily-sub">매일 자정(UTC) 새로운 세계 — 모두가 오늘 같은 세계에 도전합니다 · One shared world each day</p>
    </div>`;

  const input = root.querySelector(".name-seed") as HTMLInputElement;
  const go = () => {
    const t = nameTargets(input.value);
    if (t) location.assign(t.map);
  };
  (root.querySelector(".name-map") as HTMLButtonElement).addEventListener("click", go);
  (root.querySelector(".name-daily") as HTMLButtonElement).addEventListener("click", () => location.assign(dailyTarget(new Date())));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
}

const root = document.getElementById("landing");
if (root) {
  const target = redirectTarget(location.hash);
  if (target) location.replace(target);
  else renderChooser(root);
}
