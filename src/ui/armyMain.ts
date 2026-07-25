import "../theme.css";
import { mountArmyApp } from "./armyApp";

const root = document.getElementById("army-app");
if (root) mountArmyApp(root);
