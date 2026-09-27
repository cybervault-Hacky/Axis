import { describe, expect, it } from "vitest";
import { AIProviderOperationError } from "../domain/errors";
import { createAIRequest } from "../domain/requestNormalization";
import type { AIConnectionGateway } from "../services/connectionGateway";
import { AIProviderManager } from "./AIProviderManager";
import { createProviderAdapters } from "./adapters";

describe("AI provider manager", () => {
  const gateway: AIConnectionGateway = {
    isNativeAvailable: () => true,
    testConnection: (input) => Promise.resolve({
      status: "connected",
      providerId: input.providerId,
      modelVerified: true,
      message: "Verified",
    }),
  };

  it("dispatches connection tests through the provider adapter", async () => {
    const manager = new AIProviderManager(createProviderAdapters(gateway));
    await expect(manager.testConnection({
      providerId: "gemini",
      modelId: "gemini-3.7-flash",
    })).resolves.toEqual({
      status: "connected",
      providerId: "gemini",
      modelVerified: true,
      message: "Verified",
    });
  });

  it("keeps generation and streaming explicitly unavailable in Phase 3", async () => {
    const manager = new AIProviderManager(createProviderAdapters(gateway));
    const request = createAIRequest({
      id: "request-1",
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      messages: [{ role: "user", content: "This must not be sent." }],
    });

    await expect(manager.request(request)).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AIProviderOperationError &&
        error.normalized.code === "generation_not_enabled",
    );

    const stream = manager.stream(request)[Symbol.asyncIterator]();
    await expect(stream.next()).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AIProviderOperationError &&
        error.normalized.code === "generation_not_enabled",
    );
  });

  it("rejects duplicate adapters", () => {
    const adapters = createProviderAdapters(gateway);
    expect(() => new AIProviderManager([adapters[0]!, adapters[0]!])).toThrow(
      "Duplicate AI provider adapter",
    );
  });
});
