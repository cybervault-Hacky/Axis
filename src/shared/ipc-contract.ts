/**
 * Shared IPC contract between the Electron main process and the renderer.
 *
 * Phase 1 exposed a single read-only channel. Phase 3 adds a narrow set of
 * AI-engine and credential-management channels — still no filesystem,
 * process, or shell access is exposed to the renderer. Every channel here
 * is validated authoritatively in the main process (see src/main/ai) and
 * every handler verifies the request came from this app's own main frame
 * before doing anything. Any future IPC channel must be added here first
 * so both sides stay in sync and the preload bridge stays auditable.
 */

export const AXIS_IPC_CHANNELS = {
  getAppInfo: "axis:get-app-info",
  aiGetStatus: "axis:ai:get-status",
  aiImportCredential: "axis:ai:import-credential",
  aiRemoveCredential: "axis:ai:remove-credential",
  aiTestConnection: "axis:ai:test-connection",
  aiSendRequest: "axis:ai:send-request",
  aiCancelRequest: "axis:ai:cancel-request",
  /** Phase 4: starts a streaming generation; renderer -> main, request/response (ack only). */
  aiSendStreamingRequest: "axis:ai:send-streaming-request",
  /**
   * Phase 4: the one push-style channel in AXIS. Main -> renderer only, one
   * direction, no renderer code can send on it. Every event carries the
   * originating requestId so the renderer can ignore anything stale. Never
   * carries credential material.
   */
  aiStreamEvent: "axis:ai:stream-event",
  /**
   * Phase 5: local conversation-history persistence. All seven channels
   * are invoke/handle (request/response) — no new push channel is needed,
   * since every one of these is always explicitly requested by the
   * renderer. Filesystem access for these stays entirely in the main
   * process; the renderer only ever sees validated JSON-shaped results.
   */
  conversationsList: "axis:conversations:list",
  conversationsSearch: "axis:conversations:search",
  conversationsGet: "axis:conversations:get",
  conversationsSave: "axis:conversations:save",
  conversationsRename: "axis:conversations:rename",
  conversationsDelete: "axis:conversations:delete",
  conversationsClearAll: "axis:conversations:clear-all",
  /**
   * Phase 7: export a single saved conversation to a file the user picks
   * via a native save dialog, and import a conversation from a file the
   * user picks via a native open dialog. Both still only ever touch disk
   * from the main process — the renderer never receives a raw file path
   * or file contents, only a pass/fail/cancelled result.
   */
  conversationsExport: "axis:conversations:export",
  conversationsImport: "axis:conversations:import",
  /**
   * Phase 11: export every saved conversation at once ("Export all") to a
   * single file the user picks via a native save dialog. Same no-payload,
   * pass/fail/cancelled shape as `conversationsClearAll` — the renderer
   * never sees a file path or any conversation content directly.
   */
  conversationsExportAll: "axis:conversations:export-all",
  /**
   * Phase 12: import every conversation from a Phase 11 bulk-export file
   * the user picks via a native open dialog ("Import all"). Same
   * no-payload, pass/fail/cancelled shape as `conversationsImport` — the
   * renderer never sees a file path or any conversation content directly.
   */
  conversationsImportAll: "axis:conversations:import-all",
  /**
   * Phase 13: imports from raw conversation-export JSON text the renderer
   * already obtained via a real drag-and-drop file drop (read through the
   * standard, non-spoofable Web `File.text()` API, never from a path the
   * renderer supplies — see `src/renderer/ts/views/history.ts`). This is
   * the one conversations channel whose payload is untrusted *content*
   * rather than a value the main process resolves itself via a native
   * dialog; it is still fully re-validated and parsed in the main process
   * before anything is trusted or saved, the same as every other import.
   */
  conversationsImportFromText: "axis:conversations:import-from-text"
} as const;

export type AxisPlatform = "win32" | "darwin" | "linux" | string;

export interface AxisAppInfo {
  name: string;
  version: string;
  platform: AxisPlatform;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
}
