/**
 * Shared conversation-history contract between the Electron main process
 * and the renderer (Phase 5).
 *
 * Design goals, mirroring `ai-contract.ts`:
 *  - Every shape that crosses the IPC boundary is validated authoritatively
 *    in the main process before it is trusted — a renderer-side check is
 *    only ever a pre-flight courtesy.
 *  - Conversation records on disk are plain JSON, parsed with `JSON.parse`
 *    only (never `eval`/`Function`/a template engine), so a corrupt or even
 *    maliciously-crafted file can only ever become inert data, never
 *    executable code. Every field is still shape/type/bound checked before
 *    use — a file that merely *parses* is not automatically trusted.
 *  - Nothing in this module ever represents credential material. A
 *    `ConversationRecord` structurally has no field that could hold an API
 *    key, and conversation storage lives in a completely separate on-disk
 *    location from Phase 3's credential store.
 *  - The on-disk shape is wrapped in a versioned envelope
 *    (`ConversationFileV1`) from day one specifically so a future schema
 *    change has a safe, designated migration boundary (see
 *    `CONVERSATION_SCHEMA_VERSION` and the loader in
 *    `conversationRepository.ts`) instead of needing to retrofit one later.
 */

/** Bumped whenever the on-disk shape changes in a way old readers can't understand. */
export const CONVERSATION_SCHEMA_VERSION = 1 as const;

export type ConversationMessageRole = "user" | "assistant";

/**
 * Honest, finite status for a persisted message:
 *  - "complete": the exchange finished normally.
 *  - "cancelled": the user explicitly stopped generation.
 *  - "error": the request failed (network, provider, validation, etc).
 *  - "incomplete": the turn was still generating when it was last written
 *    to disk (e.g. the app was closed mid-stream). It is never silently
 *    upgraded to "complete" — reopening such a conversation shows it
 *    honestly as unfinished, with no live stream attached to it anymore.
 */
export type ConversationMessageStatus = "complete" | "cancelled" | "error" | "incomplete";

export interface ConversationMessage {
  id: string;
  role: ConversationMessageRole;
  text: string;
  status: ConversationMessageStatus;
  truncated: boolean;
  errorMessage?: string;
  createdAt: number;
}

export interface ConversationRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ConversationMessage[];
}

/** Lightweight shape returned by list/search — avoids shipping full message text for every row. */
export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  /** Short, plain-text snippet of the most recent message, for display only. */
  preview: string;
}

/** The actual on-disk JSON shape: a versioned envelope around one conversation. */
export interface ConversationFileV1 {
  schemaVersion: 1;
  conversation: ConversationRecord;
}

/** Discriminator for the Phase 11 bulk-export envelope — distinct from `ConversationFileV1` so the two can never be confused. */
export const CONVERSATION_BULK_KIND = "axis-conversations-bulk" as const;

/**
 * The on-disk JSON shape for a Phase 11 "Export all" file: every saved
 * conversation in one envelope, newest-updated first (same ordering the
 * History list already uses). This is purely additive — it does not change
 * `ConversationFileV1` or anything that reads it, and it is export-only:
 * nothing in this app currently reads a `ConversationBulkFileV1` back in
 * (see `exportAllToFile` in `conversationRepository.ts`). Feeding a bulk
 * file into the single-conversation Import flow will honestly fail
 * validation rather than partially importing it.
 */
export interface ConversationBulkFileV1 {
  schemaVersion: 1;
  kind: typeof CONVERSATION_BULK_KIND;
  exportedAt: number;
  conversations: ConversationRecord[];
}

/**
 * Hard ceiling (Phase 19) on how many conversations a single bulk-import
 * file ("Export all") may contain. `exportAllToFile` itself never produces
 * a file exceeding this in any realistic desktop-usage scenario, so this
 * is purely a defensive backstop: without it, a hand-edited or corrupted
 * bulk file could otherwise claim an effectively unbounded number of
 * conversations, each individually valid, causing `importAllFromFile`/
 * `importAnyFromText` to attempt an unbounded number of sequential disk
 * writes with no progress reporting or cancellation. Generous on purpose —
 * well above what any real "Export all" of a single user's own history
 * would ever produce.
 */
export const MAX_BULK_IMPORT_CONVERSATIONS = 2000;

/** Validates the exact on-disk shape of a Phase 11 bulk-export file. Used by this module's own tests to assert what `exportAllToFile` writes is honestly self-describing and internally consistent. */
export function isValidConversationBulkFile(value: unknown): value is ConversationBulkFileV1 {
  if (!isRecordObject(value)) return false;
  if (value["schemaVersion"] !== CONVERSATION_SCHEMA_VERSION) return false;
  if (value["kind"] !== CONVERSATION_BULK_KIND) return false;
  if (typeof value["exportedAt"] !== "number" || !Number.isFinite(value["exportedAt"])) return false;
  if (!Array.isArray(value["conversations"])) return false;
  if (value["conversations"].length > MAX_BULK_IMPORT_CONVERSATIONS) return false;
  return value["conversations"].every((c) => isValidConversationRecord(c));
}

