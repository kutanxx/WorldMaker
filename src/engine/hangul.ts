// Writing an invented name the way Korean writes a foreign one.
//
// This is NOT a romanizer in reverse and must not become one. Every proper noun this project shows
// is assembled from the token tables in `names.ts` (DEFAULT_PHON) and `culture.ts`
// (CULTURE_PROFILES), and every repair in names.ts — weld, deStutter, collapseRuns, lengthen,
// dropEdge — only DELETES characters or joins two drawn tokens. None of them can introduce a letter
// no token contains. So the tables ARE the whole alphabet this function will ever be handed:
// 46 onsets, 15 vowels, 25 codas, and exactly 22 letters —
//     a b c d e f g h i j k l m n o r s t u v y z   (no p, q, w, x)
// plus the digraphs names.ts already treats as single sounds (th sh kh dh ch gg ck ph) and the
// nordic onset `fj`. Every rule below names the token it is there for, so the next reader can check
// the table against names.ts line by line rather than trusting this comment.
//
// A letter with no rule is left ALONE rather than dropped: hangul.test.ts sweeps twenty seeds for
// any Latin left in the output, and a silent fallback would hide the gap it exists to find.

// The Unicode layout of a Hangul syllable: 0xac00 + (onset*21 + nucleus)*28 + coda. korean.ts reads
// the same layout backwards (`% 28`) to decide a particle, which is the whole point of this file.
const ONSET = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
const NUCLEUS = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "weo", "we", "wi", "yu", "eu", "ui", "i"];
const CODA = ["", "g", "kk", "gs", "n", "nj", "nh", "d", "l", "lg", "lm", "lb", "ls", "lt", "lp", "lh", "m", "b", "bs", "s", "ss", "ng", "j", "ch", "k", "t", "p", "h"];

// Jamo are named, not numbered, in the tables below — a wrong index is a different letter and would
// be invisible, while a wrong name cannot be composed at all.
function jamo(table: readonly string[], name: string): number {
  const i = table.indexOf(name);
  if (i < 0) throw new Error(`hangul: no jamo "${name}"`);   // a typo in this file, never in a name
  return i;
}
function syllable(onset: string, nucleus: string, coda: string): string {
  return String.fromCharCode(0xac00 + (jamo(ONSET, onset) * 21 + jamo(NUCLEUS, nucleus)) * 28 + jamo(CODA, coda));
}

interface Cons {
  on: string;             // the jamo it opens a syllable with
  fill: string;           // the nucleus it takes when no vowel follows it. Korean gives a stranded
                          // consonant a syllable of its own — ㅡ normally (Smith 스미스), ㅣ after
                          // ㅅ/ㅈ/ㅊ (bridge 브리지), which is why Dhaishdhar's `sh` is 시 and not 스.
  coda?: string;          // the 받침 it becomes instead of a syllable of its own, where `hold` allows
  hold?: "any" | "end";   // "any": a nasal or ㄹ is a 받침 before any consonant and at the end
                          //   (Bern 베른, camp 캠프). "end": a voiceless stop is one only at the end
                          //   and only after a real vowel (book 북) — after a filler syllable it
                          //   stays its own (Bismarck 비스마르크), which is why `hold` is not a flag.
  glide?: true;           // never takes the vowel after it (see `fj`)
  twin?: true;            // BEFORE a vowel it also leaves its 받침 behind, so the sound is written
                          // twice: 글라스, 플랜, 클럽, 슬라이드, 이탈리아, 줄리아. Only ㄹ does this,
                          // and only when it is not opening the word (Korean writes 라, 로 there).
  glideVowel?: true;      // BEFORE a vowel, read the vowel as its Y-glide nucleus instead of its
                          // plain one — 샤 섀 셔 셰 쇼 슈, the way `sy`/`ly` already do (샤워, 샴푸,
                          // 쇼크, 슈퍼). A prevocalic [ʃ] takes a glide in Korean; a word-final or
                          // preconsonantal one does not (시 either way — see `fill` above and
                          // hangul.test.ts's `Sainkhaish`/`Dhaishdhar` pins), so this only touches
                          // the branch where a vowel is actually found after the consonant.
}

