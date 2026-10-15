// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GEMINI_API_BASE,
  GEMINI_MODEL,
  parseGenerateContentResponse,
  sendGeminiPrompt,
  streamGeminiPrompt,
  testGeminiConnection,
  type GeminiStreamChunk
} from "../../src/main/ai/geminiProvider";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Builds an SSE-style fetch Response of the kind Gemini's streamGenerateContent?alt=sse returns. */
function sseResponse(events: unknown[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    }
  });
  return new Response(stream, { status });
}

async function collectStream(gen: AsyncGenerator<GeminiStreamChunk, void, void>): Promise<GeminiStreamChunk[]> {
  const chunks: GeminiStreamChunk[] = [];
  for await (const chunk of gen) chunks.push(chunk);
  return chunks;
}

describe("geminiProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("authenticates with the x-goog-api-key header and never puts the key in the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { candidates: [{ content: { parts: [{ text: "hello" }] }, finishReason: "STOP" }] })
    );
    vi.stubGlobal("fetch", fetchMock);

    await sendGeminiPrompt("secret-key-123456", "Hi", { signal: new AbortController().signal });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent`);
    expect(url).not.toContain("secret-key-123456");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("secret-key-123456");
    // The body must be well-formed single-turn JSON, not query-string encoded.
    const body = JSON.parse(init.body as string);
    expect(body.contents[0].parts[0].text).toBe("Hi");
  });

  it("returns success text with truncated=false for a normal STOP response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { candidates: [{ content: { parts: [{ text: "Paris" }] }, finishReason: "STOP" }] }))
    );
    const result = await sendGeminiPrompt("k", "What is the capital of France?", { signal: new AbortController().signal });
    expect(result).toEqual({ ok: true, text: "Paris", truncated: false });
  });

  it("flags a MAX_TOKENS finish reason as truncated rather than a complete answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, { candidates: [{ content: { parts: [{ text: "Once upon a" }] }, finishReason: "MAX_TOKENS" }] })
      )
    );
    const result = await sendGeminiPrompt("k", "Tell a story", { signal: new AbortController().signal });
    expect(result).toEqual({ ok: true, text: "Once upon a", truncated: true });
  });

  it("treats a safety block as a normalized error, never a fabricated answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { promptFeedback: { blockReason: "SAFETY" }, candidates: [] })));
    const result = await sendGeminiPrompt("k", "...", { signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("BLOCKED_BY_PROVIDER");
  });

  it("reports an empty-text SAFETY-finished candidate as blocked, not malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { candidates: [{ content: { parts: [] }, finishReason: "SAFETY" }] }))
    );
    const result = await sendGeminiPrompt("k", "...", { signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("BLOCKED_BY_PROVIDER");
  });

  it("reports unrecognized response shapes honestly instead of guessing at content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: true })));
    const result = await sendGeminiPrompt("k", "...", { signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("MALFORMED_RESPONSE");
  });

  it("reports a non-JSON body as malformed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json at all", { status: 200 })));
    const result = await sendGeminiPrompt("k", "...", { signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("MALFORMED_RESPONSE");
  });

  it("maps HTTP 401 to INVALID_CREDENTIALS without echoing the response body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unauthorized body with secret details", { status: 401 })));
    const result = await sendGeminiPrompt("bad-key", "Hi", { signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_CREDENTIALS");
      expect(result.message).not.toContain("secret details");
    }
  });

  it("maps HTTP 429 to RATE_LIMITED", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 429 })));
    const result = await sendGeminiPrompt("k", "Hi", { signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("RATE_LIMITED");
  });

  it("maps a 5xx response to NETWORK_ERROR", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    const result = await sendGeminiPrompt("k", "Hi", { signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NETWORK_ERROR");
  });

  it("maps a thrown network exception to NETWORK_ERROR", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const result = await sendGeminiPrompt("k", "Hi", { signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NETWORK_ERROR");
  });

  it("reports an aborted fetch as cancelled at the provider layer", async () => {
    const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));
    const result = await sendGeminiPrompt("k", "Hi", { signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CANCELLED");
  });

  it("includes bounded prior turns in the contents array ahead of the new prompt when history is supplied", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { candidates: [{ content: { parts: [{ text: "4" }] }, finishReason: "STOP" }] })
    );
    vi.stubGlobal("fetch", fetchMock);

    await sendGeminiPrompt("k", "And 2+2?", {
      signal: new AbortController().signal,
      history: [
        { role: "user", text: "What is 2+2?" },
        { role: "model", text: "4" }
      ]
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.contents).toHaveLength(3);
    expect(body.contents[0]).toEqual({ role: "user", parts: [{ text: "What is 2+2?" }] });
    expect(body.contents[1]).toEqual({ role: "model", parts: [{ text: "4" }] });
    expect(body.contents[2]).toEqual({ role: "user", parts: [{ text: "And 2+2?" }] });
  });

  it("sends exactly one turn (no empty history array) when no history is supplied, matching the Phase 3 request shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { candidates: [{ content: { parts: [{ text: "hi" }] }, finishReason: "STOP" }] })
    );
    vi.stubGlobal("fetch", fetchMock);
    await sendGeminiPrompt("k", "Hi", { signal: new AbortController().signal });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.contents).toEqual([{ role: "user", parts: [{ text: "Hi" }] }]);
  });

  it("tests the connection with a GET to model metadata (not a billable generation call) using header auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await testGeminiConnection("k-123", { signal: new AbortController().signal });
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${GEMINI_API_BASE}/models/${GEMINI_MODEL}`);
    expect(url).not.toContain("k-123");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("k-123");
  });

  it("test-connection maps an invalid key to INVALID_CREDENTIALS", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 403 })));
    const result = await testGeminiConnection("bad", { signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("INVALID_CREDENTIALS");
  });
});

