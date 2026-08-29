// Korean particle selection. Every generated sentence in this project attaches a particle to a name
// the generator invented, and until now each one shipped the placeholder — "Cianrium이(가)
// Karkhar을(를) 정복" — which is exactly the form a writer would have to hand-edit out of every
// line. The choice is determined by whether the preceding word ends in a consonant sound.

export type JosaPair = "이/가" | "을/를" | "은/는" | "와/과" | "으로/로";

// Whether the final sound closes on a consonant. Returns null when the word ends in something with
// no reading here (punctuation, a bracket), so callers can fall back rather than guess.
export function endsWithConsonant(word: string): boolean | null {
  const w = word.trim();
  if (!w) return null;
  const ch = w[w.length - 1];
  const code = w.charCodeAt(w.length - 1);

  // Hangul syllables are laid out so the trailing-consonant index is the remainder modulo 28.
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;

  // Latin names are read as they look: a final vowel letter reads open, anything else closed. This
  // is the convention Korean prose uses for foreign proper nouns, and it is why the rule has to be
  // about the LETTER rather than about the script.
  if (/[A-Za-z]/.test(ch)) return !/[aeiouAEIOU]/.test(ch);

  // Digits are read aloud, and their Korean readings end: 0 영, 1 일, 2 이, 3 삼, 4 사, 5 오,
  // 6 육, 7 칠, 8 팔, 9 구.
  if (/[0-9]/.test(ch)) return [true, true, false, true, false, false, true, true, true, false][Number(ch)];

  return null;
}

// `ㄹ` is the exception for 으로/로: a word closing on it takes 로, like a word ending in a vowel.
function endsWithRieul(word: string): boolean {
  const w = word.trim();
  const code = w.charCodeAt(w.length - 1);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 === 8;   // 8 is ㄹ
  return /[lrLR]/.test(w[w.length - 1] ?? "");
}

// Written out rather than derived by splitting the label, because the pairs are NOT consistently
// ordered: 이/가 and 을/를 name the post-consonant form first, while 와/과 names it second. Relying
// on position silently returns 와 where 과 belongs.
const FORMS: Record<JosaPair, { closed: string; open: string }> = {
  "이/가": { closed: "이", open: "가" },
  "을/를": { closed: "을", open: "를" },
  "은/는": { closed: "은", open: "는" },
  "와/과": { closed: "과", open: "와" },
  "으로/로": { closed: "으로", open: "로" },
};

// Pick the right half of a particle pair for the word it follows. The word itself is not included,
// so a caller can place it inside a longer template.
export function josa(word: string, pair: JosaPair): string {
  const { closed, open } = FORMS[pair];
  const c = endsWithConsonant(word);
  if (pair === "으로/로") return c === false || endsWithRieul(word) ? open : closed;
  return c === null ? open : c ? closed : open;
}

// The common case: the word with its particle already attached.
export function withJosa(word: string, pair: JosaPair): string {
  return word + josa(word, pair);
}
