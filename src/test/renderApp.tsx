import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../app/App";
import { AppProviders } from "../app/AppProviders";

export function renderApp(initialEntry = "/") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AppProviders>
        <App />
      </AppProviders>
    </MemoryRouter>,
  );
}
