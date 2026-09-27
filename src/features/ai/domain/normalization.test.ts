import { describe, expect, it } from "vitest";
import { normalizeAIError } from "./errors";
import { createAIRequest, normalizeAIResponse } from "./requestNormalization";

describe("normalized AI contracts", () => {
  it("normalizes messages and retains future tool and request metadata", () => {
    const request = createAIRequest({
      id: " request-1 ",
      providerId: "anthropic",
      modelId: " claude-sonnet-5 ",
      messages: [{ role: "user", content: "  Draft a release note.  " }],
      tools: [{
        name: "lookup_project",
        description: "Looks up project metadata.",
        inputSchema: { type: "object" },
      }],
      metadata: { operationId: "operation-1", labels: { surface: "test" } },
      temperature: 0.4,
    });

    expect(request).toMatchObject({
      id: "request-1",
      providerId: "anthropic",
      modelId: "claude-sonnet-5",
      messages: [{ role: "user", content: "Draft a release note." }],
      temperature: 0.4,
    });
    expect(request.tools?.[0]?.name).toBe("lookup_project");
    expect(request.metadata?.operationId).toBe("operation-1");
  });

  it("rejects empty requests and invalid temperatures", () => {
    expect(() => createAIRequest({
      id: "request-1",
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      messages: [],
    })).toThrow("at least one message");
    expect(() => createAIRequest({
      id: "request-1",
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      messages: [{ role: "user", content: "Hello" }],
      temperature: 3,
    })).toThrow("between 0 and 2");
  });

  it("normalizes responses and completed usage metadata", () => {
    const response = normalizeAIResponse({
      id: "response-1",
      providerId: "groq",
      modelId: "llama-3.3-70b-versatile",
      text: "  Completed response. ",
      finishReason: "complete",
      providerRequestId: "provider-request-1",
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14, durationMs: 25 },
    });

    expect(response.message).toEqual({ role: "assistant", content: "Completed response." });
    expect(response.usage).toMatchObject({
      providerId: "groq",
      modelId: "llama-3.3-70b-versatile",
      inputTokens: 10,
      outputTokens: 4,
      totalTokens: 14,
      status: "completed",
    });
    expect(Number.isNaN(Date.parse(response.usage?.timestamp ?? ""))).toBe(false);
  });

  it("normalizes provider failures without leaking a raw key", () => {
    const invalid = normalizeAIError("openai", {
      status: 401,
      message: "Rejected sk-obviousplaceholder123",
    });
    expect(invalid).toMatchObject({
      code: "invalid_credentials",
      category: "invalid_credentials",
      retryable: false,
    });
    expect(invalid.message).not.toContain("sk-obviousplaceholder123");

    const configuration = normalizeAIError("openai-compatible", {
      code: "configuration_error",
      message: "Endpoint contains Bearer obvious-test-token-value",
    });
    expect(configuration.message).toContain("[REDACTED]");
    expect(configuration.message).not.toContain("obvious-test-token-value");
  });
});
