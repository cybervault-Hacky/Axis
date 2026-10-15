/**
 * Shared AI-engine contract between the Electron main process and the
 * renderer (Phase 3).
 *
 * Design goals:
 *  - The renderer never sees a raw API key. Only status flags cross the
 *    IPC boundary (configured / backend / secure), never key material.
 *  - Every request/response shape here is provider-agnostic at the IPC
 *    layer: today only Gemini is implemented, but the types do not leak
 *    Gemini-specific fields to the renderer.
 *  - All error states are normalized into a small, finite set of codes so
 *    the UI can show safe, consistent copy without ever echoing a raw
 *    provider error body or credential contents.
 */

/**
 * Supported provider ids. Gemini shipped in Phase 3; OpenAI was added in
 * Phase 9, Anthropic Claude in Phase 10, and Mistral AI in Phase 14 — all
 * three later providers behind the exact same provider-agnostic contract
 * below — adding any of them never required a change to the IPC shape or
 * the renderer's request lifecycle, only a new main-process provider
 * adapter (see src/main/ai/openaiProvider.ts,
 * src/main/ai/anthropicProvider.ts, src/main/ai/mistralProvider.ts) and a
 * new credential storage bucket.
 */
export type AiProviderId = "gemini" | "openai" | "anthropic" | "mistral";

/** Every supported provider id, for UI enumeration and validation. */
export const AI_PROVIDER_IDS: readonly AiProviderId[] = ["gemini", "openai", "anthropic", "mistral"];

/** Short, user-facing display name for each provider. No marketing copy. */
export const AI_PROVIDER_LABELS: Record<AiProviderId, string> = {
  gemini: "Gemini",
  openai: "OpenAI",
  anthropic: "Claude",
  mistral: "Mistral"
};

export function isValidProviderId(value: unknown): value is AiProviderId {
  return value === "gemini" || value === "openai" || value === "anthropic" || value === "mistral";
}

/** Shape shared by every provider-scoped request that otherwise carries no other payload. */
export interface AiProviderScopedPayload {
  provider?: AiProviderId;
}

export function isValidProviderScopedPayload(value: unknown): value is AiProviderScopedPayload {
  if (value === undefined) return true;
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate["provider"] !== undefined && !isValidProviderId(candidate["provider"])) return false;
  return true;
}

/** Resolves an optional, possibly-invalid provider id to a trusted value — defaults to "gemini". */
export function resolveProviderId(value: unknown): AiProviderId {
  return isValidProviderId(value) ? value : "gemini";
}

/** How (if at all) the saved credential is currently stored. */
export type AiCredentialBackend = "none" | "os-encrypted" | "session";

/**
 * Status of the AI engine as seen from the renderer. Never contains key
 * material — only enough information to render an honest status message
 * and decide which actions (import / test / remove / send) make sense.
 */
export interface AiProviderStatus {
  provider: AiProviderId;
  /** Whether a credential is currently available for use (disk or session). */
  configured: boolean;
  /** Where the credential (if any) is currently held. */
  backend: AiCredentialBackend;
  /** True only when the credential is backed by a verified OS encryption API. */
  secure: boolean;
  /** Whether safeStorage (or equivalent) reports encryption as available on this machine. */
  persistentStorageAvailable: boolean;
  /** Set when running without the native preload bridge (browser preview). */
  nativeBridgeAvailable: boolean;
}

/** Normalized, finite set of AI-engine error codes shown to the user. */
export type AiErrorCode =
  | "MISSING_CREDENTIALS"
  | "INVALID_CREDENTIALS"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "CANCELLED"
  | "DUPLICATE_REQUEST"
  | "MALFORMED_RESPONSE"
  | "BLOCKED_BY_PROVIDER"
  | "OVERSIZED_PROMPT"
  | "VALIDATION_ERROR"
  | "STORAGE_ERROR"
  | "BRIDGE_UNAVAILABLE"
  | "INTERNAL_ERROR";

/**
 * Safe, user-facing copy for each normalized error code. No provider
 * internals, no credentials. Deliberately provider-agnostic (no "Gemini"
 * mentions) since Phase 9 added a second provider — callers that want to
 * name the active provider in a message build that text themselves from
 * `AI_PROVIDER_LABELS`, rather than this shared table hard-coding one.
 */
