import { redactSecretText } from "../security/redactSecrets";
import type { AIError, AIErrorCategory, AIProviderId } from "./types";

interface ErrorLike {
  code?: unknown;
  status?: unknown;
  message?: unknown;
  retryable?: unknown;
}

const categoryByCode: Record<string, AIErrorCategory> = {
  invalid_credential: "invalid_credentials",
  invalid_credentials: "invalid_credentials",
  expired_credentials: "expired_credentials",
  unauthorized: "invalid_credentials",
  rate_limited: "rate_limit",
  network_error: "network_failure",
  provider_error: "provider_outage",
  invalid_request: "invalid_request",
  unsupported: "unsupported_model",
  unsupported_model: "unsupported_model",
  configuration_error: "configuration_error",
  credential_store_unavailable: "credential_store",
  credential_operation_failed: "credential_store",
  native_unavailable: "credential_store",
  credential_missing: "credential_store",
};

const userMessageByCategory: Record<AIErrorCategory, string> = {
  invalid_credentials: "The provider did not accept this credential.",
  expired_credentials: "This credential appears to have expired.",
  rate_limit: "The provider is rate limiting connection checks. Try again shortly.",
  network_failure: "AXIS could not reach the provider. Check your network and try again.",
  provider_outage: "The provider returned an unavailable or unexpected response.",
  invalid_request: "The provider configuration could not be tested.",
  unsupported_model: "The selected model was not available for this account.",
  configuration_error: "Review the provider endpoint and model configuration.",
  credential_store: "The native credential store is not available.",
  unknown_provider_error: "The provider connection could not be verified.",
};

const actionByCategory: Partial<Record<AIErrorCategory, string>> = {
  invalid_credentials: "Replace the API key and test again.",
  expired_credentials: "Create a new provider key and replace the saved credential.",
  rate_limit: "Wait before retrying the connection test.",
  network_failure: "Confirm internet access and the configured endpoint.",
  unsupported_model: "Choose another model that is enabled for this account.",
  configuration_error: "Check the model ID and custom endpoint.",
  credential_store: "Run AXIS as a native desktop app with an available OS credential service.",
};

function codeFromError(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown_error";
  const candidate = error as ErrorLike;
  if (typeof candidate.code === "string") return candidate.code.toLocaleLowerCase();
  if (typeof candidate.status === "string") return candidate.status.toLocaleLowerCase();
  if (typeof candidate.status === "number") {
    if (candidate.status === 401) return "invalid_credentials";
    if (candidate.status === 403) return "unauthorized";
    if (candidate.status === 429) return "rate_limited";
    if (candidate.status >= 500) return "provider_error";
    if (candidate.status >= 400) return "invalid_request";
  }
  return "unknown_error";
}

export function normalizeAIError(
  providerId: AIProviderId,
  error: unknown,
): AIError {
  const code = codeFromError(error);
  const category = categoryByCode[code] ?? "unknown_provider_error";
  const candidate = error && typeof error === "object" ? error as ErrorLike : null;
  const sanitizedMessage = typeof candidate?.message === "string"
    ? redactSecretText(candidate.message)
    : "";

  return {
    code,
    providerId,
    category,
    message: sanitizedMessage && category === "configuration_error"
      ? sanitizedMessage
      : userMessageByCategory[category],
    retryable:
      typeof candidate?.retryable === "boolean"
        ? candidate.retryable
        : category === "rate_limit" || category === "network_failure" || category === "provider_outage",
    ...(actionByCategory[category] ? { userAction: actionByCategory[category] } : {}),
  };
}

export function createUnsupportedExecutionError(providerId: AIProviderId): AIError {
  return {
    code: "generation_not_enabled",
    providerId,
    category: "configuration_error",
    message: "AI generation is not enabled in Phase 3.",
    retryable: false,
    userAction: "Use connection testing only; request execution arrives with the Agent Engine.",
  };
}

export class AIProviderOperationError extends Error {
  readonly normalized: AIError;

  constructor(error: AIError) {
    super(error.message);
    this.name = "AIProviderOperationError";
    this.normalized = error;
  }
}
