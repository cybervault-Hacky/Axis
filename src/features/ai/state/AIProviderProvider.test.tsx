import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AIConnectionGateway } from "../services/connectionGateway";
import type { CredentialService } from "../services/credentialService";
import {
  AIProviderProvider,
  useAIProviders,
  type AIProviderDependencies,
} from "./AIProviderProvider";

const unavailableCredentials: CredentialService = {
  isNativeAvailable: () => false,
  saveCredential: () => Promise.reject(new Error("native unavailable")),
  hasCredential: () => Promise.resolve(false),
  deleteCredential: () => Promise.reject(new Error("native unavailable")),
  clearAll: () => Promise.reject(new Error("native unavailable")),
};

const unavailableConnection: AIConnectionGateway = {
  isNativeAvailable: () => false,
  testConnection: (input) => Promise.resolve({
    status: "unavailable",
    providerId: input.providerId,
    modelVerified: false,
    message: "Native runtime unavailable.",
  }),
};

const dependencies: AIProviderDependencies = {
  credentialService: unavailableCredentials,
  connectionGateway: unavailableConnection,
};

function StateProbe() {
  const state = useAIProviders();
  return (
    <output aria-label="AI provider state">
      {JSON.stringify({
        selectedProviderId: state.preferences.selectedProviderId,
        credentialConfigured: state.providerStates.openai.credentialConfigured,
        connectionStatus: state.providerStates.openai.connectionStatus,
        requestStatus: state.requestStates.openai.status,
        activeRequestId: state.requestStates.openai.activeRequestId,
        usage: state.usageByProvider.openai,
      })}
    </output>
  );
}

describe("AI provider state boundaries", () => {
  it("keeps credential, connection, request, and usage state distinct and session-only", () => {
    render(
      <AIProviderProvider dependencies={dependencies}>
        <StateProbe />
      </AIProviderProvider>,
    );

    expect(JSON.parse(screen.getByLabelText("AI provider state").textContent ?? "{}"))
      .toEqual({
        selectedProviderId: null,
        credentialConfigured: false,
        connectionStatus: "not_configured",
        requestStatus: "idle",
        activeRequestId: null,
        usage: null,
      });
    expect(window.localStorage).toHaveLength(0);
  });
});
