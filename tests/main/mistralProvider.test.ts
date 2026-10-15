// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MISTRAL_API_BASE,
  MISTRAL_MODEL,
  MISTRAL_PROVIDER,
  parseMistralChatResponse,
  sendMistralPrompt,
  streamMistralPrompt,
  testMistralConnection,
  type MistralStreamChunk
} from "../../src/main/ai/mistralProvider";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Builds an SSE-style fetch Response of the kind Mistral's chat/completions?stream=true returns (OpenAI-compatible shape). */
function sseResponse(events: unknown[], status = 200, withDone = true): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      if (withDone) controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    }
  });
  return new Response(stream, { status });
}

async function collectStream(gen: AsyncGenerator<MistralStreamChunk, void, void>): Promise<MistralStreamChunk[]> {
  const chunks: MistralStreamChunk[] = [];
  for await (const chunk of gen) chunks.push(chunk);
  return chunks;
}

describe("mistralProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exposes a ProviderAdapter with id 'mistral' wired to its own functions", () => {
    expect(MISTRAL_PROVIDER.id).toBe("mistral");
    expect(MISTRAL_PROVIDER.sendPrompt).toBe(sendMistralPrompt);
    expect(MISTRAL_PROVIDER.streamPrompt).toBe(streamMistralPrompt);
    expect(MISTRAL_PROVIDER.testConnection).toBe(testMistralConnection);
  });

  it("authenticates with a Bearer Authorization header and never puts the key in the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { choices: [{ message: { content: "hello" }, finish_reason: "stop" }] })
    );
    vi.stubGlobal("fetch", fetchMock);

    await sendMistralPrompt("secret-key-123456", "Hi", { signal: new AbortController().signal });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${MISTRAL_API_BASE}/chat/completions`);
    expect(url).not.toContain("secret-key-123456");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer secret-key-123456");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(MISTRAL_MODEL);
    expect(body.stream).toBe(false);
    expect(body.messages).toEqual([{ role: "user", content: "Hi" }]);
  });

  it("returns success text with truncated=false for a normal 'stop' response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: "Paris" }, finish_reason: "stop" }] }))
    );
    const result = await sendMistralPrompt("k", "What is the capital of France?", { signal: new AbortController().signal });
    expect(result).toEqual({ ok: true, text: "Paris", truncated: false });
  });

  it("flags a 'length' finish reason as truncated rather than a complete answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: "Once upon a" }, finish_reason: "length" }] }))
    );
    const result = await sendMistralPrompt("k", "Tell a story", { signal: new AbortController().signal });
    expect(result).toEqual({ ok: true, text: "Once upon a", truncated: true });
  });

  it("reports unrecognized response shapes honestly instead of guessing at content", () => {
    expect(parseMistralChatResponse({ unexpected: true })).toEqual({
      ok: false,
      code: "MALFORMED_RESPONSE",
      message: expect.any(String)
    });
    expect(parseMistralChatResponse(null)).toMatchObject({ ok: false, code: "MALFORMED_RESPONSE" });
    expect(parseMistralChatResponse({ choices: [] })).toMatchObject({ ok: false, code: "MALFORMED_RESPONSE" });
  });

  it("reports a non-JSON body as malformed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json at all", { status: 200 })));
    const result = await sendMistralPrompt("k", "...", { signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("MALFORMED_RESPONSE");
  });

  it("maps HTTP 401 to INVALID_CREDENTIALS without echoing the response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "secret details", type: "authentication_error" }), { status: 401 }))
    );
    const result = await sendMistralPrompt("bad-key", "Hi", { signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_CREDENTIALS");
      expect(result.message).not.toContain("secret details");
    }
  });

  it("maps HTTP 422 (Mistral's validation-error status, unlike OpenAI's 400) to VALIDATION_ERROR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ object: "error", message: { detail: [{ type: "extra_forbidden" }] }, type: "invalid_request_error" }),
          { status: 422 }
        )
      )
    );
    const result = await sendMistralPrompt("k", "Hi", { signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("classifies an 'invalid_request_error' type as VALIDATION_ERROR even off an unrelated status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ type: "invalid_request_error", message: "bad field" }), { status: 400 }))
    );
    const result = await sendMistralPrompt("k", "Hi", { signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("maps HTTP 429 to RATE_LIMITED", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 429 })));
    const result = await sendMistralPrompt("k", "Hi", { signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("RATE_LIMITED");
  });

  it("maps a 5xx response to NETWORK_ERROR", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    const result = await sendMistralPrompt("k", "Hi", { signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NETWORK_ERROR");
  });

  it("maps a thrown network exception to NETWORK_ERROR", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const result = await sendMistralPrompt("k", "Hi", { signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NETWORK_ERROR");
  });

  it("reports an aborted fetch as cancelled at the provider layer", async () => {
    const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));
    const result = await sendMistralPrompt("k", "Hi", { signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CANCELLED");
  });

  it("maps AXIS 'model' history role to Mistral's 'assistant' role, ahead of the new prompt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: "4" }, finish_reason: "stop" }] }));
    vi.stubGlobal("fetch", fetchMock);

    await sendMistralPrompt("k", "And 2+2?", {
      signal: new AbortController().signal,
      history: [
        { role: "user", text: "What is 2+2?" },
        { role: "model", text: "4" }
      ]
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.messages).toEqual([
      { role: "user", content: "What is 2+2?" },
      { role: "assistant", content: "4" },
      { role: "user", content: "And 2+2?" }
    ]);
  });

  it("tests the connection with a GET to /models (not a billable generation call) using Bearer auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await testMistralConnection("k-123", { signal: new AbortController().signal });
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${MISTRAL_API_BASE}/models`);
    expect(url).not.toContain("k-123");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer k-123");
  });

  it("test-connection maps an invalid key to INVALID_CREDENTIALS", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 401 })));
    const result = await testMistralConnection("bad", { signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("INVALID_CREDENTIALS");
  });
});

