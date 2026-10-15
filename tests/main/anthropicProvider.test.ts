// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ANTHROPIC_API_BASE,
  ANTHROPIC_API_VERSION,
  ANTHROPIC_MODEL,
  ANTHROPIC_PROVIDER,
  parseMessagesResponse,
  sendAnthropicPrompt,
  streamAnthropicPrompt,
  testAnthropicConnection,
  type AnthropicStreamChunk
} from "../../src/main/ai/anthropicProvider";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Builds an SSE-style fetch Response of the kind Anthropic's messages?stream=true returns (named events). */
function sseResponse(events: unknown[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        const type = (event as { type?: string }).type ?? "message";
        controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    }
  });
  return new Response(stream, { status });
}

async function collectStream(gen: AsyncGenerator<AnthropicStreamChunk, void, void>): Promise<AnthropicStreamChunk[]> {
  const chunks: AnthropicStreamChunk[] = [];
  for await (const chunk of gen) chunks.push(chunk);
  return chunks;
}

describe("anthropicProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exposes a ProviderAdapter with id 'anthropic' wired to its own functions", () => {
    expect(ANTHROPIC_PROVIDER.id).toBe("anthropic");
    expect(ANTHROPIC_PROVIDER.sendPrompt).toBe(sendAnthropicPrompt);
    expect(ANTHROPIC_PROVIDER.streamPrompt).toBe(streamAnthropicPrompt);
    expect(ANTHROPIC_PROVIDER.testConnection).toBe(testAnthropicConnection);
  });

  it("authenticates with x-api-key + anthropic-version headers and never puts the key in the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { content: [{ type: "text", text: "hello" }], stop_reason: "end_turn" })
    );
    vi.stubGlobal("fetch", fetchMock);

    await sendAnthropicPrompt("secret-key-123456", "Hi", { signal: new AbortController().signal });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${ANTHROPIC_API_BASE}/messages`);
    expect(url).not.toContain("secret-key-123456");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("secret-key-123456");
    expect(headers["anthropic-version"]).toBe(ANTHROPIC_API_VERSION);
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(ANTHROPIC_MODEL);
    expect(body.stream).toBe(false);
    expect(typeof body.max_tokens).toBe("number");
    expect(body.messages).toEqual([{ role: "user", content: "Hi" }]);
  });

  it("returns success text with truncated=false for a normal 'end_turn' response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { content: [{ type: "text", text: "Paris" }], stop_reason: "end_turn" }))
    );
    const result = await sendAnthropicPrompt("k", "What is the capital of France?", { signal: new AbortController().signal });
    expect(result).toEqual({ ok: true, text: "Paris", truncated: false });
  });

  it("joins multiple text content blocks in order", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, { content: [{ type: "text", text: "Hello, " }, { type: "text", text: "world." }], stop_reason: "end_turn" })
      )
    );
    const result = await sendAnthropicPrompt("k", "Hi", { signal: new AbortController().signal });
    expect(result).toEqual({ ok: true, text: "Hello, world.", truncated: false });
  });

  it("flags a 'max_tokens' stop reason as truncated rather than a complete answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { content: [{ type: "text", text: "Once upon a" }], stop_reason: "max_tokens" }))
    );
    const result = await sendAnthropicPrompt("k", "Tell a story", { signal: new AbortController().signal });
    expect(result).toEqual({ ok: true, text: "Once upon a", truncated: true });
  });

  it("treats a 'refusal' stop reason with no text as a normalized error, never a fabricated answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { content: [], stop_reason: "refusal" }))
    );
    const result = await sendAnthropicPrompt("k", "...", { signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("BLOCKED_BY_PROVIDER");
  });

  it("reports unrecognized response shapes honestly instead of guessing at content", () => {
    expect(parseMessagesResponse({ unexpected: true })).toEqual({
      ok: false,
      code: "MALFORMED_RESPONSE",
      message: expect.any(String)
    });
    expect(parseMessagesResponse(null)).toMatchObject({ ok: false, code: "MALFORMED_RESPONSE" });
    expect(parseMessagesResponse({ content: [] })).toMatchObject({ ok: false, code: "MALFORMED_RESPONSE" });
  });

  it("reports a non-JSON body as malformed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json at all", { status: 200 })));
    const result = await sendAnthropicPrompt("k", "...", { signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("MALFORMED_RESPONSE");
  });

  it("maps HTTP 401 (authentication_error) to INVALID_CREDENTIALS without echoing the response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "secret details" } }), { status: 401 })
      )
    );
    const result = await sendAnthropicPrompt("bad-key", "Hi", { signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_CREDENTIALS");
      expect(result.message).not.toContain("secret details");
    }
  });

  it("maps a rate_limit_error body to RATE_LIMITED", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "slow down" } }), { status: 429 })
      )
    );
    const result = await sendAnthropicPrompt("k", "Hi", { signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("RATE_LIMITED");
  });

  it("maps an overloaded_error body (HTTP 529) to NETWORK_ERROR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "overloaded" } }), { status: 529 })
      )
    );
    const result = await sendAnthropicPrompt("k", "Hi", { signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NETWORK_ERROR");
  });

  it("maps a thrown network exception to NETWORK_ERROR", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const result = await sendAnthropicPrompt("k", "Hi", { signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NETWORK_ERROR");
  });

  it("reports an aborted fetch as cancelled at the provider layer", async () => {
    const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));
    const result = await sendAnthropicPrompt("k", "Hi", { signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CANCELLED");
  });

  it("maps AXIS 'model' history role to Anthropic's 'assistant' role, ahead of the new prompt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { content: [{ type: "text", text: "4" }], stop_reason: "end_turn" }));
    vi.stubGlobal("fetch", fetchMock);

    await sendAnthropicPrompt("k", "And 2+2?", {
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

  it("tests the connection with a GET to /models (not a billable generation call) using the same auth headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await testAnthropicConnection("k-123", { signal: new AbortController().signal });
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${ANTHROPIC_API_BASE}/models`);
    expect(url).not.toContain("k-123");
    expect(init.method).toBe("GET");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("k-123");
    expect(headers["anthropic-version"]).toBe(ANTHROPIC_API_VERSION);
  });

  it("test-connection maps an invalid key to INVALID_CREDENTIALS", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ type: "error", error: { type: "authentication_error" } }), { status: 401 })
      )
    );
    const result = await testAnthropicConnection("bad", { signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("INVALID_CREDENTIALS");
  });
});

