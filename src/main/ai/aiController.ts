import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from "electron";
import { AXIS_IPC_CHANNELS } from "../../shared/ipc-contract";
import { createTrustedSenderCheck } from "../ipc/trustedSender";
import {
  AI_ERROR_MESSAGES,
  clampHistory,
  DEFAULT_TIMEOUT_MS,
  isValidCancelPayload,
  isValidImportPayload,
  isValidProviderScopedPayload,
  isValidSendRequestPayload,
  resolveProviderId,
  type AiCancelResult,
  type AiErrorCode,
  type AiImportCredentialResult,
  type AiProviderId,
  type AiProviderStatus,
  type AiRemoveCredentialResult,
  type AiSendResult,
  type AiStreamEvent,
  type AiStreamStartResult,
  type AiTestConnectionResult
} from "../../shared/ai-contract";
import * as credentialStore from "./credentialStore";
import { sendGeminiPrompt, streamGeminiPrompt, testGeminiConnection } from "./geminiProvider";
import { sendOpenAiPrompt, streamOpenAiPrompt, testOpenAiConnection } from "./openaiProvider";
import { sendAnthropicPrompt, streamAnthropicPrompt, testAnthropicConnection } from "./anthropicProvider";
import { sendMistralPrompt, streamMistralPrompt, testMistralConnection } from "./mistralProvider";
import type { ProviderAdapter } from "./providerTypes";

const TEST_CONNECTION_TIMEOUT_MS = 15_000;

/**
 * One adapter per supported provider (Phase 9: Gemini/OpenAI; Phase 10:
 * Anthropic; Phase 14: Mistral), each conforming to the shared
 * `ProviderAdapter` interface. Every handler below dispatches through
 * `PROVIDER_ADAPTERS[provider]` instead of calling a provider's functions
 * by name — the request lifecycle (validation, single-flight tracking,
 * timeout/`AbortController` wiring, the streaming relay over
 * `axis:ai:stream-event`) is defined exactly once here and is never
 * duplicated per provider.
 */
const PROVIDER_ADAPTERS: Record<AiProviderId, ProviderAdapter> = {
  gemini: { id: "gemini", sendPrompt: sendGeminiPrompt, streamPrompt: streamGeminiPrompt, testConnection: testGeminiConnection },
  openai: { id: "openai", sendPrompt: sendOpenAiPrompt, streamPrompt: streamOpenAiPrompt, testConnection: testOpenAiConnection },
  anthropic: { id: "anthropic", sendPrompt: sendAnthropicPrompt, streamPrompt: streamAnthropicPrompt, testConnection: testAnthropicConnection },
  mistral: { id: "mistral", sendPrompt: sendMistralPrompt, streamPrompt: streamMistralPrompt, testConnection: testMistralConnection }
};


interface ActiveRequestEntry {
  requestId: string;
  controller: AbortController;
  timedOut: boolean;
}

export interface AiControllerDeps {
  getMainWindow: () => BrowserWindow | null;
}

function failure<T extends { ok: false; code?: AiErrorCode; message?: string }>(code: AiErrorCode): T {
  return { ok: false, code, message: AI_ERROR_MESSAGES[code] } as T;
}

/**
 * Orchestrates the AI IPC surface. Kept as a factory (rather than
 * module-level singletons) so tests can construct an isolated controller
 * with a fake `getMainWindow` and fake IPC events, without touching real
 * Electron state.
 */
