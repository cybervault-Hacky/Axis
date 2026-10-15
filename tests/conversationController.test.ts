import { beforeEach, describe, expect, it, vi } from "vitest";

const { aiClientMock } = vi.hoisted(() => ({
  aiClientMock: {
    buildSendPayload: vi.fn(),
    cancelPrompt: vi.fn().mockResolvedValue(undefined),
    makeRequestId: vi.fn(),
    onStreamEvent: vi.fn(),
    sendStreamingRequest: vi.fn()
  }
}));
vi.mock("../src/renderer/ts/ai/aiClient", () => aiClientMock);

import { createConversationController } from "../src/renderer/ts/ai/conversationController";
import { createConversationContext } from "../src/renderer/ts/ai/conversationContext";
import type { ComposerHandle } from "../src/renderer/ts/components/composer";
import type { ConversationViewHandle } from "../src/renderer/ts/components/conversationView";
import type { AiProviderStatus } from "../src/shared/ai-contract";

function fakeComposer(): ComposerHandle & { setBusy: ReturnType<typeof vi.fn> } {
  return {
    element: document.createElement("div"),
    setValue: vi.fn(),
    focusEnd: vi.fn(),
    setBusy: vi.fn()
  };
}

function fakeView(): ConversationViewHandle & { render: ReturnType<typeof vi.fn> } {
  return { element: document.createElement("div"), render: vi.fn() };
}

function configuredStatus(): AiProviderStatus {
  return { provider: "gemini", configured: true, backend: "os-encrypted", secure: true, persistentStorageAvailable: true, nativeBridgeAvailable: true };
}

function fakeStore(status: AiProviderStatus = configuredStatus()) {
  return {
    getState: () => ({
      activeView: "workspace" as const,
      aboutOpen: false,
      aiStatus: status,
      settings: { aiRequestTimeoutMs: 30000, accent: "blue", density: "comfortable", motion: "system", sidebarCollapsed: false }
    })
  };
}

let nextId = 0;
function nextRequestId(): string {
  nextId += 1;
  return `req-${nextId}`;
}

