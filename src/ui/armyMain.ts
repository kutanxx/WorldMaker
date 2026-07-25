import "../theme.css";
import { mountArmyApp } from "./armyApp";

// ?seed=12345 pins the world so a play-test session can be identified/reproduced; anything absent
// or not a finite integer falls back to armyApp's own random default.
function seedFromQuery(): number | undefined {
  const raw = new URLSearchParams(location.search).get("seed");
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) ? n : undefined;
}

const root = document.getElementById("army-app");
if (root) mountArmyApp(root, { seed: seedFromQuery() });
