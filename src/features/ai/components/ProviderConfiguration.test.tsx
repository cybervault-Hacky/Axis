import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AIProviderId } from "../domain/types";
import type { AIConnectionGateway } from "../services/connectionGateway";
import type { CredentialService } from "../services/credentialService";
import type { AIProviderDependencies } from "../state/AIProviderProvider";
import { AI_PROVIDER_PREFERENCES_KEY } from "../state/providerPreferences";
import { renderApp } from "../../../test/renderApp";

function createDependencies(options: { native?: boolean } = {}): {
  dependencies: AIProviderDependencies;
  credentials: Map<AIProviderId, string>;
  saveCredential: ReturnType<typeof vi.fn>;
  testConnection: ReturnType<typeof vi.fn>;
} {
  const native = options.native ?? true;
  const credentials = new Map<AIProviderId, string>();
  const saveCredential = vi.fn((providerId: AIProviderId, credential: string) => {
    credentials.set(providerId, credential);
    return Promise.resolve();
  });
  const credentialService: CredentialService = {
    isNativeAvailable: () => native,
    saveCredential,
    hasCredential: (providerId) => Promise.resolve(credentials.has(providerId)),
    deleteCredential: (providerId) => {
      credentials.delete(providerId);
      return Promise.resolve();
    },
    clearAll: () => {
      credentials.clear();
      return Promise.resolve();
    },
  };
  const testConnection = vi.fn((input: { providerId: AIProviderId }) => Promise.resolve({
    status: "connected" as const,
    providerId: input.providerId,
    modelVerified: true,
    message: "The provider and model were verified.",
  }));
  const connectionGateway: AIConnectionGateway = {
    isNativeAvailable: () => native,
    testConnection,
  };
  return {
    dependencies: { credentialService, connectionGateway },
    credentials,
    saveCredential,
    testConnection,
  };
}

describe("provider configuration UI", () => {
  it("selects a provider and persists only safe model preferences", () => {
    const { dependencies } = createDependencies();
    const firstRender = renderApp("/ai", { aiDependencies: dependencies });

    fireEvent.click(screen.getByRole("button", { name: "Configure Google Gemini" }));
    expect(screen.getByRole("dialog", { name: "Configure Google Gemini" })).toBeVisible();
    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), {
      target: { value: "gemini-3.1-flash-lite" },
    });

    const stored = JSON.parse(
      window.localStorage.getItem(AI_PROVIDER_PREFERENCES_KEY) ?? "{}",
    ) as Record<string, unknown>;
    expect(stored).toMatchObject({
      selectedProviderId: "gemini",
      configs: {
        gemini: { selectedModelId: "gemini-3.1-flash-lite" },
      },
    });
    expect(JSON.stringify(stored)).not.toMatch(/apiKey|credential|connectionStatus/i);

    firstRender.unmount();
    renderApp("/ai", { aiDependencies: dependencies });
    expect(screen.getByRole("heading", { name: "Google Gemini" })).toBeVisible();
    expect(screen.getAllByText("Gemini 3.1 Flash-Lite")).not.toHaveLength(0);
  });

  it("saves, hides, tests, and removes a BYOK credential", async () => {
    const {
      dependencies,
      credentials,
      saveCredential,
      testConnection,
    } = createDependencies();
    renderApp("/ai", { aiDependencies: dependencies });

    fireEvent.click(screen.getByRole("button", { name: "Configure OpenAI" }));
    const input = screen.getByLabelText("OpenAI API key");
    const placeholder = "obvious-test-placeholder-key";
    fireEvent.change(input, { target: { value: placeholder } });
    fireEvent.click(screen.getByRole("button", { name: "Show API key" }));
    expect(input).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));

    expect(await screen.findByLabelText("API key saved and hidden")).toBeVisible();
    expect(saveCredential).toHaveBeenCalledWith("openai", placeholder);
    expect(screen.queryByDisplayValue(placeholder)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(placeholder);
    expect(window.localStorage.getItem(AI_PROVIDER_PREFERENCES_KEY)).not.toContain(placeholder);

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(testConnection).toHaveBeenCalledWith({
      providerId: "openai",
      modelId: "gpt-5.4-mini",
    }, undefined));
    expect(await screen.findByText("The provider accepted the saved key and selected model.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Remove saved API key" }));
    await waitFor(() => expect(credentials.has("openai")).toBe(false));
    expect(await screen.findByRole("button", { name: "Save key" })).toBeDisabled();
  });

  it("truthfully disables credential entry outside the native runtime", () => {
    const { dependencies, saveCredential } = createDependencies({ native: false });
    renderApp("/ai", { aiDependencies: dependencies });

    expect(screen.getByText(/Native credential storage is unavailable/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Configure Groq" }));
    expect(screen.getByLabelText("Groq API key")).toBeDisabled();
    expect(screen.getByText(/Secure storage is unavailable in this browser preview/)).toBeVisible();
    expect(saveCredential).not.toHaveBeenCalled();
  });
});
