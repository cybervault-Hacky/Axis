// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";

const { credentialStoreMock, geminiProviderMock, openaiProviderMock, anthropicProviderMock, mistralProviderMock } = vi.hoisted(() => ({
  credentialStoreMock: {
    getStatus: vi.fn(),
    getApiKeyForRequest: vi.fn(),
    importCredential: vi.fn(),
    removeCredential: vi.fn()
  },
  geminiProviderMock: {
    sendGeminiPrompt: vi.fn(),
    streamGeminiPrompt: vi.fn(),
    testGeminiConnection: vi.fn()
  },
  openaiProviderMock: {
    sendOpenAiPrompt: vi.fn(),
    streamOpenAiPrompt: vi.fn(),
    testOpenAiConnection: vi.fn()
  },
  anthropicProviderMock: {
    sendAnthropicPrompt: vi.fn(),
    streamAnthropicPrompt: vi.fn(),
    testAnthropicConnection: vi.fn()
  },
  mistralProviderMock: {
    sendMistralPrompt: vi.fn(),
    streamMistralPrompt: vi.fn(),
    testMistralConnection: vi.fn()
  }
}));
vi.mock("../../src/main/ai/credentialStore", () => credentialStoreMock);
vi.mock("../../src/main/ai/geminiProvider", () => geminiProviderMock);
vi.mock("../../src/main/ai/openaiProvider", () => openaiProviderMock);
vi.mock("../../src/main/ai/anthropicProvider", () => anthropicProviderMock);
vi.mock("../../src/main/ai/mistralProvider", () => mistralProviderMock);

import { createAiController } from "../../src/main/ai/aiController";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeFakeWindow() {
  const mainFrame = { id: "main-frame" } as unknown as Electron.WebFrameMain;
  const send = vi.fn();
  const webContents = { mainFrame, id: Math.floor(Math.random() * 100000), send } as unknown as Electron.WebContents;
  const win = { isDestroyed: () => false, webContents } as unknown as Electron.BrowserWindow;
  return { win, webContents, mainFrame, send };
}

/** Builds an async generator that yields the given chunks, for mocking streamGeminiPrompt. */
function fakeStream(chunks: Array<{ type: string; [key: string]: unknown }>) {
  return (async function* () {
    for (const chunk of chunks) yield chunk;
  })();
}

async function flushMicrotasks(times = 5): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

function makeEvent(webContents: Electron.WebContents, senderFrame: Electron.WebFrameMain): IpcMainInvokeEvent {
  return { sender: webContents, senderFrame } as unknown as IpcMainInvokeEvent;
}

