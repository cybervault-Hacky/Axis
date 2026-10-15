import {
  AI_ERROR_MESSAGES,
  isValidSendRequestPayload,
  MAX_PROMPT_CHARS,
  resolveProviderId,
  type AiHistoryTurn,
  type AiImportCredentialPayload,
  type AiImportCredentialResult,
  type AiProviderId,
  type AiProviderStatus,
  type AiRemoveCredentialResult,
  type AiSendRequestPayload,
  type AiSendResult,
  type AiStreamEvent,
  type AiStreamStartResult,
  type AiTestConnectionResult
} from "../../../shared/ai-contract";

export { MAX_PROMPT_CHARS };

function bridgeUnavailableStatus(provider?: AiProviderId): AiProviderStatus {
  return {
    provider: resolveProviderId(provider),
    configured: false,
    backend: "none",
    secure: false,
    persistentStorageAvailable: false,
    nativeBridgeAvailable: false
  };
}

/**
 * Thin renderer-side wrapper around `window.axis.ai`. Exists so every view
 * shares one honest fallback when the native preload bridge is absent (the
 * plain browser dev-server preview) instead of each call site guessing —
 * no native capability is ever simulated here.
 */
export function hasNativeBridge(): boolean {
  return typeof window !== "undefined" && typeof window.axis !== "undefined";
}

export async function getAiStatus(provider?: AiProviderId): Promise<AiProviderStatus> {
  if (!hasNativeBridge()) return bridgeUnavailableStatus(provider);
  try {
    return await window.axis!.ai.getStatus(provider);
  } catch {
    return bridgeUnavailableStatus(provider);
  }
}

export async function importCredential(payload?: AiImportCredentialPayload): Promise<AiImportCredentialResult> {
  if (!hasNativeBridge()) {
    return { ok: false, code: "BRIDGE_UNAVAILABLE", message: AI_ERROR_MESSAGES.BRIDGE_UNAVAILABLE };
  }
  try {
    return await window.axis!.ai.importCredential(payload);
  } catch {
    return { ok: false, code: "INTERNAL_ERROR", message: AI_ERROR_MESSAGES.INTERNAL_ERROR };
  }
}

export async function removeCredential(provider?: AiProviderId): Promise<AiRemoveCredentialResult> {
  if (!hasNativeBridge()) {
    return { ok: false, code: "BRIDGE_UNAVAILABLE", message: AI_ERROR_MESSAGES.BRIDGE_UNAVAILABLE };
  }
  try {
    return await window.axis!.ai.removeCredential(provider);
  } catch {
    return { ok: false, code: "INTERNAL_ERROR", message: AI_ERROR_MESSAGES.INTERNAL_ERROR };
  }
}

export async function testConnection(provider?: AiProviderId): Promise<AiTestConnectionResult> {
  if (!hasNativeBridge()) {
    return { ok: false, code: "BRIDGE_UNAVAILABLE", message: AI_ERROR_MESSAGES.BRIDGE_UNAVAILABLE };
  }
  try {
    return await window.axis!.ai.testConnection(provider);
  } catch {
    return { ok: false, code: "INTERNAL_ERROR", message: AI_ERROR_MESSAGES.INTERNAL_ERROR };
  }
}

export function makeRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface SendPromptOptions {
  timeoutMs?: number;
  /** Bounded recent conversation turns (Phase 4). Omitted entirely for single-shot requests. */
  history?: AiHistoryTurn[];
  /** Which provider this request targets (Phase 9). Omitted means the main process defaults to "gemini". */
  provider?: AiProviderId;
}

/** Builds a validated request payload with a fresh request id, or null if the prompt itself is invalid. */
export function buildSendPayload(prompt: string, options?: SendPromptOptions): AiSendRequestPayload | null {
  const payload: AiSendRequestPayload = { requestId: makeRequestId(), prompt, timeoutMs: options?.timeoutMs };
  if (options?.history && options.history.length > 0) payload.history = options.history;
  if (options?.provider) payload.provider = options.provider;
  return isValidSendRequestPayload(payload) ? payload : null;
}

export async function sendPrompt(payload: AiSendRequestPayload): Promise<AiSendResult> {
  if (!hasNativeBridge()) {
    return { ok: false, requestId: payload.requestId, code: "BRIDGE_UNAVAILABLE", message: AI_ERROR_MESSAGES.BRIDGE_UNAVAILABLE };
  }
  try {
    return await window.axis!.ai.sendRequest(payload);
  } catch {
    return { ok: false, requestId: payload.requestId, code: "INTERNAL_ERROR", message: AI_ERROR_MESSAGES.INTERNAL_ERROR };
  }
}

export async function cancelPrompt(requestId: string): Promise<void> {
  if (!hasNativeBridge()) return;
  try {
    await window.axis!.ai.cancelRequest(requestId);
  } catch {
    // Best-effort — if the main process is unreachable there is nothing
    // further the renderer can safely do; the UI timeline simply proceeds.
  }
}

/**
 * Starts a streaming generation. Resolves quickly with only an
 * acknowledgement (or an immediate rejection for a problem the main
 * process can know synchronously) — the actual text and outcome arrive via
 * `onStreamEvent`. Degrades honestly to BRIDGE_UNAVAILABLE both when there
 * is no native bridge at all and when an older/partial bridge does not
 * expose this Phase 4 method (defence in depth for tests and any future
 * partial-bridge scenario).
 */
export async function sendStreamingRequest(payload: AiSendRequestPayload): Promise<AiStreamStartResult> {
  if (!hasNativeBridge() || typeof window.axis!.ai.sendStreamingRequest !== "function") {
    return { ok: false, requestId: payload.requestId, code: "BRIDGE_UNAVAILABLE", message: AI_ERROR_MESSAGES.BRIDGE_UNAVAILABLE };
  }
  try {
    return await window.axis!.ai.sendStreamingRequest(payload);
  } catch {
    return { ok: false, requestId: payload.requestId, code: "INTERNAL_ERROR", message: AI_ERROR_MESSAGES.INTERNAL_ERROR };
  }
}

/**
 * Subscribes to stream events for the lifetime of the caller's choosing.
 * Returns a no-op unsubscribe when there is no native bridge (or an older
 * bridge without this method) instead of throwing, so callers can always
 * safely call the returned function during teardown.
 */
export function onStreamEvent(callback: (event: AiStreamEvent) => void): () => void {
  if (!hasNativeBridge() || typeof window.axis!.ai.onStreamEvent !== "function") {
    return () => {};
  }
  try {
    return window.axis!.ai.onStreamEvent(callback);
  } catch {
    return () => {};
  }
}
