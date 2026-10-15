/**
 * Renaming (nameBook.ts): the box a name is typed into, standing where the name stands on the map; one at a
 * time. Out of createApp's closure (design review 2026-10-15) with the two things it needs handed in: the
 * world as it is now (`ws`), and what to do with a name once it is kept (`onKeep` writes it into the book
 * and draws the screen again — that is the app's business).
 */
import type { WorldState } from "./worldState";
import { properName } from "./properName";
import { featureLabel, worldNameIn } from "../engine/featureLabel";
import { t, type Lang } from "./i18n";

export interface RenameEditorOpts {
  /** the card the screens are drawn in: the box is heard here, after the zoom has swallowed a drag's click */
  stage: HTMLElement;
  lang: () => Lang;
  ws: () => WorldState;
  /** whether a name on the map opens a box to type in (the rename chip's state) */
  renaming: () => boolean;
  /** a name kept: `typed` as the reader left it, for `key` (`w`, `t<id>`, `r<id>`, `c<id>`, `g<i>`, `v<i>`, `p<id>`) */
  onKeep: (key: string, typed: string) => void;
}

export interface RenameEditor {
  open(key: string, at: Element, near?: Element): void;
  /** close the box: keeping what was typed, or leaving the name as it was */
  close(keep: boolean): void;
  /** where a name is written on the screen now: its label, or where a plate's road goes to its town */
  nameShownAt(key: string): Element | null;
  /** the name the world gave the place, as the map writes it: typed back, it takes the reader's away */
  bornName(key: string): string;
}