describe("aiController", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns a safe unavailable status and never calls into credentialStore for an untrusted sender", () => {
    const { win } = makeFakeWindow();
    const { webContents: otherWebContents, mainFrame: otherFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });

    const status = controller.getStatus(makeEvent(otherWebContents, otherFrame));
    expect(status.nativeBridgeAvailable).toBe(false);
    expect(status.configured).toBe(false);
    expect(credentialStoreMock.getStatus).not.toHaveBeenCalled();
  });

  it("returns real status for a trusted sender", () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });
    credentialStoreMock.getStatus.mockReturnValue({
      provider: "gemini",
      configured: true,
      backend: "os-encrypted",
      secure: true,
      persistentStorageAvailable: true,
      nativeBridgeAvailable: true
    });

    const status = controller.getStatus(makeEvent(webContents, mainFrame));
    expect(status.configured).toBe(true);
    expect(credentialStoreMock.getStatus).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed send-request payloads before touching the provider", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });

    const result = await controller.sendRequestHandler(makeEvent(webContents, mainFrame), { requestId: "r1", prompt: "" });
    expect(result).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    expect(geminiProviderMock.sendGeminiPrompt).not.toHaveBeenCalled();
  });

  it("rejects an oversized prompt without calling the provider", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });

    const result = await controller.sendRequestHandler(makeEvent(webContents, mainFrame), {
      requestId: "r1",
      prompt: "x".repeat(20_000)
    });
    expect(result).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    expect(geminiProviderMock.sendGeminiPrompt).not.toHaveBeenCalled();
  });

  it("refuses to send and reports an untrusted sender as an internal error, never leaking into the provider", async () => {
    const { win } = makeFakeWindow();
    const { webContents: otherWebContents, mainFrame: otherFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });

    const result = await controller.sendRequestHandler(makeEvent(otherWebContents, otherFrame), { requestId: "r1", prompt: "hi" });
    expect(result).toEqual({ ok: false, requestId: "r1", code: "INTERNAL_ERROR", message: expect.any(String) });
    expect(geminiProviderMock.sendGeminiPrompt).not.toHaveBeenCalled();
  });

  it("reports MISSING_CREDENTIALS without calling the provider when no key is configured", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });
    credentialStoreMock.getApiKeyForRequest.mockReturnValue({ ok: false, code: "MISSING_CREDENTIALS", message: "none" });

    const result = await controller.sendRequestHandler(makeEvent(webContents, mainFrame), { requestId: "r1", prompt: "hi" });
    expect(result).toMatchObject({ ok: false, requestId: "r1", code: "MISSING_CREDENTIALS" });
    expect(geminiProviderMock.sendGeminiPrompt).not.toHaveBeenCalled();
  });

  it("rejects a concurrent second request from the same sender as DUPLICATE_REQUEST", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });
    credentialStoreMock.getApiKeyForRequest.mockReturnValue({ ok: true, key: "k" });
    const deferred = createDeferred<{ ok: true; text: string; truncated: boolean }>();
    geminiProviderMock.sendGeminiPrompt.mockReturnValue(deferred.promise);

    const event = makeEvent(webContents, mainFrame);
    const firstPromise = controller.sendRequestHandler(event, { requestId: "r1", prompt: "hello" });
    const second = await controller.sendRequestHandler(event, { requestId: "r2", prompt: "world" });

    expect(second).toEqual({ ok: false, requestId: "r2", code: "DUPLICATE_REQUEST", message: expect.any(String) });

    deferred.resolve({ ok: true, text: "done", truncated: false });
    const first = await firstPromise;
    expect(first).toEqual({ ok: true, requestId: "r1", text: "done", truncated: false });
  });

  it("allows a new request from the same sender once the previous one has completed", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });
    credentialStoreMock.getApiKeyForRequest.mockReturnValue({ ok: true, key: "k" });
    geminiProviderMock.sendGeminiPrompt.mockResolvedValue({ ok: true, text: "answer", truncated: false });

    const event = makeEvent(webContents, mainFrame);
    const first = await controller.sendRequestHandler(event, { requestId: "r1", prompt: "hello" });
    expect(first.ok).toBe(true);

    const second = await controller.sendRequestHandler(event, { requestId: "r2", prompt: "again" });
    expect(second.ok).toBe(true);
  });

  it("reports CANCELLED (not TIMEOUT) when the user explicitly cancels", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });
    credentialStoreMock.getApiKeyForRequest.mockReturnValue({ ok: true, key: "k" });

    geminiProviderMock.sendGeminiPrompt.mockImplementation(
      (_key: string, _prompt: string, opts: { signal: AbortSignal }) =>
        new Promise((resolve) => {
          opts.signal.addEventListener("abort", () => resolve({ ok: false, code: "CANCELLED", message: "aborted" }));
        })
    );

    const event = makeEvent(webContents, mainFrame);
    const resultPromise = controller.sendRequestHandler(event, { requestId: "r1", prompt: "hi" });
    await Promise.resolve();

    const cancelResult = controller.cancelRequestHandler(event, { requestId: "r1" });
    expect(cancelResult).toEqual({ ok: true });

    const result = await resultPromise;
    expect(result).toEqual({ ok: false, requestId: "r1", code: "CANCELLED", message: expect.any(String) });
  });

  it("ignores a cancel request with a mismatched requestId", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });
    credentialStoreMock.getApiKeyForRequest.mockReturnValue({ ok: true, key: "k" });
    const deferred = createDeferred<{ ok: true; text: string; truncated: boolean }>();
    geminiProviderMock.sendGeminiPrompt.mockReturnValue(deferred.promise);

    const event = makeEvent(webContents, mainFrame);
    const resultPromise = controller.sendRequestHandler(event, { requestId: "r1", prompt: "hi" });

    const cancelResult = controller.cancelRequestHandler(event, { requestId: "wrong-id" });
    expect(cancelResult).toEqual({ ok: false });

    deferred.resolve({ ok: true, text: "done", truncated: false });
    const result = await resultPromise;
    expect(result.ok).toBe(true);
  });

  it("reports TIMEOUT (not a generic cancellation) when the request exceeds its timeout", async () => {
    vi.useFakeTimers();
    try {
      const { win, webContents, mainFrame } = makeFakeWindow();
      const controller = createAiController({ getMainWindow: () => win });
      credentialStoreMock.getApiKeyForRequest.mockReturnValue({ ok: true, key: "k" });

      let capturedSignal: AbortSignal | undefined;
      geminiProviderMock.sendGeminiPrompt.mockImplementation(
        (_key: string, _prompt: string, opts: { signal: AbortSignal }) => {
          capturedSignal = opts.signal;
          return new Promise((resolve) => {
            opts.signal.addEventListener("abort", () => resolve({ ok: false, code: "CANCELLED", message: "aborted" }));
          });
        }
      );

      const event = makeEvent(webContents, mainFrame);
      const resultPromise = controller.sendRequestHandler(event, { requestId: "r1", prompt: "hi", timeoutMs: 10_000 });

      await vi.advanceTimersByTimeAsync(10_001);
      const result = await resultPromise;

      expect(result).toEqual({ ok: false, requestId: "r1", code: "TIMEOUT", message: expect.any(String) });
      expect(capturedSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("delegates test-connection to the provider for a trusted sender and blocks untrusted ones", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const { webContents: otherWebContents, mainFrame: otherFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });
    credentialStoreMock.getApiKeyForRequest.mockReturnValue({ ok: true, key: "k" });
    geminiProviderMock.testGeminiConnection.mockResolvedValue({ ok: true });

    const good = await controller.testConnectionHandler(makeEvent(webContents, mainFrame));
    expect(good).toEqual({ ok: true });

    const bad = await controller.testConnectionHandler(makeEvent(otherWebContents, otherFrame));
    expect(bad).toMatchObject({ ok: false, code: "INTERNAL_ERROR" });
    expect(geminiProviderMock.testGeminiConnection).toHaveBeenCalledTimes(1);
  });

  it("validates the import-credential payload shape before delegating", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });

    const result = await controller.importCredentialHandler(makeEvent(webContents, mainFrame), { allowSessionOnly: "yes" });
    expect(result).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    expect(credentialStoreMock.importCredential).not.toHaveBeenCalled();
  });
});

