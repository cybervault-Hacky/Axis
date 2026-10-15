import type { AiErrorCode, AiHistoryTurn } from "../../shared/ai-contract";
import { classifyHttpError, mapFetchException } from "./providerHttp";
import type { ProviderAdapter } from "./providerTypes";

/**
 * OpenAI Chat Completions API client (main process only; Phase 9).
 *
 * Reference: https://platform.openai.com/docs/api-reference/chat
 *  - Auth: the API key is sent via the standard `Authorization: Bearer`
 *    HTTP header. It is NEVER appended to the URL as a query parameter,
 *    logged, or echoed back to the renderer — identical policy to Gemini.
 *  - Endpoint: POST {base}/chat/completions (non-streaming and, with
 *    `stream: true`, Server-Sent Events).
 *  - A lightweight GET {base}/models call (metadata only, not a generation
 *    call) is used for "Test connection", mirroring Gemini's model-metadata
 *    GET, so testing a key does not spend generation quota.
 *
 * This module never logs the API key or full prompt text, and only ever
 * returns a small, normalized result — never a raw provider error body —
 * exactly like geminiProvider.ts. The two modules intentionally do not
 * share request/response parsing (OpenAI's `choices[].delta.content` SSE
 * shape and `[DONE]` sentinel are nothing like Gemini's `candidates[]`
 * shape), only the small `classifyHttpError`/`mapFetchException` helpers in
 * `providerHttp.ts` and the `ProviderAdapter` interface itself.
 */

export const OPENAI_API_BASE = "https://api.openai.com/v1";

/**
 * Default model. Chosen for broad availability and low cost at
 * implementation time. If OpenAI retires this model id, update this one
 * constant — nothing else in AXIS needs to change.
 */
export const OPENAI_MODEL = "gpt-4o-mini";

export interface OpenAiCallOk {
  ok: true;
  text: string;
  truncated: boolean;
}

export interface OpenAiCallErr {
  ok: false;
  code: AiErrorCode;
  message: string;
}

export type OpenAiCallResult = OpenAiCallOk | OpenAiCallErr;

interface OpenAiChoice {
  message?: { content?: unknown };
  finish_reason?: unknown;
}

interface OpenAiChatCompletionResponse {
  choices?: OpenAiChoice[];
}

interface OpenAiErrorBody {
  error?: { message?: unknown; code?: unknown; type?: unknown };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Validates and extracts text from a parsed OpenAI chat/completions
 * response body. Never throws — any unexpected shape is reported as a
 * normalized error rather than displayed or guessed at.
 */
export function parseChatCompletionResponse(json: unknown): OpenAiCallResult {
  if (!isRecord(json)) {
    return { ok: false, code: "MALFORMED_RESPONSE", message: "Response body was not a JSON object." };
  }
  const body = json as OpenAiChatCompletionResponse;

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
    if (finishReason === "content_filter") {
      return { ok: false, code: "BLOCKED_BY_PROVIDER", message: "Provider withheld the response (content_filter)." };
    }
    return { ok: false, code: "MALFORMED_RESPONSE", message: "Response contained no readable text." };
  }

  const truncated = finishReason === "length";
  return { ok: true, text, truncated };
}

/** Best-effort extraction of a safe (non-secret) error message from an OpenAI error body, for classification only. */
function extractErrorType(json: unknown): string | undefined {
  if (!isRecord(json)) return undefined;
  const body = json as OpenAiErrorBody;
  return isRecord(body.error) && typeof body.error["code"] === "string" ? (body.error["code"] as string) : undefined;
}

export interface OpenAiRequestOptions {
  signal: AbortSignal;
  model?: string;
  /**
   * Bounded prior turns (Phase 4 conversation context), oldest first. The
   * caller (aiController) is responsible for bounding this with
   * `clampHistory` before it ever reaches this module.
   */
  history?: AiHistoryTurn[];
}

/** Builds OpenAI's `messages` array from bounded history plus the new prompt. AXIS's "model" role maps to OpenAI's "assistant". */
function buildMessages(history: AiHistoryTurn[] | undefined, prompt: string): Array<{ role: string; content: string }> {
  const messages = (history ?? []).map((turn) => ({ role: turn.role === "model" ? "assistant" : "user", content: turn.text }));
  messages.push({ role: "user", content: prompt });
  return messages;
}

/**
 * Sends a prompt to OpenAI, optionally with bounded prior conversation
 * turns. Mirrors `sendGeminiPrompt`'s shape and behaviour exactly so
 * `aiController.ts` can treat both providers identically through the
 * shared `ProviderAdapter` interface.
 */
