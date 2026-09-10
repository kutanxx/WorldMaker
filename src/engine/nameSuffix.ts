import { toHangul } from "./hangul";
import type { Government } from "./government";

// Two complaints about the generated names, and one Korean fix for both, WITHOUT the generator
// changing a single name: a realm reads like a town because a name and its capital came out of the
// same phonology with nothing to tell them apart, and a people reads like a place for the same
// reason. Korean marks both with a suffix — 케우스두 왕국 (a kingdom, not a town), 드루스브라우인 (a
// people, not a place) — so this module is the whole of that fix. It never touches `names.ts`.

// The noun a realm's form of government is called by. Free cities are classified "republic" by
// `classifyGovernments` however they are worded in a sentence elsewhere (gazetteer.ts's "자유도시"),
// so the heading a reader sees at a glance says the same three words the map and the gazetteer's
// own government classifier already agree on.
const FORM_WORD: Record<Government, string> = {
  kingdom: "왕국",
  // 자유도시, not 공화국. Every other line of the document already says 자유도시 — five times a
  // realm against 공화국 once — and a five-tile city that threw off a crown is not a republic in
  // the modern sense the word carries. The three forms still read as three kinds of polity.
  republic: "자유도시",
  empire: "제국",
};

/**
 * A realm's name, written for Korean, with the word for what kind of state it is.
 *
 * Takes the LATIN name and transliterates INSIDE — callers must not run it through `toHangul` or
 * `properName` first, or the already-Korean text would be handed back through `toHangul` a second
 * time and come out as nonsense (the token tables `toHangul` matches against are Latin letters).
 *
 * The suffix is a separate WORD here, unlike `peopleLabelKo`'s: "케우스두 왕국" is two words the way
 * "the Kingdom of X" is, while a people-name-plus-인 is one word the way a demonym is in English
 * ("Ceusdun", not "Ceusdu n"). Getting the two suffixes to agree on spacing would make one of them
 * wrong Korean.
 */
export function realmLabelKo(name: string, form: Government): string {
  return `${toHangul(name)} ${FORM_WORD[form]}`;
}

/**
 * A people's name, marked as a PEOPLE rather than as a place — the second half of the same
 * complaint `realmLabelKo` answers. Korean does not put a space before 인 here: it fuses onto the
 * transliterated name the way an English demonym fuses onto a place name, so 드루스브라우 (a place,
 * read alone) becomes 드루스브라우인 (its people) rather than the two-word "드루스브라우 인", which
 * would read as "person of Druthvrau" rather than as the people's own name.
 */
export function peopleLabelKo(name: string): string {
  return `${toHangul(name)}인`;
}