describe("streamAnthropicPrompt (real provider streaming over Anthropic's named SSE events, no timer/character-reveal simulation)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("authenticates with the same headers, sets stream:true, and never puts the key in the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([{ type: "message_stop" }]));
    vi.stubGlobal("fetch", fetchMock);

    await collectStream(streamAnthropicPrompt("secret-key-999", "Hi", { signal: new AbortController().signal }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${ANTHROPIC_API_BASE}/messages`);
    expect(url).not.toContain("secret-key-999");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("secret-key-999");
    const body = JSON.parse(init.body as string);
    expect(body.stream).toBe(true);
  });

  it("yields incremental text_delta chunks followed by exactly one done chunk for a normal multi-event stream, ending at message_stop", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          { type: "message_start", message: { content: [] } },
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "lo " } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "world" } },
          { type: "content_block_stop", index: 0 },
          { type: "message_delta", delta: { stop_reason: "end_turn" } },
          { type: "message_stop" }
        ])
      )
    );

    const chunks = await collectStream(streamAnthropicPrompt("k", "Hi", { signal: new AbortController().signal }));
    expect(chunks).toEqual([
      { type: "delta", text: "Hel" },
      { type: "delta", text: "lo " },
      { type: "delta", text: "world" },
      { type: "done", truncated: false }
    ]);
  });

  it("ignores ping events without affecting the rest of the stream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          { type: "ping" },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
          { type: "ping" },
          { type: "message_delta", delta: { stop_reason: "end_turn" } },
          { type: "message_stop" }
        ])
      )
    );
    const chunks = await collectStream(streamAnthropicPrompt("k", "Hi", { signal: new AbortController().signal }));
    expect(chunks).toEqual([{ type: "delta", text: "ok" }, { type: "done", truncated: false }]);
  });

  it("flags a 'max_tokens' stop reason on message_delta as truncated", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Once upon a" } },
          { type: "message_delta", delta: { stop_reason: "max_tokens" } },
          { type: "message_stop" }
        ])
      )
    );
    const chunks = await collectStream(streamAnthropicPrompt("k", "Tell a story", { signal: new AbortController().signal }));
    expect(chunks.at(-1)).toEqual({ type: "done", truncated: true });
  });

  it("reports a 'refusal' stop reason with no text as BLOCKED_BY_PROVIDER, never a fabricated answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([{ type: "message_delta", delta: { stop_reason: "refusal" } }, { type: "message_stop" }])
      )
    );
    const chunks = await collectStream(streamAnthropicPrompt("k", "...", { signal: new AbortController().signal }));
    expect(chunks).toEqual([{ type: "error", code: "BLOCKED_BY_PROVIDER", message: expect.any(String) }]);
  });

  it("surfaces a mid-stream error event (after HTTP 200) as its own terminal error, never as a fabricated done", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "partial" } },
          { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }
        ])
      )
    );
    const chunks = await collectStream(streamAnthropicPrompt("k", "Hi", { signal: new AbortController().signal }));
    expect(chunks).toEqual([
      { type: "delta", text: "partial" },
      { type: "error", code: "NETWORK_ERROR", message: expect.any(String) }
    ]);
  });

  it("skips a single malformed SSE event without aborting the rest of the stream", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: {not valid json\n\n"));
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } })}\n\n`)
        );
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "message_stop" })}\n\n`));
        controller.close();
      }
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream, { status: 200 })));
    const chunks = await collectStream(streamAnthropicPrompt("k", "Hi", { signal: new AbortController().signal }));
    expect(chunks).toEqual([{ type: "delta", text: "ok" }, { type: "done", truncated: false }]);
  });

  it("maps an HTTP error status to a normalized error chunk without starting to read a body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 429 })));
    const chunks = await collectStream(streamAnthropicPrompt("k", "Hi", { signal: new AbortController().signal }));
    expect(chunks).toEqual([{ type: "error", code: "RATE_LIMITED", message: expect.any(String) }]);
  });

  it("reports CANCELLED (never a fabricated done) when the signal aborts mid-stream", async () => {
    const encoder = new TextEncoder();
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "partial" } })}\n\n`)
        );
        // Deliberately never closes — the test aborts instead.
      }
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream, { status: 200 })));

    const gen = streamAnthropicPrompt("k", "Hi", { signal: controller.signal });
    const chunks: AnthropicStreamChunk[] = [];
    const first = await gen.next();
    if (!first.done) chunks.push(first.value);
    controller.abort();
    for await (const chunk of gen) chunks.push(chunk);

    expect(chunks[0]).toEqual({ type: "delta", text: "partial" });
    expect(chunks.at(-1)).toEqual({ type: "error", code: "CANCELLED", message: expect.any(String) });
  });
});
