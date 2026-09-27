import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AIProviderOperationError, normalizeAIError } from "../domain/errors";
import type {
  AIConnectionResult,
  AIError,
  AIProviderConfig,
  AIProviderDefinition,
  AIProviderId,
  AIProviderRequestState,
  AIProviderRuntimeState,
  AIUsage,
} from "../domain/types";
import { AIProviderManager } from "../providers/AIProviderManager";
import { createProviderAdapters } from "../providers/adapters";
import { aiProviderRegistry } from "../providers/registry";
import { validateProviderBaseUrl } from "../security/providerEndpointValidation";
import {
  connectionGateway,
  type AIConnectionGateway,
} from "../services/connectionGateway";
import {
  credentialService,
  type CredentialService,
} from "../services/credentialService";
import {
  getStoredAIProviderPreferences,
  persistAIProviderPreferences,
  type AIProviderPreferences,
} from "./providerPreferences";

export interface AIProviderDependencies {
  credentialService: CredentialService;
  connectionGateway: AIConnectionGateway;
}

const defaultDependencies: AIProviderDependencies = {
  credentialService,
  connectionGateway,
};

export interface AIProviderContextValue {
  preferences: AIProviderPreferences;
  providerStates: Record<AIProviderId, AIProviderRuntimeState>;
  requestStates: Record<AIProviderId, AIProviderRequestState>;
  usageByProvider: Record<AIProviderId, AIUsage | null>;
  selectedProvider: AIProviderDefinition | null;
  selectedConfig: AIProviderConfig | null;
  selectedRuntime: AIProviderRuntimeState | null;
  credentialBackendAvailable: boolean;
  credentialPresenceReady: boolean;
  selectProvider: (providerId: AIProviderId) => void;
  selectModel: (providerId: AIProviderId, modelId: string) => void;
  setBaseUrl: (providerId: AIProviderId, baseUrl: string) => void;
  setProviderEnabled: (providerId: AIProviderId, enabled: boolean) => void;
  saveCredential: (providerId: AIProviderId, credential: string) => Promise<void>;
  deleteCredential: (providerId: AIProviderId) => Promise<void>;
  testConnection: (providerId: AIProviderId) => Promise<AIConnectionResult>;
  refreshCredentialPresence: () => Promise<void>;
}

const AIProviderContext = createContext<AIProviderContextValue | null>(null);

function runtimeState(
  credentialConfigured = false,
  connectionStatus: AIProviderRuntimeState["connectionStatus"] = "not_configured",
): AIProviderRuntimeState {
  return {
    credentialConfigured,
    connectionStatus,
    lastTestedAt: null,
    error: null,
  };
}

function createRuntimeStates(): Record<AIProviderId, AIProviderRuntimeState> {
  return {
    openai: runtimeState(),
    gemini: runtimeState(),
    anthropic: runtimeState(),
    groq: runtimeState(),
    "openai-compatible": runtimeState(),
  };
}

function createRequestStates(): Record<AIProviderId, AIProviderRequestState> {
  const idle = (): AIProviderRequestState => ({
    status: "idle",
    activeRequestId: null,
    error: null,
  });
  return {
    openai: idle(),
    gemini: idle(),
    anthropic: idle(),
    groq: idle(),
    "openai-compatible": idle(),
  };
}

function createUsageStates(): Record<AIProviderId, AIUsage | null> {
  return {
    openai: null,
    gemini: null,
    anthropic: null,
    groq: null,
    "openai-compatible": null,
  };
}

function connectionFailureStatus(error: AIError): AIConnectionResult["status"] {
  switch (error.category) {
    case "invalid_credentials":
    case "expired_credentials":
      return "invalid_credentials";
    case "rate_limit":
      return "rate_limited";
    case "network_failure":
      return "network_error";
    case "unsupported_model":
      return "unsupported";
    case "credential_store":
      return "unavailable";
    default:
      return "provider_error";
  }
}

function getInitialPreferences(): AIProviderPreferences {
  if (typeof window === "undefined") {
    return getStoredAIProviderPreferences({ getItem: () => null });
  }
  return getStoredAIProviderPreferences(window.localStorage);
}

