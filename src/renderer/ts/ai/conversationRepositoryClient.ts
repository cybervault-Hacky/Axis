import {
  CONVERSATION_ERROR_MESSAGES,
  type ConversationGetResult,
  type ConversationListResult,
  type ConversationOpResult,
  type ConversationRecord
} from "../../../shared/conversation-contract";

/**
 * Thin renderer-side wrapper around `window.axis.conversations`, mirroring
 * `aiClient.ts`'s pattern exactly: every call degrades honestly to
 * `BRIDGE_UNAVAILABLE` when there is no native preload bridge (the plain
 * browser dev-server preview) instead of ever faking local persistence
 * with, say, `localStorage` — History is genuinely unavailable in that
 * preview, and this module never pretends otherwise.
 *
 * Deliberately does not import `hasNativeBridge` from `aiClient.ts` even
 * though the check is identical — keeping it local avoids this module's
 * tests (and any module that mocks `aiClient.ts` wholesale) having to know
 * about an AI-specific export just to exercise conversation persistence.
 */
function hasNativeBridge(): boolean {
  return typeof window !== "undefined" && typeof window.axis !== "undefined";
}

const BRIDGE_UNAVAILABLE_LIST: ConversationListResult = {
  ok: false,
  code: "BRIDGE_UNAVAILABLE",
  message: CONVERSATION_ERROR_MESSAGES.BRIDGE_UNAVAILABLE,
  summaries: []
};

function bridgeUnavailable(): ConversationOpResult {
  return { ok: false, code: "BRIDGE_UNAVAILABLE", message: CONVERSATION_ERROR_MESSAGES.BRIDGE_UNAVAILABLE };
}

function internalError(): ConversationOpResult {
  return { ok: false, code: "INTERNAL_ERROR", message: CONVERSATION_ERROR_MESSAGES.INTERNAL_ERROR };
}

function hasConversationsBridge(): boolean {
  return hasNativeBridge() && typeof window.axis!.conversations !== "undefined";
}

export async function listConversations(): Promise<ConversationListResult> {
  if (!hasConversationsBridge()) return BRIDGE_UNAVAILABLE_LIST;
  try {
    return await window.axis!.conversations.list();
  } catch {
    return { ...internalError(), summaries: [] };
  }
}

export async function searchConversations(query: string): Promise<ConversationListResult> {
  if (!hasConversationsBridge()) return BRIDGE_UNAVAILABLE_LIST;
  try {
    return await window.axis!.conversations.search(query);
  } catch {
    return { ...internalError(), summaries: [] };
  }
}

export async function getConversation(id: string): Promise<ConversationGetResult> {
  if (!hasConversationsBridge()) return bridgeUnavailable();
  try {
    return await window.axis!.conversations.get(id);
  } catch {
    return internalError();
  }
}

export async function saveConversation(conversation: ConversationRecord): Promise<ConversationOpResult> {
  if (!hasConversationsBridge()) return bridgeUnavailable();
  try {
    return await window.axis!.conversations.save(conversation);
  } catch {
    return internalError();
  }
}

export async function renameConversation(id: string, title: string): Promise<ConversationOpResult> {
  if (!hasConversationsBridge()) return bridgeUnavailable();
  try {
    return await window.axis!.conversations.rename(id, title);
  } catch {
    return internalError();
  }
}

export async function deleteConversation(id: string): Promise<ConversationOpResult> {
  if (!hasConversationsBridge()) return bridgeUnavailable();
  try {
    return await window.axis!.conversations.delete(id);
  } catch {
    return internalError();
  }
}

export async function clearAllConversations(): Promise<ConversationOpResult> {
  if (!hasConversationsBridge()) return bridgeUnavailable();
  try {
    return await window.axis!.conversations.clearAll();
  } catch {
    return internalError();
  }
}

/** Phase 7: opens a native save dialog (main process) and writes the chosen conversation to the chosen file. */
export async function exportConversation(id: string): Promise<ConversationOpResult> {
  if (!hasConversationsBridge()) return bridgeUnavailable();
  try {
    return await window.axis!.conversations.exportConversation(id);
  } catch {
    return internalError();
  }
}

/** Phase 11: opens a native save dialog (main process) and writes every saved conversation into one chosen file. */
export async function exportAllConversations(): Promise<ConversationOpResult> {
  if (!hasConversationsBridge()) return bridgeUnavailable();
  try {
    return await window.axis!.conversations.exportAllConversations();
  } catch {
    return internalError();
  }
}

/** Phase 7: opens a native open dialog (main process), validates the chosen file, and saves it as a new conversation. */
export async function importConversation(): Promise<ConversationOpResult> {
  if (!hasConversationsBridge()) return bridgeUnavailable();
  try {
    return await window.axis!.conversations.importConversation();
  } catch {
    return internalError();
  }
}

/** Phase 12: opens a native open dialog (main process), validates the chosen Phase 11 bulk-export file, and saves every conversation inside it as a new conversation. */
export async function importAllConversations(): Promise<ConversationOpResult> {
  if (!hasConversationsBridge()) return bridgeUnavailable();
  try {
    return await window.axis!.conversations.importAllConversations();
  } catch {
    return internalError();
  }
}

/**
 * Phase 13: hands already-read file text (from a drag-and-drop drop, read
 * via the browser's `File.text()`) to the main process, which auto-
 * detects whether it is a single-conversation or bulk export and saves it
 * accordingly. No file path is ever involved on this path.
 */
export async function importConversationsFromText(text: string): Promise<ConversationOpResult> {
  if (!hasConversationsBridge()) return bridgeUnavailable();
  try {
    return await window.axis!.conversations.importConversationsFromText(text);
  } catch {
    return internalError();
  }
}
