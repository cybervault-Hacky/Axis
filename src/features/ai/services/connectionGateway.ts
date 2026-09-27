import { invoke } from "@tauri-apps/api/core";
import { normalizeAIError } from "../domain/errors";
import type {
  AIConnectionResult,
  AIConnectionStatus,
  AIError,
  AIProviderId,
  AIRequestOptions,
  ProviderConnectionInput,
} from "../domain/types";

interface NativeConnectionResult {
  status: AIConnectionResult["status"];
  providerId: AIProviderId;
  modelVerified: boolean;
  message: string;
  error?: AIError;
}

type NativeInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

function hasTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function abortError(): DOMException {
  return new DOMException("The provider operation was cancelled.", "AbortError");
}

export interface AIConnectionGateway {
  isNativeAvailable(): boolean;
  testConnection(
    input: ProviderConnectionInput,
    options?: AIRequestOptions,
  ): Promise<AIConnectionResult>;
}

export class TauriConnectionGateway implements AIConnectionGateway {
  readonly #invoke: NativeInvoke;
  readonly #runtimeCheck: () => boolean;

  constructor(
    nativeInvoke: NativeInvoke = invoke,
    runtimeCheck: () => boolean = hasTauriRuntime,
  ) {
    this.#invoke = nativeInvoke;
    this.#runtimeCheck = runtimeCheck;
  }

  isNativeAvailable(): boolean {
    return this.#runtimeCheck();
  }

  async testConnection(
    input: ProviderConnectionInput,
    options: AIRequestOptions = {},
  ): Promise<AIConnectionResult> {
    if (options.signal?.aborted) throw abortError();
    if (!this.isNativeAvailable()) {
      const error = normalizeAIError(input.providerId, {
        code: "credential_store_unavailable",
      });
      return {
        status: "unavailable",
        providerId: input.providerId,
        modelVerified: false,
        message: "Connection testing requires the native AXIS desktop runtime.",
        error,
      };
    }

    try {
      const result = await this.#invoke<NativeConnectionResult>(
        "test_ai_provider_connection",
        {
          input: {
            providerId: input.providerId,
            modelId: input.modelId,
            ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
          },
        },
      );
      if (options.signal?.aborted) throw abortError();
      return result;
    } catch (error) {
      if (options.signal?.aborted) throw abortError();
      const normalized = normalizeAIError(input.providerId, error);
      const statusByCategory: Partial<Record<AIError["category"], AIConnectionStatus>> = {
        invalid_credentials: "invalid_credentials",
        expired_credentials: "invalid_credentials",
        rate_limit: "rate_limited",
        network_failure: "network_error",
        unsupported_model: "unsupported",
        credential_store: "unavailable",
        configuration_error: "provider_error",
        provider_outage: "provider_error",
        invalid_request: "provider_error",
        unknown_provider_error: "provider_error",
      };
      return {
        status: statusByCategory[normalized.category] as AIConnectionResult["status"],
        providerId: input.providerId,
        modelVerified: false,
        message: normalized.message,
        error: normalized,
      };
    }
  }
}

export const connectionGateway = new TauriConnectionGateway();
