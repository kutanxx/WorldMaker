/**
 * What is said about a town's plate: the facts panel (kind, realm as of a year, people, founding, the towns
 * next door, the plate's fingerprint). A plate carried its name and nothing else, and there was no way off
 * it but back to the world map to hunt for another dot; the facts are the ones the world can actually
 * answer for. Out of createApp's closure (design review 2026-10-15): given the world, the town and the year,
 * it builds the panel; opening a neighbour is the app's (`openCity`).
 */
import type { CityMarker } from "../types/world";
import type { CityLayout } from "../engine/city";
import type { WorldState } from "./worldState";
import { cityFacts } from "./cityFacts";
import { KM_PER_UNIT } from "./scaleBar";
import { plateFingerprint } from "../engine/fingerprint";
import { t, type Lang } from "./i18n";

export function plateFactsPanel(ws: WorldState, marker: CityMarker, layout: CityLayout, lang: Lang, yearIndex: number, openCity: (id: number) => void): HTMLDivElement {
  const { history } = ws;
  // The plate answers for the year the reader scrubbed to, and says which year that was: the world map has a
  // scrubber to carry that, and a plate does not.
  // ★ ...unless the town was not there yet. The list used to offer every town at every year while the map
  // hid the ones not founded, and measured over 336 towns at year 0 — where every world starts — 170 plates
  // said "Realm — X · 0 AY" over "Founded — 360 AY". The list hides them now, but a shared link (`&city=N`)
  // still opens any town at year 0. Such a plate answers for the first year its town stood; the realm line
  // says which year that is.
  const founded = history.cityFoundings.find((f) => f.cityId === marker.id)?.year;
  let factIndex = yearIndex;
  if (founded !== undefined && history.snapshots[factIndex].year < founded) {
    const standing = history.snapshots.findIndex((s) => s.year >= founded);
    if (standing >= 0) factIndex = standing;
  }
  const snapNow = history.snapshots[factIndex];
  const facts = cityFacts(ws.generated.world, marker, layout, lang, KM_PER_UNIT, history.cityFoundings,
    { owner: snapNow.owner, polities: history.polities, year: snapNow.year }, ws.governmentForms);
  const panel = document.createElement("div");
  panel.className = "city-facts";
  const row = (label: string, value: string) => {
    const d = document.createElement("div");
    d.className = "city-fact";
    const k = document.createElement("span"); k.className = "city-fact-key"; k.textContent = label;
    const v = document.createElement("span"); v.className = "city-fact-value"; v.textContent = value;
    d.append(k, v);
    return d;
  };
  // The year the realm is true of stands on a line of its own under the name, in the facts' quiet
  // register: hung off the name ("케우스두 왕국 · 0년", "Ceusdu Kingdom · 0 AY") it read as part of it, and
  // in the 210px column the English broke as "· 0 / AY" (plate review, 2026-10-15).
  const realmRow = row(t(lang, "factRealm"), facts.realm ?? t(lang, "factUnclaimed"));
  if (facts.year !== null) {
    const when = document.createElement("small");
    when.className = "city-fact-when";
    when.textContent = t(lang, "factAsOf").replace("{y}", String(facts.year));
    realmRow.querySelector(".city-fact-value")!.appendChild(when);
  }
  panel.append(
    row(t(lang, "factKind"), facts.kind),
    realmRow,
    row(t(lang, "factPeople"), `${facts.rank} · ${facts.population}`),
    row(t(lang, "factFounded"), facts.founded === null
      ? t(lang, "factAncient")
      : t(lang, "year").replace("{y}", String(facts.founded))),
  );
  // the plate's own fingerprint, to compare with another browser's (engine/fingerprint.ts)
  const print = row(t(lang, "factFingerprint"), plateFingerprint(layout));
  print.classList.add("city-fact-fingerprint");
  print.title = t(lang, "fingerprintNote");
  const near = document.createElement("div");
  near.className = "city-fact city-neighbours";
  const nearKey = document.createElement("span");
  nearKey.className = "city-fact-key";
  nearKey.textContent = t(lang, "factNear");
  near.appendChild(nearKey);
  const nearList = document.createElement("span");
  nearList.className = "city-fact-value";
  for (const n of facts.neighbours) {
    const b = document.createElement("button");
    b.className = "neighbour";
    b.textContent = `${n.name} · ${n.bySea ? t(lang, "factBySea").replace("{km}", String(n.km)) : `${n.km}km`}`;
    if (n.foundedIn !== undefined) {
      const note = document.createElement("span");
      note.className = "neighbour-later";
      note.textContent = t(lang, "factFoundedLater").replace("{y}", String(n.foundedIn));
      b.append(" ", note);
    }
    b.addEventListener("click", () => openCity(n.id));
    nearList.appendChild(b);
  }
  near.appendChild(nearList);
  panel.appendChild(near);
  panel.appendChild(print);
  return panel;
}
