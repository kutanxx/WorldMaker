// The worlds a reader named, kept in this browser so a closed tab does not take them away.
//
// A world and the names a reader gives its places live in its link and nowhere else; renamed, then closed
// without the link copied, the names were gone (audit, 2026-10-08). What comparable tools learned, and this
// list keeps to (research, 2026-10-08):
// - browser storage is a safety net, not the save, and says so — Safari clears a site's storage after seven
//   days unused, a private window when it closes — so the front page says "this browser only";
// - their worst losses came from ONE slot overwritten (Excalidraw's scene, Azgaar's lastMap), so it is one
//   line to a world, updated in place;
// - a short list, newest first, each line removable (VS Code's recent list); nothing on a first visit, and
//   no world opened by itself.
// Only a world the reader named is kept: a world they merely looked at has nothing in it to lose.

import type { Lang } from "./i18n";

export interface RecentWorld {
  /** the world, as its address names it without the reader's names (one line to a world) */
  key: string;
  /** the address that opens it again, names and all — always this site's own map.html#… */
  url: string;
  /** what the reader calls it, in the language they were reading */
  name: string;
  /** how many names the reader gave it */
  count: number;
  /** when they last named something in it (ms) */
  at: number;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;
const KEY = "wm:recent:v1";   // one origin holds every kutanxx.github.io site: the prefix is WorldMaker's
export const RECENT_KEEP = 10;
export const RECENT_SHOW = 5;

function defaultStorage(): StorageLike | null {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
}

const isWorld = (w: unknown): w is RecentWorld => {
  const v = w as RecentWorld;
  return !!v && typeof v === "object" && typeof v.key === "string" && typeof v.name === "string"
    && typeof v.count === "number" && typeof v.at === "number" && typeof v.url === "string"
    // only an address this site wrote: anything else in the slot is not ours to put in a link
    && /^map\.html#[^\s"'<>]*$/.test(v.url);
};

/** The list, newest first — empty when nothing is kept, the value is not ours, or storage cannot be read. */
export function readRecent(storage: StorageLike | null = defaultStorage()): RecentWorld[] {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw) || !raw.every(isWorld)) return [];
    return (raw as RecentWorld[]).slice().sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

function write(list: RecentWorld[], storage: StorageLike | null): void {
  try { storage?.setItem(KEY, JSON.stringify(list)); } catch { /* full, or blocked: the link is still the save */ }
}

/** Keep a world at the head of the list (read again just before writing: another tab may have written), or
 *  let it go when it holds no names of the reader's any more. */
export function rememberWorld(w: RecentWorld, storage: StorageLike | null = defaultStorage()): void {
  const rest = readRecent(storage).filter((o) => o.key !== w.key);
  write(w.count > 0 ? [w, ...rest].slice(0, RECENT_KEEP) : rest, storage);
}

export function forgetWorld(key: string, storage: StorageLike | null = defaultStorage()): void {
  write(readRecent(storage).filter((o) => o.key !== key), storage);
}

export function clearRecent(storage: StorageLike | null = defaultStorage()): void {
  write([], storage);
}

/** "오늘", "어제", "3일 전" / "today", "yesterday", "3 days ago" — by the reader's calendar days. */
export function whenSaid(at: number, now: number, lang: Lang): string {
  const day = (t: number) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const days = Math.max(0, Math.round((day(now) - day(at)) / 86_400_000));
  if (lang === "ko") return days === 0 ? "오늘" : days === 1 ? "어제" : `${days}일 전`;
  return days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}
