import { createApp } from "./ui/app";
import { decodeParams } from "./ui/urlState";

const root = document.getElementById("app");
if (root) createApp(root, decodeParams(location.hash));