describe("aiController — multi-provider dispatch (Phase 9/10)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("defaults to gemini when no provider is given, preserving Phase 3 behaviour exactly", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });
    credentialStoreMock.getApiKeyForRequest.mockReturnValue({ ok: true, key: "k" });
    geminiProviderMock.sendGeminiPrompt.mockResolvedValue({ ok: true, text: "hi", truncated: false });

    const result = await controller.sendRequestHandler(makeEvent(webContents, mainFrame), { requestId: "r1", prompt: "hello" });

    expect(result).toEqual({ ok: true, requestId: "r1", text: "hi", truncated: false });
    expect(credentialStoreMock.getApiKeyForRequest).toHaveBeenCalledWith("gemini");
    expect(geminiProviderMock.sendGeminiPrompt).toHaveBeenCalledTimes(1);
    expect(openaiProviderMock.sendOpenAiPrompt).not.toHaveBeenCalled();
  });

  it("routes a send-request explicitly scoped to 'openai' to the OpenAI adapter, never touching Gemini", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });
    credentialStoreMock.getApiKeyForRequest.mockReturnValue({ ok: true, key: "openai-key" });
    openaiProviderMock.sendOpenAiPrompt.mockResolvedValue({ ok: true, text: "hi from openai", truncated: false });

    const result = await controller.sendRequestHandler(makeEvent(webContents, mainFrame), {
      requestId: "r1",
      prompt: "hello",
      provider: "openai"
    });

    expect(result).toEqual({ ok: true, requestId: "r1", text: "hi from openai", truncated: false });
    expect(credentialStoreMock.getApiKeyForRequest).toHaveBeenCalledWith("openai");
    expect(openaiProviderMock.sendOpenAiPrompt).toHaveBeenCalledTimes(1);
    expect(geminiProviderMock.sendGeminiPrompt).not.toHaveBeenCalled();
  });

  it("rejects an unrecognized provider id in a send-request payload as VALIDATION_ERROR before touching any provider", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });

    const result = await controller.sendRequestHandler(makeEvent(webContents, mainFrame), {
      requestId: "r1",
      prompt: "hello",
      provider: "cohere"
    });

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    expect(geminiProviderMock.sendGeminiPrompt).not.toHaveBeenCalled();
    expect(openaiProviderMock.sendOpenAiPrompt).not.toHaveBeenCalled();
    expect(anthropicProviderMock.sendAnthropicPrompt).not.toHaveBeenCalled();
  });

  it("routes a streaming request scoped to 'openai' to the OpenAI adapter and tags pushed events with the same requestId", async () => {
    const { win, webContents, mainFrame, send } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });
    credentialStoreMock.getApiKeyForRequest.mockReturnValue({ ok: true, key: "openai-key" });
    openaiProviderMock.streamOpenAiPrompt.mockReturnValue(fakeStream([{ type: "delta", text: "Hi" }, { type: "done", truncated: false }]));

    const ack = await controller.sendStreamingRequestHandler(makeEvent(webContents, mainFrame), {
      requestId: "r1",
      prompt: "hi",
      provider: "openai"
    });
    expect(ack).toEqual({ ok: true, requestId: "r1" });
    await flushMicrotasks();

    expect(send).toHaveBeenCalledWith("axis:ai:stream-event", { requestId: "r1", type: "delta", text: "Hi" });
    expect(send).toHaveBeenCalledWith("axis:ai:stream-event", { requestId: "r1", type: "done", truncated: false });
    expect(geminiProviderMock.streamGeminiPrompt).not.toHaveBeenCalled();
  });

  it("routes a send-request explicitly scoped to 'anthropic' to the Anthropic adapter, never touching Gemini or OpenAI (Phase 10)", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });
    credentialStoreMock.getApiKeyForRequest.mockReturnValue({ ok: true, key: "anthropic-key" });
    anthropicProviderMock.sendAnthropicPrompt.mockResolvedValue({ ok: true, text: "hi from claude", truncated: false });

    const result = await controller.sendRequestHandler(makeEvent(webContents, mainFrame), {
      requestId: "r1",
      prompt: "hello",
      provider: "anthropic"
    });

    expect(result).toEqual({ ok: true, requestId: "r1", text: "hi from claude", truncated: false });
    expect(credentialStoreMock.getApiKeyForRequest).toHaveBeenCalledWith("anthropic");
    expect(anthropicProviderMock.sendAnthropicPrompt).toHaveBeenCalledTimes(1);
    expect(geminiProviderMock.sendGeminiPrompt).not.toHaveBeenCalled();
    expect(openaiProviderMock.sendOpenAiPrompt).not.toHaveBeenCalled();
  });

  it("routes a streaming request scoped to 'anthropic' to the Anthropic adapter and tags pushed events with the same requestId (Phase 10)", async () => {
    const { win, webContents, mainFrame, send } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });
    credentialStoreMock.getApiKeyForRequest.mockReturnValue({ ok: true, key: "anthropic-key" });
    anthropicProviderMock.streamAnthropicPrompt.mockReturnValue(
      fakeStream([{ type: "delta", text: "Hi" }, { type: "done", truncated: false }])
    );

    const ack = await controller.sendStreamingRequestHandler(makeEvent(webContents, mainFrame), {
      requestId: "r1",
      prompt: "hi",
      provider: "anthropic"
    });
    expect(ack).toEqual({ ok: true, requestId: "r1" });
    await flushMicrotasks();

    expect(send).toHaveBeenCalledWith("axis:ai:stream-event", { requestId: "r1", type: "delta", text: "Hi" });
    expect(send).toHaveBeenCalledWith("axis:ai:stream-event", { requestId: "r1", type: "done", truncated: false });
    expect(geminiProviderMock.streamGeminiPrompt).not.toHaveBeenCalled();
    expect(openaiProviderMock.streamOpenAiPrompt).not.toHaveBeenCalled();
  });

  it("looks up gemini, openai, and anthropic credentials from entirely separate calls, never reusing one provider's key for another (Phase 10)", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });
    credentialStoreMock.getApiKeyForRequest.mockImplementation((provider: string) => ({ ok: true, key: `${provider}-key` }));
    geminiProviderMock.sendGeminiPrompt.mockResolvedValue({ ok: true, text: "g", truncated: false });
    openaiProviderMock.sendOpenAiPrompt.mockResolvedValue({ ok: true, text: "o", truncated: false });
    anthropicProviderMock.sendAnthropicPrompt.mockResolvedValue({ ok: true, text: "a", truncated: false });

    const event = makeEvent(webContents, mainFrame);
    await controller.sendRequestHandler(event, { requestId: "r1", prompt: "hello", provider: "gemini" });
    await controller.sendRequestHandler(event, { requestId: "r2", prompt: "hello", provider: "openai" });
    await controller.sendRequestHandler(event, { requestId: "r3", prompt: "hello", provider: "anthropic" });

    expect(geminiProviderMock.sendGeminiPrompt).toHaveBeenCalledWith("gemini-key", "hello", expect.anything());
    expect(openaiProviderMock.sendOpenAiPrompt).toHaveBeenCalledWith("openai-key", "hello", expect.anything());
    expect(anthropicProviderMock.sendAnthropicPrompt).toHaveBeenCalledWith("anthropic-key", "hello", expect.anything());
  });

  it("routes a send-request explicitly scoped to 'mistral' to the Mistral adapter, never touching the other three providers (Phase 14)", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });
    credentialStoreMock.getApiKeyForRequest.mockReturnValue({ ok: true, key: "mistral-key" });
    mistralProviderMock.sendMistralPrompt.mockResolvedValue({ ok: true, text: "hi from mistral", truncated: false });

    const result = await controller.sendRequestHandler(makeEvent(webContents, mainFrame), {
      requestId: "r1",
      prompt: "hello",
      provider: "mistral"
    });

    expect(result).toEqual({ ok: true, requestId: "r1", text: "hi from mistral", truncated: false });
    expect(credentialStoreMock.getApiKeyForRequest).toHaveBeenCalledWith("mistral");
    expect(mistralProviderMock.sendMistralPrompt).toHaveBeenCalledTimes(1);
    expect(geminiProviderMock.sendGeminiPrompt).not.toHaveBeenCalled();
    expect(openaiProviderMock.sendOpenAiPrompt).not.toHaveBeenCalled();
    expect(anthropicProviderMock.sendAnthropicPrompt).not.toHaveBeenCalled();
  });

  it("routes a streaming request scoped to 'mistral' to the Mistral adapter and tags pushed events with the same requestId (Phase 14)", async () => {
    const { win, webContents, mainFrame, send } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });
    credentialStoreMock.getApiKeyForRequest.mockReturnValue({ ok: true, key: "mistral-key" });
    mistralProviderMock.streamMistralPrompt.mockReturnValue(
      fakeStream([{ type: "delta", text: "Hi" }, { type: "done", truncated: false }])
    );

    const ack = await controller.sendStreamingRequestHandler(makeEvent(webContents, mainFrame), {
      requestId: "r1",
      prompt: "hi",
      provider: "mistral"
    });
    expect(ack).toEqual({ ok: true, requestId: "r1" });
    await flushMicrotasks();

    expect(send).toHaveBeenCalledWith("axis:ai:stream-event", { requestId: "r1", type: "delta", text: "Hi" });
    expect(send).toHaveBeenCalledWith("axis:ai:stream-event", { requestId: "r1", type: "done", truncated: false });
    expect(geminiProviderMock.streamGeminiPrompt).not.toHaveBeenCalled();
    expect(openaiProviderMock.streamOpenAiPrompt).not.toHaveBeenCalled();
    expect(anthropicProviderMock.streamAnthropicPrompt).not.toHaveBeenCalled();
  });

  it("testConnectionHandler dispatches to the Mistral adapter when scoped to 'mistral', never touching the other three providers (Phase 14)", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });
    credentialStoreMock.getApiKeyForRequest.mockReturnValue({ ok: true, key: "mistral-key" });
    mistralProviderMock.testMistralConnection.mockResolvedValue({ ok: true });

    const result = await controller.testConnectionHandler(makeEvent(webContents, mainFrame), { provider: "mistral" });
    expect(result).toEqual({ ok: true });
    expect(mistralProviderMock.testMistralConnection).toHaveBeenCalledTimes(1);
    expect(geminiProviderMock.testGeminiConnection).not.toHaveBeenCalled();
    expect(openaiProviderMock.testOpenAiConnection).not.toHaveBeenCalled();
    expect(anthropicProviderMock.testAnthropicConnection).not.toHaveBeenCalled();
  });

  it("removeCredentialHandler and importCredentialHandler forward 'mistral' just like any other provider (Phase 14)", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });
    credentialStoreMock.removeCredential.mockReturnValue({ ok: true });
    credentialStoreMock.importCredential.mockResolvedValue({ ok: true, backend: "os-encrypted", secure: true });

    const removeResult = controller.removeCredentialHandler(makeEvent(webContents, mainFrame), { provider: "mistral" });
    expect(removeResult).toEqual({ ok: true });
    expect(credentialStoreMock.removeCredential).toHaveBeenCalledWith("mistral");

    await controller.importCredentialHandler(makeEvent(webContents, mainFrame), { provider: "mistral" });
    expect(credentialStoreMock.importCredential).toHaveBeenCalledWith(win, { provider: "mistral" }, "mistral");
  });

  it("looks up gemini, openai, anthropic, and mistral credentials from four entirely separate calls, never reusing one provider's key for another (Phase 14)", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });
    credentialStoreMock.getApiKeyForRequest.mockImplementation((provider: string) => ({ ok: true, key: `${provider}-key` }));
    geminiProviderMock.sendGeminiPrompt.mockResolvedValue({ ok: true, text: "g", truncated: false });
    openaiProviderMock.sendOpenAiPrompt.mockResolvedValue({ ok: true, text: "o", truncated: false });
    anthropicProviderMock.sendAnthropicPrompt.mockResolvedValue({ ok: true, text: "a", truncated: false });
    mistralProviderMock.sendMistralPrompt.mockResolvedValue({ ok: true, text: "m", truncated: false });

    const event = makeEvent(webContents, mainFrame);
    await controller.sendRequestHandler(event, { requestId: "r1", prompt: "hello", provider: "gemini" });
    await controller.sendRequestHandler(event, { requestId: "r2", prompt: "hello", provider: "openai" });
    await controller.sendRequestHandler(event, { requestId: "r3", prompt: "hello", provider: "anthropic" });
    await controller.sendRequestHandler(event, { requestId: "r4", prompt: "hello", provider: "mistral" });

    expect(geminiProviderMock.sendGeminiPrompt).toHaveBeenCalledWith("gemini-key", "hello", expect.anything());
    expect(openaiProviderMock.sendOpenAiPrompt).toHaveBeenCalledWith("openai-key", "hello", expect.anything());
    expect(anthropicProviderMock.sendAnthropicPrompt).toHaveBeenCalledWith("anthropic-key", "hello", expect.anything());
    expect(mistralProviderMock.sendMistralPrompt).toHaveBeenCalledWith("mistral-key", "hello", expect.anything());
  });

  it("testConnectionHandler dispatches to the Anthropic adapter when scoped to 'anthropic', never touching Gemini or OpenAI (Phase 10)", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });
    credentialStoreMock.getApiKeyForRequest.mockReturnValue({ ok: true, key: "anthropic-key" });
    anthropicProviderMock.testAnthropicConnection.mockResolvedValue({ ok: true });

    const result = await controller.testConnectionHandler(makeEvent(webContents, mainFrame), { provider: "anthropic" });
    expect(result).toEqual({ ok: true });
    expect(anthropicProviderMock.testAnthropicConnection).toHaveBeenCalledTimes(1);
    expect(geminiProviderMock.testGeminiConnection).not.toHaveBeenCalled();
    expect(openaiProviderMock.testOpenAiConnection).not.toHaveBeenCalled();
  });

  it("removeCredentialHandler and importCredentialHandler forward 'anthropic' just like any other provider (Phase 10)", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });
    credentialStoreMock.removeCredential.mockReturnValue({ ok: true });
    credentialStoreMock.importCredential.mockResolvedValue({ ok: true, backend: "os-encrypted", secure: true });

    const removeResult = controller.removeCredentialHandler(makeEvent(webContents, mainFrame), { provider: "anthropic" });
    expect(removeResult).toEqual({ ok: true });
    expect(credentialStoreMock.removeCredential).toHaveBeenCalledWith("anthropic");

    await controller.importCredentialHandler(makeEvent(webContents, mainFrame), { provider: "anthropic" });
    expect(credentialStoreMock.importCredential).toHaveBeenCalledWith(win, { provider: "anthropic" }, "anthropic");
  });

  it("looks up gemini and openai credentials from entirely separate calls, never reusing one provider's key for the other", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });
    credentialStoreMock.getApiKeyForRequest.mockImplementation((provider: string) =>
      provider === "gemini" ? { ok: true, key: "gemini-key" } : { ok: true, key: "openai-key" }
    );
    geminiProviderMock.sendGeminiPrompt.mockResolvedValue({ ok: true, text: "g", truncated: false });
    openaiProviderMock.sendOpenAiPrompt.mockResolvedValue({ ok: true, text: "o", truncated: false });

    const event = makeEvent(webContents, mainFrame);
    await controller.sendRequestHandler(event, { requestId: "r1", prompt: "hello", provider: "gemini" });
    await controller.sendRequestHandler(event, { requestId: "r2", prompt: "hello", provider: "openai" });

    expect(geminiProviderMock.sendGeminiPrompt).toHaveBeenCalledWith("gemini-key", "hello", expect.anything());
    expect(openaiProviderMock.sendOpenAiPrompt).toHaveBeenCalledWith("openai-key", "hello", expect.anything());
  });

  it("getStatus resolves an invalid provider payload to the safe gemini default rather than throwing", () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });
    credentialStoreMock.getStatus.mockReturnValue({
      provider: "gemini",
      configured: false,
      backend: "none",
      secure: false,
      persistentStorageAvailable: true,
      nativeBridgeAvailable: true
    });

    const status = controller.getStatus(makeEvent(webContents, mainFrame), { provider: "not-a-real-provider" });
    expect(credentialStoreMock.getStatus).toHaveBeenCalledWith("gemini");
    expect(status.configured).toBe(false);
  });

  it("testConnectionHandler dispatches to the OpenAI adapter when scoped to 'openai'", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });
    credentialStoreMock.getApiKeyForRequest.mockReturnValue({ ok: true, key: "openai-key" });
    openaiProviderMock.testOpenAiConnection.mockResolvedValue({ ok: true });

    const result = await controller.testConnectionHandler(makeEvent(webContents, mainFrame), { provider: "openai" });
    expect(result).toEqual({ ok: true });
    expect(openaiProviderMock.testOpenAiConnection).toHaveBeenCalledTimes(1);
    expect(geminiProviderMock.testGeminiConnection).not.toHaveBeenCalled();
  });

  it("removeCredentialHandler forwards the resolved provider to credentialStore.removeCredential", () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });
    credentialStoreMock.removeCredential.mockReturnValue({ ok: true });

    const result = controller.removeCredentialHandler(makeEvent(webContents, mainFrame), { provider: "openai" });
    expect(result).toEqual({ ok: true });
    expect(credentialStoreMock.removeCredential).toHaveBeenCalledWith("openai");
  });

  it("importCredentialHandler forwards the resolved provider to credentialStore.importCredential", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });
    credentialStoreMock.importCredential.mockResolvedValue({ ok: true, backend: "os-encrypted", secure: true });

    await controller.importCredentialHandler(makeEvent(webContents, mainFrame), { provider: "openai" });
    expect(credentialStoreMock.importCredential).toHaveBeenCalledWith(win, { provider: "openai" }, "openai");
  });
});

