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
    <h1 class="app-title">WorldMaker</h1>
    <div class="landing">
      <a class="choice-card" href="map.html">
        <div class="choice-title">🗺 세계 지도 만들기</div>
        <p class="choice-desc">랜덤 판타지 세계를 생성하고 지도·도시·역사·가제티어를 탐험합니다.</p>
      </a>
      <a class="choice-card" href="play.html">
        <div class="choice-title">🏛 제국 플레이</div>
        <p class="choice-desc">한 나라의 군주가 되어 연도를 진행하며 제국의 운명을 이끕니다.</p>
      </a>
    </div>`;
}

const root = document.getElementById("landing");
if (root) {
  const target = redirectTarget(location.hash);
  if (target) location.replace(target);
  else renderChooser(root);
}
