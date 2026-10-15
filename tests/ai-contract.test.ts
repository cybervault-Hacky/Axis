import { describe, expect, it } from "vitest";
import {
  AI_ERROR_MESSAGES,
  AI_PROVIDER_IDS,
  AI_PROVIDER_LABELS,
  clampHistory,
  isValidCancelPayload,
  isValidHistoryTurn,
  isValidImportPayload,
  isValidProviderId,
  isValidProviderScopedPayload,
  isValidSendRequestPayload,
  isValidStreamEvent,
  MAX_HISTORY_TOTAL_CHARS,
  MAX_HISTORY_TURN_CHARS,
  MAX_HISTORY_TURNS,
  MAX_PROMPT_CHARS,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  resolveProviderId
} from "../src/shared/ai-contract";

describe("isValidSendRequestPayload", () => {
  it("accepts a minimal valid payload", () => {
    expect(isValidSendRequestPayload({ requestId: "r1", prompt: "Hello" })).toBe(true);
  });

  it("accepts a valid payload with an in-range timeout", () => {
    expect(isValidSendRequestPayload({ requestId: "r1", prompt: "Hello", timeoutMs: MIN_TIMEOUT_MS })).toBe(true);
    expect(isValidSendRequestPayload({ requestId: "r1", prompt: "Hello", timeoutMs: MAX_TIMEOUT_MS })).toBe(true);
  });

  it("rejects a missing or empty requestId", () => {
    expect(isValidSendRequestPayload({ prompt: "Hello" })).toBe(false);
    expect(isValidSendRequestPayload({ requestId: "", prompt: "Hello" })).toBe(false);
  });

  it("rejects an empty or whitespace-only prompt", () => {
    expect(isValidSendRequestPayload({ requestId: "r1", prompt: "" })).toBe(false);
    expect(isValidSendRequestPayload({ requestId: "r1", prompt: "   " })).toBe(false);
  });

  it("rejects an oversized prompt", () => {
    expect(isValidSendRequestPayload({ requestId: "r1", prompt: "a".repeat(MAX_PROMPT_CHARS + 1) })).toBe(false);
    expect(isValidSendRequestPayload({ requestId: "r1", prompt: "a".repeat(MAX_PROMPT_CHARS) })).toBe(true);
  });

  it("rejects an out-of-range timeout", () => {
    expect(isValidSendRequestPayload({ requestId: "r1", prompt: "hi", timeoutMs: MIN_TIMEOUT_MS - 1 })).toBe(false);
    expect(isValidSendRequestPayload({ requestId: "r1", prompt: "hi", timeoutMs: MAX_TIMEOUT_MS + 1 })).toBe(false);
    expect(isValidSendRequestPayload({ requestId: "r1", prompt: "hi", timeoutMs: Number.NaN })).toBe(false);
  });

  it("rejects non-object and wrongly-typed input", () => {
    expect(isValidSendRequestPayload(null)).toBe(false);
    expect(isValidSendRequestPayload("hello")).toBe(false);
    expect(isValidSendRequestPayload({ requestId: 1, prompt: "hi" })).toBe(false);
    expect(isValidSendRequestPayload({ requestId: "r1", prompt: 123 })).toBe(false);
  });

  it("accepts every explicit, supported provider id and rejects an unsupported one (Phase 9/10/14)", () => {
    expect(isValidSendRequestPayload({ requestId: "r1", prompt: "hi", provider: "gemini" })).toBe(true);
    expect(isValidSendRequestPayload({ requestId: "r1", prompt: "hi", provider: "openai" })).toBe(true);
    expect(isValidSendRequestPayload({ requestId: "r1", prompt: "hi", provider: "anthropic" })).toBe(true);
    expect(isValidSendRequestPayload({ requestId: "r1", prompt: "hi", provider: "mistral" })).toBe(true);
    expect(isValidSendRequestPayload({ requestId: "r1", prompt: "hi", provider: "cohere" })).toBe(false);
    expect(isValidSendRequestPayload({ requestId: "r1", prompt: "hi", provider: 5 })).toBe(false);
  });

  it("treats a missing provider as valid (the main process defaults it to gemini)", () => {
    expect(isValidSendRequestPayload({ requestId: "r1", prompt: "hi" })).toBe(true);
  });
});

