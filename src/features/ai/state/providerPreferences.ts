import type { AIProviderConfig, AIProviderId } from "../domain/types";
import { aiProviderRegistry, isAIProviderId } from "../providers/registry";
import { validateProviderBaseUrl } from "../security/providerEndpointValidation";

export const AI_PROVIDER_PREFERENCES_KEY = "axis:ai-provider-preferences";
const PREFERENCES_VERSION = 1;

export interface AIProviderPreferences {
  version: typeof PREFERENCES_VERSION;
  selectedProviderId: AIProviderId | null;
  configs: Record<AIProviderId, AIProviderConfig>;
}

function defaultConfig(providerId: AIProviderId): AIProviderConfig {
  const provider = aiProviderRegistry.get(providerId);
  return {
    providerId,
    enabled: true,
    selectedModelId: provider.defaultModelId,
  };
}

export function createDefaultAIProviderPreferences(): AIProviderPreferences {
  return {
    version: PREFERENCES_VERSION,
    selectedProviderId: null,
    configs: {
      openai: defaultConfig("openai"),
      gemini: defaultConfig("gemini"),
      anthropic: defaultConfig("anthropic"),
      groq: defaultConfig("groq"),
      "openai-compatible": defaultConfig("openai-compatible"),
    },
  };
}

function sanitizeConfig(
  providerId: AIProviderId,
  candidate: unknown,
): AIProviderConfig {
  const fallback = defaultConfig(providerId);
  if (!candidate || typeof candidate !== "object") return fallback;

  const record = candidate as Record<string, unknown>;
  const provider = aiProviderRegistry.get(providerId);
  const candidateModel = typeof record.selectedModelId === "string"
    ? record.selectedModelId.trim().slice(0, 200)
    : null;
  const selectedModelId = provider.customModel
    ? candidateModel || null
    : provider.models.some((model) => model.id === candidateModel)
      ? candidateModel
      : fallback.selectedModelId;
  const baseUrlValidation = provider.customEndpoint && typeof record.baseUrl === "string"
    ? validateProviderBaseUrl(record.baseUrl)
    : null;
  const baseUrl = baseUrlValidation?.valid && baseUrlValidation.value
    ? baseUrlValidation.value
    : undefined;

  return {
    providerId,
    enabled: record.enabled !== false,
    selectedModelId,
    ...(baseUrl ? { baseUrl } : {}),
  };
}

export function parseAIProviderPreferences(value: string | null): AIProviderPreferences {
  const fallback = createDefaultAIProviderPreferences();
  if (!value) return fallback;

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object") return fallback;
    const record = parsed as Record<string, unknown>;
    const configs = record.configs && typeof record.configs === "object"
      ? record.configs as Record<string, unknown>
      : {};
    const selectedProviderId = isAIProviderId(record.selectedProviderId)
      ? record.selectedProviderId
      : null;

    return {
      version: PREFERENCES_VERSION,
      selectedProviderId,
      configs: {
        openai: sanitizeConfig("openai", configs.openai),
        gemini: sanitizeConfig("gemini", configs.gemini),
        anthropic: sanitizeConfig("anthropic", configs.anthropic),
        groq: sanitizeConfig("groq", configs.groq),
        "openai-compatible": sanitizeConfig(
          "openai-compatible",
          configs["openai-compatible"],
        ),
      },
    };
  } catch {
    return fallback;
  }
}

export function getStoredAIProviderPreferences(
  storage: Pick<Storage, "getItem">,
): AIProviderPreferences {
  return parseAIProviderPreferences(storage.getItem(AI_PROVIDER_PREFERENCES_KEY));
}

export function persistAIProviderPreferences(
  storage: Pick<Storage, "setItem">,
  preferences: AIProviderPreferences,
): void {
  storage.setItem(AI_PROVIDER_PREFERENCES_KEY, JSON.stringify(preferences));
}
