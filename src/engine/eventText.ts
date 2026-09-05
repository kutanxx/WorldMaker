import type { HistoryEvent, HistoryPolity } from "./historySim";
import { withJosa } from "./korean";

export type EventLang = "en" | "ko";

// "a and b"; "a, b and c". A realm's successors are a sentence, not an array.
function joinEn(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// One sentence per recorded event, assembled in the reader's language at the moment it is read.
// The simulation stores ids and the handful of names no id can recover; the words are chosen here.
//
// The English voice is not free: these lines are interleaved with `minedChronicle`'s in
// gazetteer.ts, so they take its form — "Year <n> — " and a present-tense clause. The Korean is
// byte-identical to the sentences the simulation used to build, and the golden anchor in
// history.test.ts holds it that way.
export function eventText(e: HistoryEvent, polities: HistoryPolity[], lang: EventLang): string {
  const nameOf = (id: number) => polities[id]?.name ?? String(id);
  const ko = lang === "ko";
  const y = e.year;
  const self = nameOf(e.polityId);
  switch (e.type) {
    case "found":
      return ko ? `${y}년, ${self} 건국` : `Year ${y} — ${self} is founded`;
    case "staple":
      return ko ? `${y}년, ${e.name ?? ""} 자유무역항 지정`
                : `Year ${y} — ${e.name ?? ""} is named a free port`;
    case "goldenage":
      return ko ? `${y}년, ${self} 황금기 도래` : `Year ${y} — a golden age dawns in ${self}`;
    case "newCity":
      return ko ? `${y}년, ${withJosa(self, "이/가")} ${e.name ?? ""} 건설`
                : `Year ${y} — ${self} founds ${e.name ?? ""}`;
    case "conquer": {
      const prey = nameOf(e.otherId ?? -1);
      return ko ? `${y}년, ${withJosa(self, "이/가")} ${withJosa(prey, "을/를")} 정복`
                : `Year ${y} — ${self} conquers ${prey}`;
    }
    case "civilwar": {
      const heirs = (e.intoIds ?? []).map(nameOf);
      // the Korean particle is chosen from the joined list, i.e. from the LAST successor's name
      return ko ? `${y}년, 내란이 ${withJosa(self, "을/를")} ${withJosa(heirs.join("·"), "으로/로")} 쪼갬`
                : `Year ${y} — civil war splits ${self} into ${joinEn(heirs)}`;
    }
    case "independence":
      return ko ? `${y}년, 자유도시 ${self} 독립 선포`
                : `Year ${y} — the free city of ${self} declares independence`;
  }
}
