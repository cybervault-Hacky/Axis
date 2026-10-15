import type { AiErrorCode, AiHistoryTurn } from "../../shared/ai-contract";
import { classifyHttpError, mapFetchException } from "./providerHttp";
import type { ProviderAdapter } from "./providerTypes";

/**
 * Anthropic Claude Messages API client (main process only; Phase 10).
 *
 * Reference (fetched live from Anthropic's own docs while implementing this
 * module — https://platform.claude.com/docs/en/api/messages,
 * .../api/models/list, .../api/versioning, .../api/errors,
 * .../build-with-claude/streaming, .../models/overview):
 *  - Auth: the API key is sent via the `x-api-key` HTTP header, plus a
 *    required `anthropic-version` header pinning the wire protocol. Neither
 *    the key nor the version string is ever logged or echoed to the
 *    renderer — identical policy to Gemini and OpenAI.
 *  - Endpoint: POST {base}/messages (non-streaming and, with
 *    `stream: true`, Server-Sent Events using Anthropic's own named-event
 *    protocol — not the single-shape `data:` JSON Gemini/OpenAI use).
 *  - A lightweight GET {base}/models call (metadata only, not a generation
 *    call) is used for "Test connection", mirroring both existing
 *    providers' non-billable connectivity check.
 *
 * This module never logs the API key or full prompt text, and only ever
 * returns a small, normalized result — never a raw provider error body —
 * exactly like geminiProvider.ts and openaiProvider.ts. It shares no
 * request/response parsing with either (Anthropic's `content: [{type,
 * text}]` blocks and named SSE event stream are shaped nothing like
 * Gemini's `candidates[]` or OpenAI's `choices[].delta`), only the small
 * `classifyHttpError`/`mapFetchException` helpers in `providerHttp.ts` and
 * the `ProviderAdapter` interface itself.
 */

export const ANTHROPIC_API_BASE = "https://api.anthropic.com/v1";

/**
 * Required API version header. Per Anthropic's own versioning docs, this
 * value identifies the wire protocol (SSE event shapes, field set) and has
 * remained "2023-06-01" since that protocol revision — it is not a model
 * version and does not need to track new model releases.
 */
export const ANTHROPIC_API_VERSION = "2023-06-01";

/**
 * Default model. Chosen for broad availability and low cost at
 * implementation time (confirmed current and active on Anthropic's own
 * models overview page at implementation time) — the same "fast, cheap,
 * widely available" tier Phase 9 chose for OpenAI (`gpt-4o-mini`), rather
 * than Anthropic's own "start here" flagship recommendation, which is
 * priced for heavier workloads. If Anthropic retires this model id, update
 * this one constant — nothing else in AXIS needs to change.
 */
export const ANTHROPIC_MODEL = "claude-haiku-5-5";

/**
 * The Messages API requires `max_tokens` on every request (unlike Gemini/
 * OpenAI, where an output cap is optional). This is an output-length cap,
 * not a cost control knob exposed to the user — kept generous enough for a
 * normal chat answer without being unbounded.
 */
const ANTHROPIC_MAX_OUTPUT_TOKENS = 4096;

export interface AnthropicCallOk {
  ok: true;
  text: string;
  truncated: boolean;
}

export interface AnthropicCallErr {
  ok: false;
  code: AiErrorCode;
  message: string;
}

export type AnthropicCallResult = AnthropicCallOk | AnthropicCallErr;

interface AnthropicContentBlock {
  type?: unknown;
  text?: unknown;
}

interface AnthropicMessageResponse {
  content?: AnthropicContentBlock[];
  stop_reason?: unknown;
}

