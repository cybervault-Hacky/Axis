import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountApp } from "../src/renderer/ts/app";
import type { AiProviderStatus, AiSendResult } from "../src/shared/ai-contract";

interface FakeAiBridge {
  getStatus: ReturnType<typeof vi.fn>;
  importCredential: ReturnType<typeof vi.fn>;
  removeCredential: ReturnType<typeof vi.fn>;
  testConnection: ReturnType<typeof vi.fn>;
  sendRequest: ReturnType<typeof vi.fn>;
  cancelRequest: ReturnType<typeof vi.fn>;
}

function installBridge(status: AiProviderStatus): FakeAiBridge {
  const ai: FakeAiBridge = {
    getStatus: vi.fn().mockResolvedValue(status),
    importCredential: vi.fn(),
    removeCredential: vi.fn(),
    testConnection: vi.fn(),
    sendRequest: vi.fn(),
    cancelRequest: vi.fn().mockResolvedValue({ ok: true })
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
  return ai;
}

function configuredStatus(): AiProviderStatus {
  return {
    provider: "gemini",
    configured: true,
    backend: "os-encrypted",
    secure: true,
    persistentStorageAvailable: true,
    nativeBridgeAvailable: true
  };
}

function unconfiguredStatus(): AiProviderStatus {
  return {
    provider: "gemini",
    configured: false,
    backend: "none",
    secure: false,
    persistentStorageAvailable: true,
    nativeBridgeAvailable: true
  };
}

function freshRoot(): HTMLElement {
  document.body.innerHTML = "";
  window.localStorage.clear();
  const root = document.createElement("div");
  root.id = "app";
  document.body.appendChild(root);
  return root;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await Promise.resolve();
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("composer <-> AI engine lifecycle (Home view)", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = freshRoot();
  });

  afterEach(() => {
    delete (window as { axis?: unknown }).axis;
  });

  it("shows a loading state, disables Send, reveals Cancel, then renders the response safely as text", async () => {
    const ai = installBridge(configuredStatus());
    mountApp(root);
    await flush();

    const textarea = root.querySelector<HTMLTextAreaElement>("#home-composer-textarea")!;
    const sendButton = root.querySelector<HTMLButtonElement>("#home-composer-send")!;
    const cancelButton = root.querySelector<HTMLButtonElement>("#home-composer-cancel")!;

    textarea.value = "Hello AXIS";
    textarea.dispatchEvent(new Event("input"));

    const deferred = createDeferred<AiSendResult>();
    ai.sendRequest.mockReturnValue(deferred.promise);

    sendButton.click();
    await flush();

    expect(ai.sendRequest).toHaveBeenCalledTimes(1);
    expect(sendButton.disabled).toBe(true);
    expect(cancelButton.hidden).toBe(false);
    expect(root.querySelector("#home-response-title")?.textContent).toContain("Sending");

    const maliciousLookingText = "<img src=x onerror=alert(1)>Hello & <b>world</b>";
    deferred.resolve({ ok: true, requestId: (ai.sendRequest.mock.calls[0]?.[0] as { requestId: string }).requestId, text: maliciousLookingText, truncated: false });
    await flush();

    // No longer busy, and the composer still has text, so Send is re-enabled.
    expect(sendButton.disabled).toBe(false);
    const responseDetail = root.querySelector("#home-response-detail");
    expect(responseDetail?.textContent).toBe(maliciousLookingText);
    // Never parsed as HTML: no actual <img>/<b> element exists anywhere.
    expect(root.querySelector("img")).toBeNull();
    expect(responseDetail?.querySelector("b")).toBeNull();
    expect(cancelButton.hidden).toBe(true);
  });

  it("prevents duplicate submissions while a request is already in flight", async () => {
    const ai = installBridge(configuredStatus());
    mountApp(root);
    await flush();

    const textarea = root.querySelector<HTMLTextAreaElement>("#home-composer-textarea")!;
    const sendButton = root.querySelector<HTMLButtonElement>("#home-composer-send")!;

    textarea.value = "Hello AXIS";
    textarea.dispatchEvent(new Event("input"));

    const deferred = createDeferred<AiSendResult>();
    ai.sendRequest.mockReturnValue(deferred.promise);

    sendButton.click();
    await flush();
    // Send is now disabled by the busy state; a further click must be a no-op.
    sendButton.click();
    sendButton.click();
    await flush();

    expect(ai.sendRequest).toHaveBeenCalledTimes(1);

    deferred.resolve({ ok: true, requestId: "whatever", text: "done", truncated: false });
    await flush();
  });

  it("cancels an active request, preserves the draft, and re-enables Send", async () => {
    const ai = installBridge(configuredStatus());
    mountApp(root);
    await flush();

    const textarea = root.querySelector<HTMLTextAreaElement>("#home-composer-textarea")!;
    const sendButton = root.querySelector<HTMLButtonElement>("#home-composer-send")!;
    const cancelButton = root.querySelector<HTMLButtonElement>("#home-composer-cancel")!;

    textarea.value = "Draft that must survive cancellation";
    textarea.dispatchEvent(new Event("input"));

    const deferred = createDeferred<AiSendResult>();
    ai.sendRequest.mockReturnValue(deferred.promise);
    sendButton.click();
    await flush();

    expect(cancelButton.hidden).toBe(false);
    cancelButton.click();
    await flush();

    expect(ai.cancelRequest).toHaveBeenCalledTimes(1);
    expect(textarea.value).toBe("Draft that must survive cancellation");
    expect(sendButton.disabled).toBe(false);
    expect(root.querySelector("#home-response-title")?.textContent?.toLowerCase()).toContain("not sent");

    // A late resolution of the now-superseded request must not overwrite the UI.
    deferred.resolve({ ok: true, requestId: "stale", text: "late answer", truncated: false });
    await flush();
    expect(root.querySelector("#home-response-detail")?.textContent).not.toBe("late answer");
  });

  it("shows a normalized error message without echoing raw provider text", async () => {
    const ai = installBridge(configuredStatus());
    mountApp(root);
    await flush();

    const textarea = root.querySelector<HTMLTextAreaElement>("#home-composer-textarea")!;
    const sendButton = root.querySelector<HTMLButtonElement>("#home-composer-send")!;
    textarea.value = "Hello";
    textarea.dispatchEvent(new Event("input"));

    ai.sendRequest.mockResolvedValue({
      ok: false,
      requestId: "r1",
      code: "RATE_LIMITED",
      message: "Gemini reported a rate limit. Wait a moment and try again."
    });
    sendButton.click();
    await flush();

    expect(root.querySelector("#home-response-title")?.textContent).toContain("not sent");
    expect(root.querySelector("#home-response-detail")?.textContent).toContain("rate limit");
    expect(textarea.value).toBe("Hello");
    expect(sendButton.disabled).toBe(false);
  });

  it("guides the user to Settings when no credential is configured, without calling the provider", async () => {
    const ai = installBridge(unconfiguredStatus());
    mountApp(root);
    await flush();

    const textarea = root.querySelector<HTMLTextAreaElement>("#home-composer-textarea")!;
    const sendButton = root.querySelector<HTMLButtonElement>("#home-composer-send")!;
    textarea.value = "Hello";
    textarea.dispatchEvent(new Event("input"));

    sendButton.click();
    await flush();

    expect(ai.sendRequest).not.toHaveBeenCalled();
    expect(root.querySelector("#home-response-detail")?.textContent).toContain("Settings");
    expect(root.querySelector("#home-status-title")?.textContent).toContain("not configured");
  });

  it("submits on plain Enter and does not submit on Shift+Enter", async () => {
    const ai = installBridge(configuredStatus());
    ai.sendRequest.mockResolvedValue({ ok: true, requestId: "r1", text: "ok", truncated: false });
    mountApp(root);
    await flush();

    const textarea = root.querySelector<HTMLTextAreaElement>("#home-composer-textarea")!;
    textarea.value = "Hello";
    textarea.dispatchEvent(new Event("input"));

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }));
    await flush();
    expect(ai.sendRequest).not.toHaveBeenCalled();

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await flush();
    expect(ai.sendRequest).toHaveBeenCalledTimes(1);
  });
});
