import { toHangul, properNoun } from "../engine/hangul";
import type { GovernmentForm } from "../engine/government";
import { realmLabelEn, realmLabelKo, peopleLabelKo } from "../engine/nameSuffix";
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
 *
 * Delegates to `properNoun` (src/engine/hangul.ts) rather than restating `ko ? toHangul(s) : s`
 * itself — that one-line rule was written out independently at six call sites (four in the engine,
 * this one, and `chronicleLines.ts`'s second inline copy) as separate tasks each reached for it.
 */
export function properName(lang: Lang, name: string): string {
  return properNoun(lang === "ko", name);
}

/**
 * The same thing shaped as `politicalLayer`'s `labelOf`. That layer is handed polities as
 * `{id, name?}` and knows nothing about language — a caller supplies the labeller, the way it
 * already supplies `colorOf`. Takes the id because a realm's form of government (kingdom / republic
 * / empire) lives in `history`, not on the polity object, and is looked up by id.
 *
 * `forms` is optional so every existing call site that has no history handy (a caller mid-migration,
 * a test) keeps working exactly as before: plain transliteration, no government word. When it IS
 * given and Korean is asked for, the realm's own name is handed straight to `realmLabelKo` — NOT
 * wrapped through `properName` first, which would run already-Korean text back through `toHangul`
 * and produce nonsense. That is why this function does not simply compose `properName` with a
 * suffix: it replaces the transliterating call for the one case that needs more than a name.
 */
/**
 * @param spellForm say what kind of state it is in words. Ignored in Korean, which always does —
 * the word is the only device Korean has here, and 왕국 is two characters even on a map label.
 * English has case: on the map the typography carries it (`svg.world.lang-en .nation-label` in
 * theme.css), because the word measured **2.04x** the label there, and this is spent only where a
 * reader has neither typography nor a legend to read it from — the town list, the plate's facts.
 */
export function polityLabeller(lang: Lang, forms?: Map<number, GovernmentForm>,
                               spellForm = false): (id: number, name: string) => string {
  return (id, name) => {
    const form = forms?.get(id)?.form;
    if (lang !== "ko") return spellForm && form ? realmLabelEn(name, form) : name;
    return form ? realmLabelKo(name, form) : toHangul(name);
  };
}

/**
 * A people's name, written for the reader's language, marked as a PEOPLE rather than as a place —
 * the culture view's map label and legend row are the two sites that draw a culture's name STANDING
 * ALONE, the same boundary `polityLabeller` draws for a realm's heading. Takes the raw Latin name and
 * calls `peopleLabelKo` directly, the same way `polityLabeller` calls `realmLabelKo` directly, rather
 * than composing `properName(lang, name) + "인"`: chaining through `properName` first would run
 * already-transliterated Korean back through `toHangul` a second time (its token tables match Latin
 * letters, not Hangul) and produce nonsense, the exact trap `nameSuffix.ts`'s own doc comment warns
 * every caller off.
 */
export function peopleLabel(lang: Lang, name: string): string {
  return lang === "ko" ? peopleLabelKo(name) : name;
}