describe("aiController — streaming (Phase 4)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("acknowledges quickly with { ok: true, requestId } and then pushes delta/done events tagged with that requestId", async () => {
    const { win, webContents, mainFrame, send } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });
    credentialStoreMock.getApiKeyForRequest.mockReturnValue({ ok: true, key: "k" });
    geminiProviderMock.streamGeminiPrompt.mockReturnValue(
      fakeStream([{ type: "delta", text: "Hel" }, { type: "delta", text: "lo" }, { type: "done", truncated: false }])
    );

    const ack = await controller.sendStreamingRequestHandler(makeEvent(webContents, mainFrame), { requestId: "r1", prompt: "hi" });
    expect(ack).toEqual({ ok: true, requestId: "r1" });

    await flushMicrotasks();

    expect(send).toHaveBeenNthCalledWith(1, "axis:ai:stream-event", { requestId: "r1", type: "delta", text: "Hel" });
    expect(send).toHaveBeenNthCalledWith(2, "axis:ai:stream-event", { requestId: "r1", type: "delta", text: "lo" });
    expect(send).toHaveBeenNthCalledWith(3, "axis:ai:stream-event", { requestId: "r1", type: "done", truncated: false });
    // The slot must be freed once the stream has fully finished.
    expect(controller.__activeRequestCount()).toBe(0);
  });

  it("rejects a concurrent streaming request from the same sender as DUPLICATE_REQUEST without starting a second stream", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });
    credentialStoreMock.getApiKeyForRequest.mockReturnValue({ ok: true, key: "k" });
    let release!: () => void;
    geminiProviderMock.streamGeminiPrompt.mockReturnValue(
      (async function* () {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        yield { type: "done", truncated: false };
      })()
    );

    const event = makeEvent(webContents, mainFrame);
    const first = await controller.sendStreamingRequestHandler(event, { requestId: "r1", prompt: "hello" });
    expect(first).toEqual({ ok: true, requestId: "r1" });

    const second = await controller.sendStreamingRequestHandler(event, { requestId: "r2", prompt: "world" });
    expect(second).toEqual({ ok: false, requestId: "r2", code: "DUPLICATE_REQUEST", message: expect.any(String) });
    expect(geminiProviderMock.streamGeminiPrompt).toHaveBeenCalledTimes(1);

    release();
    await flushMicrotasks();
  });

  it("rejects an untrusted sender immediately and never starts a stream", async () => {
    const { win } = makeFakeWindow();
    const { webContents: otherWebContents, mainFrame: otherFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });

    const result = await controller.sendStreamingRequestHandler(makeEvent(otherWebContents, otherFrame), { requestId: "r1", prompt: "hi" });
    expect(result).toEqual({ ok: false, requestId: "r1", code: "INTERNAL_ERROR", message: expect.any(String) });
    expect(geminiProviderMock.streamGeminiPrompt).not.toHaveBeenCalled();
  });

  it("rejects a malformed payload and an oversized prompt before ever touching the provider", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });

    const malformed = await controller.sendStreamingRequestHandler(makeEvent(webContents, mainFrame), { requestId: "r1", prompt: "" });
    expect(malformed).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });

    const oversized = await controller.sendStreamingRequestHandler(makeEvent(webContents, mainFrame), {
      requestId: "r2",
      prompt: "x".repeat(20_000)
    });
    expect(oversized).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    expect(geminiProviderMock.streamGeminiPrompt).not.toHaveBeenCalled();
  });

  it("reports MISSING_CREDENTIALS as an immediate ack failure, never starting a stream", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });
    credentialStoreMock.getApiKeyForRequest.mockReturnValue({ ok: false, code: "MISSING_CREDENTIALS", message: "none" });

    const result = await controller.sendStreamingRequestHandler(makeEvent(webContents, mainFrame), { requestId: "r1", prompt: "hi" });
    expect(result).toMatchObject({ ok: false, requestId: "r1", code: "MISSING_CREDENTIALS" });
    expect(geminiProviderMock.streamGeminiPrompt).not.toHaveBeenCalled();
  });

  it("pushes a distinct 'cancelled' event (not a generic error) when the user explicitly cancels mid-stream", async () => {
    const { win, webContents, mainFrame, send } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });
    credentialStoreMock.getApiKeyForRequest.mockReturnValue({ ok: true, key: "k" });

    geminiProviderMock.streamGeminiPrompt.mockImplementation((_key: string, _prompt: string, opts: { signal: AbortSignal }) =>
      (async function* () {
        yield { type: "delta", text: "partial" };
        await new Promise<void>((resolve) => opts.signal.addEventListener("abort", () => resolve()));
        yield { type: "error", code: "CANCELLED", message: "aborted" };
      })()
    );

    const event = makeEvent(webContents, mainFrame);
    const ack = await controller.sendStreamingRequestHandler(event, { requestId: "r1", prompt: "hi" });
    expect(ack).toEqual({ ok: true, requestId: "r1" });
    await flushMicrotasks();

    const cancelResult = controller.cancelRequestHandler(event, { requestId: "r1" });
    expect(cancelResult).toEqual({ ok: true });
    await flushMicrotasks();

    expect(send).toHaveBeenCalledWith("axis:ai:stream-event", { requestId: "r1", type: "delta", text: "partial" });
    expect(send).toHaveBeenCalledWith("axis:ai:stream-event", { requestId: "r1", type: "cancelled" });
    expect(controller.__activeRequestCount()).toBe(0);
  });

  it("promotes a CANCELLED stream chunk to a TIMEOUT error event when AXIS's own timer (not the user) aborted it", async () => {
    vi.useFakeTimers();
    try {
      const { win, webContents, mainFrame, send } = makeFakeWindow();
      const controller = createAiController({ getMainWindow: () => win });
      credentialStoreMock.getApiKeyForRequest.mockReturnValue({ ok: true, key: "k" });

      geminiProviderMock.streamGeminiPrompt.mockImplementation((_key: string, _prompt: string, opts: { signal: AbortSignal }) =>
        (async function* () {
          await new Promise<void>((resolve) => opts.signal.addEventListener("abort", () => resolve()));
          yield { type: "error", code: "CANCELLED", message: "aborted" };
        })()
      );

      const event = makeEvent(webContents, mainFrame);
      await controller.sendStreamingRequestHandler(event, { requestId: "r1", prompt: "hi", timeoutMs: 10_000 });

      await vi.advanceTimersByTimeAsync(10_001);
      await flushMicrotasks();

      expect(send).toHaveBeenCalledWith("axis:ai:stream-event", { requestId: "r1", type: "error", code: "TIMEOUT", message: expect.any(String) });
    } finally {
      vi.useRealTimers();
    }
  });

  it("forwards a bounded/clamped history into streamGeminiPrompt and re-clamps an oversized one authoritatively", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createAiController({ getMainWindow: () => win });
    credentialStoreMock.getApiKeyForRequest.mockReturnValue({ ok: true, key: "k" });
    geminiProviderMock.streamGeminiPrompt.mockReturnValue(fakeStream([{ type: "done", truncated: false }]));

    const oversizedHistory = Array.from({ length: 30 }, (_, i) => ({ role: "user" as const, text: `turn ${i}` }));
    await controller.sendStreamingRequestHandler(makeEvent(webContents, mainFrame), {
      requestId: "r1",
      prompt: "hi",
      history: oversizedHistory
    });

    await flushMicrotasks();
    const [, , options] = geminiProviderMock.streamGeminiPrompt.mock.calls[0] as [string, string, { history?: unknown[] }];
    expect(options.history).toBeDefined();
    expect((options.history as unknown[]).length).toBeLessThanOrEqual(8);
  });
});
