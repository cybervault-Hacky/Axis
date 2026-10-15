import type { AiErrorCode, AiHistoryTurn } from "../../shared/ai-contract";
import { classifyHttpError, mapFetchException as mapFetchExceptionShared } from "./providerHttp";
import type { ProviderAdapter } from "./providerTypes";

/**
 * Google Gemini Developer API client (main process only).
 *
 * Reference: https://ai.google.dev/api/generate-content
 *  - Auth: the API key is sent via the `x-goog-api-key` HTTP header. It is
 *    NEVER appended to the URL as a query parameter, per AXIS security
 *    policy and Google's current guidance.
 *  - Endpoint: POST {base}/models/{model}:generateContent
 *  - A lightweight GET {base}/models/{model} call (metadata only, not a
 *    generation call) is used for "Test connection" so testing a key does
 *    not spend generation quota.
 *
 * This module never logs the API key or full prompt text. It only ever
 * returns a small, normalized result — never a raw provider error body.
 */

export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Default model. Chosen for broad availability on the free/developer tier
 * at implementation time. If Google retires this model id, update this one
 * constant — nothing else in AXIS needs to change.
 */
export const GEMINI_MODEL = "gemini-2.0-flash";

export interface GeminiCallOk {
  ok: true;
  text: string;
  truncated: boolean;
}

export interface GeminiCallErr {
  ok: false;
  code: AiErrorCode;
  message: string;
}

export type GeminiCallResult = GeminiCallOk | GeminiCallErr;

interface GeminiPart {
  text?: unknown;
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
  finishReason?: unknown;
}

interface GeminiGenerateContentResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: unknown };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Validates and extracts text from a parsed Gemini generateContent response
 * body. Never throws — any unexpected shape is reported as a normalized
 * error rather than displayed or guessed at.
 */
export function parseGenerateContentResponse(json: unknown): GeminiCallResult {
  if (!isRecord(json)) {
    return { ok: false, code: "MALFORMED_RESPONSE", message: "Response body was not a JSON object." };
  }
  const body = json as GeminiGenerateContentResponse;

  const blockReason = isRecord(body.promptFeedback) ? body.promptFeedback["blockReason"] : undefined;
  if (typeof blockReason === "string" && blockReason.length > 0 && blockReason !== "BLOCK_REASON_UNSPECIFIED") {
    return { ok: false, code: "BLOCKED_BY_PROVIDER", message: "Blocked by provider safety filtering." };
  }

  if (!Array.isArray(body.candidates) || body.candidates.length === 0) {
    return { ok: false, code: "MALFORMED_RESPONSE", message: "Response contained no candidates." };
  }

  const candidate = body.candidates[0];
  if (typeof candidate !== "object" || candidate === null) {
    return { ok: false, code: "MALFORMED_RESPONSE", message: "First candidate was not an object." };
  }

  const parts = candidate.content?.parts;
  const text = Array.isArray(parts)
    ? parts
        .map((part) => (isRecord(part) && typeof part["text"] === "string" ? (part["text"] as string) : ""))
        .join("")
    : "";

  const finishReason = typeof candidate.finishReason === "string" ? candidate.finishReason : undefined;

  if (text.length === 0) {
    if (finishReason === "SAFETY" || finishReason === "RECITATION" || finishReason === "PROHIBITED_CONTENT") {
      return { ok: false, code: "BLOCKED_BY_PROVIDER", message: `Provider withheld the response (${finishReason}).` };
    }
    return { ok: false, code: "MALFORMED_RESPONSE", message: "Response contained no readable text." };
  }

  const truncated = finishReason === "MAX_TOKENS";
  return { ok: true, text, truncated };
}

export interface GeminiRequestOptions {
  signal: AbortSignal;
  model?: string;
  /**
   * Bounded prior turns (Phase 4 conversation context), oldest first. The
   * caller (aiController) is responsible for bounding this with
   * `clampHistory` before it ever reaches this module — this function does
   * not re-check the bound, only forwards it as-is into `contents`.
   */
  history?: AiHistoryTurn[];
}

