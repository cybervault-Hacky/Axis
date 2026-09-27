import { describe, expect, it } from "vitest";
import {
  isSensitiveFieldName,
  redactSecrets,
  redactSecretText,
} from "./redactSecrets";

describe("secret redaction", () => {
  it("redacts provider-key patterns, bearer tokens, and authorization headers", () => {
    const raw = [
      "api_key=obvious-test-key-value",
      "Authorization: Bearer obvious-test-bearer-token",
      "Authorization=Basic obvious-test-basic-token",
      "x-api-key: obvious-test-header-key",
      "x-goog-api-key=obvious-test-google-header-key",
      "token=obvious-test-generic-token",
      "{\"api_key\": \"obvious-test-json-secret\"}",
      "https://embedded-user:embedded-password@models.example/v1",
      "sk-obviousplaceholder123",
      "gsk_obviousplaceholder456",
      "AIzaObviousPlaceholder789",
    ].join(" | ");
    const redacted = redactSecretText(raw);

    expect(redacted).not.toContain("obvious-test-key-value");
    expect(redacted).not.toContain("obvious-test-bearer-token");
    expect(redacted).not.toContain("obvious-test-basic-token");
    expect(redacted).not.toContain("obvious-test-header-key");
    expect(redacted).not.toContain("obvious-test-google-header-key");
    expect(redacted).not.toContain("obvious-test-generic-token");
    expect(redacted).not.toContain("obvious-test-json-secret");
    expect(redacted).not.toContain("embedded-user");
    expect(redacted).not.toContain("embedded-password");
    expect(redacted).not.toContain("sk-obviousplaceholder123");
    expect(redacted).not.toContain("gsk_obviousplaceholder456");
    expect(redacted).not.toContain("AIzaObviousPlaceholder789");
    expect(redacted.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("redacts nested sensitive fields, arrays, and errors containing secrets", () => {
    const value = {
      request: {
        headers: {
          authorization: "Bearer obvious-test-header-token",
          "x-api-key": "obvious-test-api-key",
        },
        nested: [
          { refreshToken: "obvious-test-refresh-token" },
          { token: "obvious-test-generic-field-token" },
          "Bearer obvious-test-array-bearer-value",
        ],
      },
      error: new Error("Provider failed for sk-obviousplaceholder999"),
      safe: "provider metadata",
    };
    const redacted = redactSecrets(value);
    const serialized = JSON.stringify(redacted);

    expect(serialized).not.toContain("obvious-test-header-token");
    expect(serialized).not.toContain("obvious-test-api-key");
    expect(serialized).not.toContain("obvious-test-refresh-token");
    expect(serialized).not.toContain("obvious-test-generic-field-token");
    expect(serialized).not.toContain("obvious-test-array-bearer-value");
    expect(serialized).not.toContain("sk-obviousplaceholder999");
    expect(redacted.safe).toBe("provider metadata");
    expect(redacted.request.headers.authorization).toBe("[REDACTED]");
  });

  it("handles circular data and recognizes sensitive field names", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(redactSecrets(circular)).toEqual({ self: "[Circular]" });
    expect(isSensitiveFieldName("access_token")).toBe(true);
    expect(isSensitiveFieldName("token")).toBe(true);
    expect(isSensitiveFieldName("x-goog-api-key")).toBe(true);
    expect(isSensitiveFieldName("modelId")).toBe(false);
  });
});
