export const AI_PROVIDER_IDS = [
  "openai",
  "gemini",
  "anthropic",
  "groq",
  "openai-compatible",
] as const;

export type AIProviderId = (typeof AI_PROVIDER_IDS)[number];

export type AIProviderAvailability = "available" | "unavailable";
export type AIModelAvailability = "catalog" | "unavailable";
export type AIModelCapability =
  | "text"
  | "image-input"
  | "audio-input"
  | "video-input"
  | "structured-output"
  | "tool-calling"
  | "streaming";

export interface AIModel {
  id: string;
  displayName: string;
  description: string;
  capabilities: readonly AIModelCapability[];
  availability: AIModelAvailability;
}

export interface AIProviderDefinition {
  id: AIProviderId;
  displayName: string;
  shortName: string;
  description: string;
  credentialLabel: string;
  models: readonly AIModel[];
  defaultModelId: string | null;
  availability: AIProviderAvailability;
  customEndpoint: boolean;
  customModel: boolean;
}

export interface AIProviderConfig {
  providerId: AIProviderId;
  enabled: boolean;
  selectedModelId: string | null;
  baseUrl?: string;
}

export type AIConnectionStatus =
  | "not_configured"
  | "configured"
  | "idle"
  | "testing"
  | "connected"
  | "invalid_credentials"
  | "unauthorized"
  | "rate_limited"
  | "network_error"
  | "provider_error"
  | "unsupported"
  | "unavailable";

export type AIErrorCategory =
  | "invalid_credentials"
  | "expired_credentials"
  | "rate_limit"
  | "network_failure"
  | "provider_outage"
  | "invalid_request"
  | "unsupported_model"
  | "configuration_error"
  | "credential_store"
  | "unknown_provider_error";

export interface AIError {
  code: string;
  providerId: AIProviderId;
  category: AIErrorCategory;
  message: string;
  retryable: boolean;
  userAction?: string;
}

export interface AIConnectionResult {
  status: Exclude<AIConnectionStatus, "idle" | "testing" | "configured" | "not_configured">;
  providerId: AIProviderId;
  modelVerified: boolean;
  message: string;
  error?: AIError;
}

export interface AIProviderRuntimeState {
  credentialConfigured: boolean;
  connectionStatus: AIConnectionStatus;
  lastTestedAt: string | null;
  error: AIError | null;
}

export type AIRequestStatus = "idle" | "pending" | "completed" | "failed" | "cancelled";

export interface AIProviderRequestState {
  status: AIRequestStatus;
  activeRequestId: string | null;
  error: AIError | null;
}

export type AIMessageRole = "system" | "user" | "assistant" | "tool";

export interface AIMessage {
  role: AIMessageRole;
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface AIToolDefinition {
  name: string;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
}

export interface AIRequestMetadata {
  operationId?: string;
  projectId?: string;
  labels?: Readonly<Record<string, string>>;
}

export interface AIRequest {
  id: string;
  providerId: AIProviderId;
  modelId: string;
  messages: readonly AIMessage[];
  tools?: readonly AIToolDefinition[];
  temperature?: number;
  metadata?: AIRequestMetadata;
}

export interface AIUsage {
  providerId: AIProviderId;
  modelId: string;
  requestId?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  durationMs?: number;
  timestamp: string;
  status: "completed" | "failed" | "cancelled";
}

export type AIFinishReason = "complete" | "length" | "tool_call" | "cancelled" | "unknown";

export interface AIResponse {
  id: string;
  providerId: AIProviderId;
  modelId: string;
  message: AIMessage;
  finishReason: AIFinishReason;
  usage?: AIUsage;
  providerRequestId?: string;
}

export type AIStreamEvent =
  | { type: "started"; requestId: string }
  | { type: "text_delta"; requestId: string; delta: string }
  | { type: "tool_delta"; requestId: string; toolCallId: string; delta: string }
  | { type: "usage"; requestId: string; usage: AIUsage }
  | { type: "completed"; requestId: string; response: AIResponse }
  | { type: "error"; requestId: string; error: AIError };

export interface AIRequestOptions {
  signal?: AbortSignal;
}

export interface ProviderConnectionInput {
  providerId: AIProviderId;
  modelId: string;
  baseUrl?: string;
}

export interface AIProviderAdapter {
  readonly providerId: AIProviderId;
  testConnection(
    input: ProviderConnectionInput,
    options?: AIRequestOptions,
  ): Promise<AIConnectionResult>;
  request(request: AIRequest, options?: AIRequestOptions): Promise<AIResponse>;
  stream(
    request: AIRequest,
    options?: AIRequestOptions,
  ): AsyncIterable<AIStreamEvent>;
}