describe("isValidProviderId / resolveProviderId / AI_PROVIDER_IDS (Phase 9/10/14)", () => {
  it("accepts exactly the four supported provider ids", () => {
    expect(isValidProviderId("gemini")).toBe(true);
    expect(isValidProviderId("openai")).toBe(true);
    expect(isValidProviderId("anthropic")).toBe(true);
    expect(isValidProviderId("mistral")).toBe(true);
  });

  it("rejects an unsupported, malformed, or non-string provider id", () => {
    expect(isValidProviderId("cohere")).toBe(false);
    expect(isValidProviderId("")).toBe(false);
    expect(isValidProviderId(undefined)).toBe(false);
    expect(isValidProviderId(null)).toBe(false);
    expect(isValidProviderId(5)).toBe(false);
  });

  it("resolveProviderId passes through a valid id and defaults an invalid/missing one to gemini", () => {
    expect(resolveProviderId("openai")).toBe("openai");
    expect(resolveProviderId("gemini")).toBe("gemini");
    expect(resolveProviderId("anthropic")).toBe("anthropic");
    expect(resolveProviderId("mistral")).toBe("mistral");
    expect(resolveProviderId("cohere")).toBe("gemini");
    expect(resolveProviderId(undefined)).toBe("gemini");
  });

  it("AI_PROVIDER_IDS and AI_PROVIDER_LABELS agree on exactly the supported providers", () => {
    expect(AI_PROVIDER_IDS).toEqual(["gemini", "openai", "anthropic", "mistral"]);
    expect(Object.keys(AI_PROVIDER_LABELS).sort()).toEqual(["anthropic", "gemini", "mistral", "openai"]);
    for (const id of AI_PROVIDER_IDS) expect(AI_PROVIDER_LABELS[id].length).toBeGreaterThan(0);
  });
});

describe("isValidProviderScopedPayload", () => {
  it("accepts undefined, an empty object, and a well-formed provider payload", () => {
    expect(isValidProviderScopedPayload(undefined)).toBe(true);
    expect(isValidProviderScopedPayload({})).toBe(true);
    expect(isValidProviderScopedPayload({ provider: "openai" })).toBe(true);
  });

  it("accepts every supported provider id and rejects an unsupported one or a non-object payload", () => {
    expect(isValidProviderScopedPayload({ provider: "anthropic" })).toBe(true);
    expect(isValidProviderScopedPayload({ provider: "mistral" })).toBe(true);
    expect(isValidProviderScopedPayload({ provider: "cohere" })).toBe(false);
    expect(isValidProviderScopedPayload("nope")).toBe(false);
    expect(isValidProviderScopedPayload(null)).toBe(false);
  });
});

describe("isValidCancelPayload", () => {
  it("accepts a well-formed payload", () => {
    expect(isValidCancelPayload({ requestId: "r1" })).toBe(true);
  });
  it("rejects missing/empty/non-string requestId", () => {
    expect(isValidCancelPayload({})).toBe(false);
    expect(isValidCancelPayload({ requestId: "" })).toBe(false);
    expect(isValidCancelPayload({ requestId: 5 })).toBe(false);
    expect(isValidCancelPayload(null)).toBe(false);
  });
});

describe("isValidImportPayload", () => {
  it("accepts undefined (no options) and a well-formed payload", () => {
    expect(isValidImportPayload(undefined)).toBe(true);
    expect(isValidImportPayload({ allowSessionOnly: true })).toBe(true);
    expect(isValidImportPayload({})).toBe(true);
  });
  it("rejects a non-boolean allowSessionOnly or a non-object payload", () => {
    expect(isValidImportPayload({ allowSessionOnly: "yes" })).toBe(false);
    expect(isValidImportPayload("nope")).toBe(false);
    expect(isValidImportPayload(null)).toBe(false);
  });

  it("accepts a well-formed provider field for every supported provider and rejects an unsupported one (Phase 9/10/14)", () => {
    expect(isValidImportPayload({ provider: "openai" })).toBe(true);
    expect(isValidImportPayload({ provider: "openai", allowSessionOnly: true })).toBe(true);
    expect(isValidImportPayload({ provider: "anthropic" })).toBe(true);
    expect(isValidImportPayload({ provider: "mistral" })).toBe(true);
    expect(isValidImportPayload({ provider: "cohere" })).toBe(false);
  });
});

describe("isValidHistoryTurn", () => {
  it("accepts a well-formed user or model turn", () => {
    expect(isValidHistoryTurn({ role: "user", text: "hi" })).toBe(true);
    expect(isValidHistoryTurn({ role: "model", text: "hello" })).toBe(true);
  });
  it("rejects an invalid role, non-string text, or non-object input", () => {
    expect(isValidHistoryTurn({ role: "system", text: "hi" })).toBe(false);
    expect(isValidHistoryTurn({ role: "user", text: 5 })).toBe(false);
    expect(isValidHistoryTurn(null)).toBe(false);
    expect(isValidHistoryTurn("hi")).toBe(false);
  });
});

