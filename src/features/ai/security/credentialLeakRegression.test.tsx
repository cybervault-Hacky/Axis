import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AIConnectionGateway } from "../services/connectionGateway";
import type { CredentialService } from "../services/credentialService";
import {
  AIProviderProvider,
  useAIProviders,
} from "../state/AIProviderProvider";

const fakeSecret = "fake-security-regression-token-do-not-use";

function SafeStateProbe() {
  const providers = useAIProviders();
  const safeState = JSON.stringify({
    preferences: providers.preferences,
    providerStates: providers.providerStates,
    requestStates: providers.requestStates,
    usage: providers.usageByProvider,
  });

  return (
    <>
      <output aria-label="Safe provider state">{safeState}</output>
      <button type="button" onClick={() => void providers.saveCredential("openai", fakeSecret)}>
        Save fake credential
      </button>
    </>
  );
}

describe("credential leakage regression", () => {
  it("keeps a raw test secret out of persisted state, exposed state, UI, and logs", async () => {
    const nativeCredentialValues = new Map<string, string>();
    const credentialService: CredentialService = {
      isNativeAvailable: () => true,
      saveCredential: (providerId, value) => {
        nativeCredentialValues.set(providerId, value);
        return Promise.resolve();
      },
      hasCredential: (providerId) => Promise.resolve(nativeCredentialValues.has(providerId)),
      deleteCredential: (providerId) => {
        nativeCredentialValues.delete(providerId);
        return Promise.resolve();
      },
      clearAll: () => {
        nativeCredentialValues.clear();
        return Promise.resolve();
      },
    };
    const connectionGateway: AIConnectionGateway = {
      isNativeAvailable: () => true,
      testConnection: (input) => Promise.resolve({
        status: "connected",
        providerId: input.providerId,
        modelVerified: true,
        message: "Verified",
      }),
    };
    const logSinks = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
    ];

    render(
      <AIProviderProvider dependencies={{ credentialService, connectionGateway }}>
        <SafeStateProbe />
      </AIProviderProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save fake credential" }));
    await waitFor(() => expect(nativeCredentialValues.has("openai")).toBe(true));

    const serializedSafeState = screen.getByLabelText("Safe provider state").textContent ?? "";
    const serializedPreferences = window.localStorage.getItem("axis:ai-provider-preferences") ?? "";
    const renderedUi = document.body.textContent ?? "";
    const serializedLogs = JSON.stringify(logSinks.flatMap((sink) => sink.mock.calls));

    expect(nativeCredentialValues.get("openai")).toBe(fakeSecret);
    expect(serializedSafeState).not.toContain(fakeSecret);
    expect(serializedPreferences).not.toContain(fakeSecret);
    expect(renderedUi).not.toContain(fakeSecret);
    expect(serializedLogs).not.toContain(fakeSecret);
    expect(serializedSafeState).toContain('"credentialConfigured":true');

    for (const sink of logSinks) sink.mockRestore();
  });
});