export function AIProviderProvider({
  children,
  dependencies = defaultDependencies,
}: {
  children: ReactNode;
  dependencies?: AIProviderDependencies;
}) {
  const [preferences, setPreferences] = useState<AIProviderPreferences>(getInitialPreferences);
  const [providerStates, setProviderStates] =
    useState<Record<AIProviderId, AIProviderRuntimeState>>(createRuntimeStates);
  const [requestStates] = useState<Record<AIProviderId, AIProviderRequestState>>(
    createRequestStates,
  );
  const [usageByProvider] = useState<Record<AIProviderId, AIUsage | null>>(
    createUsageStates,
  );
  const [credentialBackendAvailable, setCredentialBackendAvailable] = useState(
    dependencies.credentialService.isNativeAvailable(),
  );
  const [credentialPresenceReady, setCredentialPresenceReady] = useState(
    !dependencies.credentialService.isNativeAvailable(),
  );
  const manager = useMemo(
    () => new AIProviderManager(createProviderAdapters(dependencies.connectionGateway)),
    [dependencies.connectionGateway],
  );

  const updatePreferences = useCallback(
    (updater: (current: AIProviderPreferences) => AIProviderPreferences) => {
      setPreferences((current) => {
        const next = updater(current);
        persistAIProviderPreferences(window.localStorage, next);
        return next;
      });
    },
    [],
  );

  const refreshCredentialPresence = useCallback(async () => {
    if (!dependencies.credentialService.isNativeAvailable()) {
      setCredentialBackendAvailable(false);
      setCredentialPresenceReady(true);
      return;
    }

    try {
      const presenceEntries = await Promise.all(
        aiProviderRegistry.providers.map(async (provider) => [
          provider.id,
          await dependencies.credentialService.hasCredential(provider.id),
        ] as const),
      );
      setProviderStates((current) => {
        const next = { ...current };
        for (const [providerId, configured] of presenceEntries) {
          const previous = current[providerId];
          next[providerId] = {
            ...previous,
            credentialConfigured: configured,
            connectionStatus: configured ? "configured" : "not_configured",
            error: null,
          };
        }
        return next;
      });
      setCredentialBackendAvailable(true);
    } catch {
      setCredentialBackendAvailable(false);
    } finally {
      setCredentialPresenceReady(true);
    }
  }, [dependencies.credentialService]);

  useEffect(() => {
    const refreshTimer = window.setTimeout(() => {
      void refreshCredentialPresence();
    }, 0);
    return () => window.clearTimeout(refreshTimer);
  }, [refreshCredentialPresence]);

  const selectProvider = useCallback(
    (providerId: AIProviderId) => {
      const provider = aiProviderRegistry.get(providerId);
      if (provider.availability === "unavailable") return;
      updatePreferences((current) => ({ ...current, selectedProviderId: providerId }));
    },
    [updatePreferences],
  );

  const selectModel = useCallback(
    (providerId: AIProviderId, modelId: string) => {
      const provider = aiProviderRegistry.get(providerId);
      const normalizedModelId = modelId.trim().slice(0, 200);
      if (
        !provider.customModel &&
        !provider.models.some(
          (model) => model.id === normalizedModelId && model.availability !== "unavailable",
        )
      ) {
        return;
      }
      updatePreferences((current) => ({
        ...current,
        configs: {
          ...current.configs,
          [providerId]: {
            ...current.configs[providerId],
            selectedModelId: normalizedModelId || null,
          },
        },
      }));
      setProviderStates((current) => ({
        ...current,
        [providerId]: {
          ...current[providerId],
          connectionStatus: current[providerId].credentialConfigured
            ? "configured"
            : "not_configured",
          lastTestedAt: null,
          error: null,
        },
      }));
    },
    [updatePreferences],
  );

  const setBaseUrl = useCallback(
    (providerId: AIProviderId, baseUrl: string) => {
      if (!aiProviderRegistry.get(providerId).customEndpoint) return;
      const validation = validateProviderBaseUrl(baseUrl);
      if (!validation.valid) return;
      updatePreferences((current) => ({
        ...current,
        configs: {
          ...current.configs,
          [providerId]: {
            ...current.configs[providerId],
            ...(validation.value ? { baseUrl: validation.value } : { baseUrl: undefined }),
          },
        },
      }));
      setProviderStates((current) => ({
        ...current,
        [providerId]: {
          ...current[providerId],
          connectionStatus: current[providerId].credentialConfigured
            ? "configured"
            : "not_configured",
          lastTestedAt: null,
          error: null,
        },
      }));
    },
    [updatePreferences],
  );

  const setProviderEnabled = useCallback(
    (providerId: AIProviderId, enabled: boolean) => {
      updatePreferences((current) => ({
        ...current,
        selectedProviderId:
          !enabled && current.selectedProviderId === providerId
            ? null
            : current.selectedProviderId,
        configs: {
          ...current.configs,
          [providerId]: { ...current.configs[providerId], enabled },
        },
      }));
    },
    [updatePreferences],
  );

  const saveCredential = useCallback(
    async (providerId: AIProviderId, credential: string) => {
      try {
        await dependencies.credentialService.saveCredential(providerId, credential);
        setCredentialBackendAvailable(true);
        setProviderStates((current) => ({
          ...current,
          [providerId]: {
            credentialConfigured: true,
            connectionStatus: "configured",
            lastTestedAt: null,
            error: null,
          },
        }));
      } catch (error) {
        const normalized = normalizeAIError(providerId, error);
        if (normalized.category === "credential_store") {
          setCredentialBackendAvailable(false);
        }
        setProviderStates((current) => ({
          ...current,
          [providerId]: {
            ...current[providerId],
            connectionStatus: normalized.category === "invalid_credentials"
              ? current[providerId].credentialConfigured
                ? "configured"
                : "not_configured"
              : "unavailable",
            error: normalized,
          },
        }));
        throw new AIProviderOperationError(normalized);
      }
    },
    [dependencies.credentialService],
  );

  const deleteCredential = useCallback(
    async (providerId: AIProviderId) => {
      try {
        await dependencies.credentialService.deleteCredential(providerId);
        setProviderStates((current) => ({
          ...current,
          [providerId]: runtimeState(),
        }));
      } catch (error) {
        const normalized = normalizeAIError(providerId, error);
        setProviderStates((current) => ({
          ...current,
          [providerId]: {
            ...current[providerId],
            connectionStatus: "unavailable",
            error: normalized,
          },
        }));
        throw new AIProviderOperationError(normalized);
      }
    },
    [dependencies.credentialService],
  );

  const testConnection = useCallback(
    async (providerId: AIProviderId) => {
      const config = preferences.configs[providerId];
      const modelId = config.selectedModelId?.trim();
      if (!modelId) {
        const normalized = normalizeAIError(providerId, {
          code: "configuration_error",
          message: "Choose a model before testing the connection.",
        });
        const result: AIConnectionResult = {
          status: "provider_error",
          providerId,
          modelVerified: false,
          message: normalized.message,
          error: normalized,
        };
        setProviderStates((current) => ({
          ...current,
          [providerId]: { ...current[providerId], connectionStatus: result.status, error: normalized },
        }));
        return result;
      }

      setProviderStates((current) => ({
        ...current,
        [providerId]: { ...current[providerId], connectionStatus: "testing", error: null },
      }));
      let result: AIConnectionResult;
      try {
        result = await manager.testConnection({
          providerId,
          modelId,
          ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
        });
      } catch (error) {
        const normalized = normalizeAIError(providerId, error);
        result = {
          status: connectionFailureStatus(normalized),
          providerId,
          modelVerified: false,
          message: normalized.message,
          error: normalized,
        };
      }
      setProviderStates((current) => ({
        ...current,
        [providerId]: {
          ...current[providerId],
          connectionStatus: result.status,
          lastTestedAt: new Date().toISOString(),
          error: result.error ?? null,
        },
      }));
      return result;
    },
    [manager, preferences.configs],
  );

  const selectedProvider = preferences.selectedProviderId
    ? aiProviderRegistry.get(preferences.selectedProviderId)
    : null;
  const selectedConfig = preferences.selectedProviderId
    ? preferences.configs[preferences.selectedProviderId]
    : null;
  const selectedRuntime = preferences.selectedProviderId
    ? providerStates[preferences.selectedProviderId]
    : null;

  const value = useMemo<AIProviderContextValue>(
    () => ({
      preferences,
      providerStates,
      requestStates,
      usageByProvider,
      selectedProvider,
      selectedConfig,
      selectedRuntime,
      credentialBackendAvailable,
      credentialPresenceReady,
      selectProvider,
      selectModel,
      setBaseUrl,
      setProviderEnabled,
      saveCredential,
      deleteCredential,
      testConnection,
      refreshCredentialPresence,
    }),
    [
      credentialBackendAvailable,
      credentialPresenceReady,
      deleteCredential,
      preferences,
      providerStates,
      requestStates,
      refreshCredentialPresence,
      saveCredential,
      selectModel,
      selectProvider,
      selectedConfig,
      selectedProvider,
      selectedRuntime,
      setBaseUrl,
      setProviderEnabled,
      testConnection,
      usageByProvider,
    ],
  );

  return <AIProviderContext.Provider value={value}>{children}</AIProviderContext.Provider>;
}

// This hook intentionally shares the provider module.
// eslint-disable-next-line react-refresh/only-export-components
export function useAIProviders(): AIProviderContextValue {
  const context = useContext(AIProviderContext);
  if (!context) throw new Error("useAIProviders must be used within AIProviderProvider");
  return context;
}
