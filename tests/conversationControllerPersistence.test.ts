import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { aiClientMock, repoClientMock } = vi.hoisted(() => ({
  aiClientMock: {
    buildSendPayload: vi.fn(),
    cancelPrompt: vi.fn().mockResolvedValue(undefined),
    makeRequestId: vi.fn(),
    onStreamEvent: vi.fn(),
    sendStreamingRequest: vi.fn()
  },
  repoClientMock: {
    saveConversation: vi.fn()
  }
}));
vi.mock("../src/renderer/ts/ai/aiClient", () => aiClientMock);
vi.mock("../src/renderer/ts/ai/conversationRepositoryClient", () => repoClientMock);

import { createConversationController } from "../src/renderer/ts/ai/conversationController";
import { createConversationContext } from "../src/renderer/ts/ai/conversationContext";
import { messagesToTurns, turnsToMessages } from "../src/renderer/ts/ai/conversationPersistence";
import type { ComposerHandle } from "../src/renderer/ts/components/composer";
import type { ConversationViewHandle } from "../src/renderer/ts/components/conversationView";
import type { AiProviderStatus } from "../src/shared/ai-contract";
import type { ConversationRecord } from "../src/shared/conversation-contract";

function fakeComposer(): ComposerHandle & { setBusy: ReturnType<typeof vi.fn> } {
  return { element: document.createElement("div"), setValue: vi.fn(), focusEnd: vi.fn(), setBusy: vi.fn() };
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

describe("conversationController persistence", () => {
  let streamListener: ((event: { requestId: string; type: string; [key: string]: unknown }) => void) | null;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
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
    repoClientMock.saveConversation.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not save anything before the first turn exists", () => {
    createConversationController(fakeStore() as never, () => fakeComposer(), createConversationContext(), fakeView());
    vi.advanceTimersByTime(5000);
    expect(repoClientMock.saveConversation).not.toHaveBeenCalled();
  });

  it("debounces saves while streaming: many deltas in quick succession only save once after the debounce window", async () => {
    aiClientMock.sendStreamingRequest.mockResolvedValue({ ok: true, requestId: "req-1" });
    const controller = createConversationController(fakeStore() as never, () => fakeComposer(), createConversationContext(), fakeView());

    controller.submit("Hello");
    streamListener?.({ requestId: "req-1", type: "delta", text: "a" });
    streamListener?.({ requestId: "req-1", type: "delta", text: "b" });
    streamListener?.({ requestId: "req-1", type: "delta", text: "c" });

    expect(repoClientMock.saveConversation).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1600);
    expect(repoClientMock.saveConversation).toHaveBeenCalledTimes(1);
    const savedRecord = repoClientMock.saveConversation.mock.calls[0]?.[0] as ConversationRecord;
    expect(savedRecord.messages[1]?.text).toBe("abc");
    expect(savedRecord.messages[1]?.status).toBe("incomplete"); // still live, never "pending" on disk.
  });

  it("flushes a save immediately on a terminal 'done' event, cancelling any pending debounce", async () => {
    aiClientMock.sendStreamingRequest.mockResolvedValue({ ok: true, requestId: "req-1" });
    const controller = createConversationController(fakeStore() as never, () => fakeComposer(), createConversationContext(), fakeView());

    controller.submit("Hello");
    streamListener?.({ requestId: "req-1", type: "delta", text: "partial" });
    streamListener?.({ requestId: "req-1", type: "done", truncated: false });

    await vi.advanceTimersByTimeAsync(0);
    expect(repoClientMock.saveConversation).toHaveBeenCalledTimes(1);
    const savedRecord = repoClientMock.saveConversation.mock.calls[0]?.[0] as ConversationRecord;
    expect(savedRecord.messages[1]?.status).toBe("complete");

    // The debounce timer from the earlier delta must not fire a second,
    // stale save after the terminal flush already happened.
    await vi.advanceTimersByTimeAsync(5000);
    expect(repoClientMock.saveConversation).toHaveBeenCalledTimes(1);
  });

  it("flushes a save immediately on cancel(), marking the turn cancelled on disk", async () => {
    aiClientMock.sendStreamingRequest.mockResolvedValue({ ok: true, requestId: "req-1" });
    const controller = createConversationController(fakeStore() as never, () => fakeComposer(), createConversationContext(), fakeView());

    controller.submit("Hello");
    streamListener?.({ requestId: "req-1", type: "delta", text: "partial" });
    controller.cancel();

    await vi.advanceTimersByTimeAsync(0);
    expect(repoClientMock.saveConversation).toHaveBeenCalledTimes(1);
    const savedRecord = repoClientMock.saveConversation.mock.calls[0]?.[0] as ConversationRecord;
    expect(savedRecord.messages[1]?.status).toBe("cancelled");
  });

  it("persists a failed turn honestly (never as complete) for a provider error", async () => {
    aiClientMock.sendStreamingRequest.mockResolvedValue({ ok: true, requestId: "req-1" });
    const controller = createConversationController(fakeStore() as never, () => fakeComposer(), createConversationContext(), fakeView());

    controller.submit("Hello");
    streamListener?.({ requestId: "req-1", type: "error", code: "NETWORK_ERROR", message: "Could not reach Gemini." });

    await vi.advanceTimersByTimeAsync(0);
    const savedRecord = repoClientMock.saveConversation.mock.calls[0]?.[0] as ConversationRecord;
    expect(savedRecord.messages[1]?.status).toBe("error");
    expect(savedRecord.messages[1]?.errorMessage).toBe("Could not reach Gemini.");
  });

  it("generates a title from the first prompt and keeps it stable across later turns", async () => {
    aiClientMock.sendStreamingRequest.mockResolvedValue({ ok: true, requestId: "req-1" });
    const controller = createConversationController(fakeStore() as never, () => fakeComposer(), createConversationContext(), fakeView());

    controller.submit("Explain the history of the Roman Empire");
    streamListener?.({ requestId: "req-1", type: "done", truncated: false });
    await vi.advanceTimersByTimeAsync(0);

    expect(controller.getTitle()).toBe("Explain the history of the Roman Empire");
    const firstSave = repoClientMock.saveConversation.mock.calls[0]?.[0] as ConversationRecord;
    expect(firstSave.title).toBe("Explain the history of the Roman Empire");

    aiClientMock.sendStreamingRequest.mockResolvedValue({ ok: true, requestId: "req-2" });
    controller.submit("And what about Byzantium?");
    streamListener?.({ requestId: "req-2", type: "done", truncated: false });
    await vi.advanceTimersByTimeAsync(0);

    expect(controller.getTitle()).toBe("Explain the history of the Roman Empire");
  });

  it("never saves an empty conversation created by newConversation()", () => {
    const controller = createConversationController(fakeStore() as never, () => fakeComposer(), createConversationContext(), fakeView());
    controller.newConversation();
    vi.advanceTimersByTime(5000);
    expect(repoClientMock.saveConversation).not.toHaveBeenCalled();
  });

  it("newConversation() assigns a brand new conversation id, distinct from the previous one", async () => {
    aiClientMock.sendStreamingRequest.mockResolvedValue({ ok: true, requestId: "req-1" });
    const controller = createConversationController(fakeStore() as never, () => fakeComposer(), createConversationContext(), fakeView());
    const firstId = controller.getConversationId();

    controller.submit("Hello");
    streamListener?.({ requestId: "req-1", type: "done", truncated: false });
    await vi.advanceTimersByTimeAsync(0);

    controller.newConversation();
    const secondId = controller.getConversationId();
    expect(secondId).not.toBe(firstId);
  });

  it("switching conversations mid-stream cancels the old request and isolates it: a late event for the old id never mutates the newly loaded conversation", async () => {
    aiClientMock.sendStreamingRequest.mockResolvedValue({ ok: true, requestId: "req-1" });
    const view = fakeView();
    const controller = createConversationController(fakeStore() as never, () => fakeComposer(), createConversationContext(), view);

    // Conversation A: start streaming, never finishes.
    controller.submit("Conversation A prompt");
    streamListener?.({ requestId: "req-1", type: "delta", text: "partial A" });
    expect(controller.hasActiveRequest()).toBe(true);

    // Switch to a different, previously-saved conversation B mid-stream.
    const now = Date.now();
    const conversationB: ConversationRecord = {
      id: "conv-b",
      title: "Conversation B",
      createdAt: now,
      updatedAt: now,
      messages: turnsToMessages([
        { id: "b1", prompt: "B prompt", responseText: "B response", status: "complete", truncated: false, createdAt: now }
      ])
    };
    controller.loadConversation(conversationB);

    expect(controller.hasActiveRequest()).toBe(false);
    expect(controller.getConversationId()).toBe("conv-b");
    const restoredAfterLoad = messagesToTurns(conversationB.messages);
    expect(restoredAfterLoad).toHaveLength(1);

    // A late delta for the now-abandoned conversation A request must never
    // be applied, because it can no longer match `activeRequestId`.
    streamListener?.({ requestId: "req-1", type: "delta", text: " — should never appear" });
    const renderedTurnsAfterStaleEvent = view.render.mock.calls.at(-1)?.[0] as Array<{ id: string; responseText: string }>;
    expect(renderedTurnsAfterStaleEvent.find((t) => t.id === "b1")?.responseText).toBe("B response");

    // Conversation A's own abandoned state must have been flushed (saved
    // as cancelled) when it was switched away from.
    await vi.advanceTimersByTimeAsync(0);
    const savedCallForA = repoClientMock.saveConversation.mock.calls.find(
      (call) => (call[0] as ConversationRecord).id !== "conv-b"
    );
    expect(savedCallForA).toBeDefined();
    const recordForA = savedCallForA?.[0] as ConversationRecord;
    expect(recordForA.messages[1]?.status).toBe("cancelled");
  });

  it("reports a save failure honestly via the status callback without claiming success", async () => {
    repoClientMock.saveConversation.mockResolvedValue({ ok: false, code: "STORAGE_ERROR", message: "disk full" });
    aiClientMock.sendStreamingRequest.mockResolvedValue({ ok: true, requestId: "req-1" });
    const onSaveStatusChange = vi.fn();
    const controller = createConversationController(
      fakeStore() as never,
      () => fakeComposer(),
      createConversationContext(),
      fakeView(),
      onSaveStatusChange
    );

    controller.submit("Hello");
    streamListener?.({ requestId: "req-1", type: "done", truncated: false });
    await vi.advanceTimersByTimeAsync(0);

    expect(onSaveStatusChange).toHaveBeenCalledWith({ ok: false, message: "disk full" });
  });

  it("loadConversation() restores turns from a saved record, including an interrupted/incomplete one, honestly", () => {
    const view = fakeView();
    const controller = createConversationController(fakeStore() as never, () => fakeComposer(), createConversationContext(), view);
    const now = Date.now();
    const record: ConversationRecord = {
      id: "conv-restore",
      title: "Restored",
      createdAt: now,
      updatedAt: now,
      messages: [
        { id: "m1-user", role: "user", text: "Will this finish?", status: "complete", truncated: false, createdAt: now },
        { id: "m1-assistant", role: "assistant", text: "partial thought", status: "incomplete", truncated: false, createdAt: now }
      ]
    };

    controller.loadConversation(record);
    const rendered = view.render.mock.calls.at(-1)?.[0] as Array<{ status: string; responseText: string }>;
    expect(rendered[0]?.status).toBe("incomplete");
    expect(rendered[0]?.responseText).toBe("partial thought");
    expect(controller.getTitle()).toBe("Restored");
    expect(controller.getConversationId()).toBe("conv-restore");
  });

  it("setTitleIfCurrent() updates the displayed title when the id matches the open conversation, and re-renders", () => {
    const view = fakeView();
    const controller = createConversationController(fakeStore() as never, () => fakeComposer(), createConversationContext(), view);
    const id = controller.getConversationId();
    const renderCallsBefore = view.render.mock.calls.length;

    controller.setTitleIfCurrent(id, "Renamed from History");

    expect(controller.getTitle()).toBe("Renamed from History");
    expect(view.render.mock.calls.length).toBeGreaterThan(renderCallsBefore);
  });

  it("setTitleIfCurrent() is a no-op for any id other than the currently open conversation", () => {
    const view = fakeView();
    const controller = createConversationController(fakeStore() as never, () => fakeComposer(), createConversationContext(), view);
    const renderCallsBefore = view.render.mock.calls.length;

    controller.setTitleIfCurrent("some-other-conversation-id", "Should not apply");

    expect(controller.getTitle()).not.toBe("Should not apply");
    expect(view.render.mock.calls.length).toBe(renderCallsBefore);
  });
});
