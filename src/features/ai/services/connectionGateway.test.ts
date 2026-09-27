import { describe, expect, it } from "vitest";
import { TauriConnectionGateway } from "./connectionGateway";

describe("Tauri connection gateway", () => {
  const input = {
    providerId: "openai" as const,
    modelId: "gpt-5.4-mini",
  };

  it("reports native-runtime unavailability without simulating a connection", async () => {
    let invoked = false;
    const gateway = new TauriConnectionGateway(<T>() => {
      invoked = true;
      return Promise.resolve(undefined as T);
    }, () => false);

    await expect(gateway.testConnection(input)).resolves.toMatchObject({
      status: "unavailable",
      providerId: "openai",
      modelVerified: false,
      error: { category: "credential_store" },
    });
    expect(invoked).toBe(false);
  });

  it("passes only normalized provider connection input to the native command", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const gateway = new TauriConnectionGateway(
      <T>(command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        return Promise.resolve({
          status: "connected",
          providerId: "openai-compatible",
          modelVerified: true,
          message: "Verified",
        } as T);
      },
      () => true,
    );

    await expect(gateway.testConnection({
      providerId: "openai-compatible",
      modelId: "private-model",
      baseUrl: "https://models.example/v1",
    })).resolves.toMatchObject({ status: "connected", modelVerified: true });
    expect(calls).toEqual([{
      command: "test_ai_provider_connection",
      args: {
        input: {
          providerId: "openai-compatible",
          modelId: "private-model",
          baseUrl: "https://models.example/v1",
        },
      },
    }]);
  });

  it("normalizes thrown network failures and honors cancellation", async () => {
    const gateway = new TauriConnectionGateway(
      <T>() => {
        const error = Object.assign(new Error("socket details"), {
          code: "network_error",
        });
        return Promise.reject<T>(error);
      },
      () => true,
    );
    await expect(gateway.testConnection(input)).resolves.toMatchObject({
      status: "network_error",
      modelVerified: false,
      error: { category: "network_failure", retryable: true },
    });

    const controller = new AbortController();
    controller.abort();
    await expect(
      gateway.testConnection(input, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
