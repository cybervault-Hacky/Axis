import type { AiErrorCode, AiHistoryTurn } from "../../shared/ai-contract";
import { classifyHttpError, mapFetchException } from "./providerHttp";
import type { ProviderAdapter } from "./providerTypes";

/**
 * Mistral AI Chat Completions API client (main process only; Phase 14).
 *
 * Reference (gathered from Mistral's own public API documentation and
 * widely-mirrored usage examples while implementing this module —
 * api.mistral.ai's `/v1/chat/completions` and `/v1/models` endpoints):
 *  - Auth: the API key is sent via a standard `Authorization: Bearer`
 *    HTTP header — identical in shape to OpenAI's. It is never appended to
 *    the URL, logged, or echoed back to the renderer.
 *  - Endpoint: POST {base}/chat/completions (non-streaming and, with
 *    `stream: true`, Server-Sent Events). The request/response body shape
 *    (`messages: [{role, content}]`, `choices[0].message.content`,
 *    `choices[0].finish_reason`, and the streaming `choices[0].delta.content`
 *    SSE "chunk" shape terminated by a literal `data: [DONE]` line) is the
 *    same OpenAI-compatible Chat Completions shape Mistral's API
 *    deliberately mirrors.
 *  - A lightweight GET {base}/models call (metadata only, not a generation
 *    call) is used for "Test connection", mirroring the non-billable
 *    connectivity check every other provider adapter already uses.
 *  - Mistral's error body shape is flatter than OpenAI's, though
 *    ("{ message, type, code }" rather than OpenAI's nested
 *    "{ error: { message, type, code } }"), and Mistral uses HTTP 422 (not
 *    400) for request-validation failures — both differences are handled
 *    explicitly in `classifyMistralError` below rather than assumed to
 *    match OpenAI's classification.
 *
 * This module never logs the API key or full prompt text, and only ever
 * returns a small, normalized result — never a raw provider error body —
 * exactly like the other three provider adapters. It shares no request/
 * response parsing with them (even though the shape closely resembles
 * OpenAI's, this module is self-contained, matching the established
 * one-module-per-provider convention), only the small
 * `classifyHttpError`/`mapFetchException` helpers in `providerHttp.ts` and
 * the `ProviderAdapter` interface itself.
 */

export const MISTRAL_API_BASE = "https://api.mistral.ai/v1";

/**
 * Default model. Chosen for broad availability and low cost at
 * implementation time — the same "fast, cheap, widely available" tier
 * Phase 9/10 chose for OpenAI (`gpt-4o-mini`) and Anthropic
 * (`claude-haiku-5-5`), rather than Mistral's larger/more expensive
 * flagship model. If Mistral retires this model id, update this one
 * constant — nothing else in AXIS needs to change.
 */
export const MISTRAL_MODEL = "mistral-small-latest";

export interface MistralCallOk {
  ok: true;
  text: string;
  truncated: boolean;
}

export interface MistralCallErr {
  ok: false;
  code: AiErrorCode;
  message: string;
}

export type MistralCallResult = MistralCallOk | MistralCallErr;

interface MistralChoice {
  message?: { content?: unknown };
  finish_reason?: unknown;
}

interface MistralChatCompletionResponse {
  choices?: MistralChoice[];
}

