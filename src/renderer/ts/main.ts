import { mountApp } from "./app";

function bootstrap(): void {
  const root = document.getElementById("app");
  if (!root) {
    throw new Error("AXIS root element (#app) was not found in index.html");
  }
  mountApp(root);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
