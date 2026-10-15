/**
 * The bar across the top of the map page, and the world's settings under it: the controls, built once, and
 * their words in the reader's language (`applyLang`). Out of createApp's closure (design review 2026-10-15);
 * what each control DOES is the app's — it hangs the handlers on the elements returned here.
 */
import type { WorldParams } from "../types/world";
import { icon, sign } from "./icons";
import { t, type Lang } from "./i18n";

export interface DialRow { key: keyof WorldParams; name: HTMLSpanElement; input: HTMLInputElement; read: HTMLOutputElement }

export interface Toolbar {
  controls: HTMLDivElement;
  homeBtn: HTMLAnchorElement;
  backBtn: HTMLButtonElement;
  randomBtn: HTMLButtonElement;
  seedGroup: HTMLDivElement;
  seedInput: HTMLInputElement;
  regenBtn: HTMLButtonElement;
  viewToggle: HTMLDivElement;
  terrainBtn: HTMLButtonElement;
  politicalBtn: HTMLButtonElement;
  cultureBtn: HTMLButtonElement;
  provinceBtn: HTMLButtonElement;
  inkBtn: HTMLButtonElement;
  moreBtn: HTMLButtonElement;
  exportGroup: HTMLDivElement;
  jsonBtn: HTMLButtonElement;
  pngBtn: HTMLButtonElement;
  svgBtn: HTMLButtonElement;
  linkBtn: HTMLButtonElement;
  gazBtn: HTMLButtonElement;
  langBtn: HTMLButtonElement;
  /** the world's settings: the dials, folded away, with the world's fingerprint under them */
  advanced: HTMLDetailsElement;
  dialRows: DialRow[];
  fingerprintCode: HTMLElement;
  /** every UI string from the current language (on init and on language toggle) */
  applyLang(): void;
  /** the fold of a narrow window's bar: shown, and said on the button */
  syncMore(on: boolean): void;
  /** the seed box and the dials, as the world is */
  showParams(params: WorldParams): void;
}

export interface ToolbarOpts {
  params: WorldParams;
  lang: () => Lang;
  /** a dial released: the world it asks for; false when the reader chose to stay (the dial goes back) */
  onDial: (key: keyof WorldParams, value: number) => boolean;
}