/** Mistral's error body is flatter than OpenAI's — no nested `error` key. */
interface MistralErrorBody {
  message?: unknown;
  type?: unknown;
  code?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Validates and extracts text from a parsed Mistral chat/completions
 * response body. Never throws — any unexpected shape is reported as a
 * normalized error rather than displayed or guessed at.
 */
export function parseMistralChatResponse(json: unknown): MistralCallResult {
  if (!isRecord(json)) {
    return { ok: false, code: "MALFORMED_RESPONSE", message: "Response body was not a JSON object." };
  }
  const body = json as MistralChatCompletionResponse;

  if (!Array.isArray(body.choices) || body.choices.length === 0) {
    return { ok: false, code: "MALFORMED_RESPONSE", message: "Response contained no choices." };
  }

  const choice = body.choices[0];
  if (typeof choice !== "object" || choice === null) {
    return { ok: false, code: "MALFORMED_RESPONSE", message: "First choice was not an object." };
  }

  const text = typeof choice.message?.content === "string" ? choice.message.content : "";
  const finishReason = typeof choice.finish_reason === "string" ? choice.finish_reason : undefined;

  if (text.length === 0) {
    return { ok: false, code: "MALFORMED_RESPONSE", message: "Response contained no readable text." };
  }

  return { ok: true, text, truncated: finishReason === "length" };
}

/** Best-effort extraction of a safe (non-secret) error `type` from a Mistral error body, for classification only. */
function extractErrorType(json: unknown): string | undefined {
  if (!isRecord(json)) return undefined;
  const body = json as MistralErrorBody;
  return typeof body.type === "string" ? body.type : undefined;
}

/**
 * Maps a Mistral error response to a normalized code. Mistral uses HTTP
 * 422 (not 400, unlike OpenAI/the generic `classifyHttpError` default) for
 * request-validation failures (e.g. an unrecognized field), so that status
 * is special-cased here rather than falling through to
 * `classifyHttpError`'s generic `INTERNAL_ERROR` fallback for an
 * unrecognized status.
 */
function classifyMistralError(status: number, errorType: string | undefined): AiErrorCode {
  if (errorType === "invalid_request_error") return "VALIDATION_ERROR";
  if (status === 422) return "VALIDATION_ERROR";
  return classifyHttpError(status);
}

export interface MistralRequestOptions {
  signal: AbortSignal;
  model?: string;
  /**
   * Bounded prior turns (Phase 4 conversation context), oldest first. The
   * caller (aiController) is responsible for bounding this with
   * `clampHistory` before it ever reaches this module.
   */
  history?: AiHistoryTurn[];
}

/** Builds Mistral's `messages` array from bounded history plus the new prompt. AXIS's "model" role maps to Mistral's "assistant". */
function buildMessages(history: AiHistoryTurn[] | undefined, prompt: string): Array<{ role: string; content: string }> {
  const messages = (history ?? []).map((turn) => ({ role: turn.role === "model" ? "assistant" : "user", content: turn.text }));
  messages.push({ role: "user", content: prompt });
  return messages;
}

function requestHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    // Standard bearer-token auth — the key never appears in the URL.
    Authorization: `Bearer ${apiKey}`
  };
}

/**
 * Sends a prompt to Mistral, optionally with bounded prior conversation
 * turns. Mirrors `sendOpenAiPrompt`'s/`sendAnthropicPrompt`'s shape and
 * behaviour exactly so `aiController.ts` can treat all four providers
 * identically through the shared `ProviderAdapter` interface.
 */
export async function sendMistralPrompt(
  apiKey: string,
  prompt: string,
  options: MistralRequestOptions
): Promise<MistralCallResult> {
  const model = options.model ?? MISTRAL_MODEL;
  const url = `${MISTRAL_API_BASE}/chat/completions`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      signal: options.signal,
      headers: requestHeaders(apiKey),
      body: JSON.stringify({ model, messages: buildMessages(options.history, prompt), stream: false })
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
    const code = classifyMistralError(response.status, extractErrorType(body));
    return { ok: false, code, message: `Provider returned HTTP ${response.status}.` };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { ok: false, code: "MALFORMED_RESPONSE", message: "Response body was not valid JSON." };
  }

  return parseMistralChatResponse(json);
}

/** One event out of a streaming generation. Exactly one terminal event ("done" or "error") ends the stream. */
export type MistralStreamChunk =
  | { type: "delta"; text: string }
  | { type: "done"; truncated: boolean }
  | { type: "error"; code: AiErrorCode; message: string };

/**
 * Best-effort extraction of incremental text from one parsed SSE `data:`
 * JSON event (Mistral's `chat.completion.chunk` shape, identical to
 * OpenAI's). Never throws — an unrecognized shape simply yields no text
 * for that one event rather than aborting the whole stream.
 */
