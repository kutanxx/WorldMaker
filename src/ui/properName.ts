import { toHangul } from "../engine/hangul";
import type { GovernmentForm } from "../engine/government";
import { realmLabelKo } from "../engine/nameSuffix";
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
export function polityLabeller(lang: Lang, forms?: Map<number, GovernmentForm>): (id: number, name: string) => string {
  return (id, name) => {
    if (lang !== "ko") return name;
    const form = forms?.get(id)?.form;
    return form ? realmLabelKo(name, form) : toHangul(name);
  };
}
