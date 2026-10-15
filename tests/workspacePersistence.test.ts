import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountApp } from "../src/renderer/ts/app";
import type { AiProviderStatus, AiStreamEvent, AiStreamStartResult } from "../src/shared/ai-contract";
import type { ConversationGetResult, ConversationListResult, ConversationOpResult, ConversationRecord } from "../src/shared/conversation-contract";

type StreamListener = (event: AiStreamEvent) => void;

interface FakeAiBridge {
  getStatus: ReturnType<typeof vi.fn>;
  importCredential: ReturnType<typeof vi.fn>;
  removeCredential: ReturnType<typeof vi.fn>;
  testConnection: ReturnType<typeof vi.fn>;
  sendRequest: ReturnType<typeof vi.fn>;
  cancelRequest: ReturnType<typeof vi.fn>;
  sendStreamingRequest: ReturnType<typeof vi.fn>;
  onStreamEvent: ReturnType<typeof vi.fn>;
}

/** A tiny in-memory stand-in for the real main-process conversation repository, for full-app integration tests. */
function createFakeConversationsBridge() {
  const store = new Map<string, ConversationRecord>();

  return {
    store,
    list: vi.fn(async (): Promise<ConversationListResult> => ({
      ok: true,
      summaries: [...store.values()]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, messageCount: c.messages.length, preview: "" }))
    })),
    search: vi.fn(async (query: string): Promise<ConversationListResult> => {
      const needle = query.toLowerCase();
      const matches = [...store.values()].filter(
        (c) => c.title.toLowerCase().includes(needle) || c.messages.some((m) => m.text.toLowerCase().includes(needle))
      );
      return { ok: true, summaries: matches.map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, messageCount: c.messages.length, preview: "" })) };
    }),
    get: vi.fn(async (id: string): Promise<ConversationGetResult> => {
      const found = store.get(id);
      if (!found) return { ok: false, code: "NOT_FOUND", message: "not found" };
      return { ok: true, conversation: found };
    }),
    save: vi.fn(async (conversation: ConversationRecord): Promise<ConversationOpResult> => {
      store.set(conversation.id, conversation);
      return { ok: true };
    }),
    rename: vi.fn(async (id: string, title: string): Promise<ConversationOpResult> => {
      const found = store.get(id);
      if (!found) return { ok: false, code: "NOT_FOUND", message: "not found" };
      store.set(id, { ...found, title, updatedAt: Date.now() });
      return { ok: true };
    }),
    delete: vi.fn(async (id: string): Promise<ConversationOpResult> => {
      store.delete(id);
      return { ok: true };
    }),
    clearAll: vi.fn(async (): Promise<ConversationOpResult> => {
      store.clear();
      return { ok: true };
    })
  };
}

function installBridge(status: AiProviderStatus) {
  let listener: StreamListener | null = null;
  const ai: FakeAiBridge = {
    getStatus: vi.fn().mockResolvedValue(status),
    importCredential: vi.fn(),
    removeCredential: vi.fn(),
    testConnection: vi.fn(),
    sendRequest: vi.fn(),
    cancelRequest: vi.fn().mockResolvedValue({ ok: true }),
    sendStreamingRequest: vi.fn().mockImplementation((payload: { requestId: string }) =>
      Promise.resolve({ ok: true, requestId: payload.requestId })
    ),
    onStreamEvent: vi.fn().mockImplementation((cb: StreamListener) => {
      listener = cb;
      return () => {
        listener = null;
      };
    })
  };
  const conversations = createFakeConversationsBridge();
  (window as unknown as { axis: unknown }).axis = {
    ai,
    conversations,
    getAppInfo: vi.fn().mockResolvedValue({
      name: "AXIS",
      version: "0.1.0",
      platform: "linux",
      electronVersion: "31.0.0",
      chromeVersion: "126.0",
      nodeVersion: "20.0.0"
    })
  };
  return { ai, conversations, emit: (event: AiStreamEvent) => listener?.(event) };
}

function configuredStatus(): AiProviderStatus {
  return { provider: "gemini", configured: true, backend: "os-encrypted", secure: true, persistentStorageAvailable: true, nativeBridgeAvailable: true };
}

function freshRoot(): HTMLElement {
  document.body.innerHTML = "";
  window.localStorage.clear();
  const root = document.createElement("div");
  root.id = "app";
  document.body.appendChild(root);
  return root;
}

async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

function goToWorkspace(root: HTMLElement): void {
  root.querySelector<HTMLButtonElement>("#nav-workspace")?.click();
}

function lastRequestId(ai: FakeAiBridge): string {
  const call = ai.sendStreamingRequest.mock.calls.at(-1);
  return (call?.[0] as { requestId: string }).requestId;
}

function sendMessage(root: HTMLElement, text: string): void {
  const textarea = root.querySelector<HTMLTextAreaElement>("#workspace-composer-textarea")!;
  textarea.value = text;
  textarea.dispatchEvent(new Event("input"));
  root.querySelector<HTMLButtonElement>("#workspace-composer-send")?.click();
}

