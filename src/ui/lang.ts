// Language bootstrap — remember the player's choice, else follow the browser (the "stop
// clicking 한국어 every visit" fix). Storage failures must never break app startup.
import type { Lang } from "./i18n";

type StorageLike = Pick<Storage, "getItem" | "setItem">;
const KEY = "wm:lang";

function defaultStorage(): StorageLike | null {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
}

export function detectLang(navLang?: string, storage: StorageLike | null = defaultStorage()): Lang {
  try {
    const saved = storage?.getItem(KEY);
    if (saved === "ko" || saved === "en") return saved;
  } catch { /* fall through to detection */ }
  const nav = navLang ?? (typeof navigator !== "undefined" ? navigator.language : "");
  return nav.toLowerCase().startsWith("ko") ? "ko" : "en";
}

export function saveLang(lang: Lang, storage: StorageLike | null = defaultStorage()): void {
  try { storage?.setItem(KEY, lang); } catch { /* privacy mode — ignore */ }
}