// Consonants, longest key first when scanned. Each row names the tokens that put the letters here.
const CONSONANTS: [string, Cons][] = [
  // digraphs — names.ts already counts each of these as ONE sound (its DIGRAPHS list), and a reader
  // of Korean expects the same: Khaagg opens 카, not 크하.
  ["th", { on: "s", fill: "eu" }],                       // onset th, thr · coda th
  ["sh", { on: "s", fill: "i", glideVowel: true }],      // onset sh, sha · coda sh — prevocalic [ʃ]
                                                         // takes the glide (Zaiashain 자이아샤인,
                                                         // Shazar 샤자르); `fill` still gives 시 when
                                                         // no vowel follows (Sainkhaish 사인카이시,
                                                         // and the preconsonantal Dhaishdhar 다이시다르)
  ["kh", { on: "k", fill: "eu" }],                       // onset kh (guttural, sibilant) · coda kh
                                                         // (guttural) — it ends words, not just opens
  ["dh", { on: "d", fill: "eu" }],                       // onset dh
  ["ch", { on: "ch", fill: "i" }],                       // no token spells it; names.ts DIGRAPHS does
  ["gg", { on: "g", fill: "eu" }],                       // onset gg · coda gg — ㄱ not ㄲ: Korean does
                                                         // not spell a loanword with a tense consonant
  ["ck", { on: "k", fill: "eu", coda: "g", hold: "end" }], // no token spells it; names.ts DIGRAPHS does
  ["ph", { on: "p", fill: "eu" }],                       // no token spells it; names.ts DIGRAPHS does
  ["fj", { on: "p", fill: "i", glide: true }],           // nordic onset fj — the j is a glide, so the
                                                         // vowel after it gets its own syllable and
                                                         // fjo comes out 피오, as fjord does (피오르드)

  // single letters — all 22 the tables can produce
  ["b", { on: "b", fill: "eu" }],                                  // onset br
  ["c", { on: "k", fill: "eu" }],                                  // onset c, cor
  ["d", { on: "d", fill: "eu" }],                                  // onset d, dr, nd(coda)
  ["f", { on: "p", fill: "eu" }],                                  // onset f, fj · coda fr
  ["g", { on: "g", fill: "eu" }],                                  // onset g, gr, gl, gru · coda gr
  ["h", { on: "h", fill: "eu" }],                                  // onset h, hr · coda h
  ["j", { on: "j", fill: "i" }],                                   // onset fj only
  ["k", { on: "k", fill: "eu", coda: "g", hold: "end" }],          // onset k, kr, sk · coda k, rk
  ["l", { on: "r", fill: "eu", coda: "l", hold: "any", twin: true }], // onset l, gl, el, li, ly, val,
                                                                   // mel · coda l, el — the codas are
                                                                   // what `hold` is here for, and `gl`
                                                                   // is what `twin` is here for
  ["m", { on: "m", fill: "eu", coda: "m", hold: "any" }],          // onset m, mel · coda m, um
  ["n", { on: "n", fill: "eu", coda: "n", hold: "any" }],          // onset n · coda n, nd, an, rn
  ["r", { on: "r", fill: "eu" }],                                  // onset r, br, tr, kr, gr, hr, vr,
                                                                   // cor · coda r, rk, or, ar, rn, fr
  ["s", { on: "s", fill: "eu" }],                                  // onset s, st, sk, sv, sy, sa, si
                                                                   // · coda s, us, is
  ["t", { on: "t", fill: "eu", coda: "s", hold: "end" }],          // onset t, tr, st — ㅅ is the 받침
                                                                   // Korean gives a final t (rocket 로켓)
  ["v", { on: "b", fill: "eu" }],                                  // onset v, vr, va, val, sv · coda vik
  ["z", { on: "j", fill: "eu" }],                                  // onset z, za · coda z
];

