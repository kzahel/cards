import "./styles.css";
import { SetApp } from "./app";

const appRoot = document.querySelector<HTMLElement>("#app");

if (!appRoot) {
  throw new Error("Missing #app root element.");
}

new SetApp(appRoot);
