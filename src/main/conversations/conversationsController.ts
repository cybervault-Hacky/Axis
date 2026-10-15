import { dialog } from "electron";
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, OpenDialogReturnValue, SaveDialogReturnValue } from "electron";
import { AXIS_IPC_CHANNELS } from "../../shared/ipc-contract";
import {
  CONVERSATION_ERROR_MESSAGES,
  isValidConversationIdPayload,
  isValidImportTextPayload,
  isValidRenamePayload,
  isValidSaveConversationPayload,
  isValidSearchPayload,
  type ConversationGetResult,
  type ConversationListResult,
  type ConversationOpResult
} from "../../shared/conversation-contract";
import { createTrustedSenderCheck } from "../ipc/trustedSender";
import type { ConversationRepository } from "./conversationRepository";

export interface ConversationsControllerDeps {
  getMainWindow: () => BrowserWindow | null;
  repository: ConversationRepository;
}

function internalFailure<T extends ConversationOpResult>(): T {
  return { ok: false, code: "INTERNAL_ERROR", message: CONVERSATION_ERROR_MESSAGES.INTERNAL_ERROR } as T;
}

/** Strips path separators and other filesystem-hostile characters from a title before using it as a suggested filename. */
function sanitizeFileNameStem(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]/g, "").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 80) : "conversation";
}

/**
 * Orchestrates the conversation-history IPC surface. All six channels are
 * invoke/handle (request/response) — there is no push channel here, unlike
 * the AI streaming controller, because conversation list/search/save
 * operations are always explicitly requested by the renderer. Every
 * handler re-verifies the sender via the same `isTrustedSender` check the
 * AI controller uses, and every payload is re-validated here regardless of
 * what the renderer already checked.
 */
