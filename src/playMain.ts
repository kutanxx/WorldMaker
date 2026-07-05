import "./theme.css";
import { createPlayApp } from "./ui/playApp";
import { randomSeed } from "./ui/urlState";

const root = document.getElementById("play");
if (root) {
  const hashSeed = Number(new URLSearchParams(location.hash.slice(1)).get("seed"));
  const seed = Number.isFinite(hashSeed) && hashSeed > 0 ? hashSeed : randomSeed();
  createPlayApp(root, seed);
}
