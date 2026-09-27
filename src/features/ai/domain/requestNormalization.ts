import type {
  AIFinishReason,
  AIMessage,
  AIProviderId,
  AIRequest,
  AIResponse,
  AIUsage,
} from "./types";

export interface CreateAIRequestInput {
  id: string;
  providerId: AIProviderId;
  modelId: string;
  messages: readonly AIMessage[];
  tools?: AIRequest["tools"];
  temperature?: number;
  metadata?: AIRequest["metadata"];
}

export function createAIRequest(input: CreateAIRequestInput): AIRequest {
  const id = input.id.trim();
  const modelId = input.modelId.trim();
  if (!id) throw new Error("AI request ID is required");
  if (!modelId) throw new Error("AI model ID is required");
  if (input.messages.length === 0) throw new Error("AI request requires at least one message");

  const messages = input.messages.map((message) => {
    const content = message.content.trim();
    if (!content) throw new Error("AI messages cannot be empty");
    return { ...message, content };
  });

  if (
    input.temperature !== undefined &&
    (!Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 2)
  ) {
    throw new Error("AI request temperature must be between 0 and 2");
  }

  return {
    id,
    providerId: input.providerId,
    modelId,
    messages,
    ...(input.tools ? { tools: input.tools } : {}),
    ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

export interface NormalizedResponseInput {
  id: string;
  providerId: AIProviderId;
  modelId: string;
  text: string;
  finishReason?: AIFinishReason;
  providerRequestId?: string;
  usage?: Omit<AIUsage, "providerId" | "modelId" | "timestamp" | "status"> & {
    timestamp?: string;
  };
}

export function normalizeAIResponse(input: NormalizedResponseInput): AIResponse {
  const text = input.text.trim();
  if (!text) throw new Error("Provider response did not include text output");

  const usage = input.usage
    ? {
        ...input.usage,
        providerId: input.providerId,
        modelId: input.modelId,
        timestamp: input.usage.timestamp ?? new Date().toISOString(),
        status: "completed" as const,
      }
    : undefined;

  return {
    id: input.id,
    providerId: input.providerId,
    modelId: input.modelId,
    message: { role: "assistant", content: text },
    finishReason: input.finishReason ?? "unknown",
    ...(input.providerRequestId ? { providerRequestId: input.providerRequestId } : {}),
    ...(usage ? { usage } : {}),
  };
}
