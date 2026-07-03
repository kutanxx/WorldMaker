import "./theme.css";

export function renderStub(root: HTMLElement): void {
  root.innerHTML = `
    <h1 class="app-title">제국 시뮬레이션</h1>
    <div class="stub">
      <p>준비 중입니다 — 한 나라의 군주가 되어 연도를 진행하고 제국을 이끄는 모드입니다.</p>
      <a class="home-link" href="index.html">← 홈으로</a>
    </div>`;
}

const root = document.getElementById("play");
if (root) renderStub(root);