function extractStreamEventText(json: unknown): { text: string; finishReason?: string } {
  if (!isRecord(json)) return { text: "" };
  const body = json as MistralChatCompletionResponse;
  const choice = Array.isArray(body.choices) ? body.choices[0] : undefined;
  if (typeof choice !== "object" || choice === null) return { text: "" };
  const delta = (choice as { delta?: { content?: unknown } }).delta;
  const text = isRecord(delta) && typeof delta["content"] === "string" ? (delta["content"] as string) : "";
  const finishReason = typeof choice.finish_reason === "string" ? choice.finish_reason : undefined;
  return { text, finishReason };
}

/**
 * Streams a generation from Mistral via `chat/completions` with
 * `stream: true` (Server-Sent Events). Each `data:` line decodes to one
 * JSON "chunk" event whose `choices[0].delta.content` is a text fragment
 * to append; the stream ends with a literal `data: [DONE]` line. This is
 * real provider streaming — no timer or character-reveal simulation is
 * involved anywhere in this function. Cancellation is honored by
 * cancelling the underlying reader as soon as `options.signal` aborts.
 */
export async function* streamMistralPrompt(
  apiKey: string,
  prompt: string,
  options: MistralRequestOptions
): AsyncGenerator<MistralStreamChunk, void, void> {
  const model = options.model ?? MISTRAL_MODEL;
  const url = `${MISTRAL_API_BASE}/chat/completions`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      signal: options.signal,
      headers: requestHeaders(apiKey),
      body: JSON.stringify({ model, messages: buildMessages(options.history, prompt), stream: true })
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
    yield { type: "error", code: classifyMistralError(response.status, extractErrorType(body)), message: `Provider returned HTTP ${response.status}.` };
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
  let finishReason: string | undefined;
  let sawDone = false;

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
        if (jsonText === "[DONE]") {
          sawDone = true;
          continue;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(jsonText);
        } catch {
          // A single malformed/partial SSE event does not invalidate the
          // whole stream — skip it and keep reading.
          continue;
        }
        const extracted = extractStreamEventText(parsed);
        if (extracted.finishReason) finishReason = extracted.finishReason;
        if (extracted.text.length > 0) {
          sawAnyText = true;
          yield { type: "delta", text: extracted.text };
        }
      }
      if (sawDone) break;
    }
  } finally {
    options.signal.removeEventListener("abort", onAbort);
  }

  if (options.signal.aborted) {
    yield { type: "error", code: "CANCELLED", message: "Request was aborted." };
    return;
  }

  if (!sawAnyText) {
    yield { type: "error", code: "MALFORMED_RESPONSE", message: "Stream ended with no readable text." };
    return;
  }

  yield { type: "done", truncated: finishReason === "length" };
}

export interface MistralTestResult {
  ok: boolean;
  code?: AiErrorCode;
  message?: string;
}

/**
 * Verifies a key works by listing available models (GET), which does not
 * consume generation quota or trigger a billable generation call — the
 * same non-billable-metadata-call approach every other provider's "Test
 * connection" uses.
 */
export async function testMistralConnection(apiKey: string, options: MistralRequestOptions): Promise<MistralTestResult> {
  const url = `${MISTRAL_API_BASE}/models`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      signal: options.signal,
      headers: { Authorization: `Bearer ${apiKey}` }
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
    return { ok: false, code: classifyMistralError(response.status, extractErrorType(body)), message: `Provider returned HTTP ${response.status}.` };
  }

  return { ok: true };
}

/**
 * This provider's adapter conforming to the shared `ProviderAdapter`
 * interface (Phase 9/10/14) — see the matching `GEMINI_PROVIDER`/
 * `OPENAI_PROVIDER`/`ANTHROPIC_PROVIDER` exports. `aiController.ts`
 * dispatches through this interface rather than calling these functions by
 * name.
 */
export const MISTRAL_PROVIDER: ProviderAdapter = {
  id: "mistral",
  sendPrompt: sendMistralPrompt,
  streamPrompt: streamMistralPrompt,
  testConnection: testMistralConnection
};