export function createRenameEditor(opts: RenameEditorOpts): RenameEditor {
  const { stage } = opts;
  let editor: { key: string; input: HTMLInputElement; hint: HTMLElement; follow: MutationObserver } | null = null;

  /** Which name a click on the map landed on: a label says (`data-name`); a town's dot, or where a
   * plate's road goes, says which town. */
  function nameKeyOf(target: Element): string | null {
    if (!target.closest?.("svg.world, svg.city")) return null;
    const named = target.closest("[data-name]")?.getAttribute("data-name");
    if (named) return named;
    const town = target.closest("[data-city]")?.getAttribute("data-city");
    return town ? `t${town}` : null;
  }

  function nameShownAt(key: string): Element | null {
    return stage.querySelector(`svg [data-name="${key}"]`)
      ?? (key[0] === "t" ? stage.querySelector(`svg.city [data-city="${key.slice(1)}"]`) : null);
  }

  /** A name as the map writes it in the reader's language: as it is now, or as the world was born with it.
   * A realm's and a people's are the bare word, without the form or the 인 the map adds. */
  function nameIn(key: string, born: boolean): string {
    const ws = opts.ws(), lang = opts.lang();
    const world = ws.generated.world, n = Number(key.slice(1));
    const word = (now: string | undefined, was: string | undefined) => {
      const w = born ? was : now;
      return w === undefined ? "" : properName(lang, w);
    };
    switch (key[0]) {
      case "w": return worldNameIn(born ? { name: ws.bornNames.world, nameLabel: world.nameLabel } : world, lang);
      case "t": {
        const i = world.cities.findIndex((c) => c.id === n);
        return word(world.cities[i]?.name, ws.bornNames.towns[i]);
      }
      case "r": return word(ws.history.polities[n]?.name, ws.bornNames.record[n]);
      case "c": return word(world.cultures[n]?.name, ws.bornNames.peoples[n]);
      case "g": case "v": case "p": {
        const item = key[0] === "g" ? world.regions[n] : key[0] === "v" ? world.rivers[n] : world.provinces.find((q) => q.id === n);
        return item ? featureLabel(born ? { ...item.label, custom: undefined } : item.label, lang) : "";
      }
    }
    return "";
  }

  /**
   * Open the box over a name. Enter keeps what is typed, Escape leaves the name as it was, and so does
   * an empty box — or the name the world gave, which takes the reader's away. Leaving the box any other
   * way keeps what was typed. It follows its name while the map is moved or zoomed under it.
   * @param near what was pressed, where the name itself is not drawn at this zoom
   */
  function open(key: string, at: Element, near: Element = at): void {
    close(false);
    const lang = opts.lang();
    const frame = at.closest(".map-frame") as HTMLElement | null;
    const map = at.closest("svg") as SVGSVGElement | null;
    if (!frame || !map) return;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "name-editor";
    input.value = nameIn(key, false);
    input.placeholder = nameIn(key, true);
    input.spellcheck = false;
    input.setAttribute("aria-label", t(lang, "renameLabel"));
    input.title = t(lang, "renameHint");
    // ...and said under the box, not only in its tooltip: "Enter keeps it · Esc leaves it" was found by
    // nobody who did not hover (design review 2026-10-15)
    const hint = document.createElement("span");
    hint.className = "name-editor-hint";
    hint.textContent = t(lang, "renameHint");
    let anchor = at;
    const place = () => {
      if (!anchor.isConnected) {
        const again = nameShownAt(key);
        if (!again) { close(true); return; }
        anchor = again;
      }
      let r = anchor.getBoundingClientRect();
      if (!r.width && !r.height && near.isConnected) r = near.getBoundingClientRect();
      const f = frame.getBoundingClientRect();
      input.style.left = `${r.left - f.left + r.width / 2}px`;
      input.style.top = `${r.top - f.top + r.height / 2}px`;
      input.style.width = `${Math.round(Math.max(150, Math.min(340, r.width + 36)))}px`;
      // the caption hangs under the box: its middle, and the box's half-height (its own line and padding) below
      hint.style.left = input.style.left;
      hint.style.top = `${r.top - f.top + r.height / 2 + input.offsetHeight / 2 + 4}px`;
    };
    const follow = new MutationObserver(place);
    follow.observe(map, { attributes: true, attributeFilter: ["viewBox"] });
    editor = { key, input, hint, follow };
    frame.append(input, hint);
    place();
    input.addEventListener("keydown", (e) => {
      // A syllable still being put together (a Korean one, always, until the next key) is the input
      // method's to finish: an Enter that finishes it keeps the name once it is written.
      if (e.isComposing) {
        if (e.key === "Enter") input.addEventListener("compositionend", () => close(true), { once: true });
        return;
      }
      if (e.key === "Enter") { e.preventDefault(); close(true); }
      // (and not out of the map-only view as well, which Escape also closes)
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(false); }
    });
    input.addEventListener("blur", () => { if (editor?.input === input) close(true); });
    input.focus({ preventScroll: true });
    input.select();
  }

  function close(keep: boolean): void {
    if (!editor) return;
    const { key, input, hint, follow } = editor;
    editor = null;
    follow.disconnect();
    input.remove();
    hint.remove();
    // the name the world gave takes the reader's away: said by the app, which owns the book
    if (keep) opts.onKeep(key, input.value);
  }

  // While renaming, a click on a name opens its box instead of the place it names (the maps' own click
  // handlers stand down). Heard on the stage, after the zoom has swallowed a drag's click.
  stage.addEventListener("click", (e) => {
    if (!opts.renaming()) return;
    const target = e.target as Element;
    const key = nameKeyOf(target);
    // a click on the map elsewhere keeps what was typed; a click on a name moves the box there
    close(true);
    if (!key) return;
    e.preventDefault();
    // ...which may have drawn the screen again under the name just kept
    const at = target.isConnected ? (target.closest("[data-name]") ?? nameShownAt(key) ?? target) : nameShownAt(key);
    if (at) open(key, at, target.isConnected ? target : at);
  });
  // ...and a press on the map, or on its buttons, does not take the keyboard from the box: the click after
  // it decides. (Taken, the box kept its name and drew the screen again under the press, and the click
  // that followed landed on nothing.)
  stage.addEventListener("mousedown", (e) => {
    const on = e.target as Element;
    if (editor && on !== editor.input && on.closest?.(".map-frame")) e.preventDefault();
  });

  return { open, close, nameShownAt, bornName: (key) => nameIn(key, true) };
}