describe("streamMistralPrompt (real provider streaming, no timer/character-reveal simulation)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("authenticates with Bearer auth, sets stream:true, and never puts the key in the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await collectStream(streamMistralPrompt("secret-key-999", "Hi", { signal: new AbortController().signal }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${MISTRAL_API_BASE}/chat/completions`);
    expect(url).not.toContain("secret-key-999");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer secret-key-999");
    const body = JSON.parse(init.body as string);
    expect(body.stream).toBe(true);
  });

  it("yields incremental delta chunks followed by exactly one done chunk for a normal multi-event stream, ending at [DONE]", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          { choices: [{ delta: { content: "Hel" } }] },
          { choices: [{ delta: { content: "lo " } }] },
          { choices: [{ delta: { content: "world" }, finish_reason: "stop" }] }
        ])
      )
    );

    const chunks = await collectStream(streamMistralPrompt("k", "Hi", { signal: new AbortController().signal }));
    expect(chunks).toEqual([
      { type: "delta", text: "Hel" },
      { type: "delta", text: "lo " },
      { type: "delta", text: "world" },
      { type: "done", truncated: false }
    ]);
  });

  it("flags a 'length' finish reason on the final event as truncated", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(sseResponse([{ choices: [{ delta: { content: "Once upon a" }, finish_reason: "length" }] }]))
    );
    const chunks = await collectStream(streamMistralPrompt("k", "Tell a story", { signal: new AbortController().signal }));
    expect(chunks.at(-1)).toEqual({ type: "done", truncated: true });
  });

  it("skips a single malformed SSE event without aborting the rest of the stream", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: {not valid json\n\n"));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] })}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream, { status: 200 })));
    const chunks = await collectStream(streamMistralPrompt("k", "Hi", { signal: new AbortController().signal }));
    expect(chunks).toEqual([{ type: "delta", text: "ok" }, { type: "done", truncated: false }]);
  });

  it("maps an HTTP error status to a normalized error chunk without starting to read a body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 429 })));
    const chunks = await collectStream(streamMistralPrompt("k", "Hi", { signal: new AbortController().signal }));
    expect(chunks).toEqual([{ type: "error", code: "RATE_LIMITED", message: expect.any(String) }]);
  });

  it("maps a mid-request HTTP 422 to a VALIDATION_ERROR error chunk", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ type: "invalid_request_error" }), { status: 422 }))
    );
    const chunks = await collectStream(streamMistralPrompt("k", "Hi", { signal: new AbortController().signal }));
    expect(chunks).toEqual([{ type: "error", code: "VALIDATION_ERROR", message: expect.any(String) }]);
  });

  it("reports CANCELLED (never a fabricated done) when the signal aborts mid-stream", async () => {
    const encoder = new TextEncoder();
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "partial" } }] })}\n\n`));
        // Deliberately never closes — the test aborts instead.
      }
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream, { status: 200 })));

    const gen = streamMistralPrompt("k", "Hi", { signal: controller.signal });
    const chunks: MistralStreamChunk[] = [];
    const first = await gen.next();
    if (!first.done) chunks.push(first.value);
    controller.abort();
    for await (const chunk of gen) chunks.push(chunk);

    expect(chunks[0]).toEqual({ type: "delta", text: "partial" });
    expect(chunks.at(-1)).toEqual({ type: "error", code: "CANCELLED", message: expect.any(String) });
  });
});