// Vowels. A cluster is written as its letters in turn — 카아 for `aa`, 다이 for `ai`, 로우 for `ou`,
// 히아 for `ia` — because that is what the three hand-checked names in hangul.test.ts show, and it
// is what Korean does with a foreign vowel run (house 하우스). The clusters are listed anyway, ahead
// of the single letters, so a future reader can give one a reading of its own (`ae` as 애, say)
// without touching the scanner.
//
// The `y` rows are the exception that earns the mechanism: y is a VOWEL in names.ts (its VOWELS
// string), and `sy`/`ly` meeting a vowel token makes 샤/료 rather than 시아/리오.
const VOWELS: [string, string[]][] = [
  ["ya", ["ya"]],          // onset sy, ly + vowel a; also + ea/ae, trimmed to one vowel by weld's
                           // two-vowel cap (Lyanael, Melearlyal)
  ["ye", ["ye"]],          // onset sy, ly + vowel e; also + ei/ae trimmed the same way (Syansyen)
  ["yo", ["yo"]],          // onset ly + vowel io, trimmed to o by weld's two-vowel cap
  ["yu", ["yu"]],          // no profile pairs them today; the row costs nothing and closes the glide
  ["yi", ["i"]],           // mostly liquid onset sy/ly + vowel ei/ea, trimmed to one vowel by weld's
                           // two-vowel cap (Syilin, Lyir, Elanlyil); also the nordic vowel y grown by
                           // lengthen. Korean writes yi as 이

  ["aa", ["a", "a"]],      // guttural vowel aa, sibilant vowel aa
  ["ae", ["a", "e"]],      // DEFAULT_PHON vowel ae, liquid onset/vowel ae
  ["ai", ["a", "i"]],      // sibilant vowel ai
  ["au", ["a", "u"]],      // guttural vowel au, nordic vowel au
  ["ea", ["e", "a"]],      // liquid vowel ea
  ["ei", ["e", "i"]],      // liquid vowel ei, nordic vowel ei
  ["ia", ["i", "a"]],      // DEFAULT_PHON / liquid / sibilant vowel ia
  ["io", ["i", "o"]],      // liquid vowel io
  ["ou", ["o", "u"]],      // DEFAULT_PHON vowel ou

  ["a", ["a"]], ["e", ["e"]], ["i", ["i"]], ["o", ["o"]], ["u", ["u"]],
  ["y", ["i"]],            // nordic vowel y, onsets sy/ly — Thykhy is 시키
];

// What a plain vowel nucleus becomes when `glideVowel` fires. `i` maps to itself because Korean's
// own "yi" row (above) already resolves to the bare ㅣ — 시 either way, so `Shi` needs no case here.
const Y_GLIDE: Record<string, string> = { a: "ya", e: "ye", i: "i", o: "yo", u: "yu" };

const CONS_BY_KEY = new Map(CONSONANTS);
const VOWEL_BY_KEY = new Map(VOWELS);
const longestKey = (t: [string, unknown][]) => t.reduce((n, [k]) => Math.max(n, k.length), 0);
const CONS_MAX = longestKey(CONSONANTS);
const VOWEL_MAX = longestKey(VOWELS);

function match<T>(table: Map<string, T>, max: number, w: string, i: number): [string, T] | null {
  for (let n = Math.min(max, w.length - i); n > 0; n--) {
    const key = w.slice(i, i + n);
    const hit = table.get(key);
    if (hit) return [key, hit];
  }
  return null;
}

interface Syl { on: string; nuc: string; coda: string; fromVowel: boolean }

/**
 * Write a generated Latin name in Hangul. Pure: no rng, no state, the same word always the same
 * string — the map is drawn from a seed and a name that moved between two renders would move the
 * label with it.
 */