export const AI_ERROR_MESSAGES: Record<AiErrorCode, string> = {
  MISSING_CREDENTIALS: "No API key is configured for this provider yet. Add one in Settings to send requests.",
  INVALID_CREDENTIALS: "The provider rejected the configured API key. Check the key in Settings and try again.",
  RATE_LIMITED: "The provider reported a rate limit. Wait a moment and try again.",
  NETWORK_ERROR: "Could not reach the provider. Check your network connection and try again.",
  TIMEOUT: "The request took too long and was stopped. Try again or raise the timeout in Settings.",
  CANCELLED: "The request was cancelled.",
  DUPLICATE_REQUEST: "A request is already in progress. Wait for it to finish or cancel it first.",
  MALFORMED_RESPONSE: "The provider returned a response AXIS could not understand, so nothing was shown.",
  BLOCKED_BY_PROVIDER: "The provider did not return an answer for this prompt (it was blocked or withheld).",
  OVERSIZED_PROMPT: "That message is too long to send. Shorten it and try again.",
  VALIDATION_ERROR: "That message could not be sent as written.",
  STORAGE_ERROR: "AXIS could not read or write the saved credential on this device.",
  BRIDGE_UNAVAILABLE: "This preview window cannot reach the native AI engine. Run the AXIS desktop app for real requests.",
  INTERNAL_ERROR: "Something went wrong inside AXIS while handling that request."
};

/** Hard cap on a single prompt's length, enforced on both renderer and main. */
export const MAX_PROMPT_CHARS = 8000;

/** Request timeout bounds (ms) for the Settings preference. */
export const MIN_TIMEOUT_MS = 10_000;
export const MAX_TIMEOUT_MS = 120_000;
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Conversation context (Phase 4). A history turn is plain prompt/response
 * text exchanged earlier in the same in-memory session — never credentials,
 * never anything read from disk. `"model"` matches Gemini's own role name
 * for its half of the exchange so history turns can be forwarded directly
 * into the provider's multi-turn `contents` array.
 */
export type AiConversationRole = "user" | "model";

export interface AiHistoryTurn {
  role: AiConversationRole;
  text: string;
}

/** Explicit, small bounds for the conversation context sent with a request. */
export const MAX_HISTORY_TURNS = 8;
export const MAX_HISTORY_TURN_CHARS = 4000;
export const MAX_HISTORY_TOTAL_CHARS = 6000;
/** Raw safety ceiling checked before clamping — rejects grossly oversized payloads outright. */
const MAX_RAW_HISTORY_TURNS = 50;
const MAX_RAW_HISTORY_TURN_CHARS = 20_000;

export function isValidHistoryTurn(value: unknown): value is AiHistoryTurn {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate["role"] !== "user" && candidate["role"] !== "model") return false;
  if (typeof candidate["text"] !== "string") return false;
  if (candidate["text"].length > MAX_RAW_HISTORY_TURN_CHARS) return false;
  return true;
}

/**
 * Authoritative bounding of a conversation history array: trims each turn's
 * text to a per-turn cap, keeps only the most recent turns up to the turn
 * count cap, and drops the oldest of those further if the combined
 * character total still exceeds the overall cap. Pure and side-effect free
 * so both the renderer (what to send) and the main process (what to trust)
 * can call the exact same bound. Never throws on malformed input — callers
 * are expected to have already filtered with `isValidHistoryTurn`.
 */
export function clampHistory(history: readonly AiHistoryTurn[]): AiHistoryTurn[] {
  const trimmed = history
    .slice(-MAX_RAW_HISTORY_TURNS)
    .map((turn) => ({ role: turn.role, text: turn.text.slice(0, MAX_HISTORY_TURN_CHARS) }));

  const recent = trimmed.slice(-MAX_HISTORY_TURNS);

  const kept: AiHistoryTurn[] = [];
  let total = 0;
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const turn = recent[i];
    if (!turn) continue;
    const next = total + turn.text.length;
    if (kept.length > 0 && next > MAX_HISTORY_TOTAL_CHARS) break;
    kept.unshift(turn);
    total = next;
  }
  return kept;
}

export interface AiSendRequestPayload {
  requestId: string;
  prompt: string;
  timeoutMs?: number;
  /** Bounded recent conversation turns (Phase 4). Absent for single-shot requests. */
  history?: AiHistoryTurn[];
  /** Which provider to send this request to (Phase 9). Defaults to "gemini" when absent. */
  provider?: AiProviderId;
}

export interface AiSendResultSuccess {
  ok: true;
  requestId: string;
  text: string;
  /** True when the provider cut the answer short (e.g. hit a length limit). */
  truncated: boolean;
}

