import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { AXIS_IPC_CHANNELS, type AxisAppInfo } from "../shared/ipc-contract";
import {
  isValidStreamEvent,
  type AiCancelResult,
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
} from "../shared/ai-contract";
import type {
  ConversationGetResult,
  ConversationListResult,
  ConversationOpResult,
  ConversationRecord
} from "../shared/conversation-contract";

/**
 * AXIS preload bridge.
 *
 * This is the ONLY surface the renderer can use to talk to the main
 * process. It stays intentionally narrow: read-only app metadata, AI
 * provider status, and a handful of validated AI-engine actions. No
 * filesystem, process, shell, or Node module access is exposed, and the
 * raw Gemini API key never crosses this bridge in either direction — only
 * status enums and response text do. Context isolation + sandbox remain
 * enabled in main.ts, so this file runs in an isolated world and
 * `window.axis` is the sole bridge.
 */

const axisBridge = {
  getAppInfo: (): Promise<AxisAppInfo> => ipcRenderer.invoke(AXIS_IPC_CHANNELS.getAppInfo),
  ai: {
    /** `provider` (Phase 9) selects which provider's credential status to report; defaults to "gemini" in the main process when omitted. */
    getStatus: (provider?: AiProviderId): Promise<AiProviderStatus> =>
      ipcRenderer.invoke(AXIS_IPC_CHANNELS.aiGetStatus, provider ? { provider } : undefined),
    importCredential: (payload?: AiImportCredentialPayload): Promise<AiImportCredentialResult> =>
      ipcRenderer.invoke(AXIS_IPC_CHANNELS.aiImportCredential, payload),
    removeCredential: (provider?: AiProviderId): Promise<AiRemoveCredentialResult> =>
      ipcRenderer.invoke(AXIS_IPC_CHANNELS.aiRemoveCredential, provider ? { provider } : undefined),
    testConnection: (provider?: AiProviderId): Promise<AiTestConnectionResult> =>
      ipcRenderer.invoke(AXIS_IPC_CHANNELS.aiTestConnection, provider ? { provider } : undefined),
    sendRequest: (payload: AiSendRequestPayload): Promise<AiSendResult> =>
      ipcRenderer.invoke(AXIS_IPC_CHANNELS.aiSendRequest, payload),
    cancelRequest: (requestId: string): Promise<AiCancelResult> =>
      ipcRenderer.invoke(AXIS_IPC_CHANNELS.aiCancelRequest, { requestId }),
    sendStreamingRequest: (payload: AiSendRequestPayload): Promise<AiStreamStartResult> =>
      ipcRenderer.invoke(AXIS_IPC_CHANNELS.aiSendStreamingRequest, payload),
    /**
     * Subscribes to streamed generation events. This is the one place the
     * renderer receives a main -> renderer push rather than a request it
     * made itself; the payload is re-validated here (shape only — it never
     * contains credential material) before the caller's callback ever sees
     * it, and malformed events are silently dropped rather than forwarded.
     * Returns an unsubscribe function; the renderer never gets direct
     * access to `ipcRenderer` itself.
     */
    onStreamEvent: (callback: (event: AiStreamEvent) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, data: unknown): void => {
        if (isValidStreamEvent(data)) callback(data);
      };
      ipcRenderer.on(AXIS_IPC_CHANNELS.aiStreamEvent, listener);
      return () => ipcRenderer.removeListener(AXIS_IPC_CHANNELS.aiStreamEvent, listener);
    }
  },
  /**
   * Phase 5: narrow local conversation-history surface. No filesystem
   * access of any kind is exposed directly — every call here is a single
   * validated round trip to the main process, which owns all disk I/O.
   */
  conversations: {
    list: (): Promise<ConversationListResult> => ipcRenderer.invoke(AXIS_IPC_CHANNELS.conversationsList),
    search: (query: string): Promise<ConversationListResult> =>
      ipcRenderer.invoke(AXIS_IPC_CHANNELS.conversationsSearch, { query }),
    get: (id: string): Promise<ConversationGetResult> => ipcRenderer.invoke(AXIS_IPC_CHANNELS.conversationsGet, { id }),
    save: (conversation: ConversationRecord): Promise<ConversationOpResult> =>
      ipcRenderer.invoke(AXIS_IPC_CHANNELS.conversationsSave, conversation),
    rename: (id: string, title: string): Promise<ConversationOpResult> =>
      ipcRenderer.invoke(AXIS_IPC_CHANNELS.conversationsRename, { id, title }),
    delete: (id: string): Promise<ConversationOpResult> => ipcRenderer.invoke(AXIS_IPC_CHANNELS.conversationsDelete, { id }),
    clearAll: (): Promise<ConversationOpResult> => ipcRenderer.invoke(AXIS_IPC_CHANNELS.conversationsClearAll),
    /**
     * Phase 7: both of these only ever hand the main process an id (export)
     * or nothing at all (import) — the native save/open dialog, the chosen
     * file path, and all file contents stay entirely in the main process.
     */
    exportConversation: (id: string): Promise<ConversationOpResult> =>
      ipcRenderer.invoke(AXIS_IPC_CHANNELS.conversationsExport, { id }),
    /**
     * Phase 11: exports every saved conversation to one file the user
     * picks via a native save dialog. No arguments — the main process
     * reads every conversation itself, so there is nothing for the
     * renderer to hand over.
     */
    exportAllConversations: (): Promise<ConversationOpResult> =>
      ipcRenderer.invoke(AXIS_IPC_CHANNELS.conversationsExportAll),
    importConversation: (): Promise<ConversationOpResult> => ipcRenderer.invoke(AXIS_IPC_CHANNELS.conversationsImport),
    /**
     * Phase 12: imports every conversation from a Phase 11 bulk-export
     * file the user picks via a native open dialog. No arguments — same
     * shape as `importConversation`.
     */
    importAllConversations: (): Promise<ConversationOpResult> =>
      ipcRenderer.invoke(AXIS_IPC_CHANNELS.conversationsImportAll),
    /**
     * Phase 13: imports from raw conversation-export JSON text the
     * renderer already read itself from a dropped file (drag-and-drop).
     * Unlike every other import/export call, this does not reference a
     * file path at all — the renderer never hands the main process a path
     * it did not itself choose via a native dialog.
     */
    importConversationsFromText: (text: string): Promise<ConversationOpResult> =>
      ipcRenderer.invoke(AXIS_IPC_CHANNELS.conversationsImportFromText, { text })
  }
} as const;

export type AxisBridge = typeof axisBridge;

contextBridge.exposeInMainWorld("axis", axisBridge);
