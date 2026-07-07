// Reign chronicle — the play-mode payoff artifact: your rule, rendered as a readable Markdown
// story (mirrors the gazetteer for pure history). Pure function of SimState; event body text is
// engine-generated Korean (same scope-out as the chronicle), headers/stat lines localise.
import type { SimState } from "./historySim";
import { scorecard } from "./playSim";

const DELTA_NOTEWORTHY = 15; // a decade's net cell swing worth a line of its own

function playerCellsIn(owner: ArrayLike<number>, polity: number): number {
  let n = 0;
  for (let i = 0; i < owner.length; i++) if (owner[i] === polity) n++;
  return n;
}

export function reignChronicle(s: SimState, worldName: string, lang: "ko" | "en" = "ko"): string {
  const me = s.playerPolity;
  const nation = s.polities[me].name;
  const sc = scorecard(s);
  const years = sc.survivedYears;
  const ko = lang === "ko";

  const title = ko ? `# ${nation} 연대기 — ${worldName}` : `# The Reign of ${nation} — ${worldName}`;
  const outcome = sc.alive
    ? ko ? `${years}년의 통치에서 살아남았다.` : `The realm survived ${years} years of rule.`
    : ko ? `${years}년, 나라가 멸망했다.` : `The realm fell in year ${years}.`;
  const stats = ko
    ? `최대 ${sc.peakCells}셀 · 최종 ${sc.cells}셀 · 순위 ${sc.rank > 0 ? `${sc.rank}/${sc.nations}` : "—"} · 도시 ${sc.citiesHeld}/${sc.citiesFounded}`
    : `Peak ${sc.peakCells} cells · final ${sc.cells} · rank ${sc.rank > 0 ? `${sc.rank}/${sc.nations}` : "—"} · cities ${sc.citiesHeld}/${sc.citiesFounded}`;

  // one merged, year-ordered stream: the player's events + noteworthy decade swings
  const lines: { year: number; text: string }[] = [];
  for (const e of s.events) {
    if (e.polityId === me || e.otherId === me) lines.push({ year: e.year, text: e.text });
  }
  for (let i = 1; i < s.snapshots.length; i++) {
    const prev = playerCellsIn(s.snapshots[i - 1].owner, me);
    const cur = playerCellsIn(s.snapshots[i].owner, me);
    const net = cur - prev;
    if (Math.abs(net) < DELTA_NOTEWORTHY) continue;
    const year = s.snapshots[i].year;
    const change = net > 0 ? `+${net}` : `−${-net}`;
    lines.push({ year, text: ko ? `${year}년: ${change}셀 (${cur}셀)` : `Year ${year}: ${change} cells (${cur} total)` });
  }
  lines.sort((a, b) => a.year - b.year);

  const header = ko ? "## 기록" : "## The Record";
  return [title, "", outcome, "", stats, "", header, "", ...lines.map((l) => `- ${l.text}`), ""].join("\n");
}