export function createToolbar(opts: ToolbarOpts): Toolbar {
  const lang = opts.lang;
  const controls = document.createElement("div");
  controls.className = "controls";

  const homeBtn = document.createElement("a"); // back to the landing chooser (index.html — relative for the Pages subpath)
  homeBtn.className = "home";
  homeBtn.setAttribute("href", "index.html");
  // The house, and the site's name: a desktop window shows the name here and takes the big title off
  // the page (theme.css) — its 68px, and the second row the bar wrapped to, were the map's.
  const homeIcon = document.createElement("span");
  homeIcon.className = "home-icon";
  homeIcon.appendChild(icon("home"));   // drawn, not the 🏠 emoji: every sign in the bar is one drawing (icons.ts)
  const homeWord = document.createElement("span");
  homeWord.className = "home-word";
  homeWord.textContent = "WorldMaker";
  homeBtn.append(homeIcon, homeWord);
  // The seed box and its button are ONE control: the button applies the number beside it. Measured
  // apart, they read as two rival ways to make a world sitting next to a third (the die), all in
  // the same colour — and the one called "Generate" is the one that does nothing visible when the
  // seed has not been edited, because it re-runs the world already on screen.
  const seedGroup = document.createElement("div");
  seedGroup.className = "seed-group";
  const seedInput = document.createElement("input");
  seedInput.type = "number";
  seedInput.value = String(opts.params.seed);
  const regenBtn = document.createElement("button");
  // ★ The box says what it holds. It was a bare number beside "생성", next to "새 세계" — two ways to make a
  // world and nothing to say what the number was (live, 2026-10-08). The word wraps the box, so it is the
  // box's label wherever it stands, with no id to collide with another page's.
  const seedLabel = document.createElement("label");
  seedLabel.className = "seed-label";
  const seedWord = document.createElement("span");
  seedLabel.append(seedWord, seedInput);
  seedGroup.append(seedLabel, regenBtn);
  // ...and a number typed and entered opens its world, as the button beside it does
  seedInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); regenBtn.click(); } });
  // The primary action, and the only one in the bar: a die always yields a world you have not seen.
  // World-only: on a plate it threw the plate AND its world away, and Back then left the address on
  // the old world with the new one on screen.
  const randomBtn = document.createElement("button");
  randomBtn.className = "random-seed primary world-only";
  // ★ The way off a plate, in the bar with the page's other way off a screen. It was a bar of its
  // own across the whole card — 1093px wide at 1440x900, 336 on a phone, the biggest control on the
  // page — standing between the toolbar and the drawing: an accident of the card becoming a flex
  // column (and later a grid), never a decision. It shows only on a plate (`plate-only`).
  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "plate-back plate-only";
  // One control, not three buttons each repeating the verb: the formats name themselves and the
  // download arrow says what the group does. See the note in theme.css for what that bought.
  const exportGroup = document.createElement("div");
  exportGroup.className = "export-group";
  const exportIcon = document.createElement("span");
  exportIcon.className = "export-icon";
  exportIcon.appendChild(icon("download"));
  const jsonBtn = document.createElement("button");
  // the world's data: on a town's plate the PNG and the SVG are the plate, and this was still the world's
  jsonBtn.className = "world-only";
  const pngBtn = document.createElement("button");
  const svgBtn = document.createElement("button");
  exportGroup.append(exportIcon, jsonBtn, pngBtn, svgBtn);
  const gazBtn = document.createElement("button");
  gazBtn.className = "gazetteer";
  // ★ The link is the save: the world and every name the reader gave it ride in the address and nowhere else,
  // and nothing on the page said so but a tooltip on the rename chip. Copying it is the one way to keep a
  // world beyond this tab; the browser's own address bar is a step a reader has to know about.
  // It stands at the end of the files, the other way a world leaves this page, as a sign with its words in
  // its tooltip: the bar had no room for them in English (measured at 1440x900, any copy button with words
  // took the English bar to two rows).
  const linkBtn = document.createElement("button");
  linkBtn.type = "button";
  linkBtn.className = "copy-link";
  // two links of a chain, in the bar's own ink (the 🔗 emoji came out a pale lilac beside the formats' words) —
  // the first drawn sign in the bar, and the one the rest were drawn to match (icons.ts)
  linkBtn.appendChild(icon("link"));
  let copiedFor = 0;
  linkBtn.addEventListener("click", async () => {
    const url = location.href;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // no clipboard to write to (an old browser, a page not served over https): the link, to copy by hand
      window.prompt(t(lang(), "copyLinkManual"), url);
      return;
    }
    // said beside the button, over the page rather than in the bar, so nothing in the bar moves
    exportGroup.querySelector(".copy-done")?.remove();
    const said = document.createElement("span");
    said.className = "copy-done";
    said.setAttribute("role", "status");
    said.textContent = t(lang(), "copyLinkDone");
    exportGroup.appendChild(said);
    window.clearTimeout(copiedFor);
    copiedFor = window.setTimeout(() => said.remove(), 2500);
  });
  const langBtn = document.createElement("button");
  langBtn.className = "lang-toggle";
  const viewToggle = document.createElement("div");
  viewToggle.className = "view-toggle";
  const terrainBtn = document.createElement("button");
  const politicalBtn = document.createElement("button");
  const cultureBtn = document.createElement("button");
  const provinceBtn = document.createElement("button");
  viewToggle.append(terrainBtn, politicalBtn, cultureBtn, provinceBtn);
  // The map for print: one ink on white paper. Beside the views and not among them — it is how any of
  // them is drawn, not another thing to look at.
  const inkBtn = document.createElement("button");
  inkBtn.type = "button";
  inkBtn.className = "ink-toggle world-only";
  inkBtn.setAttribute("aria-pressed", "false");
  // The engine has read all of these from the URL since it was written — seaLevel, mountainLevel,
  // polityCount, townCount, cellCount — and there was no way to reach any of them from the page, so
  // a reader could only ever have the one world the defaults describe. Folded away, because the
  // toolbar's own lesson is that a control costs a row whether it is used or not.
  const advanced = document.createElement("details");
  advanced.className = "advanced";
  const advancedSummary = document.createElement("summary");
  advanced.appendChild(advancedSummary);
  // what moving one does, said before it is done: a setting is a new world, and Back brings this one again
  const advancedNote = document.createElement("p");
  advancedNote.className = "advanced-note";
  advanced.appendChild(advancedNote);
  // The world's fingerprint (engine/fingerprint.ts): no world is stored, every browser computes it from its
  // number, and this is how a reader checks that another browser or device computed the same one.
  const fingerprint = document.createElement("p");
  fingerprint.className = "fingerprint";
  const fingerprintWord = document.createElement("span");
  fingerprintWord.className = "fingerprint-word";
  const fingerprintCode = document.createElement("code");
  fingerprintCode.className = "fingerprint-code";
  const fingerprintNote = document.createElement("span");
  fingerprintNote.className = "fingerprint-note";
  fingerprint.append(fingerprintWord, " ", fingerprintCode, " ", fingerprintNote);
  const dials: { key: keyof WorldParams; min: number; max: number; step: number }[] = [
    { key: "seaLevel", min: 0.15, max: 0.55, step: 0.01 },
    { key: "mountainLevel", min: 0.4, max: 0.8, step: 0.01 },
    { key: "polityCount", min: 2, max: 12, step: 1 },
    { key: "townCount", min: 4, max: 60, step: 1 },
    { key: "cellCount", min: 1200, max: 9000, step: 200 },
  ];
  let shown: WorldParams = { ...opts.params };
  const dialRows: DialRow[] = dials.map(({ key, min, max, step }) => {
    const row = document.createElement("label");
    row.className = "advanced-row";
    const name = document.createElement("span");
    const input = document.createElement("input");
    input.type = "range";
    input.name = key;
    input.min = String(min); input.max = String(max); input.step = String(step);
    input.value = String(shown[key]);
    const read = document.createElement("output");
    read.textContent = String(shown[key]);
    input.addEventListener("input", () => { read.textContent = input.value; });
    // regenerate on release, not on every pixel of the drag: a world is a second of work
    input.addEventListener("change", () => {
      // ...and back where it was if the reader chose to stay in the world they renamed
      if (!opts.onDial(key, Number(input.value))) { input.value = String(shown[key]); read.textContent = input.value; }
    });
    row.append(name, input, read);
    advanced.appendChild(row);
    return { key, name, input, read };
  });
  // Ordered by what a reader is doing, in three zones the CSS separates by space rather than by
  // size: make a world, look at it, take it away. The language toggle and the home link are
  // furniture and sit at the two ends.
  /**
   * What a phone keeps out, and what folds away behind one control.
   *
   * Measured on a live 375x812 phone: the title and the toolbar came to 236px — 29% of the screen,
   * above a map 225px tall. The controls outweighed the thing they control. So the toolbar gets the
   * treatment the panels under the map got. What stays out is what a phone actually does here: go
   * home, roll a new world, and choose which map you are looking at. What folds is what a phone can
   * do least with — a numeric seed box that summons a number pad, three file downloads and a
   * markdown one, and a language toggle you set once.
   *
   * `world-only` is a second axis, not a smaller one: on a city plate the view toggles switch a map
   * that is not on screen and the seed box builds a world you would be leaving the plate to see.
   * Both stay on a wide window, where there is room and they read as a way back.
   */
  seedGroup.classList.add("secondary", "world-only");
  viewToggle.classList.add("world-only");
  exportGroup.classList.add("secondary");
  gazBtn.classList.add("secondary");
  langBtn.classList.add("secondary");
  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "more-toggle";
  // ⚠ The LABEL carries the state, not only the title: measured on a phone, the button read
  // "더 보기" whether the controls were shown or hidden, and the word for the open state lived in
  // `title` — which a touch screen never shows. A button says what pressing it does.
  const syncMore = (on: boolean) => {
    controls.classList.toggle("more-open", on);
    moreBtn.setAttribute("aria-expanded", String(on));
    moreBtn.textContent = t(lang(), on ? "lessToggle" : "moreToggle");
    moreBtn.title = t(lang(), on ? "moreHide" : "moreShow");
  };
  moreBtn.addEventListener("click", () => syncMore(!controls.classList.contains("more-open")));
  // ★ The fold's control goes BEFORE the zones it unfolds. It used to be last, so everything it
  // revealed was inserted in front of it: measured at 390x844, pressing it moved the button 56px
  // right and 100px down, and a second press in the same place landed on the view toggle. What a
  // disclosure opens belongs BELOW its own control, and in a wrapping bar "below" is "after".
  // ★ ...and the primary goes ahead of everything the fold reveals, for the same reason. The seed
  // box used to stand in front of the die, so opening the fold at 390x844 moved "새 세계" from x=76
  // to x=216 — the one control that must never move under a thumb. On a wide window the zone reads
  // the same either way round: the die, then the way to a particular world.
  exportGroup.appendChild(linkBtn);
  controls.append(homeBtn, backBtn, randomBtn, seedGroup, viewToggle, inkBtn, moreBtn, exportGroup, gazBtn, langBtn);
  syncMore(false);
  advanced.appendChild(fingerprint);

  // set every UI string from the current language (called on init and on language toggle)
  function applyLang(): void {
    const l = lang();
    moreBtn.textContent = t(l, controls.classList.contains("more-open") ? "lessToggle" : "moreToggle");
    moreBtn.title = t(l, controls.classList.contains("more-open") ? "moreHide" : "moreShow");
    // the document's own language, which is what a screen reader and a translation tool go by:
    // map.html declares lang="ko" and it used to stay that way whatever the toggle said
    document.documentElement.lang = l;
    advancedSummary.textContent = t(l, "advanced");
    advancedNote.textContent = t(l, "advancedNote");
    fingerprintWord.textContent = t(l, "fingerprint");
    fingerprintNote.textContent = t(l, "fingerprintNote");
    for (const d of dialRows) { d.name.textContent = t(l, d.key as never); d.name.title = t(l, `${d.key}Title`); }
    sign(backBtn, "back", t(l, "backToWorld"));
    homeBtn.title = t(l, "homeLabel"); // the house carries it; the word cost the toolbar a second row
    regenBtn.textContent = t(l, "generate");
    regenBtn.title = t(l, "seedTitle");
    seedWord.textContent = t(l, "seedLabel");
    seedInput.setAttribute("aria-label", t(l, "seedName"));   // the English word is a sign ("#") on screen
    seedInput.title = t(l, "seedTitle");
    sign(randomBtn, "die", t(l, "newWorld"));
    jsonBtn.textContent = t(l, "exportJson");
    // a data file that looks like a save and is not one: nothing here can open it again
    jsonBtn.title = t(l, "exportJsonTitle");
    pngBtn.textContent = t(l, "exportPng");
    svgBtn.textContent = t(l, "exportSvg");
    // what each format is for, for a reader who has never had to choose between them
    pngBtn.title = t(l, "exportPngTitle");
    svgBtn.title = t(l, "exportSvgTitle");
    exportIcon.title = t(l, "exportLabel"); // the verb, said once for the group
    sign(gazBtn, "book", t(l, "gazetteer"));
    gazBtn.title = t(l, "gazetteerTitle");
    linkBtn.setAttribute("aria-label", t(l, "copyLink"));
    linkBtn.title = t(l, "copyLinkTitle");
    terrainBtn.textContent = t(l, "terrain");
    politicalBtn.textContent = t(l, "political");
    cultureBtn.textContent = t(l, "culture");
    provinceBtn.textContent = t(l, "province");
    inkBtn.textContent = t(l, "inkToggle");
    inkBtn.title = t(l, "inkTitle");
    langBtn.textContent = t(l, "langToggle");
  }

  function showParams(params: WorldParams): void {
    shown = { ...params };
    seedInput.value = String(params.seed);
    for (const d of dialRows) { d.input.value = String(params[d.key]); d.read.textContent = String(params[d.key]); }
  }

  return {
    controls, homeBtn, backBtn, randomBtn, seedGroup, seedInput, regenBtn, viewToggle,
    terrainBtn, politicalBtn, cultureBtn, provinceBtn, inkBtn, moreBtn,
    exportGroup, jsonBtn, pngBtn, svgBtn, linkBtn, gazBtn, langBtn,
    advanced, dialRows, fingerprintCode, applyLang, syncMore, showParams,
  };
}
