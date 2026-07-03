import "./theme.css";

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
    </div>`;
}

const root = document.getElementById("landing");
if (root) {
  const target = redirectTarget(location.hash);
  if (target) location.replace(target);
  else renderChooser(root);
}