describe("conversationController", () => {
  let streamListener: ((event: { requestId: string; type: string; [key: string]: unknown }) => void) | null;

  beforeEach(() => {
    vi.resetAllMocks();
    streamListener = null;
    nextId = 0;
    aiClientMock.cancelPrompt.mockResolvedValue(undefined);
    aiClientMock.makeRequestId.mockImplementation(nextRequestId);
    aiClientMock.onStreamEvent.mockImplementation((cb: typeof streamListener) => {
      streamListener = cb;
      return () => {
        streamListener = null;
      };
    });
    aiClientMock.buildSendPayload.mockImplementation((prompt: string, opts: Record<string, unknown>) => ({
      requestId: nextRequestId(),
      prompt,
      ...opts
    }));
  });

  it("starts a turn, marks the composer busy, and applies streamed deltas as they arrive, tagged by requestId", () => {
    aiClientMock.sendStreamingRequest.mockResolvedValue({ ok: true, requestId: "req-1" });
    const context = createConversationContext();
    const view = fakeView();
    const composer = fakeComposer();
    const controller = createConversationController(fakeStore() as never, () => composer, context, view);

    controller.submit("Hello there");

    expect(composer.setBusy).toHaveBeenCalledWith(true);
    expect(context.getTurn("req-1")?.status).toBe("pending");

    streamListener?.({ requestId: "req-1", type: "delta", text: "Hi" });
    streamListener?.({ requestId: "req-1", type: "delta", text: " there" });
    expect(context.getTurn("req-1")?.responseText).toBe("Hi there");

    streamListener?.({ requestId: "req-1", type: "done", truncated: false });
    expect(context.getTurn("req-1")?.status).toBe("complete");
    expect(composer.setBusy).toHaveBeenLastCalledWith(false);
    expect(controller.hasActiveRequest()).toBe(false);
  });

  it("ignores a stream event whose requestId does not match the currently active request (stale/superseded event)", () => {
    aiClientMock.sendStreamingRequest.mockResolvedValue({ ok: true, requestId: "req-1" });
    const context = createConversationContext();
    const controller = createConversationController(fakeStore() as never, () => fakeComposer(), context, fakeView());

    controller.submit("Hello");
    streamListener?.({ requestId: "some-other-stale-id", type: "delta", text: "should never appear" });

    expect(context.getTurn("req-1")?.responseText).toBe("");
  });

  it("prevents a duplicate submission while a request is already active", () => {
    aiClientMock.sendStreamingRequest.mockResolvedValue({ ok: true, requestId: "req-1" });
    const context = createConversationContext();
    const controller = createConversationController(fakeStore() as never, () => fakeComposer(), context, fakeView());

    controller.submit("First");
    controller.submit("Second");

    expect(aiClientMock.sendStreamingRequest).toHaveBeenCalledTimes(1);
    expect(context.getTurns()).toHaveLength(1);
  });

  it("cancel() immediately frees the composer and marks the turn cancelled, then ignores a late event for the old request", () => {
    aiClientMock.sendStreamingRequest.mockResolvedValue({ ok: true, requestId: "req-1" });
    const context = createConversationContext();
    const composer = fakeComposer();
    const controller = createConversationController(fakeStore() as never, () => composer, context, fakeView());

    controller.submit("Hello");
    streamListener?.({ requestId: "req-1", type: "delta", text: "partial" });

    controller.cancel();
    expect(aiClientMock.cancelPrompt).toHaveBeenCalledWith("req-1");
    expect(context.getTurn("req-1")?.status).toBe("cancelled");
    expect(composer.setBusy).toHaveBeenLastCalledWith(false);
    expect(controller.hasActiveRequest()).toBe(false);

    // A late "done" for the already-cancelled request must never resurrect it.
    streamListener?.({ requestId: "req-1", type: "done", truncated: false });
    expect(context.getTurn("req-1")?.status).toBe("cancelled");

    // And a new request afterwards must work normally.
    controller.submit("Second message");
    expect(aiClientMock.sendStreamingRequest).toHaveBeenCalledTimes(2);
  });

  it("surfaces a provider error event as a failed turn and re-enables the composer", () => {
    aiClientMock.sendStreamingRequest.mockResolvedValue({ ok: true, requestId: "req-1" });
    const context = createConversationContext();
    const composer = fakeComposer();
    const controller = createConversationController(fakeStore() as never, () => composer, context, fakeView());

    controller.submit("Hello");
    streamListener?.({ requestId: "req-1", type: "error", code: "RATE_LIMITED", message: "Gemini reported a rate limit." });

    expect(context.getTurn("req-1")?.status).toBe("error");
    expect(context.getTurn("req-1")?.errorMessage).toBe("Gemini reported a rate limit.");
    expect(composer.setBusy).toHaveBeenLastCalledWith(false);
  });

  it("surfaces an immediate ack rejection (e.g. duplicate at the main-process level) as a failed turn", async () => {
    aiClientMock.sendStreamingRequest.mockResolvedValue({ ok: false, requestId: "req-1", code: "DUPLICATE_REQUEST", message: "busy" });
    const context = createConversationContext();
    const composer = fakeComposer();
    const controller = createConversationController(fakeStore() as never, () => composer, context, fakeView());

    controller.submit("Hello");
    await Promise.resolve();
    await Promise.resolve();

    expect(context.getTurn("req-1")?.status).toBe("error");
    expect(composer.setBusy).toHaveBeenLastCalledWith(false);
  });

  it("retry() resends the same prompt as a brand-new request, leaving the original failed turn in place", () => {
    aiClientMock.sendStreamingRequest.mockResolvedValue({ ok: true, requestId: "req-1" });
    const context = createConversationContext();
    const controller = createConversationController(fakeStore() as never, () => fakeComposer(), context, fakeView());

    controller.submit("Flaky prompt");
    streamListener?.({ requestId: "req-1", type: "error", code: "NETWORK_ERROR", message: "Could not reach Gemini." });

    aiClientMock.sendStreamingRequest.mockResolvedValue({ ok: true, requestId: "req-2" });
    const failedTurn = context.getTurn("req-1")!;
    controller.retry(failedTurn);

    expect(context.getTurns()).toHaveLength(2);
    expect(context.getTurn("req-1")?.status).toBe("error");
    expect(context.getTurn("req-2")?.prompt).toBe("Flaky prompt");
    expect(aiClientMock.sendStreamingRequest).toHaveBeenCalledTimes(2);
  });

  it("never auto-retries: a failed turn stays failed until the user explicitly clicks retry", () => {
    aiClientMock.sendStreamingRequest.mockResolvedValue({ ok: true, requestId: "req-1" });
    const context = createConversationContext();
    const controller = createConversationController(fakeStore() as never, () => fakeComposer(), context, fakeView());

    controller.submit("Flaky prompt");
    streamListener?.({ requestId: "req-1", type: "error", code: "NETWORK_ERROR", message: "Could not reach Gemini." });

    expect(aiClientMock.sendStreamingRequest).toHaveBeenCalledTimes(1);
    expect(context.getTurn("req-1")?.status).toBe("error");
  });

  it("newConversation() cancels any active request first, then clears all turns and history", () => {
    aiClientMock.sendStreamingRequest.mockResolvedValue({ ok: true, requestId: "req-1" });
    const context = createConversationContext();
    const controller = createConversationController(fakeStore() as never, () => fakeComposer(), context, fakeView());

    controller.submit("Hello");
    expect(context.getTurns()).toHaveLength(1);

    controller.newConversation();
    expect(aiClientMock.cancelPrompt).toHaveBeenCalledWith("req-1");
    expect(context.getTurns()).toEqual([]);
    expect(controller.hasActiveRequest()).toBe(false);
  });

  it("includes the bounded prior conversation history (not credentials) when building the next request's payload", () => {
    aiClientMock.sendStreamingRequest.mockResolvedValue({ ok: true, requestId: "req-1" });
    const context = createConversationContext();
    context.startTurn("earlier", "What is 2+2?");
    context.completeTurn("earlier", { text: "4", truncated: false });

    const controller = createConversationController(fakeStore() as never, () => fakeComposer(), context, fakeView());
    controller.submit("And 3+3?");

    const [, options] = aiClientMock.buildSendPayload.mock.calls[0] as [string, { history: Array<{ role: string; text: string }> }];
    expect(options.history).toEqual([
      { role: "user", text: "What is 2+2?" },
      { role: "model", text: "4" }
    ]);
  });

  it("reports an honest 'no AI engine' failure without calling the provider when the native bridge is unavailable", () => {
    const context = createConversationContext();
    const status: AiProviderStatus = { provider: "gemini", configured: false, backend: "none", secure: false, persistentStorageAvailable: false, nativeBridgeAvailable: false };
    const controller = createConversationController(fakeStore(status) as never, () => fakeComposer(), context, fakeView());

    controller.submit("Hello");

    expect(aiClientMock.sendStreamingRequest).not.toHaveBeenCalled();
    expect(context.getTurns()).toHaveLength(1);
    expect(context.getTurns()[0]?.status).toBe("error");
  });
});
