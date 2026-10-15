import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSendPayload,
  cancelPrompt,
  getAiStatus,
  hasNativeBridge,
  importCredential,
  removeCredential,
  sendPrompt,
  testConnection
} from "../src/renderer/ts/ai/aiClient";
import { MAX_PROMPT_CHARS } from "../src/shared/ai-contract";

function installFakeBridge() {
  const ai = {
    getStatus: vi.fn(),
    importCredential: vi.fn(),
    removeCredential: vi.fn(),
    testConnection: vi.fn(),
    sendRequest: vi.fn(),
    cancelRequest: vi.fn()
  };
  (window as unknown as { axis: { ai: typeof ai; getAppInfo: () => Promise<unknown> } }).axis = {
    ai,
    getAppInfo: vi.fn()
  };
  return ai;
}

describe("aiClient (browser-preview mode: no native bridge)", () => {
  afterEach(() => {
    delete (window as { axis?: unknown }).axis;
  });

  it("reports the bridge as unavailable and never fakes a configured/ready state", async () => {
    expect(hasNativeBridge()).toBe(false);
    const status = await getAiStatus();
    expect(status.nativeBridgeAvailable).toBe(false);
    expect(status.configured).toBe(false);
  });

  it("reflects the requested provider in the bridge-unavailable fallback status (Phase 9/10)", async () => {
    expect((await getAiStatus()).provider).toBe("gemini");
    expect((await getAiStatus("openai")).provider).toBe("openai");
    expect((await getAiStatus("anthropic")).provider).toBe("anthropic");
  });

  it("returns BRIDGE_UNAVAILABLE for every native-only action instead of simulating it", async () => {
    const imported = await importCredential();
    expect(imported).toMatchObject({ ok: false, code: "BRIDGE_UNAVAILABLE" });

    const removed = await removeCredential();
    expect(removed).toMatchObject({ ok: false, code: "BRIDGE_UNAVAILABLE" });

    const tested = await testConnection();
    expect(tested).toMatchObject({ ok: false, code: "BRIDGE_UNAVAILABLE" });

    const sent = await sendPrompt({ requestId: "r1", prompt: "hi" });
    expect(sent).toMatchObject({ ok: false, requestId: "r1", code: "BRIDGE_UNAVAILABLE" });

    // Must not throw even with no bridge present.
    await expect(cancelPrompt("r1")).resolves.toBeUndefined();
  });
});

describe("aiClient (native bridge present)", () => {
  afterEach(() => {
    delete (window as { axis?: unknown }).axis;
  });

  it("forwards calls to window.axis.ai and returns its result verbatim", async () => {
    const ai = installFakeBridge();
    ai.getStatus.mockResolvedValue({
      provider: "gemini",
      configured: true,
      backend: "os-encrypted",
      secure: true,
      persistentStorageAvailable: true,
      nativeBridgeAvailable: true
    });
    ai.sendRequest.mockResolvedValue({ ok: true, requestId: "r1", text: "hello", truncated: false });

    expect(hasNativeBridge()).toBe(true);
    const status = await getAiStatus();
    expect(status.configured).toBe(true);

    const result = await sendPrompt({ requestId: "r1", prompt: "hi" });
    expect(result).toEqual({ ok: true, requestId: "r1", text: "hello", truncated: false });
    expect(ai.sendRequest).toHaveBeenCalledWith({ requestId: "r1", prompt: "hi" });
  });

  it("maps a thrown bridge error to a safe INTERNAL_ERROR instead of propagating it", async () => {
    const ai = installFakeBridge();
    ai.testConnection.mockRejectedValue(new Error("boom"));
    const result = await testConnection();
    expect(result).toMatchObject({ ok: false, code: "INTERNAL_ERROR" });
  });

  it("cancelPrompt calls the bridge and swallows bridge errors", async () => {
    const ai = installFakeBridge();
    ai.cancelRequest.mockRejectedValue(new Error("boom"));
    await expect(cancelPrompt("r1")).resolves.toBeUndefined();
    expect(ai.cancelRequest).toHaveBeenCalledWith("r1");
  });

  it("forwards the requested provider to getStatus/removeCredential/testConnection (Phase 9)", async () => {
    const ai = installFakeBridge();
    ai.getStatus.mockResolvedValue({
      provider: "openai",
      configured: false,
      backend: "none",
      secure: false,
      persistentStorageAvailable: true,
      nativeBridgeAvailable: true
    });
    ai.removeCredential.mockResolvedValue({ ok: true });
    ai.testConnection.mockResolvedValue({ ok: true });

    await getAiStatus("openai");
    expect(ai.getStatus).toHaveBeenCalledWith("openai");

    await removeCredential("openai");
    expect(ai.removeCredential).toHaveBeenCalledWith("openai");

    await testConnection("openai");
    expect(ai.testConnection).toHaveBeenCalledWith("openai");
  });
});

describe("buildSendPayload", () => {
  it("builds a valid payload with a fresh request id for a normal prompt", () => {
    const payload = buildSendPayload("Hello there");
    expect(payload).not.toBeNull();
    expect(payload?.prompt).toBe("Hello there");
    expect(typeof payload?.requestId).toBe("string");
    expect(payload?.requestId.length).toBeGreaterThan(0);
  });

  it("returns null for an empty prompt instead of a fabricated payload", () => {
    expect(buildSendPayload("   ")).toBeNull();
  });

  it("returns null for an oversized prompt", () => {
    expect(buildSendPayload("x".repeat(MAX_PROMPT_CHARS + 1))).toBeNull();
  });

  it("produces different request ids for successive calls", () => {
    const a = buildSendPayload("one");
    const b = buildSendPayload("two");
    expect(a?.requestId).not.toBe(b?.requestId);
  });

  it("omits the provider field entirely when none is requested, and includes it when one is (Phase 9)", () => {
    const withoutProvider = buildSendPayload("hi");
    expect(withoutProvider?.provider).toBeUndefined();

    const withProvider = buildSendPayload("hi", { provider: "openai" });
    expect(withProvider?.provider).toBe("openai");
  });
});