export async function sendOpenAiPrompt(
  apiKey: string,
  prompt: string,
  options: OpenAiRequestOptions
): Promise<OpenAiCallResult> {
  const model = options.model ?? OPENAI_MODEL;
  const url = `${OPENAI_API_BASE}/chat/completions`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      signal: options.signal,
      headers: {
        "Content-Type": "application/json",
        // Standard bearer-token auth — the key never appears in the URL.
        Authorization: `Bearer ${apiKey}`
      },
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
    const errorType = extractErrorType(body);
    const code = errorType === "insufficient_quota" ? "RATE_LIMITED" : classifyHttpError(response.status);
    return { ok: false, code, message: `Provider returned HTTP ${response.status}.` };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { ok: false, code: "MALFORMED_RESPONSE", message: "Response body was not valid JSON." };
  }

  return parseChatCompletionResponse(json);
}

/** One event out of a streaming generation. Exactly one terminal event ("done" or "error") ends the stream. */
export type OpenAiStreamChunk =
  | { type: "delta"; text: string }
  | { type: "done"; truncated: boolean }
  | { type: "error"; code: AiErrorCode; message: string };

/**
 * Best-effort extraction of incremental text from one parsed SSE `data:`
 * JSON event (OpenAI's `chat.completion.chunk` shape). Never throws — an
 * unrecognized shape simply yields no text for that one event rather than
 * aborting the whole stream.
 */
function extractStreamEventText(json: unknown): { text: string; finishReason?: string } {
  if (!isRecord(json)) return { text: "" };
  const body = json as OpenAiChatCompletionResponse;
  const choice = Array.isArray(body.choices) ? body.choices[0] : undefined;
  if (typeof choice !== "object" || choice === null) return { text: "" };
  const delta = (choice as { delta?: { content?: unknown } }).delta;
  const text = isRecord(delta) && typeof delta["content"] === "string" ? (delta["content"] as string) : "";
  const finishReason = typeof choice.finish_reason === "string" ? choice.finish_reason : undefined;
  return { text, finishReason };
}

/**
 * Streams a generation from OpenAI via `chat/completions` with
 * `stream: true` (Server-Sent Events). Each `data:` line decodes to one
 * JSON "chunk" event whose `choices[0].delta.content` is a text fragment
 * to append; the stream ends with a literal `data: [DONE]` line. This is
 * real provider streaming — no timer or character-reveal simulation is
 * involved anywhere in this function. Cancellation is honored by
 * cancelling the underlying reader as soon as `options.signal` aborts.
 */
export async function* streamOpenAiPrompt(
  apiKey: string,
  prompt: string,
  options: OpenAiRequestOptions
): AsyncGenerator<OpenAiStreamChunk, void, void> {
  const model = options.model ?? OPENAI_MODEL;
  const url = `${OPENAI_API_BASE}/chat/completions`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      signal: options.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({ model, messages: buildMessages(options.history, prompt), stream: true })
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
    if (finishReason === "content_filter") {
      yield { type: "error", code: "BLOCKED_BY_PROVIDER", message: "Blocked by provider safety filtering." };
    } else {
      yield { type: "error", code: "MALFORMED_RESPONSE", message: "Stream ended with no readable text." };
    }
    return;
  }

  yield { type: "done", truncated: finishReason === "length" };
}

export interface OpenAiTestResult {
  ok: boolean;
  code?: AiErrorCode;
  message?: string;
}

/**
 * Verifies a key works by listing available models (GET), which does not
 * consume generation quota or trigger a billable generation call — the
 * same non-billable-metadata-call approach Gemini's "Test connection" uses.
 */
export async function testOpenAiConnection(apiKey: string, options: OpenAiRequestOptions): Promise<OpenAiTestResult> {
  const url = `${OPENAI_API_BASE}/models`;

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
    return { ok: false, code: classifyHttpError(response.status), message: `Provider returned HTTP ${response.status}.` };
  }

  return { ok: true };
}

/**
 * This provider's adapter conforming to the shared `ProviderAdapter`
 * interface (Phase 9) — see the matching `GEMINI_PROVIDER` export in
 * geminiProvider.ts. `aiController.ts` dispatches through this interface
 * rather than calling these functions by name.
 */
export const OPENAI_PROVIDER: ProviderAdapter = {
  id: "openai",
  sendPrompt: sendOpenAiPrompt,
  streamPrompt: streamOpenAiPrompt,
  testConnection: testOpenAiConnection
};
