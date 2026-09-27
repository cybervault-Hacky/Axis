import { describe, expect, it } from "vitest";
import type { AIProviderId } from "../domain/types";
import { TauriCredentialService } from "./credentialService";

describe("Tauri credential service", () => {
  it("uses only provider-scoped credential commands and never retrieves a raw key", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invoke = <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
      calls.push({ command, args });
      return Promise.resolve((command === "has_ai_credential" ? true : undefined) as T);
    };
    const service = new TauriCredentialService(invoke, () => true);

    await service.saveCredential("openai", "obvious-test-placeholder-key");
    await expect(service.hasCredential("openai")).resolves.toBe(true);
    await service.deleteCredential("openai");
    await service.clearAll();

    expect(calls.map(({ command }) => command)).toEqual([
      "save_ai_credential",
      "has_ai_credential",
      "delete_ai_credential",
      "clear_all_ai_credentials",
    ]);
    expect(calls.some(({ command }) => /get|read|load/.test(command))).toBe(false);
    expect(calls[0]?.args).toEqual({
      providerId: "openai",
      credential: "obvious-test-placeholder-key",
    });
  });

  it("rejects malformed provider scopes before crossing the native boundary", async () => {
    let invoked = false;
    const service = new TauriCredentialService(<T>() => {
      invoked = true;
      return Promise.resolve(undefined as T);
    }, () => true);

    await expect(
      service.hasCredential("../gemini" as unknown as AIProviderId),
    ).rejects.toMatchObject({ code: "invalid_provider_scope" });
    expect(invoked).toBe(false);
  });

  it("rejects browser use without invoking or falling back to web storage", async () => {
    let invoked = false;
    const invoke = <T>(): Promise<T> => {
      invoked = true;
      return Promise.resolve(undefined as T);
    };
    const service = new TauriCredentialService(invoke, () => false);

    await expect(
      service.saveCredential("gemini", "obvious-test-placeholder-key"),
    ).rejects.toMatchObject({ code: "native_unavailable" });
    expect(invoked).toBe(false);
    expect(window.localStorage).toHaveLength(0);
  });

  it("normalizes native store failures to safe errors", async () => {
    const invoke = <T>(): Promise<T> => {
      const error = Object.assign(
        new Error("failed around obvious-test-placeholder-key"),
        { code: "credential_store_unavailable" },
      );
      return Promise.reject<T>(error);
    };
    const service = new TauriCredentialService(invoke, () => true);

    await expect(service.hasCredential("anthropic")).rejects.toMatchObject({
      code: "credential_store_unavailable",
      message: "The operating-system credential store is unavailable.",
    });
  });
});