interface AnthropicErrorBody {
  error?: { type?: unknown; message?: unknown };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Concatenates every `text`-type content block, in order. Non-text blocks (none requested here) are ignored. */
function extractText(blocks: AnthropicContentBlock[] | undefined): string {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .map((block) => (isRecord(block) && block.type === "text" && typeof block.text === "string" ? block.text : ""))
    .join("");
}

/**
 * Validates and extracts text from a parsed Anthropic Messages API response
 * body. Never throws — any unexpected shape is reported as a normalized
 * error rather than displayed or guessed at.
 */
export function parseMessagesResponse(json: unknown): AnthropicCallResult {
  if (!isRecord(json)) {
    return { ok: false, code: "MALFORMED_RESPONSE", message: "Response body was not a JSON object." };
  }
  const body = json as AnthropicMessageResponse;
  const stopReason = typeof body.stop_reason === "string" ? body.stop_reason : undefined;
  const text = extractText(body.content);

  if (text.length === 0) {
    if (stopReason === "refusal") {
      return { ok: false, code: "BLOCKED_BY_PROVIDER", message: "Provider declined to answer (refusal)." };
    }
    return { ok: false, code: "MALFORMED_RESPONSE", message: "Response contained no readable text." };
  }

  return { ok: true, text, truncated: stopReason === "max_tokens" };
}

/** Best-effort extraction of a safe (non-secret) error type from an Anthropic error body, for classification only. */
function extractErrorType(json: unknown): string | undefined {
  if (!isRecord(json)) return undefined;
  const body = json as AnthropicErrorBody;
  return isRecord(body.error) && typeof body.error["type"] === "string" ? (body.error["type"] as string) : undefined;
}

/** Maps an Anthropic error `type` string (from the JSON body) to a normalized code, falling back to the HTTP status. */
function classifyAnthropicError(status: number, errorType: string | undefined): AiErrorCode {
  if (errorType === "authentication_error" || errorType === "permission_error") return "INVALID_CREDENTIALS";
  if (errorType === "rate_limit_error") return "RATE_LIMITED";
  if (errorType === "overloaded_error") return "NETWORK_ERROR";
  if (errorType === "invalid_request_error") return "VALIDATION_ERROR";
  return classifyHttpError(status);
}

export interface AnthropicRequestOptions {
  signal: AbortSignal;
  model?: string;
  /**
   * Bounded prior turns (Phase 4 conversation context), oldest first. The
   * caller (aiController) is responsible for bounding this with
   * `clampHistory` before it ever reaches this module.
   */
  history?: AiHistoryTurn[];
}

/** Builds Anthropic's `messages` array from bounded history plus the new prompt. AXIS's "model" role maps to Anthropic's "assistant". */
function buildMessages(history: AiHistoryTurn[] | undefined, prompt: string): Array<{ role: string; content: string }> {
  const messages = (history ?? []).map((turn) => ({ role: turn.role === "model" ? "assistant" : "user", content: turn.text }));
  messages.push({ role: "user", content: prompt });
  return messages;
}

function requestHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    // Anthropic's documented header-based auth — the key never appears in
    // the URL. `anthropic-version` pins the wire protocol (see the module
    // doc comment above), not a model version.
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_API_VERSION
  };
}

/**
 * Sends a prompt to Claude, optionally with bounded prior conversation
 * turns. Mirrors `sendGeminiPrompt`/`sendOpenAiPrompt`'s shape and
 * behaviour exactly so `aiController.ts` can treat all three providers
 * identically through the shared `ProviderAdapter` interface.
 */
export async function sendAnthropicPrompt(
  apiKey: string,
  prompt: string,
  options: AnthropicRequestOptions
): Promise<AnthropicCallResult> {
  const model = options.model ?? ANTHROPIC_MODEL;
  const url = `${ANTHROPIC_API_BASE}/messages`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      signal: options.signal,
      headers: requestHeaders(apiKey),
      body: JSON.stringify({
        model,
        max_tokens: ANTHROPIC_MAX_OUTPUT_TOKENS,
        messages: buildMessages(options.history, prompt),
        stream: false
      })
    });
  } catch (error) {
    return mapFetchException(error);
  }

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // Best-effort only — classification still falls back to the HTTP status.
    }
    const code = classifyAnthropicError(response.status, extractErrorType(body));
    return { ok: false, code, message: `Provider returned HTTP ${response.status}.` };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { ok: false, code: "MALFORMED_RESPONSE", message: "Response body was not valid JSON." };
  }

  return parseMessagesResponse(json);
}

/** One event out of a streaming generation. Exactly one terminal event ("done" or "error") ends the stream. */
export type AnthropicStreamChunk =
  | { type: "delta"; text: string }
  | { type: "done"; truncated: boolean }
  | { type: "error"; code: AiErrorCode; message: string };

/**
 * Anthropic's SSE frames carry both a named `event:` line and a `data:`
 * JSON line, but the JSON payload's own `type` field always mirrors the
 * event name — so, like Gemini's and OpenAI's adapters, this only ever
 * inspects the parsed `data:` JSON, never the separate `event:` line.
 * Unrecognized/future event types are ignored rather than treated as an
 * error, per Anthropic's own streaming-protocol versioning guidance.
 */
interface AnthropicStreamParseResult {
  textDelta?: string;
  stopReason?: string;
  done?: boolean;
  midStreamError?: { code: AiErrorCode; message: string };
}

function parseStreamEvent(json: unknown): AnthropicStreamParseResult {
  if (!isRecord(json)) return {};
  const type = json["type"];

  if (type === "content_block_delta") {
    const delta = json["delta"];
    if (isRecord(delta) && delta["type"] === "text_delta" && typeof delta["text"] === "string") {
      return { textDelta: delta["text"] };
    }
    return {};
  }

  if (type === "message_delta") {
    const delta = json["delta"];
    const stopReason = isRecord(delta) && typeof delta["stop_reason"] === "string" ? (delta["stop_reason"] as string) : undefined;
    return { stopReason };
  }

  if (type === "message_stop") {
    return { done: true };
  }

  if (type === "error") {
    // A stream-level error can arrive after the initial HTTP 200 — handled
    // as its own terminal outcome, not just an HTTP-status classification.
    const errorType = extractErrorType(json);
    const code = classifyAnthropicError(529, errorType);
    return { midStreamError: { code, message: "Provider reported a mid-stream error." } };
  }

  // message_start / content_block_start / content_block_stop / ping /
  // any future event type: nothing this caller needs to act on.
  return {};
}

