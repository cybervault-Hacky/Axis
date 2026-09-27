import { invoke } from "@tauri-apps/api/core";
import type { AIProviderId } from "../domain/types";
import { isAIProviderId } from "../providers/registry";

export type CredentialServiceErrorCode =
  | "native_unavailable"
  | "invalid_provider_scope"
  | "invalid_credential"
  | "credential_store_unavailable"
  | "credential_operation_failed";

export class CredentialServiceError extends Error {
  readonly code: CredentialServiceErrorCode;

  constructor(code: CredentialServiceErrorCode, message: string) {
    super(message);
    this.name = "CredentialServiceError";
    this.code = code;
  }
}

export interface CredentialService {
  isNativeAvailable(): boolean;
  saveCredential(providerId: AIProviderId, credential: string): Promise<void>;
  hasCredential(providerId: AIProviderId): Promise<boolean>;
  deleteCredential(providerId: AIProviderId): Promise<void>;
  clearAll(): Promise<void>;
}

type NativeInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

function hasTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function unavailableError(): CredentialServiceError {
  return new CredentialServiceError(
    "native_unavailable",
    "Secure credential storage is available only in the native AXIS desktop runtime.",
  );
}

function assertProviderScope(providerId: AIProviderId): void {
  if (!isAIProviderId(providerId)) {
    throw new CredentialServiceError(
      "invalid_provider_scope",
      "The provider credential scope is invalid.",
    );
  }
}

function normalizeCredentialError(error: unknown): CredentialServiceError {
  if (error instanceof CredentialServiceError) return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const code = typeof record.code === "string" ? record.code : "";
    if (code === "invalid_credential") {
      return new CredentialServiceError("invalid_credential", "The credential was not accepted.");
    }
    if (code === "credential_store_unavailable") {
      return new CredentialServiceError(
        "credential_store_unavailable",
        "The operating-system credential store is unavailable.",
      );
    }
  }
  return new CredentialServiceError(
    "credential_operation_failed",
    "The credential operation could not be completed.",
  );
}

export class TauriCredentialService implements CredentialService {
  readonly #invoke: NativeInvoke;
  readonly #runtimeCheck: () => boolean;

  constructor(
    nativeInvoke: NativeInvoke = invoke,
    runtimeCheck: () => boolean = hasTauriRuntime,
  ) {
    this.#invoke = nativeInvoke;
    this.#runtimeCheck = runtimeCheck;
  }

  isNativeAvailable(): boolean {
    return this.#runtimeCheck();
  }

  async saveCredential(providerId: AIProviderId, credential: string): Promise<void> {
    assertProviderScope(providerId);
    if (!this.isNativeAvailable()) throw unavailableError();
    try {
      await this.#invoke<void>("save_ai_credential", { providerId, credential });
    } catch (error) {
      throw normalizeCredentialError(error);
    }
  }

  async hasCredential(providerId: AIProviderId): Promise<boolean> {
    assertProviderScope(providerId);
    if (!this.isNativeAvailable()) throw unavailableError();
    try {
      return await this.#invoke<boolean>("has_ai_credential", { providerId });
    } catch (error) {
      throw normalizeCredentialError(error);
    }
  }

  async deleteCredential(providerId: AIProviderId): Promise<void> {
    assertProviderScope(providerId);
    if (!this.isNativeAvailable()) throw unavailableError();
    try {
      await this.#invoke<void>("delete_ai_credential", { providerId });
    } catch (error) {
      throw normalizeCredentialError(error);
    }
  }

  async clearAll(): Promise<void> {
    if (!this.isNativeAvailable()) throw unavailableError();
    try {
      await this.#invoke<void>("clear_all_ai_credentials");
    } catch (error) {
      throw normalizeCredentialError(error);
    }
  }
}

export const credentialService = new TauriCredentialService();
