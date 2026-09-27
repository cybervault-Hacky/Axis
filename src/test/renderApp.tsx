import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../app/App";
import { AppProviders } from "../app/AppProviders";
import type { AIProviderDependencies } from "../features/ai/state/AIProviderProvider";

export function renderApp(
  initialEntry = "/",
  options: { aiDependencies?: AIProviderDependencies } = {},
) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AppProviders aiDependencies={options.aiDependencies}>
        <App />
      </AppProviders>
    </MemoryRouter>,
  );
}
