import type {
  AIConnectionResult,
  AIProviderAdapter,
  AIProviderId,
  AIRequest,
  AIRequestOptions,
  AIResponse,
  AIStreamEvent,
  ProviderConnectionInput,
} from "../domain/types";
import { aiProviderRegistry, type AIProviderRegistry } from "./registry";

export class AIProviderManager {
  readonly #registry: AIProviderRegistry;
  readonly #adapters = new Map<AIProviderId, AIProviderAdapter>();

  constructor(
    adapters: readonly AIProviderAdapter[],
    registry: AIProviderRegistry = aiProviderRegistry,
  ) {
    this.#registry = registry;
    for (const adapter of adapters) {
      if (this.#adapters.has(adapter.providerId)) {
        throw new Error(`Duplicate AI provider adapter: ${adapter.providerId}`);
      }
      if (!registry.has(adapter.providerId)) {
        throw new Error(`Adapter has no provider registration: ${String(adapter.providerId)}`);
      }
      this.#adapters.set(adapter.providerId, adapter);
    }
  }

  getAdapter(providerId: AIProviderId): AIProviderAdapter {
    const provider = this.#registry.get(providerId);
    if (provider.availability === "unavailable") {
      throw new Error(`${provider.displayName} is unavailable`);
    }
    const adapter = this.#adapters.get(providerId);
    if (!adapter) throw new Error(`No adapter is registered for ${providerId}`);
    return adapter;
  }

  testConnection(
    input: ProviderConnectionInput,
    options?: AIRequestOptions,
  ): Promise<AIConnectionResult> {
    return this.getAdapter(input.providerId).testConnection(input, options);
  }

  request(request: AIRequest, options?: AIRequestOptions): Promise<AIResponse> {
    return this.getAdapter(request.providerId).request(request, options);
  }

  stream(
    request: AIRequest,
    options?: AIRequestOptions,
  ): AsyncIterable<AIStreamEvent> {
    return this.getAdapter(request.providerId).stream(request, options);
  }
}
