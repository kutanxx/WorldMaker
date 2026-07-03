import "./theme.css";

export function renderStub(root: HTMLElement): void {
  root.innerHTML = `
    <h1 class="app-title">Empire</h1>
    <div class="stub">
      <p class="stub-badge">Coming soon · 준비 중</p>
      <p>Rule a nation, advance the years, and shape the fate of your realm.<br>
      한 나라의 군주가 되어 연도를 진행하고 제국을 이끄는 모드입니다.</p>
      <a class="home-link" href="index.html">← Home</a>
    </div>`;
}

const root = document.getElementById("play");
if (root) renderStub(root);
