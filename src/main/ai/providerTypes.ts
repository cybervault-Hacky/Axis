import type { AiErrorCode, AiHistoryTurn, AiProviderId } from "../../shared/ai-contract";

/**
 * Common provider adapter shape (Phase 9).
 *
 * Every AI provider AXIS supports (Gemini, OpenAI) implements this same
 * three-method surface. `aiController.ts` only ever calls through this
 * interface — it never branches on "if gemini do X, if openai do Y" for
 * the request lifecycle itself (validation, single-flight tracking,
 * timeout/`AbortController` wiring, the streaming relay over
 * `axis:ai:stream-event`). All of that stays defined exactly once.
 *
 * Everything provider-specific — the HTTP request shape, auth header,
 * response parsing, SSE framing, and how a given HTTP status or response
 * shape maps to one of AXIS's normalized `AiErrorCode`s — stays inside
 * that provider's own module (`geminiProvider.ts`, `openaiProvider.ts`)
 * and is never duplicated here.
 */
export interface ProviderRequestOptions {
  signal: AbortSignal;
  model?: string;
  /** Bounded prior turns, oldest first. Already clamped by the caller. */
  history?: AiHistoryTurn[];
}

export interface ProviderCallOk {
  ok: true;
  text: string;
  truncated: boolean;
}

export interface ProviderCallErr {
  ok: false;
  code: AiErrorCode;
  message: string;
}

export type ProviderCallResult = ProviderCallOk | ProviderCallErr;

export type ProviderStreamChunk =
  | { type: "delta"; text: string }
  | { type: "done"; truncated: boolean }
  | { type: "error"; code: AiErrorCode; message: string };

export interface ProviderTestResult {
  ok: boolean;
  code?: AiErrorCode;
  message?: string;
}

export interface ProviderAdapter {
  id: AiProviderId;
  sendPrompt(apiKey: string, prompt: string, options: ProviderRequestOptions): Promise<ProviderCallResult>;
  streamPrompt(apiKey: string, prompt: string, options: ProviderRequestOptions): AsyncGenerator<ProviderStreamChunk, void, void>;
  testConnection(apiKey: string, options: ProviderRequestOptions): Promise<ProviderTestResult>;
}