export function createAiController(deps: AiControllerDeps) {
  const activeRequestsBySender = new Map<number, ActiveRequestEntry>();

  /**
   * Defence in depth: every handler re-verifies the call came from this
   * app's own window and its top-level frame (never a webview/iframe we
   * did not create — AXIS creates none, but this still guards against a
   * compromised/forged sender). Shared with the conversations controller
   * via `trustedSender.ts` so both enforce the exact same check.
   */
  const isTrustedSender = createTrustedSenderCheck(deps.getMainWindow);

  function getStatus(event: IpcMainInvokeEvent, rawPayload?: unknown): AiProviderStatus {
    if (!isTrustedSender(event)) {
      return {
        provider: "gemini",
        configured: false,
        backend: "none",
        secure: false,
        persistentStorageAvailable: false,
        nativeBridgeAvailable: false
      };
    }
    const provider = isValidProviderScopedPayload(rawPayload) ? resolveProviderId(rawPayload?.provider) : "gemini";
    return credentialStore.getStatus(provider);
  }

  async function importCredentialHandler(event: IpcMainInvokeEvent, rawPayload: unknown): Promise<AiImportCredentialResult> {
    if (!isTrustedSender(event)) return failure("INTERNAL_ERROR");
    if (!isValidImportPayload(rawPayload)) return failure("VALIDATION_ERROR");
    const win = deps.getMainWindow();
    if (!win) return failure("INTERNAL_ERROR");
    const provider = resolveProviderId(rawPayload?.provider);
    return credentialStore.importCredential(win, rawPayload ?? {}, provider);
  }

  function removeCredentialHandler(event: IpcMainInvokeEvent, rawPayload?: unknown): AiRemoveCredentialResult {
    if (!isTrustedSender(event)) return failure("INTERNAL_ERROR");
    if (!isValidProviderScopedPayload(rawPayload)) return failure("VALIDATION_ERROR");
    const provider = resolveProviderId(rawPayload?.provider);
    return credentialStore.removeCredential(provider);
  }

  async function testConnectionHandler(event: IpcMainInvokeEvent, rawPayload?: unknown): Promise<AiTestConnectionResult> {
    if (!isTrustedSender(event)) return failure("INTERNAL_ERROR");
    if (!isValidProviderScopedPayload(rawPayload)) return failure("VALIDATION_ERROR");
    const provider = resolveProviderId(rawPayload?.provider);

    const keyLookup = credentialStore.getApiKeyForRequest(provider);
    if (!keyLookup.ok) return failure(keyLookup.code);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TEST_CONNECTION_TIMEOUT_MS);
    try {
      const result = await PROVIDER_ADAPTERS[provider].testConnection(keyLookup.key, { signal: controller.signal });
      if (result.ok) return { ok: true };
      const code = result.code ?? "NETWORK_ERROR";
      return { ok: false, code, message: AI_ERROR_MESSAGES[code] };
    } catch {
      return failure("NETWORK_ERROR");
    } finally {
      clearTimeout(timer);
    }
  }

  async function sendRequestHandler(event: IpcMainInvokeEvent, rawPayload: unknown): Promise<AiSendResult> {
    const fallbackId =
      typeof rawPayload === "object" && rawPayload !== null && typeof (rawPayload as Record<string, unknown>)["requestId"] === "string"
        ? ((rawPayload as Record<string, unknown>)["requestId"] as string)
        : "unknown";

    if (!isTrustedSender(event)) {
      return { ok: false, requestId: fallbackId, code: "INTERNAL_ERROR", message: AI_ERROR_MESSAGES.INTERNAL_ERROR };
    }
    if (!isValidSendRequestPayload(rawPayload)) {
      return { ok: false, requestId: fallbackId, code: "VALIDATION_ERROR", message: AI_ERROR_MESSAGES.VALIDATION_ERROR };
    }

    const senderId = event.sender.id;
    if (activeRequestsBySender.has(senderId)) {
      return { ok: false, requestId: rawPayload.requestId, code: "DUPLICATE_REQUEST", message: AI_ERROR_MESSAGES.DUPLICATE_REQUEST };
    }

    const provider = resolveProviderId(rawPayload.provider);
    const keyLookup = credentialStore.getApiKeyForRequest(provider);
    if (!keyLookup.ok) {
      return { ok: false, requestId: rawPayload.requestId, code: keyLookup.code, message: AI_ERROR_MESSAGES[keyLookup.code] };
    }

    const timeoutMs = rawPayload.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const entry: ActiveRequestEntry = { requestId: rawPayload.requestId, controller, timedOut: false };
    activeRequestsBySender.set(senderId, entry);
    const timer = setTimeout(() => {
      entry.timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const result = await PROVIDER_ADAPTERS[provider].sendPrompt(keyLookup.key, rawPayload.prompt, { signal: controller.signal });
      if (result.ok) {
        return { ok: true, requestId: rawPayload.requestId, text: result.text, truncated: result.truncated };
      }
      // A generic abort from fetch is reported as CANCELLED by the provider
      // layer — promote it to TIMEOUT when our own timer, not the user,
      // triggered the abort.
      const code: AiErrorCode = result.code === "CANCELLED" && entry.timedOut ? "TIMEOUT" : result.code;
      return { ok: false, requestId: rawPayload.requestId, code, message: AI_ERROR_MESSAGES[code] };
    } catch {
      return { ok: false, requestId: rawPayload.requestId, code: "INTERNAL_ERROR", message: AI_ERROR_MESSAGES.INTERNAL_ERROR };
    } finally {
      clearTimeout(timer);
      activeRequestsBySender.delete(senderId);
    }
  }

  /**
   * Starts a streaming generation (Phase 4). Unlike `sendRequestHandler`,
   * this resolves quickly with only an acknowledgement — the actual delta
   * text and the single terminal outcome (done / cancelled / error) are
   * delivered afterwards over the one-way `aiStreamEvent` push channel,
   * every event stamped with this same `requestId`. Shares the same
   * `activeRequestsBySender` single-flight map and the same cancel handler
   * below as the non-streaming path, so duplicate-submission prevention and
   * explicit cancellation behave identically for both.
   */
  async function sendStreamingRequestHandler(event: IpcMainInvokeEvent, rawPayload: unknown): Promise<AiStreamStartResult> {
    const fallbackId =
      typeof rawPayload === "object" && rawPayload !== null && typeof (rawPayload as Record<string, unknown>)["requestId"] === "string"
        ? ((rawPayload as Record<string, unknown>)["requestId"] as string)
        : "unknown";

    if (!isTrustedSender(event)) {
      return { ok: false, requestId: fallbackId, code: "INTERNAL_ERROR", message: AI_ERROR_MESSAGES.INTERNAL_ERROR };
    }
    if (!isValidSendRequestPayload(rawPayload)) {
      return { ok: false, requestId: fallbackId, code: "VALIDATION_ERROR", message: AI_ERROR_MESSAGES.VALIDATION_ERROR };
    }

    const senderId = event.sender.id;
    if (activeRequestsBySender.has(senderId)) {
      return { ok: false, requestId: rawPayload.requestId, code: "DUPLICATE_REQUEST", message: AI_ERROR_MESSAGES.DUPLICATE_REQUEST };
    }

    const provider = resolveProviderId(rawPayload.provider);
    const keyLookup = credentialStore.getApiKeyForRequest(provider);
    if (!keyLookup.ok) {
      return { ok: false, requestId: rawPayload.requestId, code: keyLookup.code, message: AI_ERROR_MESSAGES[keyLookup.code] };
    }

    const requestId = rawPayload.requestId;
    const timeoutMs = rawPayload.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const entry: ActiveRequestEntry = { requestId, controller, timedOut: false };
    activeRequestsBySender.set(senderId, entry);
    const timer = setTimeout(() => {
      entry.timedOut = true;
      controller.abort();
    }, timeoutMs);

    // Authoritative re-clamp: never trust a renderer-computed history bound,
    // even though the renderer already bounds it itself before sending.
    const history = rawPayload.history && rawPayload.history.length > 0 ? clampHistory(rawPayload.history) : undefined;

    const send = (streamEvent: AiStreamEvent): void => {
      const target = deps.getMainWindow();
      if (!target || target.isDestroyed()) return;
      target.webContents.send(AXIS_IPC_CHANNELS.aiStreamEvent, streamEvent);
    };

    void (async () => {
      try {
        for await (const chunk of PROVIDER_ADAPTERS[provider].streamPrompt(keyLookup.key, rawPayload.prompt, { signal: controller.signal, history })) {
          if (chunk.type === "delta") {
            send({ requestId, type: "delta", text: chunk.text });
          } else if (chunk.type === "done") {
            send({ requestId, type: "done", truncated: chunk.truncated });
          } else if (chunk.code === "CANCELLED" && entry.timedOut) {
            // Same promotion rule as the non-streaming path: our own timer
            // (not the user) triggered the abort.
            send({ requestId, type: "error", code: "TIMEOUT", message: AI_ERROR_MESSAGES.TIMEOUT });
          } else if (chunk.code === "CANCELLED") {
            send({ requestId, type: "cancelled" });
          } else {
            send({ requestId, type: "error", code: chunk.code, message: chunk.message });
          }
        }
      } catch {
        send({ requestId, type: "error", code: "INTERNAL_ERROR", message: AI_ERROR_MESSAGES.INTERNAL_ERROR });
      } finally {
        clearTimeout(timer);
        activeRequestsBySender.delete(senderId);
      }
    })();

    return { ok: true, requestId };
  }

  function cancelRequestHandler(event: IpcMainInvokeEvent, rawPayload: unknown): AiCancelResult {
    if (!isTrustedSender(event)) return { ok: false };
    if (!isValidCancelPayload(rawPayload)) return { ok: false };
    const entry = activeRequestsBySender.get(event.sender.id);
    if (!entry || entry.requestId !== rawPayload.requestId) return { ok: false };
    entry.controller.abort();
    return { ok: true };
  }

  function registerIpc(ipcMain: IpcMain): void {
    ipcMain.handle(AXIS_IPC_CHANNELS.aiGetStatus, (event, payload) => getStatus(event, payload));
    ipcMain.handle(AXIS_IPC_CHANNELS.aiImportCredential, (event, payload) => importCredentialHandler(event, payload));
    ipcMain.handle(AXIS_IPC_CHANNELS.aiRemoveCredential, (event, payload) => removeCredentialHandler(event, payload));
    ipcMain.handle(AXIS_IPC_CHANNELS.aiTestConnection, (event, payload) => testConnectionHandler(event, payload));
    ipcMain.handle(AXIS_IPC_CHANNELS.aiSendRequest, (event, payload) => sendRequestHandler(event, payload));
    ipcMain.handle(AXIS_IPC_CHANNELS.aiCancelRequest, (event, payload) => cancelRequestHandler(event, payload));
    ipcMain.handle(AXIS_IPC_CHANNELS.aiSendStreamingRequest, (event, payload) => sendStreamingRequestHandler(event, payload));
  }

  return {
    registerIpc,
    getStatus,
    importCredentialHandler,
    removeCredentialHandler,
    testConnectionHandler,
    sendRequestHandler,
    sendStreamingRequestHandler,
    cancelRequestHandler,
    /** Test-only inspection hook. */
    __activeRequestCount: () => activeRequestsBySender.size
  };
}

export type AiController = ReturnType<typeof createAiController>;
