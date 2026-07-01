import { createApp } from "./ui/app";
import { initialParams } from "./ui/urlState";

const root = document.getElementById("app");
if (root) createApp(root, initialParams(location.hash));
