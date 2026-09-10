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

  // The slider ran the whole five centuries with nothing written on it but the readout of wherever
  // the thumb happened to be, so reaching a century meant hunting. The marks are drawn here rather
  // than left to <datalist>, which some browsers render as ticks and others ignore entirely — and
  // the complaint was about not knowing WHERE 300 is, which a tick alone does not answer. A number
  // does.
  const first = history.snapshots[0]?.year ?? 0;
  const last = history.snapshots[max]?.year ?? 0;
  const span = Math.max(1, last - first);
  const ticks = document.createElement("div");
  ticks.className = "timeline-ticks";
  for (let y = Math.ceil(first / 100) * 100; y <= last; y += 100) {
    const tick = document.createElement("span");
    tick.className = "timeline-tick";
    tick.textContent = String(y);
    // Positioned as a fraction of the run rather than by index, so a world of a different length
    // marks its own centuries in the right places — and inset by half a thumb at each end, because
    // that is where the thumb's centre can actually reach. A flat percentage put "500" 22px short
    // of the end of its own slider, measured at 1920.
    const f = (y - first) / span;
    tick.style.left = `calc(var(--thumb) / 2 + (100% - var(--thumb)) * ${f})`;
    ticks.appendChild(tick);
  }

  const track = document.createElement("div");
  track.className = "timeline-track";
  track.append(slider, ticks);
  element.append(playBtn, track, year);

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