export const MAX_TITLE_CHARS = 80;
export const MAX_MESSAGE_TEXT_CHARS = 60_000;
export const MAX_MESSAGES_PER_CONVERSATION = 2000;
export const MAX_PREVIEW_CHARS = 140;
const MAX_ID_CHARS = 100;
/**
 * Hard rejection ceiling for a title *before* normalization — generous on
 * purpose. `isValidConversationRecord`/`isValidRenamePayload` only reject
 * something this clearly abusive outright; anything within this ceiling is
 * accepted and then clamped down to the tighter `MAX_TITLE_CHARS` display
 * bound by `normalizeConversationRecord`/the repository, rather than being
 * rejected for being merely "a bit long".
 */
const MAX_RAW_TITLE_CHARS = 500;
const MAX_SEARCH_QUERY_CHARS = 200;

/** Conservative, URL/path-safe id charset. Also used directly to build on-disk file names. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

export function isValidConversationId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_CHARS && ID_PATTERN.test(value);
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isValidConversationMessage(value: unknown): value is ConversationMessage {
  if (!isRecordObject(value)) return false;
  if (!isValidConversationId(value["id"])) return false;
  if (value["role"] !== "user" && value["role"] !== "assistant") return false;
  if (typeof value["text"] !== "string" || value["text"].length > MAX_MESSAGE_TEXT_CHARS) return false;
  const status = value["status"];
  if (status !== "complete" && status !== "cancelled" && status !== "error" && status !== "incomplete") return false;
  if (typeof value["truncated"] !== "boolean") return false;
  if (value["errorMessage"] !== undefined && typeof value["errorMessage"] !== "string") return false;
  if (typeof value["createdAt"] !== "number" || !Number.isFinite(value["createdAt"])) return false;
  return true;
}

export function isValidConversationRecord(value: unknown): value is ConversationRecord {
  if (!isRecordObject(value)) return false;
  if (!isValidConversationId(value["id"])) return false;
  if (typeof value["title"] !== "string" || value["title"].length === 0 || value["title"].length > MAX_RAW_TITLE_CHARS) return false;
  if (typeof value["createdAt"] !== "number" || !Number.isFinite(value["createdAt"])) return false;
  if (typeof value["updatedAt"] !== "number" || !Number.isFinite(value["updatedAt"])) return false;
  if (!Array.isArray(value["messages"]) || value["messages"].length > MAX_MESSAGES_PER_CONVERSATION) return false;
  return value["messages"].every((m) => isValidConversationMessage(m));
}

/**
 * Validates the exact on-disk envelope shape for the *current* schema
 * version. A file with a missing/unknown `schemaVersion` is never guessed
 * at — it is reported as unreadable so the repository can skip it without
 * crashing, rather than silently mis-interpreting foreign or future data.
 */
export function isValidConversationFile(value: unknown): value is ConversationFileV1 {
  if (!isRecordObject(value)) return false;
  if (value["schemaVersion"] !== CONVERSATION_SCHEMA_VERSION) return false;
  return isValidConversationRecord(value["conversation"]);
}

/**
 * Deterministically clamps a candidate record to every bound this module
 * enforces, the same way `clampHistory` in `ai-contract.ts` prefers
 * trimming over outright rejection for size-shaped problems. Reserved for
 * genuinely out-of-range *values* (an overlong title, a giant pasted
 * response) — it never repairs a structurally wrong type, which is left to
 * `isValidConversationRecord` to reject outright.
 */
export function normalizeConversationRecord(record: ConversationRecord): ConversationRecord {
  const messages = record.messages.slice(-MAX_MESSAGES_PER_CONVERSATION).map((m) => ({
    ...m,
    text: m.text.slice(0, MAX_MESSAGE_TEXT_CHARS),
    errorMessage: m.errorMessage !== undefined ? m.errorMessage.slice(0, 2000) : undefined
  }));
  return {
    ...record,
    title: normalizeTitle(record.title),
    messages
  };
}

function normalizeTitle(raw: string): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return "Untitled conversation";
  if (collapsed.length <= MAX_TITLE_CHARS) return collapsed;
  return `${collapsed.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…`;
}

/**
 * Generates a sensible, safely-truncated title from the first user prompt
 * of a new conversation. Truncates at a word boundary where reasonable
 * rather than mid-word, and never returns an empty string.
 */
