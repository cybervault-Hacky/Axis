import {
  AIProviderOperationError,
  createUnsupportedExecutionError,
} from "../domain/errors";
import type {
  AIConnectionResult,
  AIProviderAdapter,
  AIProviderId,
  AIRequestOptions,
  AIResponse,
  AIStreamEvent,
  ProviderConnectionInput,
} from "../domain/types";
import type { AIConnectionGateway } from "../services/connectionGateway";

abstract class ConnectionOnlyAdapter implements AIProviderAdapter {
  abstract readonly providerId: AIProviderId;
  readonly #gateway: AIConnectionGateway;

  constructor(gateway: AIConnectionGateway) {
    this.#gateway = gateway;
  }

  testConnection(
    input: ProviderConnectionInput,
    options?: AIRequestOptions,
  ): Promise<AIConnectionResult> {
    if (input.providerId !== this.providerId) {
      throw new Error(`Adapter ${this.providerId} cannot test ${input.providerId}`);
    }
    return this.#gateway.testConnection(input, options);
  }

  request(): Promise<AIResponse> {
    return Promise.reject(
      new AIProviderOperationError(createUnsupportedExecutionError(this.providerId)),
    );
  }

  stream(): AsyncIterable<AIStreamEvent> {
    const error = new AIProviderOperationError(
      createUnsupportedExecutionError(this.providerId),
    );
    const iterator: AsyncIterableIterator<AIStreamEvent> = {
      next: () => Promise.reject(error),
      [Symbol.asyncIterator]() {
        return this;
      },
    };
    return iterator;
  }
}

export class OpenAIAdapter extends ConnectionOnlyAdapter {
  readonly providerId = "openai" as const;
}

export class GeminiAdapter extends ConnectionOnlyAdapter {
  readonly providerId = "gemini" as const;
}

export class AnthropicAdapter extends ConnectionOnlyAdapter {
  readonly providerId = "anthropic" as const;
}

export class GroqAdapter extends ConnectionOnlyAdapter {
  readonly providerId = "groq" as const;
}

export class OpenAICompatibleAdapter extends ConnectionOnlyAdapter {
  readonly providerId = "openai-compatible" as const;
}

export function createProviderAdapters(
  gateway: AIConnectionGateway,
): readonly AIProviderAdapter[] {
  return [
    new OpenAIAdapter(gateway),
    new GeminiAdapter(gateway),
    new AnthropicAdapter(gateway),
    new GroqAdapter(gateway),
    new OpenAICompatibleAdapter(gateway),
  ];
}
