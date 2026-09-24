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
export interface ChronicleCaption {
  element: HTMLElement;
  setYear(year: number): void;
  /** how long the player should stay on snapshot `i` for its caption to be read, in ms; 0 = no longer than a step */
  dwellAt(i: number): number;
}

/**
 * What a caption LEADS with when one year holds several lines: what changed who holds the map
 * first, then what happened to a place, then the record. Sorted by `rank` — which only keeps the
 * output stable — the caption showed the year's last line, and measured over 12 seeds that was the
 * smaller news in 72 of 187 busy years, and in all twelve worlds it opened on "0년, <town>
 * 자유무역항 지정 외 3건" with the founding of every realm hidden in the "3건".
 */
export const HEADLINE_ORDER: readonly string[] = [
  "fall", "conquer", "independence", "civilwar", "foundings", "found", "empire", "hegemon",
  "plague", "famine", "flood", "fire", "winter", "goldenage", "culture", "newCity", "staple", "century",
];
/** the news the player stops for: the first eight of the order, the ones that redraw the map */
export const BIG_NEWS: ReadonlySet<string> = new Set(HEADLINE_ORDER.slice(0, 8));
const orderOf = (kind: string) => {
  const i = HEADLINE_ORDER.indexOf(kind);
  return i < 0 ? HEADLINE_ORDER.length : i;
};
/**
 * Reading speed, from Netflix's Korean subtitle guide (12 characters a second, adult programmes),
 * and the longest the player will wait on one line.
 */
const READ_CPS = 12;
const MAX_DWELL_MS = 3000;

export function renderChronicleCaption(world: World, history: History, lang: Lang): ChronicleCaption {
  const lines = buildChronicle(world, history, lang)
    .filter((l) => isMoment(l.kind))
    .sort((a, b) => a.year - b.year || a.rank - b.rank);
  // The lead line of the latest year at or before `year`, and how many others shared that year.
  const headlineAt = (year: number) => {
    let latest = -Infinity;
    for (const l of lines) if (l.year <= year && l.year > latest) latest = l.year;
    if (latest === -Infinity) return null;
    const same = lines.filter((l) => l.year === latest);
    // the first of the most important wins a tie, so the same world always leads the same way
    const lead = same.reduce((a, b) => (orderOf(b.kind) < orderOf(a.kind) ? b : a));
    return { lead, also: same.length - 1 };
  };
  // ★ The headline, not the detail: the realms a founding names, a fall's last holding, the reign it
  // happened under stay in the gazetteer (`ChronicleLine.short`, and see the note there).
  const wordsOf = (h: NonNullable<ReturnType<typeof headlineAt>>) => {
    const base = h.lead.short ?? h.lead.text;
    return h.also > 0 ? `${base}${t(lang, "chronicleAlso").replace("{n}", String(h.also))}` : base;
  };
  const element = document.createElement("p");
  element.className = "chronicle-caption";
  // A live region: the scrubber changes this text without moving focus, so a screen reader would
  // otherwise never learn that the year it just chose has a sentence attached.
  element.setAttribute("aria-live", "polite");
  const setYear = (year: number): void => {
    const h = headlineAt(year);
    if (!h) { element.textContent = ""; element.hidden = true; return; }
    element.hidden = false;
    // the kind travels with the line, so a conquest can still be coloured differently from a
    // founding — the stylesheet already had rules for these and they now apply to one line.
    // "외 N건" says how many others shared the year, so a busy year does not show one of six in silence.
    element.className = `chronicle-caption evt-${h.lead.kind}`;
    element.textContent = wordsOf(h);
  };
  // ★ Played, the caption changed on 360 of 612 steps — half a second a line, where a 25-character
  // Korean line wants two. So a step whose caption is NEW and BIG asks the player to stay for as
  // long as it takes to read (capped); small news and news already on screen pass at the old pace.
  // Measured over 12 seeds: ~15 such stops a world, a play-through of about 40s instead of 15.
  const dwellAt = (i: number): number => {
    const snaps = history.snapshots;
    if (i < 0 || i >= snaps.length) return 0;
    const h = headlineAt(snaps[i].year);
    if (!h || !BIG_NEWS.has(h.lead.kind)) return 0;
    const before = i > 0 ? headlineAt(snaps[i - 1].year) : null;
    if (before && before.lead === h.lead) return 0;
    return Math.min(MAX_DWELL_MS, Math.round([...wordsOf(h)].length / READ_CPS * 1000));
  };
  return { element, setYear, dwellAt };
}