export function createConversationsController(deps: ConversationsControllerDeps) {
  const isTrustedSender = createTrustedSenderCheck(deps.getMainWindow);

  async function listHandler(event: IpcMainInvokeEvent): Promise<ConversationListResult> {
    if (!isTrustedSender(event)) return { ...internalFailure<ConversationOpResult>(), summaries: [] };
    const result = await deps.repository.listSummaries();
    if (!result.ok) return { ok: false, code: result.code, message: result.message, summaries: [] };
    return { ok: true, summaries: result.summaries };
  }

  async function searchHandler(event: IpcMainInvokeEvent, rawPayload: unknown): Promise<ConversationListResult> {
    if (!isTrustedSender(event)) return { ...internalFailure<ConversationOpResult>(), summaries: [] };
    if (!isValidSearchPayload(rawPayload)) {
      return { ok: false, code: "VALIDATION_ERROR", message: CONVERSATION_ERROR_MESSAGES.VALIDATION_ERROR, summaries: [] };
    }
    const result = await deps.repository.searchSummaries(rawPayload.query);
    if (!result.ok) return { ok: false, code: result.code, message: result.message, summaries: [] };
    return { ok: true, summaries: result.summaries };
  }

  async function getHandler(event: IpcMainInvokeEvent, rawPayload: unknown): Promise<ConversationGetResult> {
    if (!isTrustedSender(event)) return internalFailure<ConversationGetResult>();
    if (!isValidConversationIdPayload(rawPayload)) {
      return { ok: false, code: "VALIDATION_ERROR", message: CONVERSATION_ERROR_MESSAGES.VALIDATION_ERROR };
    }
    const result = await deps.repository.getConversation(rawPayload.id);
    if (!result.ok) return { ok: false, code: result.code, message: result.message };
    return { ok: true, conversation: result.conversation };
  }

  async function saveHandler(event: IpcMainInvokeEvent, rawPayload: unknown): Promise<ConversationOpResult> {
    if (!isTrustedSender(event)) return internalFailure<ConversationOpResult>();
    if (!isValidSaveConversationPayload(rawPayload)) {
      return { ok: false, code: "VALIDATION_ERROR", message: CONVERSATION_ERROR_MESSAGES.VALIDATION_ERROR };
    }
    const result = await deps.repository.saveConversation(rawPayload);
    if (!result.ok) return { ok: false, code: result.code, message: result.message };
    return { ok: true };
  }

  async function renameHandler(event: IpcMainInvokeEvent, rawPayload: unknown): Promise<ConversationOpResult> {
    if (!isTrustedSender(event)) return internalFailure<ConversationOpResult>();
    if (!isValidRenamePayload(rawPayload)) {
      return { ok: false, code: "VALIDATION_ERROR", message: CONVERSATION_ERROR_MESSAGES.VALIDATION_ERROR };
    }
    const result = await deps.repository.renameConversation(rawPayload.id, rawPayload.title);
    if (!result.ok) return { ok: false, code: result.code, message: result.message };
    return { ok: true };
  }

  async function deleteHandler(event: IpcMainInvokeEvent, rawPayload: unknown): Promise<ConversationOpResult> {
    if (!isTrustedSender(event)) return internalFailure<ConversationOpResult>();
    if (!isValidConversationIdPayload(rawPayload)) {
      return { ok: false, code: "VALIDATION_ERROR", message: CONVERSATION_ERROR_MESSAGES.VALIDATION_ERROR };
    }
    const result = await deps.repository.deleteConversation(rawPayload.id);
    if (!result.ok) return { ok: false, code: result.code, message: result.message };
    return { ok: true };
  }

  async function clearAllHandler(event: IpcMainInvokeEvent): Promise<ConversationOpResult> {
    if (!isTrustedSender(event)) return internalFailure<ConversationOpResult>();
    const result = await deps.repository.clearAll();
    if (!result.ok) return { ok: false, code: result.code, message: result.message };
    return { ok: true };
  }

  /**
   * Phase 7: exports one saved conversation to a file the user chooses via
   * a native, main-process-owned save dialog. The conversation is fetched
   * *before* the dialog opens so a stale/already-deleted id fails fast
   * with an honest "not found" instead of bothering the user with a
   * dialog for nothing. A cancelled dialog is reported as `CANCELLED`, not
   * as an error — nothing went wrong, the user simply changed their mind.
   */
  async function exportHandler(event: IpcMainInvokeEvent, rawPayload: unknown): Promise<ConversationOpResult> {
    if (!isTrustedSender(event)) return internalFailure<ConversationOpResult>();
    if (!isValidConversationIdPayload(rawPayload)) {
      return { ok: false, code: "VALIDATION_ERROR", message: CONVERSATION_ERROR_MESSAGES.VALIDATION_ERROR };
    }

    const existing = await deps.repository.getConversation(rawPayload.id);
    if (!existing.ok) return { ok: false, code: existing.code, message: existing.message };

    const win = deps.getMainWindow();
    if (!win) return internalFailure<ConversationOpResult>();

    let selection: SaveDialogReturnValue;
    try {
      selection = await dialog.showSaveDialog(win, {
        title: "Export conversation",
        defaultPath: `${sanitizeFileNameStem(existing.conversation.title)}.json`,
        filters: [{ name: "AXIS conversation", extensions: ["json"] }]
      });
    } catch {
      return { ok: false, code: "STORAGE_ERROR", message: "Could not open the export dialog." };
    }
    if (selection.canceled || !selection.filePath) {
      return { ok: false, code: "CANCELLED" };
    }

    const result = await deps.repository.exportConversationToFile(rawPayload.id, selection.filePath);
    if (!result.ok) return { ok: false, code: result.code, message: result.message };
    return { ok: true };
  }

  /**
   * Phase 11: exports every saved conversation to a single file the user
   * chooses via a native save dialog ("Export all"). No payload — unlike
   * `exportHandler` there is no id to validate, the same shape as
   * `clearAllHandler`/`importHandler`. A cancelled dialog is `CANCELLED`,
   * not an error, exactly like the per-conversation export.
   */
  async function exportAllHandler(event: IpcMainInvokeEvent): Promise<ConversationOpResult> {
    if (!isTrustedSender(event)) return internalFailure<ConversationOpResult>();

    const win = deps.getMainWindow();
    if (!win) return internalFailure<ConversationOpResult>();

    let selection: SaveDialogReturnValue;
    try {
      selection = await dialog.showSaveDialog(win, {
        title: "Export all conversations",
        defaultPath: "axis-conversations-export.json",
        filters: [{ name: "AXIS conversations (all)", extensions: ["json"] }]
      });
    } catch {
      return { ok: false, code: "STORAGE_ERROR", message: "Could not open the export dialog." };
    }
    if (selection.canceled || !selection.filePath) {
      return { ok: false, code: "CANCELLED" };
    }

    const result = await deps.repository.exportAllToFile(selection.filePath);
    if (!result.ok) return { ok: false, code: result.code, message: result.message };
    return { ok: true };
  }

  /**
   * Phase 7: imports a conversation from a file the user chooses via a
   * native open dialog. The file is fully re-validated against the same
   * schema every on-disk conversation already goes through
   * (`repository.importConversationFromFile`) and is always saved under a
   * brand-new id, so an imported file — however it was produced — can
   * never silently overwrite an existing conversation or be trusted purely
   * because it parsed as JSON.
   */
  async function importHandler(event: IpcMainInvokeEvent): Promise<ConversationOpResult> {
    if (!isTrustedSender(event)) return internalFailure<ConversationOpResult>();

    const win = deps.getMainWindow();
    if (!win) return internalFailure<ConversationOpResult>();

    let selection: OpenDialogReturnValue;
    try {
      selection = await dialog.showOpenDialog(win, {
        title: "Import conversation",
        properties: ["openFile"],
        filters: [
          { name: "AXIS conversation", extensions: ["json"] },
          { name: "All files", extensions: ["*"] }
        ]
      });
    } catch {
      return { ok: false, code: "STORAGE_ERROR", message: "Could not open the import dialog." };
    }
    if (selection.canceled || selection.filePaths.length === 0) {
      return { ok: false, code: "CANCELLED" };
    }

    const result = await deps.repository.importConversationFromFile(selection.filePaths[0] as string);
    if (!result.ok) return { ok: false, code: result.code, message: result.message };
    return { ok: true };
  }

  /**
   * Phase 12: imports every conversation from a Phase 11 bulk-export
   * ("Export all") file the user chooses via a native open dialog. No
   * payload — same no-argument shape as `importHandler`/`clearAllHandler`.
   * The file is fully re-validated by `repository.importAllFromFile`
   * against the distinct bulk-envelope schema (never the single-
   * conversation one), and every conversation inside it is always saved
   * under a brand-new id, so this can never silently overwrite an existing
   * conversation. The exact imported count is intentionally not forwarded
   * to the renderer — same as `saveHandler` discarding the saved
   * conversation it gets back — the refreshed History list is the source
   * of truth for what is now saved.
   */
  async function importAllHandler(event: IpcMainInvokeEvent): Promise<ConversationOpResult> {
    if (!isTrustedSender(event)) return internalFailure<ConversationOpResult>();

    const win = deps.getMainWindow();
    if (!win) return internalFailure<ConversationOpResult>();

    let selection: OpenDialogReturnValue;
    try {
      selection = await dialog.showOpenDialog(win, {
        title: "Import all conversations",
        properties: ["openFile"],
        filters: [
          { name: "AXIS conversations (all)", extensions: ["json"] },
          { name: "All files", extensions: ["*"] }
        ]
      });
    } catch {
      return { ok: false, code: "STORAGE_ERROR", message: "Could not open the import dialog." };
    }
    if (selection.canceled || selection.filePaths.length === 0) {
      return { ok: false, code: "CANCELLED" };
    }

    const result = await deps.repository.importAllFromFile(selection.filePaths[0] as string);
    if (!result.ok) return { ok: false, code: result.code, message: result.message };
    return { ok: true };
  }

  /**
   * Phase 13: imports from raw file text the renderer already read itself
   * (drag-and-drop), rather than from a path this handler resolves via a
   * dialog — the one conversations handler that does not open any native
   * dialog at all. The trusted-sender check and full schema re-validation
   * (`repository.importAnyFromText`, which never trusts the text just
   * because it parsed) are unchanged from every other import path; only
   * *how* the untrusted bytes first reached the main process differs.
   */
  async function importFromTextHandler(event: IpcMainInvokeEvent, rawPayload: unknown): Promise<ConversationOpResult> {
    if (!isTrustedSender(event)) return internalFailure<ConversationOpResult>();
    if (!isValidImportTextPayload(rawPayload)) {
      return { ok: false, code: "VALIDATION_ERROR", message: CONVERSATION_ERROR_MESSAGES.VALIDATION_ERROR };
    }

    const result = await deps.repository.importAnyFromText(rawPayload.text);
    if (!result.ok) return { ok: false, code: result.code, message: result.message };
    return { ok: true };
  }

  function registerIpc(ipcMain: IpcMain): void {
    ipcMain.handle(AXIS_IPC_CHANNELS.conversationsList, (event) => listHandler(event));
    ipcMain.handle(AXIS_IPC_CHANNELS.conversationsSearch, (event, payload) => searchHandler(event, payload));
    ipcMain.handle(AXIS_IPC_CHANNELS.conversationsGet, (event, payload) => getHandler(event, payload));
    ipcMain.handle(AXIS_IPC_CHANNELS.conversationsSave, (event, payload) => saveHandler(event, payload));
    ipcMain.handle(AXIS_IPC_CHANNELS.conversationsRename, (event, payload) => renameHandler(event, payload));
    ipcMain.handle(AXIS_IPC_CHANNELS.conversationsDelete, (event, payload) => deleteHandler(event, payload));
    ipcMain.handle(AXIS_IPC_CHANNELS.conversationsClearAll, (event) => clearAllHandler(event));
    ipcMain.handle(AXIS_IPC_CHANNELS.conversationsExport, (event, payload) => exportHandler(event, payload));
    ipcMain.handle(AXIS_IPC_CHANNELS.conversationsExportAll, (event) => exportAllHandler(event));
    ipcMain.handle(AXIS_IPC_CHANNELS.conversationsImport, (event) => importHandler(event));
    ipcMain.handle(AXIS_IPC_CHANNELS.conversationsImportAll, (event) => importAllHandler(event));
    ipcMain.handle(AXIS_IPC_CHANNELS.conversationsImportFromText, (event, payload) => importFromTextHandler(event, payload));
  }

  return {
    registerIpc,
    listHandler,
    searchHandler,
    getHandler,
    saveHandler,
    renameHandler,
    deleteHandler,
    clearAllHandler,
    exportHandler,
    exportAllHandler,
    importHandler,
    importAllHandler,
    importFromTextHandler
  };
}

export type ConversationsController = ReturnType<typeof createConversationsController>;