/** Builds Gemini's multi-turn `contents` array from bounded history plus the new prompt. */
function buildContents(history: AiHistoryTurn[] | undefined, prompt: string): Array<{ role: string; parts: Array<{ text: string }> }> {
  const turns = (history ?? []).map((turn) => ({ role: turn.role, parts: [{ text: turn.text }] }));
  turns.push({ role: "user", parts: [{ text: prompt }] });
  return turns;
}

/**
 * Sends a prompt to Gemini, optionally with bounded prior conversation
 * turns (Phase 4). With no history this is exactly the Phase 3 single-turn
 * call — the request body shape for that case is unchanged.
 */
export async function sendGeminiPrompt(
  apiKey: string,
  prompt: string,
  options: GeminiRequestOptions
): Promise<GeminiCallResult> {
  const model = options.model ?? GEMINI_MODEL;
  const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      signal: options.signal,
      headers: {
        "Content-Type": "application/json",
        // Supported header-based auth — the key never appears in the URL.
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: buildContents(options.history, prompt)
      })
    });
  } catch (error) {
    return mapFetchException(error);
  }

  if (!response.ok) {
    return { ok: false, code: classifyHttpError(response.status), message: `Provider returned HTTP ${response.status}.` };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { ok: false, code: "MALFORMED_RESPONSE", message: "Response body was not valid JSON." };
  }

  return parseGenerateContentResponse(json);
}

/** One event out of a streaming generation. Exactly one terminal event ("done" or "error") ends the stream. */
export type GeminiStreamChunk =
  | { type: "delta"; text: string }
  | { type: "done"; truncated: boolean }
  | { type: "error"; code: AiErrorCode; message: string };

/**
 * Best-effort extraction of incremental text from one parsed SSE `data:`
 * JSON event. Streaming events share the same `GenerateContentResponse`
 * shape as the non-streaming call, but each event's text is a fragment to
 * append, not the full answer. Never throws — an unrecognized shape simply
 * yields no text for that one event rather than aborting the whole stream.
 */
function extractStreamEventText(json: unknown): { text: string; finishReason?: string; blocked: boolean } {
  if (!isRecord(json)) return { text: "", blocked: false };
  const body = json as GeminiGenerateContentResponse;

  const blockReason = isRecord(body.promptFeedback) ? body.promptFeedback["blockReason"] : undefined;
  const blocked = typeof blockReason === "string" && blockReason.length > 0 && blockReason !== "BLOCK_REASON_UNSPECIFIED";

  const candidate = Array.isArray(body.candidates) ? body.candidates[0] : undefined;
  if (typeof candidate !== "object" || candidate === null) return { text: "", blocked };

  const parts = candidate.content?.parts;
  const text = Array.isArray(parts)
    ? parts.map((part) => (isRecord(part) && typeof part["text"] === "string" ? (part["text"] as string) : "")).join("")
    : "";
  const finishReason = typeof candidate.finishReason === "string" ? candidate.finishReason : undefined;
  return { text, finishReason, blocked };
}

/**
 * Streams a generation from Gemini via `streamGenerateContent?alt=sse`
 * (Server-Sent Events). Each `data:` line decodes to one JSON event whose
 * text is a delta to append to the growing answer; the final event (or the
 * stream simply closing) marks completion. This is real provider streaming
 * — no timer or character-reveal simulation is involved anywhere in this
 * function. Cancellation is honored by cancelling the underlying reader as
 * soon as `options.signal` aborts, which ends the read loop promptly.
 */
