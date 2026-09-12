import type { World } from "../types/world";
import type { History } from "../engine/history";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import { buildChronicle, isMoment } from "../engine/chronicleLines";

// The world is needed because the chronicle is not only the events the simulation recorded: most of
// it is mined out of the territory snapshots, and reading those means knowing whose land is whose.
// Both the caption below and the downloaded gazetteer come off `buildChronicle`, so the sentence on
// screen can never be one the document does not also carry.

/**
 * The chronicle as ONE LINE, under the scrubber: what had last happened by the year the reader is
 * standing in.
 *
 * The panel this replaces held every moment of the history — 48 rows on seed 3 — under a map the
 * reader was actually looking at, and the reader's answer to "do you read it?" was no. The honest
 * reduction is not a smaller list but a caption: the map already moved when the year moved, and
 * what was missing beside it was the sentence saying WHY.
 *
 * ⚠ It is the LAST line at or before the year, not the year's own, and that is the whole design.
 * History here is bursty: measured over 12 seeds, 43.5 events land on 51 scrub steps and **54% of
 * the steps have nothing at all**, with empty runs of 34 steps (340 years) at the worst. A caption
 * showing only the current year's events would be blank more often than not. Carrying the last one
 * forward, it is never blank after the founding, and it reads as the state of the world rather
 * than as an event log.
 */
export interface ChronicleCaption { element: HTMLElement; setYear(year: number): void }

export function renderChronicleCaption(world: World, history: History, lang: Lang): ChronicleCaption {
  const lines = buildChronicle(world, history, lang)
    .filter((l) => isMoment(l.kind))
    .sort((a, b) => a.year - b.year || a.rank - b.rank);
  const element = document.createElement("p");
  element.className = "chronicle-caption";
  // A live region: the scrubber changes this text without moving focus, so a screen reader would
  // otherwise never learn that the year it just chose has a sentence attached.
  element.setAttribute("aria-live", "polite");
  const setYear = (year: number): void => {
    let last = -1;
    for (let i = 0; i < lines.length; i++) if (lines[i].year <= year) last = i;
    if (last < 0) { element.textContent = ""; element.hidden = true; return; }
    element.hidden = false;
    const shown = lines[last];
    // ...and how many others share that year, so a busy year does not silently show one of six
    const also = lines.filter((l) => l.year === shown.year).length - 1;
    // the kind travels with the line, so a conquest can still be coloured differently from a
    // founding — the stylesheet already had rules for these and they now apply to one line
    element.className = `chronicle-caption evt-${shown.kind}`;
    element.textContent = also > 0
      ? `${shown.text}${t(lang, "chronicleAlso").replace("{n}", String(also))}`
      : shown.text;
  };
  return { element, setYear };
}