describe("streamGeminiPrompt (real provider streaming, no timer/character-reveal simulation)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("authenticates with the header, uses the streamGenerateContent?alt=sse endpoint, and never puts the key in the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await collectStream(streamGeminiPrompt("secret-key-999", "Hi", { signal: new AbortController().signal }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${GEMINI_API_BASE}/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse`);
    expect(url).not.toContain("secret-key-999");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("secret-key-999");
  });

  it("yields incremental delta chunks followed by exactly one done chunk for a normal multi-event stream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          { candidates: [{ content: { parts: [{ text: "Hel" }] } }] },
          { candidates: [{ content: { parts: [{ text: "lo " }] } }] },
          { candidates: [{ content: { parts: [{ text: "world" }] }, finishReason: "STOP" }] }
        ])
      )
    );

    const chunks = await collectStream(streamGeminiPrompt("k", "Hi", { signal: new AbortController().signal }));
    expect(chunks).toEqual([
      { type: "delta", text: "Hel" },
      { type: "delta", text: "lo " },
      { type: "delta", text: "world" },
      { type: "done", truncated: false }
    ]);
  });

  it("flags a MAX_TOKENS finishReason on the final event as truncated", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([{ candidates: [{ content: { parts: [{ text: "Once upon a" }] }, finishReason: "MAX_TOKENS" }] }])
      )
    );
    const chunks = await collectStream(streamGeminiPrompt("k", "Tell a story", { signal: new AbortController().signal }));
    expect(chunks.at(-1)).toEqual({ type: "done", truncated: true });
  });

  it("reports a safety block with no text as BLOCKED_BY_PROVIDER, never a fabricated answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(sseResponse([{ promptFeedback: { blockReason: "SAFETY" }, candidates: [] }]))
    );
    const chunks = await collectStream(streamGeminiPrompt("k", "...", { signal: new AbortController().signal }));
    expect(chunks).toEqual([{ type: "error", code: "BLOCKED_BY_PROVIDER", message: expect.any(String) }]);
  });

  it("skips a single malformed SSE event without aborting the rest of the stream", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: {not valid json\n\n"));
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }] })}\n\n`)
        );
        controller.close();
      }
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream, { status: 200 })));
    const chunks = await collectStream(streamGeminiPrompt("k", "Hi", { signal: new AbortController().signal }));
    expect(chunks).toEqual([{ type: "delta", text: "ok" }, { type: "done", truncated: false }]);
  });

  it("maps an HTTP error status to a normalized error chunk without starting to read a body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 })));
    const chunks = await collectStream(streamGeminiPrompt("bad-key", "Hi", { signal: new AbortController().signal }));
    expect(chunks).toEqual([{ type: "error", code: "INVALID_CREDENTIALS", message: expect.any(String) }]);
  });

  it("maps a thrown network exception before any connection to NETWORK_ERROR", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const chunks = await collectStream(streamGeminiPrompt("k", "Hi", { signal: new AbortController().signal }));
    expect(chunks).toEqual([{ type: "error", code: "NETWORK_ERROR", message: expect.any(String) }]);
  });

  it("stops reading and reports CANCELLED as soon as the signal is aborted mid-stream, never completing the answer", async () => {
    const encoder = new TextEncoder();
    let cancelledByReader = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "partial" }] } }] })}\n\n`));
        // Keep the stream open indefinitely until the reader is cancelled —
        // simulates a slow/ongoing generation the user cancels mid-flight.
        await new Promise<void>((resolve) => {
          const check = setInterval(() => {
            if (cancelledByReader) {
              clearInterval(check);
              resolve();
            }
          }, 5);
        });
        controller.close();
      },
      cancel() {
        cancelledByReader = true;
      }
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream, { status: 200 })));

    const controller = new AbortController();
    const gen = streamGeminiPrompt("k", "Hi", { signal: controller.signal });
    const chunks: GeminiStreamChunk[] = [];
    const first = await gen.next();
    expect(first.value).toEqual({ type: "delta", text: "partial" });
    chunks.push(first.value as GeminiStreamChunk);

    controller.abort();
    for await (const chunk of gen) chunks.push(chunk);

    expect(chunks).toEqual([{ type: "delta", text: "partial" }, { type: "error", code: "CANCELLED", message: expect.any(String) }]);
  });
});

describe("parseGenerateContentResponse", () => {
  it("rejects a non-object body", () => {
    const result = parseGenerateContentResponse("not an object");
    expect(result.ok).toBe(false);
  });

  it("rejects a body with no candidates", () => {
    const result = parseGenerateContentResponse({ candidates: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("MALFORMED_RESPONSE");
  });
});
