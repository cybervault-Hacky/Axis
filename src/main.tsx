import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "./app/App";
import { AppProviders } from "./app/AppProviders";
import "./design-system/tokens.css";
import "./styles/reset.css";
import "./styles/app.css";
import "./styles/pages.css";
import "./styles/interactions.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("AXIS root element was not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <HashRouter>
      <AppProviders>
        <App />
      </AppProviders>
    </HashRouter>
  </StrictMode>,
);
