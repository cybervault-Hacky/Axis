import type { AIConnectionStatus } from "../domain/types";

interface StatusPresentation {
  label: string;
  detail: string;
  tone: "neutral" | "accent" | "positive" | "warning";
}

export const connectionStatusPresentation: Record<AIConnectionStatus, StatusPresentation> = {
  not_configured: {
    label: "Not configured",
    detail: "Add an API key to test this provider.",
    tone: "neutral",
  },
  configured: {
    label: "Configured",
    detail: "A key is saved. Test the connection for this session.",
    tone: "accent",
  },
  idle: {
    label: "Not tested",
    detail: "Run a connection test when you are ready.",
    tone: "neutral",
  },
  testing: {
    label: "Testing",
    detail: "AXIS is checking the provider and selected model.",
    tone: "accent",
  },
  connected: {
    label: "Connected",
    detail: "The provider accepted the saved key and selected model.",
    tone: "positive",
  },
  invalid_credentials: {
    label: "Key rejected",
    detail: "Replace the saved API key and try again.",
    tone: "warning",
  },
  unauthorized: {
    label: "Access denied",
    detail: "The account does not permit this connection.",
    tone: "warning",
  },
  rate_limited: {
    label: "Rate limited",
    detail: "Wait briefly before testing again.",
    tone: "warning",
  },
  network_error: {
    label: "Network error",
    detail: "AXIS could not reach the provider.",
    tone: "warning",
  },
  provider_error: {
    label: "Connection failed",
    detail: "The provider returned an unexpected response.",
    tone: "warning",
  },
  unsupported: {
    label: "Model unavailable",
    detail: "Choose a model enabled for this provider account.",
    tone: "warning",
  },
  unavailable: {
    label: "Unavailable",
    detail: "Native secure storage or testing is unavailable.",
    tone: "warning",
  },
};
