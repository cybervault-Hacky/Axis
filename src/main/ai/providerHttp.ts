import type { AiErrorCode } from "../../shared/ai-contract";

/**
 * Small, genuinely shared helpers used by every provider adapter so this
 * one normalization policy — "never forward a raw provider error body, map
 * it to one of AXIS's finite error codes" — is defined exactly once rather
 * than re-implemented per provider.
 */

/** Maps an HTTP error status into a normalized code. Never forwards the raw response body. */
export function classifyHttpError(status: number): AiErrorCode {
  if (status === 401 || status === 403) return "INVALID_CREDENTIALS";
  if (status === 400) return "VALIDATION_ERROR";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "NETWORK_ERROR";
  return "INTERNAL_ERROR";
}

export interface MappedFetchException {
  ok: false;
  code: AiErrorCode;
  message: string;
}

/**
 * Maps a thrown `fetch` exception (network failure or `AbortError`) to a
 * normalized result. A generic abort is reported as `CANCELLED` — the
 * caller (`aiController.ts`) is responsible for promoting this to
 * `TIMEOUT` when its own timer, not the user, triggered the abort.
 */
export function mapFetchException(error: unknown): MappedFetchException {
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return { ok: false, code: "CANCELLED", message: "Request was aborted." };
    }
    return { ok: false, code: "NETWORK_ERROR", message: "Network request failed." };
  }
  return { ok: false, code: "INTERNAL_ERROR", message: "Unexpected error while contacting the provider." };
}