export async function* streamGeminiPrompt(
  apiKey: string,
  prompt: string,
  options: GeminiRequestOptions
): AsyncGenerator<GeminiStreamChunk, void, void> {
  const model = options.model ?? GEMINI_MODEL;
  const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      signal: options.signal,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: buildContents(options.history, prompt)
      })
    });
  } catch (error) {
    const mapped = mapFetchException(error);
    yield { type: "error", code: mapped.code, message: mapped.message };
    return;
  }

  if (!response.ok) {
    yield { type: "error", code: classifyHttpError(response.status), message: `Provider returned HTTP ${response.status}.` };
    return;
  }

  if (!response.body) {
    yield { type: "error", code: "MALFORMED_RESPONSE", message: "No response stream was received." };
    return;
  }

  const reader = response.body.getReader();
  const onAbort = () => {
    reader.cancel("AXIS: request aborted").catch(() => {
      // The stream may already be closed — nothing further to do.
    });
  };
  options.signal.addEventListener("abort", onAbort);

  const decoder = new TextDecoder();
  let buffer = "";
  let sawAnyText = false;
  let blockedSeen = false;
  let finishReason: string | undefined;

  try {
    for (;;) {
      let step: ReadableStreamReadResult<Uint8Array>;
      try {
        step = await reader.read();
      } catch (error) {
        if (options.signal.aborted) break;
        const mapped = mapFetchException(error);
        yield { type: "error", code: mapped.code, message: mapped.message };
        return;
      }
      if (step.done) break;
      buffer += decoder.decode(step.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        const jsonText = line.slice(5).trim();
        if (!jsonText || jsonText === "[DONE]") continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(jsonText);
        } catch {
          // A single malformed/partial SSE event does not invalidate the
          // whole stream — skip it and keep reading.
          continue;
        }
        const extracted = extractStreamEventText(parsed);
        if (extracted.blocked) blockedSeen = true;
        if (extracted.finishReason) finishReason = extracted.finishReason;
        if (extracted.text.length > 0) {
          sawAnyText = true;
          yield { type: "delta", text: extracted.text };
        }
      }
    }
  } finally {
    options.signal.removeEventListener("abort", onAbort);
  }

  if (options.signal.aborted) {
    yield { type: "error", code: "CANCELLED", message: "Request was aborted." };
    return;
  }

  if (!sawAnyText) {
    if (blockedSeen || finishReason === "SAFETY" || finishReason === "RECITATION" || finishReason === "PROHIBITED_CONTENT") {
      yield { type: "error", code: "BLOCKED_BY_PROVIDER", message: "Blocked by provider safety filtering." };
    } else {
      yield { type: "error", code: "MALFORMED_RESPONSE", message: "Stream ended with no readable text." };
    }
    return;
  }

  yield { type: "done", truncated: finishReason === "MAX_TOKENS" };
}

export interface GeminiTestResult {
  ok: boolean;
  code?: AiErrorCode;
  message?: string;
}

/**
 * Verifies a key works by fetching model metadata (GET), which does not
 * consume generation quota or trigger a billable generation call.
 */
export async function testGeminiConnection(apiKey: string, options: GeminiRequestOptions): Promise<GeminiTestResult> {
  const model = options.model ?? GEMINI_MODEL;
  const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      signal: options.signal,
      headers: { "x-goog-api-key": apiKey }
    });
  } catch (error) {
    const mapped = mapFetchException(error);
    return { ok: false, code: mapped.code, message: mapped.message };
  }

  if (!response.ok) {
    return { ok: false, code: classifyHttpError(response.status), message: `Provider returned HTTP ${response.status}.` };
  }

  return { ok: true };
}

/**
 * Thin local wrapper around the shared `mapFetchException` so every call
 * site in this file keeps its existing `GeminiCallErr`-shaped return type.
 * Caller (aiController) distinguishes user-cancel vs timeout and will
 * override `CANCELLED` with `TIMEOUT` when its own timer triggered the abort.
 */
function mapFetchException(error: unknown): GeminiCallErr {
  return mapFetchExceptionShared(error);
}

/**
 * This provider's adapter conforming to the shared `ProviderAdapter`
 * interface (Phase 9) — `aiController.ts` dispatches through this rather
 * than calling `sendGeminiPrompt`/`streamGeminiPrompt`/`testGeminiConnection`
 * by name, so adding another provider never means branching the request
 * lifecycle itself.
 */
export const GEMINI_PROVIDER: ProviderAdapter = {
  id: "gemini",
  sendPrompt: sendGeminiPrompt,
  streamPrompt: streamGeminiPrompt,
  testConnection: testGeminiConnection
};