export interface AiSendResultFailure {
  ok: false;
  requestId: string;
  code: AiErrorCode;
  message: string;
}

export type AiSendResult = AiSendResultSuccess | AiSendResultFailure;

export interface AiCancelPayload {
  requestId: string;
}

export interface AiCancelResult {
  ok: boolean;
}

export interface AiImportCredentialPayload {
  /** Only honored when persistent OS-backed encryption is unavailable. */
  allowSessionOnly?: boolean;
  /** Which provider this credential is for (Phase 9). Defaults to "gemini" when absent. */
  provider?: AiProviderId;
}

export interface AiImportCredentialResult {
  ok: boolean;
  backend?: AiCredentialBackend;
  secure?: boolean;
  code?: AiErrorCode | "CANCELLED";
  message?: string;
}

export interface AiRemoveCredentialResult {
  ok: boolean;
  code?: AiErrorCode;
  message?: string;
}

export interface AiTestConnectionResult {
  ok: boolean;
  code?: AiErrorCode;
  message?: string;
}

/** Narrow runtime guard used by both the renderer (pre-flight) and main (authoritative) validation. */
export function isValidSendRequestPayload(value: unknown): value is AiSendRequestPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate["requestId"] !== "string" || candidate["requestId"].length === 0) return false;
  if (typeof candidate["requestId"] !== "string" || candidate["requestId"].length > 100) return false;
  if (typeof candidate["prompt"] !== "string") return false;
  const trimmed = candidate["prompt"].trim();
  if (trimmed.length === 0) return false;
  if (candidate["prompt"].length > MAX_PROMPT_CHARS) return false;
  if (candidate["timeoutMs"] !== undefined) {
    if (typeof candidate["timeoutMs"] !== "number" || !Number.isFinite(candidate["timeoutMs"])) return false;
    if (candidate["timeoutMs"] < MIN_TIMEOUT_MS || candidate["timeoutMs"] > MAX_TIMEOUT_MS) return false;
  }
  if (candidate["history"] !== undefined) {
    if (!Array.isArray(candidate["history"])) return false;
    if (candidate["history"].length > MAX_RAW_HISTORY_TURNS) return false;
    if (!candidate["history"].every((turn) => isValidHistoryTurn(turn))) return false;
  }
  if (candidate["provider"] !== undefined && !isValidProviderId(candidate["provider"])) return false;
  return true;
}

export function isValidCancelPayload(value: unknown): value is AiCancelPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate["requestId"] === "string" && candidate["requestId"].length > 0 && candidate["requestId"].length <= 100;
}

export function isValidImportPayload(value: unknown): value is AiImportCredentialPayload {
  if (value === undefined) return true;
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate["allowSessionOnly"] !== undefined && typeof candidate["allowSessionOnly"] !== "boolean") return false;
  if (candidate["provider"] !== undefined && !isValidProviderId(candidate["provider"])) return false;
  return true;
}

/**
 * Streaming readiness (Phase 4).
 *
 * `sendStreamingRequest` only ever ACKs that a stream was accepted and
 * started (or rejects immediately for a validation/credential/duplicate
 * problem it can know synchronously). The actual outcome — every delta,
 * then exactly one terminal event — arrives via the one-way
 * `aiStreamEvent` push channel, each event stamped with the same
 * `requestId` so a stale or superseded stream's events can never be
 * confused with the current one. No event on this channel ever carries
 * credential material — only plain response text fragments and normalized
 * status/error codes.
 */
export type AiStreamStartResult =
  | { ok: true; requestId: string }
  | { ok: false; requestId: string; code: AiErrorCode; message: string };

export type AiStreamEvent =
  | { requestId: string; type: "delta"; text: string }
  | { requestId: string; type: "done"; truncated: boolean }
  | { requestId: string; type: "cancelled" }
  | { requestId: string; type: "error"; code: AiErrorCode; message: string };

/**
 * Defensive shape guard applied on the renderer side before any pushed
 * event is trusted, even though the only sender is this app's own main
 * process — belt-and-suspenders against a malformed or unexpected payload.
 */
export function isValidStreamEvent(value: unknown): value is AiStreamEvent {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate["requestId"] !== "string" || candidate["requestId"].length === 0) return false;
  switch (candidate["type"]) {
    case "delta":
      return typeof candidate["text"] === "string";
    case "done":
      return typeof candidate["truncated"] === "boolean";
    case "cancelled":
      return true;
    case "error":
      return typeof candidate["code"] === "string" && typeof candidate["message"] === "string";
    default:
      return false;
  }
}
