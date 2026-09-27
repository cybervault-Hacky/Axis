import { describe, expect, it } from "vitest";
import type { AIProviderDefinition } from "../domain/types";
import {
  aiProviderRegistry,
  createProviderRegistry,
  isAIProviderId,
} from "./registry";

const openAI = aiProviderRegistry.get("openai");

function definition(
  overrides: Partial<AIProviderDefinition> = {},
): AIProviderDefinition {
  return {
    ...openAI,
    models: [...openAI.models],
    ...overrides,
  };
}

describe("AI provider registry", () => {
  it("registers exactly the five normalized Phase 3 providers", () => {
    expect(aiProviderRegistry.providers.map((provider) => provider.id)).toEqual([
      "openai",
      "gemini",
      "anthropic",
      "groq",
      "openai-compatible",
    ]);
    expect(aiProviderRegistry.get("openai-compatible").customEndpoint).toBe(true);
    expect(isAIProviderId("anthropic")).toBe(true);
    expect(isAIProviderId("other-provider")).toBe(false);
  });

  it("rejects duplicate provider and model identifiers", () => {
    expect(() => createProviderRegistry([definition(), definition()])).toThrow(
      "Duplicate AI provider ID",
    );
    expect(() => createProviderRegistry([
      definition({
        models: [openAI.models[0]!, openAI.models[0]!],
      }),
    ])).toThrow("duplicate model ID");
  });

  it("rejects an invalid catalog default and empty model identifiers", () => {
    expect(() => createProviderRegistry([
      definition({ defaultModelId: "missing-model" }),
    ])).toThrow("default model is not present");
    expect(() => createProviderRegistry([
      definition({
        defaultModelId: null,
        models: [{ ...openAI.models[0]!, id: "  " }],
      }),
    ])).toThrow("empty model ID");
  });
});
