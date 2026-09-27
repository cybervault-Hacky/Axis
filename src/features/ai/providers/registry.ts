import {
  AI_PROVIDER_IDS,
  type AIProviderDefinition,
  type AIProviderId,
} from "../domain/types";

const providerDefinitions = [
  {
    id: "openai",
    displayName: "OpenAI",
    shortName: "OpenAI",
    description: "OpenAI models through your own API account.",
    credentialLabel: "OpenAI API key",
    defaultModelId: "gpt-5.4-mini",
    availability: "available",
    customEndpoint: false,
    customModel: false,
    models: [
      {
        id: "gpt-5.4-mini",
        displayName: "GPT-5.4 Mini",
        description: "Fast general-purpose reasoning and tool workflows.",
        capabilities: ["text", "image-input", "structured-output", "tool-calling", "streaming"],
        availability: "catalog",
      },
      {
        id: "gpt-5.4",
        displayName: "GPT-5.4",
        description: "Higher-capability model for complex professional work.",
        capabilities: ["text", "image-input", "structured-output", "tool-calling", "streaming"],
        availability: "catalog",
      },
    ],
  },
  {
    id: "gemini",
    displayName: "Google Gemini",
    shortName: "Gemini",
    description: "Gemini models through your Google AI API key.",
    credentialLabel: "Gemini API key",
    defaultModelId: "gemini-3.7-flash",
    availability: "available",
    customEndpoint: false,
    customModel: false,
    models: [
      {
        id: "gemini-3.7-flash",
        displayName: "Gemini 3.7 Flash",
        description: "Multimodal model balanced for speed and complex work.",
        capabilities: [
          "text",
          "image-input",
          "audio-input",
          "video-input",
          "structured-output",
          "tool-calling",
          "streaming",
        ],
        availability: "catalog",
      },
      {
        id: "gemini-3.1-flash-lite",
        displayName: "Gemini 3.1 Flash-Lite",
        description: "Efficient model for frequent, lower-latency tasks.",
        capabilities: [
          "text",
          "image-input",
          "audio-input",
          "video-input",
          "tool-calling",
          "streaming",
        ],
        availability: "catalog",
      },
    ],
  },
  {
    id: "anthropic",
    displayName: "Anthropic Claude",
    shortName: "Claude",
    description: "Claude models through your own Anthropic account.",
    credentialLabel: "Anthropic API key",
    defaultModelId: "claude-sonnet-5",
    availability: "available",
    customEndpoint: false,
    customModel: false,
    models: [
      {
        id: "claude-sonnet-5",
        displayName: "Claude Sonnet 5",
        description: "Balanced speed and intelligence for everyday agent work.",
        capabilities: ["text", "image-input", "tool-calling", "streaming"],
        availability: "catalog",
      },
      {
        id: "claude-opus-5",
        displayName: "Claude Opus 5",
        description: "Higher-capability model for demanding, long-horizon work.",
        capabilities: ["text", "image-input", "tool-calling", "streaming"],
        availability: "catalog",
      },
    ],
  },
  {
    id: "groq",
    displayName: "Groq",
    shortName: "Groq",
    description: "Low-latency hosted models through GroqCloud.",
    credentialLabel: "Groq API key",
    defaultModelId: "llama-3.3-70b-versatile",
    availability: "available",
    customEndpoint: false,
    customModel: false,
    models: [
      {
        id: "llama-3.3-70b-versatile",
        displayName: "Llama 3.3 70B Versatile",
        description: "Groq production model for general text workloads.",
        capabilities: ["text", "tool-calling", "streaming"],
        availability: "catalog",
      },
      {
        id: "openai/gpt-oss-120b",
        displayName: "GPT OSS 120B",
        description: "Large open-weight reasoning model hosted by Groq.",
        capabilities: ["text", "tool-calling", "streaming"],
        availability: "catalog",
      },
    ],
  },
  {
    id: "openai-compatible",
    displayName: "OpenAI-compatible",
    shortName: "Custom",
    description: "A custom HTTPS or local endpoint implementing the OpenAI API shape.",
    credentialLabel: "Endpoint API key",
    defaultModelId: null,
    availability: "available",
    customEndpoint: true,
    customModel: true,
    models: [],
  },
] as const satisfies readonly AIProviderDefinition[];

export interface AIProviderRegistry {
  readonly providers: readonly AIProviderDefinition[];
  get(providerId: AIProviderId): AIProviderDefinition;
  has(providerId: string): providerId is AIProviderId;
}

export function createProviderRegistry(
  definitions: readonly AIProviderDefinition[],
): AIProviderRegistry {
  const byId = new Map<AIProviderId, AIProviderDefinition>();

  for (const definition of definitions) {
    if (byId.has(definition.id)) {
      throw new Error(`Duplicate AI provider ID: ${definition.id}`);
    }

    const modelIds = new Set<string>();
    for (const model of definition.models) {
      if (!model.id.trim()) throw new Error(`Provider ${definition.id} has an empty model ID`);
      if (modelIds.has(model.id)) {
        throw new Error(`Provider ${definition.id} has duplicate model ID: ${model.id}`);
      }
      modelIds.add(model.id);
    }

    if (
      definition.defaultModelId !== null &&
      !definition.customModel &&
      !modelIds.has(definition.defaultModelId)
    ) {
      throw new Error(
        `Provider ${definition.id} default model is not present in its catalog`,
      );
    }

    byId.set(definition.id, Object.freeze({ ...definition }));
  }

  return Object.freeze({
    providers: Object.freeze([...byId.values()]),
    get(providerId: AIProviderId) {
      const provider = byId.get(providerId);
      if (!provider) throw new Error(`Unknown AI provider: ${providerId}`);
      return provider;
    },
    has(providerId: string): providerId is AIProviderId {
      return byId.has(providerId as AIProviderId);
    },
  });
}

export const aiProviderRegistry = createProviderRegistry(providerDefinitions);

export function isAIProviderId(value: unknown): value is AIProviderId {
  return typeof value === "string" && AI_PROVIDER_IDS.some((providerId) => providerId === value);
}
