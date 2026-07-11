import "./theme.css";
import { createPlayApp } from "./ui/playApp";
import { parseSeedValue, randomSeed } from "./ui/urlState";

const root = document.getElementById("play");
if (root) {
  const seed = parseSeedValue(new URLSearchParams(location.hash.slice(1)).get("seed")) ?? randomSeed();
  createPlayApp(root, seed);
}
