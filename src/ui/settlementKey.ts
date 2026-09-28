import { t, type Lang } from "./i18n";
import { capitalMark, townMark, freePortMark, type KeyRow } from "./renderer";

/**
 * The rows every key of the world map ends with: the marks every view draws over its ground — a capital's
 * star, a town's dot and a free port's gold diamond — drawn as the map draws them.
 *
 * No key said what they were (found reviewing the live site, 2026-09-28): the terrain key named the ground,
 * the realms' key the realms, the peoples' key the peoples, and a reader was left to guess the diamond.
 * Worded here and handed to the layers finished, the way the realms' key already takes its title, so the
 * layers stay free of the i18n table. A free port's row only where the map draws free ports.
 */
export function settlementKeyRows(lang: Lang, freePorts: boolean): KeyRow[] {
  return [
    [t(lang, "keyCapital"), capitalMark],
    [t(lang, "keyTown"), townMark],
    ...(freePorts ? [[t(lang, "keyFreePort"), freePortMark] as KeyRow] : []),
  ];
}
