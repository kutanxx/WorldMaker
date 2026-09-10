import { toHangul } from "../engine/hangul";
import type { Lang } from "./i18n";

/**
 * A single invented proper noun, written for the reader's language.
 *
 * Cities, realms, peoples and rulers have no structure to render — they are one made-up word out of
 * the token tables in `names.ts`, and Korean writes a foreign name by transliterating it. That is
 * all `toHangul` does, and it is the whole of the rule here.
 *
 * ⚠ NOT for a name with an English common noun inside it. `province.name` and `world.name` are
 * composites ("the Hollow Realm", "Barrens of Dimbrerk") and carry letters — w, p — that no invented
 * word contains; they have a `label`, and they go through `featureLabel(label, lang)` instead.
 *
 * Kept out of `i18n.ts` on purpose: that module's scope note says it localises UI chrome and NOT
 * generated content, and this is generated content.
 */
export function properName(lang: Lang, name: string): string {
  return lang === "ko" ? toHangul(name) : name;
}

/**
 * The same thing shaped as `politicalLayer`'s `labelOf`. That layer is handed polities as
 * `{id, name?}` and knows nothing about language — a caller supplies the labeller, the way it
 * already supplies `colorOf`. Returned as a function of the id too, because the next task hangs a
 * realm's form of government (kingdom / republic / empire) off this same seam.
 */
export function polityLabeller(lang: Lang): (id: number, name: string) => string {
  return (_id, name) => properName(lang, name);
}
