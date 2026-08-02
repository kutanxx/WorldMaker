import "../theme.css";
import { mountFrontApp } from "./frontApp";

// ?seed=12345 pins the world so a play-test session can be reproduced, exactly as the other games do.
function seedFromQuery(): number | undefined {
  const raw = new URLSearchParams(location.search).get("seed");
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) ? n : undefined;
}

const root = document.getElementById("front-app");
if (root) mountFrontApp(root, { seed: seedFromQuery() });