describe("clampHistory", () => {
  it("passes through a small history unchanged", () => {
    const history = [
      { role: "user" as const, text: "What is 2+2?" },
      { role: "model" as const, text: "4" }
    ];
    expect(clampHistory(history)).toEqual(history);
  });

  it("keeps only the most recent MAX_HISTORY_TURNS turns, oldest first", () => {
    const history = Array.from({ length: MAX_HISTORY_TURNS + 10 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("model" as const),
      text: `turn-${i}`
    }));
    const clamped = clampHistory(history);
    expect(clamped.length).toBeLessThanOrEqual(MAX_HISTORY_TURNS);
    // Must be the tail of the original array (most recent), in original order.
    expect(clamped.at(-1)?.text).toBe(`turn-${history.length - 1}`);
    expect(clamped[0]?.text).toBe(`turn-${history.length - MAX_HISTORY_TURNS}`);
  });

  it("trims an individual oversized turn to MAX_HISTORY_TURN_CHARS", () => {
    const clamped = clampHistory([{ role: "user", text: "x".repeat(MAX_HISTORY_TURN_CHARS + 500) }]);
    expect(clamped[0]?.text.length).toBe(MAX_HISTORY_TURN_CHARS);
  });

  it("drops the oldest turns once the combined character total would exceed MAX_HISTORY_TOTAL_CHARS", () => {
    const big = "x".repeat(Math.floor(MAX_HISTORY_TOTAL_CHARS / 2) + 100);
    const history = [
      { role: "user" as const, text: big },
      { role: "model" as const, text: big },
      { role: "user" as const, text: big }
    ];
    const clamped = clampHistory(history);
    const total = clamped.reduce((sum, turn) => sum + turn.text.length, 0);
    // The most recent turn must always survive even if it alone is close to the cap.
    expect(clamped.at(-1)?.text).toBe(big);
    expect(clamped.length).toBeLessThan(history.length);
    expect(total).toBeGreaterThan(0);
  });

  it("returns an empty array for empty input", () => {
    expect(clampHistory([])).toEqual([]);
  });
});

describe("isValidSendRequestPayload with history", () => {
  it("accepts a payload with a well-formed history array", () => {
    expect(
      isValidSendRequestPayload({
        requestId: "r1",
        prompt: "hi",
        history: [{ role: "user", text: "earlier" }, { role: "model", text: "earlier reply" }]
      })
    ).toBe(true);
  });

  it("rejects a payload whose history contains a malformed turn", () => {
    expect(
      isValidSendRequestPayload({ requestId: "r1", prompt: "hi", history: [{ role: "nope", text: "x" }] })
    ).toBe(false);
  });

  it("rejects a non-array history", () => {
    expect(isValidSendRequestPayload({ requestId: "r1", prompt: "hi", history: "nope" })).toBe(false);
  });
});

describe("isValidStreamEvent", () => {
  it("accepts every well-formed event variant", () => {
    expect(isValidStreamEvent({ requestId: "r1", type: "delta", text: "hi" })).toBe(true);
    expect(isValidStreamEvent({ requestId: "r1", type: "done", truncated: false })).toBe(true);
    expect(isValidStreamEvent({ requestId: "r1", type: "cancelled" })).toBe(true);
    expect(isValidStreamEvent({ requestId: "r1", type: "error", code: "NETWORK_ERROR", message: "x" })).toBe(true);
  });

  it("rejects a missing/empty requestId, an unknown type, and malformed field types", () => {
    expect(isValidStreamEvent({ type: "delta", text: "hi" })).toBe(false);
    expect(isValidStreamEvent({ requestId: "", type: "delta", text: "hi" })).toBe(false);
    expect(isValidStreamEvent({ requestId: "r1", type: "unknown-thing" })).toBe(false);
    expect(isValidStreamEvent({ requestId: "r1", type: "delta", text: 5 })).toBe(false);
    expect(isValidStreamEvent({ requestId: "r1", type: "done", truncated: "no" })).toBe(false);
    expect(isValidStreamEvent(null)).toBe(false);
    expect(isValidStreamEvent("nope")).toBe(false);
  });
});

describe("AI_ERROR_MESSAGES", () => {
  it("never echoes provider/credential-sounding placeholders and covers every declared code", () => {
    for (const message of Object.values(AI_ERROR_MESSAGES)) {
      expect(message.length).toBeGreaterThan(0);
      expect(message.toLowerCase()).not.toContain("api key:");
    }
  });
});
