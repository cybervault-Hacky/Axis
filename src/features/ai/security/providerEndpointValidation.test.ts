import { describe, expect, it } from "vitest";
import { validateProviderBaseUrl } from "./providerEndpointValidation";

describe("custom provider endpoint validation", () => {
  it("accepts HTTPS and loopback HTTP base URLs", () => {
    expect(validateProviderBaseUrl(" https://models.example/v1/ ")).toEqual({
      valid: true,
      value: "https://models.example/v1",
    });
    expect(validateProviderBaseUrl("http://localhost:11434/v1").valid).toBe(true);
    expect(validateProviderBaseUrl("http://127.0.0.1:8080/v1").valid).toBe(true);
    expect(validateProviderBaseUrl("http://[::1]:8080/v1").valid).toBe(true);
  });

  it("rejects endpoints longer than the native boundary accepts", () => {
    const oversized = `https://models.example/${"a".repeat(2049)}`;
    expect(validateProviderBaseUrl(oversized).valid).toBe(false);
  });

  it.each([
    "http://models.example/v1",
    "http://127.evil.example.com/v1",
    "https://user:password@models.example/v1",
    "https://user@models.example/v1",
    "https://@models.example/v1",
    "https://models.example/v1?token=placeholder",
    "https://models.example/v1#fragment",
    "file:///tmp/models",
  ])("rejects unsafe endpoint forms", (endpoint) => {
    expect(validateProviderBaseUrl(endpoint).valid).toBe(false);
  });
});
