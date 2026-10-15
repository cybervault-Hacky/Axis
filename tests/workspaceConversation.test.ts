import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountApp } from "../src/renderer/ts/app";
import type { AiProviderStatus, AiStreamEvent, AiStreamStartResult } from "../src/shared/ai-contract";

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

function installBridge(status: AiProviderStatus): { ai: FakeAiBridge; emit: (event: AiStreamEvent) => void } {
  let listener: StreamListener | null = null;
  const ai: FakeAiBridge = {
    getStatus: vi.fn().mockResolvedValue(status),
    importCredential: vi.fn(),
    removeCredential: vi.fn(),
    testConnection: vi.fn(),
    sendRequest: vi.fn(),
    cancelRequest: vi.fn().mockResolvedValue({ ok: true }),
    // By default, acknowledge whatever requestId the caller generated —
    // integration tests never know that id in advance (it's a real
    // crypto.randomUUID() from the unmocked renderer code), so emitting
    // stream events must always target the real id captured after sending.
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
  (window as unknown as { axis: { ai: FakeAiBridge; getAppInfo: () => Promise<unknown> } }).axis = {
    ai,
    getAppInfo: vi.fn().mockResolvedValue({
      name: "AXIS",
      version: "0.1.0",
      platform: "linux",
      electronVersion: "31.0.0",
      chromeVersion: "126.0",
      nodeVersion: "20.0.0"
    })
  };
  return { ai, emit: (event: AiStreamEvent) => listener?.(event) };
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

function ackOk(requestId: string): AiStreamStartResult {
  return { ok: true, requestId };
}

/** The id a given sendStreamingRequest call most recently received — a real crypto.randomUUID() from unmocked code. */
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

describe("AI Workspace conversation experience", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = freshRoot();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true
    });
  });

  afterEach(() => {
    delete (window as { axis?: unknown }).axis;
  });

  it("shows the empty state before any message, then streams deltas into a visible turn as they arrive", async () => {
    const { ai, emit } = installBridge(configuredStatus());
    mountApp(root);
    await flush();
    goToWorkspace(root);

    expect(root.querySelector("#workspace-conversation-empty")?.hasAttribute("hidden")).toBe(false);

    const sendButton = root.querySelector<HTMLButtonElement>("#workspace-composer-send")!;
    sendMessage(root, "Hello AXIS");
    await flush();

    const requestId = lastRequestId(ai);
    expect(sendButton.disabled).toBe(true);
    expect(root.querySelector("#workspace-conversation-empty")?.hasAttribute("hidden")).toBe(true);
    expect(root.querySelector(".axis-turn__prompt-text")?.textContent).toBe("Hello AXIS");

    emit({ requestId, type: "delta", text: "Hi " });
    emit({ requestId, type: "delta", text: "there!" });
    await flush();
    expect(root.querySelector(".axis-turn__paragraph")?.textContent).toBe("Hi there!");

    emit({ requestId, type: "done", truncated: false });
    await flush();
    // Not busy anymore, and the textarea still has text, so Send re-enables.
    expect(sendButton.disabled).toBe(false);
    expect(root.querySelector(".axis-turn__response")?.className).toContain("axis-turn__response--complete");
  });

  it("keeps a completed turn's DOM nodes referentially stable while a later turn streams (Phase 20)", async () => {
    // Regression test for the Phase 20 rendering optimization: before the
    // fix, `conversationView.render()` called `list.replaceChildren(...)`
    // on every delta, tearing down and rebuilding *every* turn's DOM —
    // including already-completed ones — on every single streamed chunk
    // of a different, still-pending turn. This asserts actual DOM node
    // identity (`===`), not just equivalent content, so it would fail
    // against the old full-rebuild implementation.
    const { ai, emit } = installBridge(configuredStatus());
    mountApp(root);
    await flush();
    goToWorkspace(root);

    sendMessage(root, "First message");
    await flush();
    const firstId = lastRequestId(ai);
    emit({ requestId: firstId, type: "delta", text: "First reply." });
    emit({ requestId: firstId, type: "done", truncated: false });
    await flush();

    expect(root.querySelectorAll(".axis-turn")).toHaveLength(1);
    const firstLi = root.querySelector(".axis-turn")!;
    const firstPromptText = root.querySelector(".axis-turn__prompt-text")!;
    const firstBody = root.querySelector(".axis-turn__body")!;
    const firstCopyButton = root.querySelector(".axis-turn__actions button")!;

    sendMessage(root, "Second message");
    await flush();
    const secondId = lastRequestId(ai);
    expect(secondId).not.toBe(firstId);

    // Stream several deltas into the *second* turn only.
    emit({ requestId: secondId, type: "delta", text: "Second " });
    await flush();
    emit({ requestId: secondId, type: "delta", text: "reply " });
    await flush();
    emit({ requestId: secondId, type: "delta", text: "in progress." });
    await flush();

    expect(root.querySelectorAll(".axis-turn")).toHaveLength(2);
    // The first (completed) turn's own nodes must be the exact same
    // objects as before — never replaced — even though the transcript
    // re-rendered multiple times while the second turn streamed.
    expect(root.querySelectorAll(".axis-turn")[0]).toBe(firstLi);
    expect(root.querySelector(".axis-turn__prompt-text")).toBe(firstPromptText);
    expect(root.querySelectorAll(".axis-turn__body")[0]).toBe(firstBody);
    expect(root.querySelectorAll(".axis-turn__actions button")[0]).toBe(firstCopyButton);
    // Its rendered content is unaffected by the sibling turn's streaming.
    expect(firstBody.textContent).toBe("First reply.");

    emit({ requestId: secondId, type: "done", truncated: false });
    await flush();
    expect(root.querySelectorAll(".axis-turn__body")[1]?.textContent).toBe("Second reply in progress.");
  });

  it("replaces only the active turn's body across consecutive deltas, leaving its own header/actions nodes stable", async () => {
    const { ai, emit } = installBridge(configuredStatus());
    mountApp(root);
    await flush();
    goToWorkspace(root);

    sendMessage(root, "Streaming target");
    await flush();
    const requestId = lastRequestId(ai);

    const li = root.querySelector(".axis-turn")!;
    const stateLabel = root.querySelector(".axis-turn__state")!;
    const actions = root.querySelector(".axis-turn__actions")!;

    emit({ requestId, type: "delta", text: "Chunk one. " });
    await flush();
    const bodyAfterFirstDelta = root.querySelector(".axis-turn__body")!;

    emit({ requestId, type: "delta", text: "Chunk two." });
    await flush();

    // The <li>, its state label, and its actions row persist across
    // deltas — only the body (which actually changed) gets swapped.
    expect(root.querySelector(".axis-turn")).toBe(li);
    expect(root.querySelector(".axis-turn__state")).toBe(stateLabel);
    expect(root.querySelector(".axis-turn__actions")).toBe(actions);
    expect(root.querySelector(".axis-turn__body")?.textContent).toBe("Chunk one. Chunk two.");
    // The body itself is a fresh node per content change (it is rebuilt
    // from the accumulated text), so it is *not* expected to equal the
    // pre-delta reference — confirming the body really was updated.
    expect(root.querySelector(".axis-turn__body")).not.toBe(bodyAfterFirstDelta);

    emit({ requestId, type: "done", truncated: false });
    await flush();
    expect(root.querySelector(".axis-turn")).toBe(li);
    expect(stateLabel.textContent).toBe("Response");
  });

  it("never renders model output as HTML even when it looks like markup", async () => {
    const { ai, emit } = installBridge(configuredStatus());
    mountApp(root);
    await flush();
    goToWorkspace(root);

    sendMessage(root, "Say something unsafe");
    await flush();
    const requestId = lastRequestId(ai);

    const malicious = "<img src=x onerror=alert(1)>Hello & <b>world</b>";
    emit({ requestId, type: "delta", text: malicious });
    emit({ requestId, type: "done", truncated: false });
    await flush();

    expect(root.querySelector(".axis-turn__paragraph")?.textContent).toBe(malicious);
    expect(root.querySelector("#view-workspace img")).toBeNull();
    expect(root.querySelector("#view-workspace b")).toBeNull();
  });

  it("renders a fenced code block as a distinct code element with a working copy-code action", async () => {
    const { ai, emit } = installBridge(configuredStatus());
    mountApp(root);
    await flush();
    goToWorkspace(root);

    sendMessage(root, "Show me code");
    await flush();
    const requestId = lastRequestId(ai);

    emit({ requestId, type: "delta", text: "Sure:\n```js\nconsole.log('hi')\n```\nDone." });
    emit({ requestId, type: "done", truncated: false });
    await flush();

    const code = root.querySelector(".axis-code__code");
    expect(code?.textContent).toBe("console.log('hi')");

    const copyCodeButton = Array.from(root.querySelectorAll<HTMLButtonElement>(".axis-code__header button")).find(
      (btn) => btn.textContent === "Copy code"
    );
    copyCodeButton?.click();
    await flush();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("console.log('hi')");
    expect(copyCodeButton?.textContent).toBe("Copied");
  });

  it("stops generation on Cancel, shows a distinct 'Stopped' state, preserves the draft, and never lets a late event resurrect it", async () => {
    const { ai, emit } = installBridge(configuredStatus());
    mountApp(root);
    await flush();
    goToWorkspace(root);

    const textarea = root.querySelector<HTMLTextAreaElement>("#workspace-composer-textarea")!;
    sendMessage(root, "Draft that must survive cancellation");
    await flush();
    const requestId = lastRequestId(ai);

    emit({ requestId, type: "delta", text: "partial answer" });
    await flush();

    const cancelButton = root.querySelector<HTMLButtonElement>("#workspace-composer-cancel")!;
    expect(cancelButton.hidden).toBe(false);
    cancelButton.click();
    await flush();

    expect(ai.cancelRequest).toHaveBeenCalledWith(requestId);
    expect(textarea.value).toBe("Draft that must survive cancellation");
    expect(root.querySelector(".axis-turn__response")?.className).toContain("axis-turn__response--cancelled");
    expect(root.querySelector(".axis-turn__state")?.textContent).toBe("Stopped");

    // A late "done" for the cancelled request must never overwrite the cancelled state.
    emit({ requestId, type: "done", truncated: false });
    await flush();
    expect(root.querySelector(".axis-turn__response")?.className).toContain("axis-turn__response--cancelled");
  });

  it("shows an explicit Retry control on a failed turn, and retrying sends a brand-new request with the same prompt", async () => {
    const { ai, emit } = installBridge(configuredStatus());
    mountApp(root);
    await flush();
    goToWorkspace(root);

    sendMessage(root, "Flaky prompt");
    await flush();
    const firstId = lastRequestId(ai);

    emit({
      requestId: firstId,
      type: "error",
      code: "NETWORK_ERROR",
      message: "Could not reach Gemini. Check your network connection and try again."
    });
    await flush();

    expect(root.querySelector(".axis-turn__state")?.textContent).toBe("Failed");
    const retryButton = Array.from(root.querySelectorAll<HTMLButtonElement>(".axis-turn__actions button")).find(
      (btn) => btn.textContent === "Retry"
    )!;
    expect(retryButton).toBeTruthy();

    retryButton.click();
    await flush();

    expect(ai.sendStreamingRequest).toHaveBeenCalledTimes(2);
    const secondPayload = ai.sendStreamingRequest.mock.calls[1]?.[0] as { prompt: string; requestId: string };
    expect(secondPayload.prompt).toBe("Flaky prompt");
    expect(secondPayload.requestId).not.toBe(firstId);
    expect(root.querySelectorAll(".axis-turn")).toHaveLength(2);
  });

  it("requires a second click within the confirmation window before 'New conversation' actually clears anything", async () => {
    const { ai, emit } = installBridge(configuredStatus());
    mountApp(root);
    await flush();
    goToWorkspace(root);

    sendMessage(root, "Hello");
    await flush();
    const requestId = lastRequestId(ai);
    emit({ requestId, type: "done", truncated: false });
    await flush();

    const newConvoButton = root.querySelector<HTMLButtonElement>("#workspace-new-conversation")!;
    expect(root.querySelectorAll(".axis-turn")).toHaveLength(1);

    newConvoButton.click();
    expect(newConvoButton.textContent).toContain("again");
    expect(root.querySelectorAll(".axis-turn")).toHaveLength(1); // not cleared yet

    newConvoButton.click();
    expect(root.querySelectorAll(".axis-turn")).toHaveLength(0);
    expect(root.querySelector("#workspace-conversation-empty")?.hasAttribute("hidden")).toBe(false);
    expect(newConvoButton.textContent).toBe("New conversation");
  });

  it("prevents duplicate submissions while a request is already streaming", async () => {
    const { ai } = installBridge(configuredStatus());
    mountApp(root);
    await flush();
    goToWorkspace(root);

    const textarea = root.querySelector<HTMLTextAreaElement>("#workspace-composer-textarea")!;
    const sendButton = root.querySelector<HTMLButtonElement>("#workspace-composer-send")!;
    textarea.value = "Hello AXIS";
    textarea.dispatchEvent(new Event("input"));

    let resolveAck!: (value: AiStreamStartResult) => void;
    ai.sendStreamingRequest.mockReturnValue(new Promise((resolve) => (resolveAck = resolve)));
    sendButton.click();
    await flush();
    sendButton.click();
    sendButton.click();
    await flush();

    expect(ai.sendStreamingRequest).toHaveBeenCalledTimes(1);
    resolveAck(ackOk("whatever-id"));
    await flush();
  });

  it("reports an honest 'no AI engine' message in the transcript without calling the bridge when there is no native bridge at all", async () => {
    mountApp(root);
    await flush();
    goToWorkspace(root);

    sendMessage(root, "Hello");
    await flush();

    expect(root.querySelector(".axis-turn__state")?.textContent).toBe("Failed");
    expect(root.querySelector(".axis-turn__paragraph--error")?.textContent?.toLowerCase()).toContain("ai engine");
    expect(root.querySelector<HTMLTextAreaElement>("#workspace-composer-textarea")?.value).toBe("Hello");
  });

  it("guides the user to Settings when no credential is configured, without calling the provider", async () => {
    const { ai } = installBridge({
      provider: "gemini",
      configured: false,
      backend: "none",
      secure: false,
      persistentStorageAvailable: true,
      nativeBridgeAvailable: true
    });
    mountApp(root);
    await flush();
    goToWorkspace(root);

    sendMessage(root, "Hello");
    await flush();

    expect(ai.sendStreamingRequest).not.toHaveBeenCalled();
    expect(root.querySelector(".axis-turn__paragraph--error")?.textContent).toContain("Settings");
  });

  it("submits on plain Enter and inserts a newline (does not submit) on Shift+Enter", async () => {
    const { ai, emit } = installBridge(configuredStatus());
    mountApp(root);
    await flush();
    goToWorkspace(root);

    const textarea = root.querySelector<HTMLTextAreaElement>("#workspace-composer-textarea")!;
    textarea.value = "Hello";
    textarea.dispatchEvent(new Event("input"));

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }));
    await flush();
    expect(ai.sendStreamingRequest).not.toHaveBeenCalled();

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await flush();
    expect(ai.sendStreamingRequest).toHaveBeenCalledTimes(1);
    emit({ requestId: lastRequestId(ai), type: "done", truncated: false });
    await flush();
  });

  it("marks a response truncated by the provider with a visible note, distinct from a complete answer", async () => {
    const { ai, emit } = installBridge(configuredStatus());
    mountApp(root);
    await flush();
    goToWorkspace(root);

    sendMessage(root, "Tell a long story");
    await flush();
    const requestId = lastRequestId(ai);

    emit({ requestId, type: "delta", text: "Once upon a time" });
    emit({ requestId, type: "done", truncated: true });
    await flush();

    expect(root.querySelector(".axis-turn__note")?.textContent).toContain("may be incomplete");
  });

  it("rejects an oversized prompt with a helpful validation message, without calling the provider", async () => {
    const { ai } = installBridge(configuredStatus());
    mountApp(root);
    await flush();
    goToWorkspace(root);

    sendMessage(root, "x".repeat(9000));
    await flush();

    expect(ai.sendStreamingRequest).not.toHaveBeenCalled();
    expect(root.querySelector(".axis-turn__state")?.textContent).toBe("Failed");
  });

  it("sends the currently selected AI provider in the streaming request payload (Phase 9)", async () => {
    const { ai } = installBridge(configuredStatus());
    mountApp(root);
    await flush();
    goToWorkspace(root);

    sendMessage(root, "Hello with default provider");
    await flush();
    expect(ai.sendStreamingRequest.mock.calls.at(-1)?.[0]).toMatchObject({ provider: "gemini" });
  });

  it("uses the persisted provider selection (openai) for a new conversation's requests, never silently falling back to gemini", async () => {
    window.localStorage.setItem("axis.settings.v1", JSON.stringify({ aiProvider: "openai" }));
    const { ai } = installBridge({ provider: "openai", configured: true, backend: "os-encrypted", secure: true, persistentStorageAvailable: true, nativeBridgeAvailable: true });
    mountApp(root);
    await flush();
    goToWorkspace(root);

    sendMessage(root, "Hello OpenAI");
    await flush();
    expect(ai.sendStreamingRequest.mock.calls.at(-1)?.[0]).toMatchObject({ provider: "openai" });
  });

  it("uses the persisted provider selection (anthropic) for a new conversation's requests (Phase 10)", async () => {
    window.localStorage.setItem("axis.settings.v1", JSON.stringify({ aiProvider: "anthropic" }));
    const { ai } = installBridge({ provider: "anthropic", configured: true, backend: "os-encrypted", secure: true, persistentStorageAvailable: true, nativeBridgeAvailable: true });
    mountApp(root);
    await flush();
    goToWorkspace(root);

    sendMessage(root, "Hello Claude");
    await flush();
    expect(ai.sendStreamingRequest.mock.calls.at(-1)?.[0]).toMatchObject({ provider: "anthropic" });
  });
});