export function generateConversationTitle(firstPrompt: string): string {
  const collapsed = firstPrompt.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return "New conversation";
  if (collapsed.length <= MAX_TITLE_CHARS) return collapsed;
  const slice = collapsed.slice(0, MAX_TITLE_CHARS - 1);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > MAX_TITLE_CHARS * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

/** Short, plain-text (never HTML) snippet used for the History list preview. */
export function truncateForPreview(text: string, max: number = MAX_PREVIEW_CHARS): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max).trimEnd()}…`;
}

export function summarizeConversation(record: ConversationRecord): ConversationSummary {
  const last = record.messages[record.messages.length - 1];
  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    messageCount: record.messages.length,
    preview: last ? truncateForPreview(last.text.length > 0 ? last.text : "(no response text)") : ""
  };
}

/** Normalized, finite set of error codes for conversation-storage operations. */
export type ConversationErrorCode =
  | "VALIDATION_ERROR"
  | "STORAGE_ERROR"
  | "NOT_FOUND"
  | "BRIDGE_UNAVAILABLE"
  | "INTERNAL_ERROR"
  | "CANCELLED";

export const CONVERSATION_ERROR_MESSAGES: Record<ConversationErrorCode, string> = {
  VALIDATION_ERROR: "That conversation data was not valid, so nothing was changed.",
  STORAGE_ERROR: "AXIS could not read or write conversation history on this device.",
  NOT_FOUND: "That conversation could not be found — it may have already been deleted.",
  BRIDGE_UNAVAILABLE: "This preview window cannot reach local conversation storage. Run the AXIS desktop app to use History.",
  INTERNAL_ERROR: "Something went wrong inside AXIS while handling conversation history.",
  CANCELLED: "Cancelled — no changes were made."
};

export interface ConversationOpResult {
  ok: boolean;
  code?: ConversationErrorCode;
  message?: string;
}

export interface ConversationListResult extends ConversationOpResult {
  summaries: ConversationSummary[];
}

export interface ConversationGetResult extends ConversationOpResult {
  conversation?: ConversationRecord;
}

export interface ConversationIdPayload {
  id: string;
}

export function isValidConversationIdPayload(value: unknown): value is ConversationIdPayload {
  if (!isRecordObject(value)) return false;
  return isValidConversationId(value["id"]);
}

export interface ConversationSearchPayload {
  query: string;
}

export function isValidSearchPayload(value: unknown): value is ConversationSearchPayload {
  if (!isRecordObject(value)) return false;
  return typeof value["query"] === "string" && value["query"].length <= MAX_SEARCH_QUERY_CHARS;
}

export interface ConversationRenamePayload {
  id: string;
  title: string;
}

export function isValidRenamePayload(value: unknown): value is ConversationRenamePayload {
  if (!isRecordObject(value)) return false;
  if (!isValidConversationId(value["id"])) return false;
  if (typeof value["title"] !== "string") return false;
  if (value["title"].trim().length === 0) return false;
  if (value["title"].length > MAX_RAW_TITLE_CHARS) return false;
  return true;
}

/**
 * Authoritative payload guard for saving a whole conversation. Deliberately
 * stricter than `isValidConversationRecord` only in that it is the single
 * named entry point the IPC save handler calls — kept as a thin alias so
 * the controller reads clearly about which boundary it is enforcing.
 */
export function isValidSaveConversationPayload(value: unknown): value is ConversationRecord {
  return isValidConversationRecord(value);
}

/**
 * Hard ceiling (Phase 13) on the raw JSON text a drag-and-drop import may
 * send over IPC, well above the largest file the schema itself could ever
 * produce (`MAX_MESSAGES_PER_CONVERSATION` × `MAX_MESSAGE_TEXT_CHARS` ≈
 * 120,000,000 characters for a single maximal conversation, plus JSON
 * structural overhead) so a legitimately schema-valid export — however
 * large — behaves the same whether it is opened via the native Import
 * dialog or dropped onto History. This bound exists purely as a backstop
 * against a renderer (accidentally or otherwise) handing the main process
 * an unbounded string, not as a tighter restriction than every other
 * import path already has.
 */
export const MAX_DROPPED_IMPORT_TEXT_CHARS = 150_000_000;

export interface ConversationImportTextPayload {
  text: string;
}

/**
 * Authoritative payload guard for the Phase 13 drag-and-drop import
 * channel, which — unlike every other conversations IPC payload — carries
 * raw, not-yet-parsed file content rather than an already-structured
 * value. Only the outer shape (a bounded, non-empty string) is checked
 * here; the content itself is still fully parsed and validated against
 * the exact same `loadConversationFile`/`isValidConversationBulkFile`
 * schema guards every other import path already uses, in
 * `conversationRepository.ts`'s `importAnyFromText`.
 */
export function isValidImportTextPayload(value: unknown): value is ConversationImportTextPayload {
  if (!isRecordObject(value)) return false;
  const text = value["text"];
  return typeof text === "string" && text.length > 0 && text.length <= MAX_DROPPED_IMPORT_TEXT_CHARS;
}

