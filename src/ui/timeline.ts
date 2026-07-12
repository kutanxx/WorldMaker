// Structural source type: Version A's History and play mode's SimState both satisfy it.
export interface TimelineSource {
  snapshots: { year: number }[];
}

export interface Timeline {
  element: HTMLElement;
  setIndex(i: number): void;
  destroy(): void;
}

const STEP_MS = 300;

export function createTimeline(
  history: TimelineSource,
  onIndex: (i: number) => void,
  formatYear: (y: number) => string = (y) => `${y}년`,
): Timeline {
  const max = history.snapshots.length - 1;

  const element = document.createElement("div");
  element.className = "timeline";

  const playBtn = document.createElement("button");
  playBtn.className = "timeline-play";
  playBtn.textContent = "▶";

  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "timeline-slider";
  slider.min = "0";
  slider.max = String(max);
  slider.step = "1";
  slider.value = "0";

  const year = document.createElement("span");
  year.className = "timeline-year";

  element.append(playBtn, slider, year);

  let timer: ReturnType<typeof setInterval> | null = null;
  let index = 0;

  const readout = (i: number) => { year.textContent = formatYear(history.snapshots[i].year); };

  function apply(i: number, fromSlider = false): void {
    index = Math.max(0, Math.min(max, i));
    if (!fromSlider) slider.value = String(index);
    readout(index);
    onIndex(index);
  }

  function stop(): void {
    if (timer !== null) { clearInterval(timer); timer = null; }
    playBtn.textContent = "▶";
  }

  function play(): void {
    if (index >= max) apply(0); // replay from the dawn
    playBtn.textContent = "⏸";
    timer = setInterval(() => {
      if (index >= max) { stop(); return; }
      apply(index + 1);
    }, STEP_MS);
  }

  playBtn.addEventListener("click", () => { if (timer === null) play(); else stop(); });
  slider.addEventListener("input", () => { stop(); apply(Number(slider.value), true); });

  readout(0);
  return { element, setIndex: (i: number) => apply(i), destroy: stop };
}