/**
 * A single invented proper noun, written for the reader's language. Cities, realms, peoples and
 * rulers have no structure to render — one made-up word out of the token tables above — so Korean
 * writes it by transliterating it (`toHangul`) and English leaves it alone. That one-line rule was
 * written out independently at six call sites (chronicleLines.ts x2, eventText.ts, gazetteer.ts,
 * naturalHistory.ts, and `properName` in src/ui/properName.ts) as four different tasks each reached
 * for it; this is the one home for it, beside the transliterator it wraps. Takes `ko` rather than a
 * `lang` union because every call site already computes `const ko = lang === "ko"` for its own
 * sentence-building, and `toHangul` itself takes no language argument to thread through.
 */
export function properNoun(ko: boolean, word: string): string {
  return ko ? toHangul(word) : word;
}

export function toHangul(word: string): string {
  const w = word.toLowerCase();
  const parts: (Syl | string)[] = [];
  let i = 0;

  // The syllable a 받침 could still be added to: the one just written, if it has none yet. Read off
  // the tail rather than tracked in a variable, so a syllable that already closed and a letter that
  // fell through unwritten both end the run without any bookkeeping to keep in step.
  const open = (): Syl | null => {
    const last = parts[parts.length - 1];
    return typeof last === "object" && last.coda === "" ? last : null;
  };
  const vowelSyllables = (nuclei: string[], onset: string | null) => {
    // Only the first nucleus can belong to the consonant before it; a run like the `aa` of Khaagg
    // spills into syllables of its own, opened by the silent ㅇ (카아).
    nuclei.forEach((nuc, k) => parts.push({ on: k === 0 && onset !== null ? onset : "", nuc, coda: "", fromVowel: true }));
  };

  while (i < w.length) {
    const v = match(VOWEL_BY_KEY, VOWEL_MAX, w, i);
    const c = match(CONS_BY_KEY, CONS_MAX, w, i);
    if (v && (!c || v[0].length >= c[0].length)) {
      i += v[0].length;
      vowelSyllables(v[1], null);
      continue;
    }
    if (!c) { parts.push(w[i]); i++; continue; }   // outside the inventory: left visible

    const [key, rule] = c;
    i += key.length;
    const after = rule.glide ? null : match(VOWEL_BY_KEY, VOWEL_MAX, w, i);
    if (after) {
      i += after[0].length;
      // A prevocalic ㄹ that is not word-initial is written TWICE — a 받침 on the syllable before
      // it as well as the onset of its own. `open()` returning null is exactly the word-initial
      // case (nothing has been written yet), so 라/로 at the head of a name falls out for free.
      // Without this `l` and `r` produce identical strings; the ㄹㄹ is how Korean keeps 멜리아
      // and 메리아 apart, and `gl` is one of DEFAULT_PHON's fourteen onsets.
      if (rule.twin && rule.coda) {
        const host = open();
        if (host) host.coda = rule.coda;
      }
      // Only the FIRST nucleus can carry the glide — it is the one the onset actually meets. A run
      // like `shai` still spills the rest into their own syllables the normal way (샤이, not 샤야이).
      const nuclei = rule.glideVowel
        ? after[1].map((n, k) => (k === 0 ? (Y_GLIDE[n] ?? n) : n))
        : after[1];
      vowelSyllables(nuclei, rule.on);
      continue;
    }
    // Nothing to open a syllable with. A word-final letter is one the reader stops on, so a
    // following letter that has no rule counts as the end too.
    const atEnd = !/[a-z]/.test(w[i] ?? "");
    const host = open();
    if (rule.coda && host && (rule.hold === "any" || (rule.hold === "end" && atEnd && host.fromVowel))) {
      host.coda = rule.coda;
      continue;
    }
    parts.push({ on: rule.on, nuc: rule.fill, coda: "", fromVowel: false });
  }

  return parts.map((p) => (typeof p === "string" ? p : syllable(p.on, p.nuc, p.coda))).join("");
}
