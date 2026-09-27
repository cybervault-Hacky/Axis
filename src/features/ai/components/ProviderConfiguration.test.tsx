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

  it("clears unsaved secrets when a dialog closes and isolates provider inputs", () => {
    const { dependencies } = createDependencies();
    renderApp("/ai", { aiDependencies: dependencies });

    fireEvent.click(screen.getByRole("button", { name: "Configure OpenAI" }));
    const openAiInput = screen.getByLabelText("OpenAI API key");
    fireEvent.change(openAiInput, { target: { value: "fake-openai-secret-for-test" } });
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Configure OpenAI" }), {
      key: "Escape",
    });

    fireEvent.click(screen.getByRole("button", { name: "Configure OpenAI" }));
    expect(screen.getByLabelText("OpenAI API key")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("OpenAI API key"), {
      target: { value: "fake-openai-secret-for-test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));

    fireEvent.click(screen.getByRole("button", { name: "Configure Google Gemini" }));
    expect(screen.getByLabelText("Gemini API key")).toHaveValue("");
    expect(document.body.textContent).not.toContain("fake-openai-secret-for-test");
  });

  it("keeps provider credentials independent through replacement and removal", async () => {
    const { dependencies, credentials } = createDependencies();
    renderApp("/ai", { aiDependencies: dependencies });

    fireEvent.click(screen.getByRole("button", { name: "Configure OpenAI" }));
    fireEvent.change(screen.getByLabelText("OpenAI API key"), {
      target: { value: "fake-openai-secret-for-test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    await screen.findByLabelText("API key saved and hidden");
    expect(credentials.get("openai")).toBe("fake-openai-secret-for-test");
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    fireEvent.change(screen.getByLabelText("OpenAI API key"), {
      target: { value: "fake-openai-replacement-for-test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Replace key" }));
    await screen.findByLabelText("API key saved and hidden");
    expect(credentials.get("openai")).toBe("fake-openai-replacement-for-test");
    expect(document.body.textContent).not.toContain("fake-openai-secret-for-test");
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));

    fireEvent.click(screen.getByRole("button", { name: "Configure Google Gemini" }));
    fireEvent.change(screen.getByLabelText("Gemini API key"), {
      target: { value: "fake-gemini-secret-for-test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    await screen.findByLabelText("API key saved and hidden");
    expect(credentials.get("gemini")).toBe("fake-gemini-secret-for-test");
    expect(credentials.get("openai")).toBe("fake-openai-replacement-for-test");

    fireEvent.click(screen.getByRole("button", { name: "Remove saved API key" }));
    await waitFor(() => expect(credentials.has("gemini")).toBe(false));
    expect(credentials.get("openai")).toBe("fake-openai-replacement-for-test");
    const serializedUiAndPersistence = [
      document.body.textContent,
      window.localStorage.getItem(AI_PROVIDER_PREFERENCES_KEY),
    ].join(" ");
    expect(serializedUiAndPersistence).not.toContain("fake-openai-secret-for-test");
    expect(serializedUiAndPersistence).not.toContain("fake-openai-replacement-for-test");
    expect(serializedUiAndPersistence).not.toContain("fake-gemini-secret-for-test");
  });

  it("restores only credential presence after an application restart", async () => {
    const { dependencies, credentials } = createDependencies();
    const firstRun = renderApp("/ai", { aiDependencies: dependencies });
    fireEvent.click(screen.getByRole("button", { name: "Configure Anthropic Claude" }));
    fireEvent.change(screen.getByLabelText("Anthropic API key"), {
      target: { value: "fake-anthropic-restart-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    await screen.findByLabelText("API key saved and hidden");
    expect(credentials.has("anthropic")).toBe(true);
    firstRun.unmount();

    renderApp("/ai", { aiDependencies: dependencies });
    fireEvent.click(screen.getByRole("button", { name: "Configure Anthropic Claude" }));
    expect(await screen.findByLabelText("API key saved and hidden")).toBeVisible();
    expect(document.body.textContent).not.toContain("fake-anthropic-restart-secret");
    expect(window.localStorage.getItem(AI_PROVIDER_PREFERENCES_KEY))
      .not.toContain("fake-anthropic-restart-secret");
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
