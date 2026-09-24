import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "./app/App";
import { ThemeProvider } from "./features/theme/ThemeProvider";
import "./design-system/tokens.css";
import "./styles/reset.css";
import "./styles/app.css";
import "./styles/pages.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("AXIS root element was not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider>
      <HashRouter>
        <App />
      </HashRouter>
    </ThemeProvider>
  </StrictMode>,
);