describe("Workspace <-> conversation persistence integration", () => {
  let root: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    root = freshRoot();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as { axis?: unknown }).axis;
  });

  it("a completed turn is saved to the repository with a generated title and complete status", async () => {
    const { ai, conversations, emit } = installBridge(configuredStatus());
    mountApp(root);
    await flush();
    goToWorkspace(root);

    sendMessage(root, "What is the capital of France?");
    await flush();
    const requestId = lastRequestId(ai);
    emit({ requestId, type: "delta", text: "Paris" });
    emit({ requestId, type: "done", truncated: false });
    await flush();

    expect(conversations.save).toHaveBeenCalled();
    const saved = [...conversations.store.values()][0]!;
    expect(saved.title).toBe("What is the capital of France?");
    expect(saved.messages).toHaveLength(2);
    expect(saved.messages[0]?.role).toBe("user");
    expect(saved.messages[1]?.role).toBe("assistant");
    expect(saved.messages[1]?.status).toBe("complete");
    expect(saved.messages[1]?.text).toBe("Paris");
  });

  it("a cancelled turn is saved honestly as cancelled, never as complete", async () => {
    const { ai, conversations, emit } = installBridge(configuredStatus());
    mountApp(root);
    await flush();
    goToWorkspace(root);

    sendMessage(root, "Tell me something long");
    await flush();
    const requestId = lastRequestId(ai);
    emit({ requestId, type: "delta", text: "partial" });
    root.querySelector<HTMLButtonElement>("#workspace-composer-cancel")?.click();
    await flush();

    const saved = [...conversations.store.values()][0]!;
    expect(saved.messages[1]?.status).toBe("cancelled");
    expect(saved.messages[1]?.text).toBe("partial");
  });

  it("a failed turn is saved honestly as error, with the error message, never as complete", async () => {
    const { ai, conversations, emit } = installBridge(configuredStatus());
    mountApp(root);
    await flush();
    goToWorkspace(root);

    sendMessage(root, "This will fail");
    await flush();
    const requestId = lastRequestId(ai);
    emit({ requestId, type: "error", code: "NETWORK_ERROR", message: "Could not reach Gemini." });
    await flush();

    const saved = [...conversations.store.values()][0]!;
    expect(saved.messages[1]?.status).toBe("error");
    expect(saved.messages[1]?.errorMessage).toBe("Could not reach Gemini.");
  });

  it("New conversation starts a distinct conversation id — sending again creates a second saved record", async () => {
    const { ai, conversations, emit } = installBridge(configuredStatus());
    mountApp(root);
    await flush();
    goToWorkspace(root);

    sendMessage(root, "First conversation message");
    await flush();
    emit({ requestId: lastRequestId(ai), type: "done", truncated: false });
    await flush();
    expect(conversations.store.size).toBe(1);
    const firstId = [...conversations.store.keys()][0];

    // Two-click confirm for "New conversation".
    const newConvButton = root.querySelector<HTMLButtonElement>("#workspace-new-conversation")!;
    newConvButton.click();
    newConvButton.click();

    sendMessage(root, "Second conversation message");
    await flush();
    emit({ requestId: lastRequestId(ai), type: "done", truncated: false });
    await flush();

    expect(conversations.store.size).toBe(2);
    const ids = [...conversations.store.keys()];
    expect(ids).toContain(firstId);
    expect(ids.filter((id) => id !== firstId)).toHaveLength(1);
  });

  it("reopening a saved conversation from History restores its transcript in the Workspace", async () => {
    const { conversations } = installBridge(configuredStatus());
    const now = Date.now();
    const record: ConversationRecord = {
      id: "conv-saved-1",
      title: "A previous chat",
      createdAt: now,
      updatedAt: now,
      messages: [
        { id: "m1", role: "user", text: "What is 2+2?", status: "complete", truncated: false, createdAt: now },
        { id: "m2", role: "assistant", text: "4", status: "complete", truncated: false, createdAt: now }
      ]
    };
    conversations.store.set(record.id, record);

    const { store } = mountApp(root);
    await flush();

    // Simulate History's "Open" action.
    store.requestOpenConversation("conv-saved-1");
    await flush();

    expect(root.querySelector("#view-workspace")?.hasAttribute("hidden")).toBe(false);
    expect(root.textContent).toContain("What is 2+2?");
    expect(root.textContent).toContain("4");
    expect(store.getState().pendingOpenConversationId).toBeNull();
  });

  it("opening a conversation that no longer exists reports an honest error instead of crashing", async () => {
    installBridge(configuredStatus());
    const { store } = mountApp(root);
    await flush();

    store.requestOpenConversation("does-not-exist");
    await flush();

    expect(root.querySelector("#workspace-save-status")?.hasAttribute("hidden")).toBe(false);
    const statusEl = root.querySelector("#workspace-save-status");
    expect(statusEl?.hidden).toBe(false);
    expect(store.getState().pendingOpenConversationId).toBeNull();
  });

  it("reopening a conversation and continuing it sends only the bounded, complete prior turns to Gemini — never cancelled/error/incomplete ones", async () => {
    const { ai, conversations } = installBridge(configuredStatus());
    const now = Date.now();
    const record: ConversationRecord = {
      id: "conv-mixed",
      title: "Mixed history",
      createdAt: now,
      updatedAt: now,
      messages: [
        { id: "c1-user", role: "user", text: "First complete question", status: "complete", truncated: false, createdAt: now },
        { id: "c1-assistant", role: "assistant", text: "First complete answer", status: "complete", truncated: false, createdAt: now },
        { id: "c2-user", role: "user", text: "A cancelled question", status: "complete", truncated: false, createdAt: now },
        { id: "c2-assistant", role: "assistant", text: "", status: "cancelled", truncated: false, createdAt: now },
        { id: "c3-user", role: "user", text: "A failed question", status: "complete", truncated: false, createdAt: now },
        { id: "c3-assistant", role: "assistant", text: "", status: "error", truncated: false, createdAt: now, errorMessage: "boom" },
        { id: "c4-user", role: "user", text: "An interrupted question", status: "complete", truncated: false, createdAt: now },
        { id: "c4-assistant", role: "assistant", text: "half an answer", status: "incomplete", truncated: false, createdAt: now }
      ]
    };
    conversations.store.set(record.id, record);

    const { store } = mountApp(root);
    await flush();
    store.requestOpenConversation("conv-mixed");
    await flush();

    sendMessage(root, "Continuing the conversation");
    await flush();

    const payload = ai.sendStreamingRequest.mock.calls.at(-1)?.[0] as { history?: Array<{ role: string; text: string }> };
    expect(payload.history).toEqual([
      { role: "user", text: "First complete question" },
      { role: "model", text: "First complete answer" }
    ]);
  });

  it("safely renders a restored stored message's text, never as HTML, even if it looks like markup", async () => {
    const { conversations } = installBridge(configuredStatus());
    const now = Date.now();
    const maliciousText = "<img src=x onerror=\"window.__pwned=true\"> <b>bold</b>";
    const record: ConversationRecord = {
      id: "conv-xss",
      title: "Untitled",
      createdAt: now,
      updatedAt: now,
      messages: [
        { id: "m1", role: "user", text: "Show me some HTML", status: "complete", truncated: false, createdAt: now },
        { id: "m2", role: "assistant", text: maliciousText, status: "complete", truncated: false, createdAt: now }
      ]
    };
    conversations.store.set(record.id, record);

    const { store } = mountApp(root);
    await flush();
    store.requestOpenConversation("conv-xss");
    await flush();

    const responseBody = root.querySelector(".axis-turn__body");
    expect(responseBody?.querySelector("img")).toBeNull();
    expect(responseBody?.querySelector("b")).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    expect(root.textContent).toContain("<img src=x onerror=");
    expect(root.textContent).toContain("<b>bold</b>");
  });

  it("renders a restored incomplete turn honestly (never as 'Generating…') with a Retry option", async () => {
    const { conversations } = installBridge(configuredStatus());
    const now = Date.now();
    const record: ConversationRecord = {
      id: "conv-incomplete",
      title: "Interrupted chat",
      createdAt: now,
      updatedAt: now,
      messages: [
        { id: "m1", role: "user", text: "Were you able to finish?", status: "complete", truncated: false, createdAt: now },
        { id: "m2", role: "assistant", text: "", status: "incomplete", truncated: false, createdAt: now }
      ]
    };
    conversations.store.set(record.id, record);

    const { store } = mountApp(root);
    await flush();
    store.requestOpenConversation("conv-incomplete");
    await flush();

    expect(root.textContent).toContain("Incomplete");
    expect(root.textContent).not.toContain("Generating…");
    expect(root.querySelector(".axis-turn__response--incomplete")).not.toBeNull();
    const retryButtons = Array.from(root.querySelectorAll("button")).filter((b) => b.textContent === "Retry");
    expect(retryButtons.length).toBeGreaterThan(0);
  });

  it("switching to a different saved conversation mid-stream cancels and isolates the old request end-to-end", async () => {
    const { ai, conversations, emit } = installBridge(configuredStatus());
    const now = Date.now();
    const other: ConversationRecord = {
      id: "conv-other",
      title: "Other conversation",
      createdAt: now,
      updatedAt: now,
      messages: [{ id: "m1", role: "user", text: "Hi from other", status: "complete", truncated: false, createdAt: now }]
    };
    conversations.store.set(other.id, other);

    const { store } = mountApp(root);
    await flush();
    goToWorkspace(root);

    sendMessage(root, "Streaming message");
    await flush();
    const requestId = lastRequestId(ai);
    emit({ requestId, type: "delta", text: "partial A" });
    await flush();
    expect(root.textContent).toContain("partial A");

    store.requestOpenConversation("conv-other");
    await flush();

    // The old stream's late delta must never leak into the now-open conversation B.
    emit({ requestId, type: "delta", text: " — leaked text" });
    await flush();
    expect(root.textContent).not.toContain("leaked text");
    expect(root.textContent).toContain("Hi from other");
  });
});
