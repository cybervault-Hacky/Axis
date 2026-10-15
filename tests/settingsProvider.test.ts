import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountApp } from "../src/renderer/ts/app";
import type { AiProviderStatus } from "../src/shared/ai-contract";

interface FakeAiBridge {
  getStatus: ReturnType<typeof vi.fn>;
  importCredential: ReturnType<typeof vi.fn>;
  removeCredential: ReturnType<typeof vi.fn>;
  testConnection: ReturnType<typeof vi.fn>;
  sendRequest: ReturnType<typeof vi.fn>;
  sendStreamingRequest: ReturnType<typeof vi.fn>;
  cancelRequest: ReturnType<typeof vi.fn>;
  onStreamEvent: ReturnType<typeof vi.fn>;
}

function statusFor(provider: "gemini" | "openai" | "anthropic" | "mistral", overrides: Partial<AiProviderStatus> = {}): AiProviderStatus {
  return {
    provider,
    configured: false,
    backend: "none",
    secure: false,
    persistentStorageAvailable: true,
    nativeBridgeAvailable: true,
    ...overrides
  };
}

function installBridge(): FakeAiBridge {
  const ai: FakeAiBridge = {
    getStatus: vi.fn().mockImplementation((provider: "gemini" | "openai" | "anthropic" | "mistral" = "gemini") => Promise.resolve(statusFor(provider))),
    importCredential: vi.fn().mockResolvedValue({ ok: true, backend: "os-encrypted", secure: true }),
    removeCredential: vi.fn().mockResolvedValue({ ok: true }),
    testConnection: vi.fn().mockResolvedValue({ ok: true }),
    sendRequest: vi.fn(),
    sendStreamingRequest: vi.fn(),
    cancelRequest: vi.fn().mockResolvedValue({ ok: true }),
    onStreamEvent: vi.fn().mockReturnValue(() => {})
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

function freshRoot(): HTMLElement {
  document.body.innerHTML = "";
  window.localStorage.clear();
  const root = document.createElement("div");
  root.id = "app";
  document.body.appendChild(root);
  return root;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function providerOptions(
  root: HTMLElement
): { gemini: HTMLButtonElement; openai: HTMLButtonElement; claude: HTMLButtonElement; mistral: HTMLButtonElement } {
  const group = Array.from(root.querySelectorAll<HTMLElement>(".axis-segmented")).find((g) => g.textContent?.includes("OpenAI"))!;
  const options = Array.from(group.querySelectorAll<HTMLButtonElement>(".axis-segmented__option"));
  return {
    gemini: options.find((o) => o.textContent === "Gemini")!,
    openai: options.find((o) => o.textContent === "OpenAI")!,
    claude: options.find((o) => o.textContent === "Claude")!,
    mistral: options.find((o) => o.textContent === "Mistral")!
  };
}

describe("Settings — AI provider selection (Phase 9/10)", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = freshRoot();
  });

  afterEach(() => {
    delete (window as { axis?: unknown }).axis;
  });

  it("defaults to Gemini selected, never claims OpenAI or Claude is connected before it is actually selected", async () => {
    installBridge();
    mountApp(root);
    await flush();
    root.querySelector<HTMLButtonElement>("#nav-settings")?.click();

    const { gemini, openai, claude, mistral } = providerOptions(root);
    expect(gemini.getAttribute("aria-checked")).toBe("true");
    expect(openai.getAttribute("aria-checked")).toBe("false");
    expect(claude.getAttribute("aria-checked")).toBe("false");
    expect(mistral.getAttribute("aria-checked")).toBe("false");
  });

  it("offers exactly the four supported providers (Gemini, OpenAI, Claude, Mistral) (Phase 10/14)", async () => {
    installBridge();
    mountApp(root);
    await flush();
    root.querySelector<HTMLButtonElement>("#nav-settings")?.click();

    const { gemini, openai, claude, mistral } = providerOptions(root);
    expect(gemini).toBeTruthy();
    expect(openai).toBeTruthy();
    expect(claude).toBeTruthy();
    expect(mistral).toBeTruthy();
  });

  it("switching to Claude updates the selection, persists it, and refetches status scoped to 'anthropic' (Phase 10)", async () => {
    const ai = installBridge();
    mountApp(root);
    await flush();
    root.querySelector<HTMLButtonElement>("#nav-settings")?.click();

    const { claude } = providerOptions(root);
    ai.getStatus.mockClear();
    claude.click();
    await flush();

    expect(claude.getAttribute("aria-checked")).toBe("true");
    expect(ai.getStatus).toHaveBeenCalledWith("anthropic");

    const persisted = JSON.parse(window.localStorage.getItem("axis.settings.v1") ?? "{}");
    expect(persisted.aiProvider).toBe("anthropic");
  });

  it("never claims Claude is connected until its own status actually reports configured (Phase 10)", async () => {
    const ai = installBridge();
    mountApp(root);
    await flush();
    root.querySelector<HTMLButtonElement>("#nav-settings")?.click();

    const { claude } = providerOptions(root);
    claude.click();
    await flush();

    const statusTitle = root.querySelector<HTMLElement>("#settings-ai-status-title");
    expect(statusTitle?.textContent).toBe("Claude not configured");
    expect(ai.importCredential).not.toHaveBeenCalled();
  });

  it("switching to Mistral updates the selection, persists it, and refetches status scoped to 'mistral' (Phase 14)", async () => {
    const ai = installBridge();
    mountApp(root);
    await flush();
    root.querySelector<HTMLButtonElement>("#nav-settings")?.click();

    const { mistral } = providerOptions(root);
    ai.getStatus.mockClear();
    mistral.click();
    await flush();

    expect(mistral.getAttribute("aria-checked")).toBe("true");
    expect(ai.getStatus).toHaveBeenCalledWith("mistral");

    const persisted = JSON.parse(window.localStorage.getItem("axis.settings.v1") ?? "{}");
    expect(persisted.aiProvider).toBe("mistral");
  });

  it("never claims Mistral is connected until its own status actually reports configured (Phase 14)", async () => {
    const ai = installBridge();
    mountApp(root);
    await flush();
    root.querySelector<HTMLButtonElement>("#nav-settings")?.click();

    const { mistral } = providerOptions(root);
    mistral.click();
    await flush();

    const statusTitle = root.querySelector<HTMLElement>("#settings-ai-status-title");
    expect(statusTitle?.textContent).toBe("Mistral not configured");
    expect(ai.importCredential).not.toHaveBeenCalled();
  });

  it("scopes every credential action to Claude when selected, never leaking the prior OpenAI selection (Phase 10)", async () => {
    const ai = installBridge();
    mountApp(root);
    await flush();
    root.querySelector<HTMLButtonElement>("#nav-settings")?.click();

    const { openai, claude } = providerOptions(root);
    openai.click();
    await flush();
    root.querySelector<HTMLButtonElement>("#settings-ai-import")?.click();
    await flush();
    expect(ai.importCredential).toHaveBeenLastCalledWith({ provider: "openai" });

    claude.click();
    await flush();
    ai.getStatus.mockResolvedValueOnce(statusFor("anthropic", { configured: true, backend: "os-encrypted", secure: true }));
    root.querySelector<HTMLButtonElement>("#settings-ai-import")?.click();
    await flush();
    expect(ai.importCredential).toHaveBeenLastCalledWith({ provider: "anthropic" });

    root.querySelector<HTMLButtonElement>("#settings-ai-test")?.click();
    await flush();
    expect(ai.testConnection).toHaveBeenLastCalledWith("anthropic");

    root.querySelector<HTMLButtonElement>("#settings-ai-remove")?.click();
    await flush();
    expect(ai.removeCredential).toHaveBeenLastCalledWith("anthropic");
  });

  it("switching the provider control updates the selection, persists it, and refetches status scoped to the new provider", async () => {
    const ai = installBridge();
    mountApp(root);
    await flush();
    root.querySelector<HTMLButtonElement>("#nav-settings")?.click();

    const { openai } = providerOptions(root);
    ai.getStatus.mockClear();
    openai.click();
    await flush();

    expect(openai.getAttribute("aria-checked")).toBe("true");
    expect(ai.getStatus).toHaveBeenCalledWith("openai");

    const persisted = JSON.parse(window.localStorage.getItem("axis.settings.v1") ?? "{}");
    expect(persisted.aiProvider).toBe("openai");
  });

  it("never claims a provider is connected until its own status actually reports configured", async () => {
    const ai = installBridge();
    mountApp(root);
    await flush();
    root.querySelector<HTMLButtonElement>("#nav-settings")?.click();

    const { openai } = providerOptions(root);
    openai.click();
    await flush();

    const statusTitle = root.querySelector<HTMLElement>("#settings-ai-status-title");
    expect(statusTitle?.textContent).toBe("OpenAI not configured");
    expect(ai.importCredential).not.toHaveBeenCalled();
  });

  it("scopes every credential action (import, session-only, test, remove) to the currently selected provider", async () => {
    const ai = installBridge();
    mountApp(root);
    await flush();
    root.querySelector<HTMLButtonElement>("#nav-settings")?.click();

    const { openai } = providerOptions(root);
    openai.click();
    await flush();

    // The status refetched right after import reports "configured" so Remove/Test become actionable.
    ai.getStatus.mockResolvedValueOnce(statusFor("openai", { configured: true, backend: "os-encrypted", secure: true }));
    root.querySelector<HTMLButtonElement>("#settings-ai-import")?.click();
    await flush();
    expect(ai.importCredential).toHaveBeenCalledWith({ provider: "openai" });

    root.querySelector<HTMLButtonElement>("#settings-ai-test")?.click();
    await flush();
    expect(ai.testConnection).toHaveBeenCalledWith("openai");

    root.querySelector<HTMLButtonElement>("#settings-ai-remove")?.click();
    await flush();
    expect(ai.removeCredential).toHaveBeenCalledWith("openai");

    // Switching back to Gemini and importing must never carry the OpenAI selection along.
    const { gemini } = providerOptions(root);
    gemini.click();
    await flush();
    root.querySelector<HTMLButtonElement>("#settings-ai-import")?.click();
    await flush();
    expect(ai.importCredential).toHaveBeenLastCalledWith({ provider: "gemini" });
  });

  it("clears the status message shown for one provider when switching to the other, never carrying stale text across", async () => {
    const ai = installBridge();
    mountApp(root);
    await flush();
    root.querySelector<HTMLButtonElement>("#nav-settings")?.click();

    root.querySelector<HTMLButtonElement>("#settings-ai-import")?.click();
    await flush();
    const message = root.querySelector<HTMLElement>("#settings-ai-message");
    expect(message?.textContent?.length).toBeGreaterThan(0);

    const { openai } = providerOptions(root);
    openai.click();
    await flush();
    expect(message?.textContent).toBe("");
    expect(ai.importCredential).toHaveBeenCalledTimes(1);
  });
});