/**
 * Streams a generation from Claude via `messages` with `stream: true`
 * (Server-Sent Events). This is real provider streaming — no timer or
 * character-reveal simulation is involved anywhere in this function.
 * Cancellation is honored by cancelling the underlying reader as soon as
 * `options.signal` aborts, which ends the read loop promptly — identical
 * policy to the Gemini and OpenAI adapters.
 */
export async function* streamAnthropicPrompt(
  apiKey: string,
  prompt: string,
  options: AnthropicRequestOptions
): AsyncGenerator<AnthropicStreamChunk, void, void> {
  const model = options.model ?? ANTHROPIC_MODEL;
  const url = `${ANTHROPIC_API_BASE}/messages`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      signal: options.signal,
      headers: requestHeaders(apiKey),
      body: JSON.stringify({
        model,
        max_tokens: ANTHROPIC_MAX_OUTPUT_TOKENS,
        messages: buildMessages(options.history, prompt),
        stream: true
      })
    });
  } catch (error) {
    const mapped = mapFetchException(error);
    yield { type: "error", code: mapped.code, message: mapped.message };
    return;
  }

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // Best-effort only.
    }
    yield { type: "error", code: classifyAnthropicError(response.status, extractErrorType(body)), message: `Provider returned HTTP ${response.status}.` };
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
  let stopReason: string | undefined;
  let sawMessageStop = false;
  let midStreamError: { code: AiErrorCode; message: string } | undefined;

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
        if (!jsonText) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(jsonText);
        } catch {
          // A single malformed/partial SSE event does not invalidate the
          // whole stream — skip it and keep reading.
          continue;
        }
        const extracted = parseStreamEvent(parsed);
        if (extracted.midStreamError) {
          midStreamError = extracted.midStreamError;
          break;
        }
        if (extracted.stopReason) stopReason = extracted.stopReason;
        if (extracted.done) sawMessageStop = true;
        if (extracted.textDelta) {
          sawAnyText = true;
          yield { type: "delta", text: extracted.textDelta };
        }
      }
      if (midStreamError || sawMessageStop) break;
    }
  } finally {
    options.signal.removeEventListener("abort", onAbort);
  }

  if (options.signal.aborted) {
    yield { type: "error", code: "CANCELLED", message: "Request was aborted." };
    return;
  }

  if (midStreamError) {
    yield { type: "error", code: midStreamError.code, message: midStreamError.message };
    return;
  }

  if (!sawAnyText) {
    if (stopReason === "refusal") {
      yield { type: "error", code: "BLOCKED_BY_PROVIDER", message: "Provider declined to answer (refusal)." };
    } else {
      yield { type: "error", code: "MALFORMED_RESPONSE", message: "Stream ended with no readable text." };
    }
    return;
  }

  yield { type: "done", truncated: stopReason === "max_tokens" };
}

export interface AnthropicTestResult {
  ok: boolean;
  code?: AiErrorCode;
  message?: string;
}

/**
 * Verifies a key works by listing available models (GET), which does not
 * consume generation quota or trigger a billable generation call — the
 * same non-billable-metadata-call approach Gemini and OpenAI use.
 */
export async function testAnthropicConnection(apiKey: string, options: AnthropicRequestOptions): Promise<AnthropicTestResult> {
  const url = `${ANTHROPIC_API_BASE}/models`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      signal: options.signal,
      headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_API_VERSION }
    });
  } catch (error) {
    const mapped = mapFetchException(error);
    return { ok: false, code: mapped.code, message: mapped.message };
  }

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // Best-effort only.
    }
    return { ok: false, code: classifyAnthropicError(response.status, extractErrorType(body)), message: `Provider returned HTTP ${response.status}.` };
  }

  return { ok: true };
}

/**
 * This provider's adapter conforming to the shared `ProviderAdapter`
 * interface (Phase 9/10) — see the matching `GEMINI_PROVIDER`/
 * `OPENAI_PROVIDER` exports. `aiController.ts` dispatches through this
 * interface rather than calling these functions by name.
 */
export const ANTHROPIC_PROVIDER: ProviderAdapter = {
  id: "anthropic",
  sendPrompt: sendAnthropicPrompt,
  streamPrompt: streamAnthropicPrompt,
  testConnection: testAnthropicConnection
};
