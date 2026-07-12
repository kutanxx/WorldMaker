// Tap-strip tooltips — touch devices can't hover, so the title-attribute explanations
// (stance multipliers, chip factors, goal conditions, meter help…) surface in a fixed
// bottom strip on tap. ONE delegated listener covers every present and future [title]
// element; buttons still fire their own actions — the strip is additive, never blocking.
export const TIP_MS = 4000;

function prefersCoarse(): boolean {
  try { return typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches; }
  catch { return false; } // jsdom / ancient browsers: behave like desktop
}

export function installTipStrip(root: HTMLElement, coarse: boolean = prefersCoarse()): () => void {
  if (!coarse) return () => {};
  const strip = document.createElement("div");
  strip.className = "tip-strip";
  document.body.appendChild(strip);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const hide = () => { strip.classList.remove("show"); };
  const onClick = (e: Event) => {
    const el = (e.target as Element).closest?.("[title]");
    const tip = el?.getAttribute("title") ?? "";
    if (!tip) return; // untitled or empty: leave any active tip alone
    strip.textContent = tip;
    strip.classList.add("show");
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(hide, TIP_MS);
  };
  root.addEventListener("click", onClick);
  return () => {
    root.removeEventListener("click", onClick);
    if (timer !== null) clearTimeout(timer);
    strip.remove();
  };
}
