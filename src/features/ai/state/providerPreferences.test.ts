import { describe, expect, it, vi } from "vitest";
import {
  AI_PROVIDER_PREFERENCES_KEY,
  createDefaultAIProviderPreferences,
  parseAIProviderPreferences,
  persistAIProviderPreferences,
} from "./providerPreferences";

describe("AI provider preferences", () => {
  it("creates safe defaults without selecting or configuring a credential", () => {
    const preferences = createDefaultAIProviderPreferences();
    expect(preferences.selectedProviderId).toBeNull();
    expect(preferences.configs.openai.selectedModelId).toBe("gpt-5.4-mini");
    expect(preferences.configs["openai-compatible"].selectedModelId).toBeNull();
    expect(JSON.stringify(preferences)).not.toMatch(/apiKey|credential|secret/i);
  });

  it("sanitizes unknown providers, models, and unsafe fields from stored data", () => {
    const parsed = parseAIProviderPreferences(JSON.stringify({
      version: 999,
      selectedProviderId: "unknown-provider",
      configs: {
        openai: {
          providerId: "other-provider",
          enabled: false,
          selectedModelId: "invented-model",
          apiKey: "obvious-test-placeholder-secret",
          connectionStatus: "connected",
        },
        "openai-compatible": {
          selectedModelId: "  private-model  ",
          baseUrl: "  https://models.example/v1  ",
          authorization: "Bearer obvious-test-placeholder",
        },
      },
    }));

    expect(parsed.selectedProviderId).toBeNull();
    expect(parsed.configs.openai).toEqual({
      providerId: "openai",
      enabled: false,
      selectedModelId: "gpt-5.4-mini",
    });
    expect(parsed.configs["openai-compatible"]).toEqual({
      providerId: "openai-compatible",
      enabled: true,
      selectedModelId: "private-model",
      baseUrl: "https://models.example/v1",
    });
    expect(JSON.stringify(parsed)).not.toContain("obvious-test-placeholder");
  });

  it("drops custom endpoint URLs containing credentials, queries, or insecure remote HTTP", () => {
    for (const baseUrl of [
      "https://user:password@models.example/v1",
      "https://models.example/v1?api_key=placeholder",
      "http://models.example/v1",
    ]) {
      const parsed = parseAIProviderPreferences(JSON.stringify({
        selectedProviderId: "openai-compatible",
        configs: { "openai-compatible": { baseUrl } },
      }));
      expect(parsed.configs["openai-compatible"].baseUrl).toBeUndefined();
    }
  });

  it("falls back cleanly for malformed JSON and persists only the normalized shape", () => {
    expect(parseAIProviderPreferences("not-json")).toEqual(
      createDefaultAIProviderPreferences(),
    );
    const setItem = vi.fn();
    const preferences = createDefaultAIProviderPreferences();
    preferences.selectedProviderId = "gemini";
    persistAIProviderPreferences({ setItem }, preferences);

    expect(setItem).toHaveBeenCalledOnce();
    expect(setItem.mock.calls[0]?.[0]).toBe(AI_PROVIDER_PREFERENCES_KEY);
    const serialized = String(setItem.mock.calls[0]?.[1]);
    const persisted = JSON.parse(serialized) as { selectedProviderId?: unknown };
    expect(persisted.selectedProviderId).toBe("gemini");
    expect(serialized).not.toMatch(/apiKey|authorization|credential/i);
  });
});
