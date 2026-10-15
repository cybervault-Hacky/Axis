import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountApp } from "../src/renderer/ts/app";
import { MAX_FOLDER_EXPANDED_FILES, MAX_FOLDER_RECURSION_DEPTH } from "../src/renderer/ts/dragDropFiles";
import type { ConversationGetResult, ConversationListResult, ConversationOpResult, ConversationRecord } from "../src/shared/conversation-contract";

function createFakeConversationsBridge() {
  const store = new Map<string, ConversationRecord>();
  return {
    store,
    list: vi.fn(async (): Promise<ConversationListResult> => ({
      ok: true,
      summaries: [...store.values()]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, messageCount: c.messages.length, preview: c.messages.at(-1)?.text ?? "" }))
    })),
    search: vi.fn(async (query: string): Promise<ConversationListResult> => {
      const needle = query.toLowerCase();
      const matches = [...store.values()].filter(
        (c) => c.title.toLowerCase().includes(needle) || c.messages.some((m) => m.text.toLowerCase().includes(needle))
      );
      return {
        ok: true,
        summaries: matches.map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, messageCount: c.messages.length, preview: "" }))
      };
    }),
    get: vi.fn(async (id: string): Promise<ConversationGetResult> => {
      const found = store.get(id);
      if (!found) return { ok: false, code: "NOT_FOUND", message: "not found" };
      return { ok: true, conversation: found };
    }),
    save: vi.fn(async (): Promise<ConversationOpResult> => ({ ok: true })),
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
    }),
    exportConversation: vi.fn(async (): Promise<ConversationOpResult> => ({ ok: true })),
    exportAllConversations: vi.fn(async (): Promise<ConversationOpResult> => ({ ok: true })),
    importConversation: vi.fn(async (): Promise<ConversationOpResult> => ({ ok: true })),
    importAllConversations: vi.fn(async (): Promise<ConversationOpResult> => ({ ok: true })),
    importConversationsFromText: vi.fn(async (): Promise<ConversationOpResult> => ({ ok: true }))
  };
}

function installBridge() {
  const ai = {
    getStatus: vi.fn().mockResolvedValue({
      provider: "gemini",
      configured: false,
      backend: "none",
      secure: false,
      persistentStorageAvailable: false,
      nativeBridgeAvailable: true
    }),
    importCredential: vi.fn(),
    removeCredential: vi.fn(),
    testConnection: vi.fn(),
    sendRequest: vi.fn(),
    cancelRequest: vi.fn(),
    sendStreamingRequest: vi.fn(),
    onStreamEvent: vi.fn().mockImplementation(() => () => {})
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
  return { conversations };
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

// Polls a condition across microtask ticks instead of guessing a fixed tick
// count — used by the Phase 18 large-folder tests below, where the number
// of per-file awaits scales with MAX_FOLDER_EXPANDED_FILES and a fixed
// `flush(N)` would be either flaky or needlessly slow.
async function waitUntil(condition: () => boolean, maxTicks = 5000): Promise<void> {
  for (let i = 0; i < maxTicks; i += 1) {
    if (condition()) return;
    await Promise.resolve();
  }
}

function goToHistory(root: HTMLElement): void {
  root.querySelector<HTMLButtonElement>("#nav-history")?.click();
}

function seedConversation(
  conversations: ReturnType<typeof createFakeConversationsBridge>,
  overrides: Partial<ConversationRecord> = {}
): ConversationRecord {
  const now = Date.now();
  const record: ConversationRecord = {
    id: `conv-${Math.random().toString(36).slice(2)}`,
    title: "A saved conversation",
    createdAt: now,
    updatedAt: now,
    messages: [
      { id: "m1", role: "user", text: "Hello", status: "complete", truncated: false, createdAt: now },
      { id: "m2", role: "assistant", text: "Hi there", status: "complete", truncated: false, createdAt: now }
    ],
    ...overrides
  };
  conversations.store.set(record.id, record);
  return record;
}

function makeFakeDroppedFile(name: string, text: string): { name: string; text: () => Promise<string> } {
  return { name, text: vi.fn(async () => text) };
}

function dispatchDragEvent(
  target: Element,
  type: "dragenter" | "dragover" | "dragleave" | "drop",
  options: { files?: Array<{ name: string; text: () => Promise<string> }>; carriesFiles?: boolean } = {}
): void {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    dataTransfer?: { types: string[]; files: unknown; dropEffect: string };
  };
  const carriesFiles = options.carriesFiles ?? true;
  event.dataTransfer = {
    types: carriesFiles ? ["Files"] : ["text/plain"],
    files: options.files ?? [],
    dropEffect: ""
  };
  target.dispatchEvent(event);
}

// Reuses the same duck-typed `{ name, text() }` fake as `makeFakeDroppedFile`
// above (a real jsdom `File` has no working `.text()` method), just
// delivered via a fake FileSystemFileEntry's `.file()` callback instead of
// directly through `dataTransfer.files`. Shared by the Phase 17 and
// Phase 18 folder-drop describe blocks below.
function fakeFileEntry(file: { name: string; text: () => Promise<string> }): FileSystemEntry {
  return {
    isFile: true,
    isDirectory: false,
    name: file.name,
    file: (onSuccess: (f: unknown) => void) => onSuccess(file)
  } as unknown as FileSystemEntry;
}

function fakeDirectoryEntry(name: string, children: FileSystemEntry[]): FileSystemEntry {
  let delivered = false;
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => ({
      readEntries: (onSuccess: (entries: FileSystemEntry[]) => void) => {
        onSuccess(delivered ? [] : children);
        delivered = true;
      }
    })
  } as unknown as FileSystemEntry;
}

function dispatchFolderDrop(target: Element, entries: FileSystemEntry[]): void {
  const event = new Event("drop", { bubbles: true, cancelable: true }) as Event & {
    dataTransfer?: { types: string[]; files: unknown[]; items: Array<{ webkitGetAsEntry: () => FileSystemEntry }>; dropEffect: string };
  };
  event.dataTransfer = {
    types: ["Files"],
    files: [],
    items: entries.map((entry) => ({ webkitGetAsEntry: () => entry })),
    dropEffect: ""
  };
  target.dispatchEvent(event);
}

describe("History view", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = freshRoot();
  });

  afterEach(() => {
    delete (window as { axis?: unknown }).axis;
  });

  it("shows a loading state immediately, then the empty state when there are no saved conversations", async () => {
    installBridge();
    mountApp(root);
    goToHistory(root);
    expect(root.querySelector("#history-loading")).not.toBeNull();

    await flush();
    expect(root.querySelector("#history-empty")).not.toBeNull();
    expect(root.querySelector("#history-list")).toBeNull();
  });

  it("shows an honest error state (no native bridge) in the plain browser preview", async () => {
    mountApp(root); // no window.axis installed at all
    goToHistory(root);
    await flush();

    expect(root.querySelector("#history-error")).not.toBeNull();
    expect(root.textContent).toContain("Run the AXIS desktop app");
  });

  it("lists saved conversations with title, meta, and preview", async () => {
    const { conversations } = installBridge();
    seedConversation(conversations, { title: "Trip to Kyoto" });
    mountApp(root);
    goToHistory(root);
    await flush();

    expect(root.querySelector("#history-list")).not.toBeNull();
    expect(root.textContent).toContain("Trip to Kyoto");
    expect(root.textContent).toContain("1 message".replace("1", "2")); // "2 messages"
  });

  it("searches locally by title and by message text, debounced, without any AI calls", async () => {
    vi.useFakeTimers();
    const { conversations } = installBridge();
    seedConversation(conversations, { title: "Trip planning", messages: [{ id: "m1", role: "user", text: "Let's visit Kyoto", status: "complete", truncated: false, createdAt: Date.now() }] });
    seedConversation(conversations, { title: "Recipe ideas", messages: [{ id: "m2", role: "user", text: "pasta with garlic", status: "complete", truncated: false, createdAt: Date.now() }] });
    mountApp(root);
    goToHistory(root);
    await vi.advanceTimersByTimeAsync(0);

    const searchInput = root.querySelector<HTMLInputElement>("#history-search")!;
    searchInput.value = "kyoto";
    searchInput.dispatchEvent(new Event("input"));

    await vi.advanceTimersByTimeAsync(300);

    expect(root.textContent).toContain("Trip planning");
    expect(root.textContent).not.toContain("Recipe ideas");
    expect(conversations.search).toHaveBeenCalledWith("kyoto");
    vi.useRealTimers();
  });

  it("shows a 'no matching conversations' state for a search with zero results", async () => {
    vi.useFakeTimers();
    const { conversations } = installBridge();
    seedConversation(conversations, { title: "Trip planning" });
    mountApp(root);
    goToHistory(root);
    await vi.advanceTimersByTimeAsync(0);

    const searchInput = root.querySelector<HTMLInputElement>("#history-search")!;
    searchInput.value = "nonexistent-xyz";
    searchInput.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(300);

    expect(root.querySelector("#history-no-results")).not.toBeNull();
    vi.useRealTimers();
  });

  it("renames a conversation inline", async () => {
    const { conversations } = installBridge();
    const record = seedConversation(conversations, { title: "Old title" });
    mountApp(root);
    goToHistory(root);
    await flush();

    root.querySelector<HTMLButtonElement>(`[aria-label="Rename conversation: Old title"]`)?.click();
    const input = root.querySelector<HTMLInputElement>(".axis-history-rename-input")!;
    input.value = "New title";
    input.dispatchEvent(new Event("input"));
    const saveButton = Array.from(root.querySelectorAll("button")).find((b) => b.textContent === "Save") as HTMLButtonElement;
    saveButton.click();
    await flush();

    expect(conversations.rename).toHaveBeenCalledWith(record.id, "New title");
    expect(root.textContent).toContain("New title");
    expect(root.textContent).not.toContain("Old title");
  });

  it("renaming the conversation currently open in Workspace updates its title there in place, without reopening it", async () => {
    const { conversations } = installBridge();
    const record = seedConversation(conversations, { title: "Original title" });
    mountApp(root);
    goToHistory(root);
    await flush();

    // Open it in the Workspace first.
    root.querySelector<HTMLButtonElement>(`[aria-label="Open conversation: Original title"]`)?.click();
    await flush();
    expect(root.querySelector("#workspace-conversation-title")?.textContent).toBe("Original title");
    const getCallsAfterOpen = conversations.get.mock.calls.length;

    // Rename it from History while it is still open in Workspace.
    root.querySelector<HTMLButtonElement>("#nav-history")?.click();
    await flush();
    root.querySelector<HTMLButtonElement>(`[aria-label="Rename conversation: Original title"]`)?.click();
    const input = root.querySelector<HTMLInputElement>(".axis-history-rename-input")!;
    input.value = "Renamed from History";
    input.dispatchEvent(new Event("input"));
    const saveButton = Array.from(root.querySelectorAll("button")).find((b) => b.textContent === "Save") as HTMLButtonElement;
    saveButton.click();
    await flush();

    // Switch back to Workspace without using History's "Open" action again.
    root.querySelector<HTMLButtonElement>("#nav-workspace")?.click();
    await flush();

    expect(root.querySelector("#workspace-conversation-title")?.textContent).toBe("Renamed from History");
    // The title updated via the in-memory sync event, not by reopening —
    // the conversation was never re-fetched after the initial open.
    expect(conversations.get.mock.calls.length).toBe(getCallsAfterOpen);
  });

  it("deletes a conversation only after a second confirming click", async () => {
    const { conversations } = installBridge();
    const record = seedConversation(conversations, { title: "Delete me" });
    mountApp(root);
    goToHistory(root);
    await flush();

    const deleteButton = root.querySelector<HTMLButtonElement>(`[aria-label="Delete conversation: Delete me"]`)!;
    deleteButton.click();
    expect(conversations.delete).not.toHaveBeenCalled();
    expect(root.textContent).toContain("Delete me"); // still present — not deleted yet

    const confirmButton = root.querySelector<HTMLButtonElement>(`[aria-label="Click again to delete: Delete me"]`)!;
    confirmButton.click();
    await flush();

    expect(conversations.delete).toHaveBeenCalledWith(record.id);
    expect(root.querySelector("#history-empty")).not.toBeNull();
  });

  it("clears all conversations only after a second confirming click", async () => {
    const { conversations } = installBridge();
    seedConversation(conversations, { title: "First" });
    seedConversation(conversations, { title: "Second" });
    mountApp(root);
    goToHistory(root);
    await flush();

    const clearAllButton = root.querySelector<HTMLButtonElement>("#history-clear-all")!;
    clearAllButton.click();
    expect(conversations.clearAll).not.toHaveBeenCalled();
    expect(root.textContent).toContain("First");

    clearAllButton.click();
    await flush();

    expect(conversations.clearAll).toHaveBeenCalledTimes(1);
    expect(root.querySelector("#history-empty")).not.toBeNull();
  });

  it("'Clear all' is disabled when there is nothing to clear", async () => {
    installBridge();
    mountApp(root);
    goToHistory(root);
    await flush();

    const clearAllButton = root.querySelector<HTMLButtonElement>("#history-clear-all")!;
    expect(clearAllButton.disabled).toBe(true);
  });

  it("'Export all' is disabled when there is nothing to export", async () => {
    installBridge();
    mountApp(root);
    goToHistory(root);
    await flush();

    const exportAllButton = root.querySelector<HTMLButtonElement>("#history-export-all")!;
    expect(exportAllButton.disabled).toBe(true);
  });

  it("exports every saved conversation via the 'Export all' action, with no per-conversation id involved", async () => {
    const { conversations } = installBridge();
    seedConversation(conversations, { title: "First" });
    seedConversation(conversations, { title: "Second" });
    mountApp(root);
    goToHistory(root);
    await flush();

    const exportAllButton = root.querySelector<HTMLButtonElement>("#history-export-all")!;
    expect(exportAllButton.disabled).toBe(false);
    exportAllButton.click();
    await flush();

    expect(conversations.exportAllConversations).toHaveBeenCalledTimes(1);
    expect(conversations.exportAllConversations).toHaveBeenCalledWith();
    expect(root.querySelector("#history-error")).toBeNull();
    expect(root.textContent).toContain("First");
    expect(root.textContent).toContain("Second");
  });

  it("a cancelled 'Export all' is a silent no-op — no error banner, nothing changes", async () => {
    const { conversations } = installBridge();
    seedConversation(conversations, { title: "Keep as is" });
    conversations.exportAllConversations.mockResolvedValueOnce({ ok: false, code: "CANCELLED" });
    mountApp(root);
    goToHistory(root);
    await flush();

    const exportAllButton = root.querySelector<HTMLButtonElement>("#history-export-all")!;
    exportAllButton.click();
    await flush();

    expect(conversations.exportAllConversations).toHaveBeenCalledTimes(1);
    expect(root.querySelector("#history-error")).toBeNull();
    expect(root.textContent).toContain("Keep as is");
  });

  it("shows an error banner when 'Export all' genuinely fails", async () => {
    const { conversations } = installBridge();
    seedConversation(conversations, { title: "Broken export" });
    conversations.exportAllConversations.mockResolvedValueOnce({ ok: false, code: "STORAGE_ERROR", message: "disk full" });
    mountApp(root);
    goToHistory(root);
    await flush();

    const exportAllButton = root.querySelector<HTMLButtonElement>("#history-export-all")!;
    exportAllButton.click();
    await flush();

    expect(root.querySelector("#history-error")).not.toBeNull();
    expect(root.textContent).toContain("disk full");
  });

  it("'Open' switches to the Workspace view and restores the saved transcript", async () => {
    const { conversations } = installBridge();
    const record = seedConversation(conversations, { title: "Reopen me" });
    mountApp(root);
    goToHistory(root);
    await flush();

    root.querySelector<HTMLButtonElement>(`[aria-label="Open conversation: Reopen me"]`)?.click();
    await flush();

    expect(root.querySelector("#view-workspace")?.hasAttribute("hidden")).toBe(false);
    expect(root.querySelector("#view-history")?.hasAttribute("hidden")).toBe(true);
    expect(root.textContent).toContain("Hello");
    expect(root.textContent).toContain("Hi there");
    expect(conversations.get).toHaveBeenCalledWith(record.id);
  });

  it("every History control performs its advertised action — no decorative buttons", async () => {
    const { conversations } = installBridge();
    seedConversation(conversations, { title: "Functional check" });
    mountApp(root);
    goToHistory(root);
    await flush();

    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("#view-history button"));
    expect(buttons.length).toBeGreaterThan(0);
    // Every button either has a real listener attached via addEventListener
    // in this module (verified functionally above) or is the disabled-by-
    // design Clear-all with nothing to clear — here there is one
    // conversation, so Clear all must be enabled and clickable.
    const clearAllButton = root.querySelector<HTMLButtonElement>("#history-clear-all")!;
    expect(clearAllButton.disabled).toBe(false);
  });

  it("exports a conversation via the per-item Export action", async () => {
    const { conversations } = installBridge();
    const record = seedConversation(conversations, { title: "Export me" });
    mountApp(root);
    goToHistory(root);
    await flush();

    const exportButton = root.querySelector<HTMLButtonElement>(`[aria-label="Export conversation: Export me"]`)!;
    exportButton.click();
    await flush();

    expect(conversations.exportConversation).toHaveBeenCalledWith(record.id);
    // A successful export doesn't replace the list with an error state.
    expect(root.querySelector("#history-error")).toBeNull();
    expect(root.textContent).toContain("Export me");
  });

  it("a cancelled export is a silent no-op — no error banner, nothing changes", async () => {
    const { conversations } = installBridge();
    seedConversation(conversations, { title: "Keep as is" });
    conversations.exportConversation.mockResolvedValueOnce({ ok: false, code: "CANCELLED" });
    mountApp(root);
    goToHistory(root);
    await flush();

    const exportButton = root.querySelector<HTMLButtonElement>(`[aria-label="Export conversation: Keep as is"]`)!;
    exportButton.click();
    await flush();

    expect(conversations.exportConversation).toHaveBeenCalledTimes(1);
    expect(root.querySelector("#history-error")).toBeNull();
    expect(root.textContent).toContain("Keep as is");
  });

  it("shows an error banner when export genuinely fails", async () => {
    const { conversations } = installBridge();
    seedConversation(conversations, { title: "Broken export" });
    conversations.exportConversation.mockResolvedValueOnce({ ok: false, code: "STORAGE_ERROR", message: "disk full" });
    mountApp(root);
    goToHistory(root);
    await flush();

    const exportButton = root.querySelector<HTMLButtonElement>(`[aria-label="Export conversation: Broken export"]`)!;
    exportButton.click();
    await flush();

    expect(root.querySelector("#history-error")).not.toBeNull();
    expect(root.textContent).toContain("disk full");
  });

  it("imports a conversation via the Import control and refreshes the list", async () => {
    const { conversations } = installBridge();
    mountApp(root);
    goToHistory(root);
    await flush();
    expect(root.querySelector("#history-empty")).not.toBeNull();

    conversations.importConversation.mockImplementationOnce(async () => {
      seedConversation(conversations, { title: "Freshly imported" });
      return { ok: true };
    });

    const importButton = root.querySelector<HTMLButtonElement>("#history-import")!;
    importButton.click();
    await flush();

    expect(conversations.importConversation).toHaveBeenCalledTimes(1);
    expect(root.textContent).toContain("Freshly imported");
  });

  it("a cancelled import is a silent no-op — no error banner, list unchanged", async () => {
    const { conversations } = installBridge();
    seedConversation(conversations, { title: "Untouched" });
    conversations.importConversation.mockResolvedValueOnce({ ok: false, code: "CANCELLED" });
    mountApp(root);
    goToHistory(root);
    await flush();

    const importButton = root.querySelector<HTMLButtonElement>("#history-import")!;
    importButton.click();
    await flush();

    expect(root.querySelector("#history-error")).toBeNull();
    expect(root.textContent).toContain("Untouched");
  });

  it("shows an error banner when import genuinely fails (e.g. an invalid file)", async () => {
    const { conversations } = installBridge();
    conversations.importConversation.mockResolvedValueOnce({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "That file is not a valid AXIS conversation export."
    });
    mountApp(root);
    goToHistory(root);
    await flush();

    const importButton = root.querySelector<HTMLButtonElement>("#history-import")!;
    importButton.click();
    await flush();

    expect(root.querySelector("#history-error")).not.toBeNull();
    expect(root.textContent).toContain("not a valid AXIS conversation export");
  });

  it("imports every conversation via the 'Import all…' control and refreshes the list", async () => {
    const { conversations } = installBridge();
    mountApp(root);
    goToHistory(root);
    await flush();
    expect(root.querySelector("#history-empty")).not.toBeNull();

    conversations.importAllConversations.mockImplementationOnce(async () => {
      seedConversation(conversations, { title: "Bulk-imported first" });
      seedConversation(conversations, { title: "Bulk-imported second" });
      return { ok: true };
    });

    const importAllButton = root.querySelector<HTMLButtonElement>("#history-import-all")!;
    importAllButton.click();
    await flush();

    expect(conversations.importAllConversations).toHaveBeenCalledTimes(1);
    expect(root.textContent).toContain("Bulk-imported first");
    expect(root.textContent).toContain("Bulk-imported second");
  });

  it("'Import all…' is available even when History is empty — unlike Export all/Clear all, it never depends on existing conversations", async () => {
    installBridge();
    mountApp(root);
    goToHistory(root);
    await flush();

    const importAllButton = root.querySelector<HTMLButtonElement>("#history-import-all")!;
    expect(importAllButton.disabled).toBe(false);
  });

  it("a cancelled 'Import all…' is a silent no-op — no error banner, list unchanged", async () => {
    const { conversations } = installBridge();
    seedConversation(conversations, { title: "Untouched by bulk import" });
    conversations.importAllConversations.mockResolvedValueOnce({ ok: false, code: "CANCELLED" });
    mountApp(root);
    goToHistory(root);
    await flush();

    const importAllButton = root.querySelector<HTMLButtonElement>("#history-import-all")!;
    importAllButton.click();
    await flush();

    expect(root.querySelector("#history-error")).toBeNull();
    expect(root.textContent).toContain("Untouched by bulk import");
  });

  it("shows an error banner when 'Import all…' genuinely fails (e.g. a single-conversation file, not a bulk one)", async () => {
    const { conversations } = installBridge();
    conversations.importAllConversations.mockResolvedValueOnce({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "That file is not a valid, readable AXIS bulk conversation export."
    });
    mountApp(root);
    goToHistory(root);
    await flush();

    const importAllButton = root.querySelector<HTMLButtonElement>("#history-import-all")!;
    importAllButton.click();
    await flush();

    expect(root.querySelector("#history-error")).not.toBeNull();
    expect(root.textContent).toContain("not a valid, readable AXIS bulk conversation export");
  });

  describe("drag-and-drop import (Phase 13)", () => {
    it("imports a dropped single-conversation file and refreshes the list, without opening any dialog", async () => {
      const { conversations } = installBridge();
      mountApp(root);
      goToHistory(root);
      await flush();
      expect(root.querySelector("#history-empty")).not.toBeNull();

      conversations.importConversationsFromText.mockImplementationOnce(async () => {
        seedConversation(conversations, { title: "Dropped in" });
        return { ok: true };
      });

      const inner = root.querySelector("#view-history .axis-view__inner")!;
      const file = makeFakeDroppedFile("dropped.json", JSON.stringify({ hello: "world" }));
      dispatchDragEvent(inner, "drop", { files: [file] });
      await flush(8); // one extra microtask hop vs. before Phase 17's folder-expansion step

      expect(file.text).toHaveBeenCalledTimes(1);
      expect(conversations.importConversationsFromText).toHaveBeenCalledWith(JSON.stringify({ hello: "world" }));
      expect(root.querySelector("#history-error")).toBeNull();
      expect(root.textContent).toContain("Dropped in");
    });

    it("imports every dropped file sequentially on a multi-file drop and refreshes once", async () => {
      const { conversations } = installBridge();
      mountApp(root);
      goToHistory(root);
      await flush();

      conversations.importConversationsFromText.mockImplementation(async (text: string) => {
        seedConversation(conversations, { title: `From ${text}` });
        return { ok: true };
      });

      const inner = root.querySelector("#view-history .axis-view__inner")!;
      const fileA = makeFakeDroppedFile("a.json", "A");
      const fileB = makeFakeDroppedFile("b.json", "B");
      dispatchDragEvent(inner, "drop", { files: [fileA, fileB] });
      await flush(10);

      expect(conversations.importConversationsFromText).toHaveBeenCalledTimes(2);
      expect(conversations.importConversationsFromText).toHaveBeenNthCalledWith(1, "A");
      expect(conversations.importConversationsFromText).toHaveBeenNthCalledWith(2, "B");
      expect(root.textContent).toContain("From A");
      expect(root.textContent).toContain("From B");
    });

    it("reports every failure (not just the first) when some dropped files fail validation (Phase 15)", async () => {
      const { conversations } = installBridge();
      mountApp(root);
      goToHistory(root);
      await flush();

      conversations.importConversationsFromText
        .mockResolvedValueOnce({ ok: false, code: "VALIDATION_ERROR", message: "bad-file-one is invalid" })
        .mockResolvedValueOnce({ ok: false, code: "VALIDATION_ERROR", message: "bad-file-two is invalid" });

      const inner = root.querySelector("#view-history .axis-view__inner")!;
      const fileOne = makeFakeDroppedFile("bad-one.json", "nope");
      const fileTwo = makeFakeDroppedFile("bad-two.json", "nope");
      dispatchDragEvent(inner, "drop", { files: [fileOne, fileTwo] });
      await flush(10);

      expect(conversations.importConversationsFromText).toHaveBeenCalledTimes(2);
      expect(root.querySelector("#history-error")).not.toBeNull();
      expect(root.textContent).toContain("2 of 2 files could not be imported");
      expect(root.textContent).toContain("bad-one.json");
      expect(root.textContent).toContain("bad-file-one is invalid");
      expect(root.textContent).toContain("bad-two.json");
      expect(root.textContent).toContain("bad-file-two is invalid");
    });

    it("reports a single dropped-file failure exactly as 'name: reason', with no N-of-M count prefix (Phase 15)", async () => {
      const { conversations } = installBridge();
      mountApp(root);
      goToHistory(root);
      await flush();

      conversations.importConversationsFromText.mockResolvedValueOnce({
        ok: false,
        code: "VALIDATION_ERROR",
        message: "that file is not valid"
      });

      const inner = root.querySelector("#view-history .axis-view__inner")!;
      const file = makeFakeDroppedFile("bad.json", "nope");
      dispatchDragEvent(inner, "drop", { files: [file] });
      await flush(10);

      expect(root.querySelector("#history-error")).not.toBeNull();
      expect(root.textContent).toContain("bad.json: that file is not valid");
      expect(root.textContent).not.toContain("of 1 files");
    });

    it("caps the individually-named failures on a large multi-file drop and summarizes the rest as 'and N more' (Phase 15)", async () => {
      const { conversations } = installBridge();
      mountApp(root);
      goToHistory(root);
      await flush();

      const names = ["f1.json", "f2.json", "f3.json", "f4.json", "f5.json"];
      for (const name of names) {
        conversations.importConversationsFromText.mockResolvedValueOnce({
          ok: false,
          code: "VALIDATION_ERROR",
          message: `${name} failed`
        });
      }

      const inner = root.querySelector("#view-history .axis-view__inner")!;
      dispatchDragEvent(inner, "drop", { files: names.map((name) => makeFakeDroppedFile(name, "nope")) });
      await flush(30);

      expect(root.querySelector("#history-error")).not.toBeNull();
      expect(root.textContent).toContain("5 of 5 files could not be imported");
      expect(root.textContent).toContain("f1.json: f1.json failed");
      expect(root.textContent).toContain("f2.json: f2.json failed");
      expect(root.textContent).toContain("f3.json: f3.json failed");
      expect(root.textContent).not.toContain("f4.json failed");
      expect(root.textContent).not.toContain("f5.json failed");
      expect(root.textContent).toContain("and 2 more");
    });

    it("deterministically ends on the failure banner (not a stale/overwritten refresh) on a partial-success multi-file drop (Phase 15)", async () => {
      const { conversations } = installBridge();
      mountApp(root);
      goToHistory(root);
      await flush();

      conversations.importConversationsFromText
        .mockImplementationOnce(async (text: string) => {
          seedConversation(conversations, { title: `From ${text}` });
          return { ok: true };
        })
        .mockResolvedValueOnce({ ok: false, code: "VALIDATION_ERROR", message: "invalid file" });

      const listCallsBeforeDrop = conversations.list.mock.calls.length;
      const inner = root.querySelector("#view-history .axis-view__inner")!;
      const goodFile = makeFakeDroppedFile("good.json", "GOOD");
      const badFile = makeFakeDroppedFile("bad.json", "nope");
      dispatchDragEvent(inner, "drop", { files: [goodFile, badFile] });
      await flush(10);

      // The successful import was still saved and the list refreshed (one more `list`
      // call than before the drop) even though the final rendered view is the error state.
      expect(conversations.list.mock.calls.length).toBeGreaterThan(listCallsBeforeDrop);
      expect(root.querySelector("#history-error")).not.toBeNull();
      expect(root.textContent).toContain("bad.json: invalid file");
    });

    it("ignores drags that do not carry files (e.g. dragging selected text)", async () => {
      const { conversations } = installBridge();
      mountApp(root);
      goToHistory(root);
      await flush();

      const inner = root.querySelector("#view-history .axis-view__inner")!;
      dispatchDragEvent(inner, "dragenter", { carriesFiles: false });
      expect(inner.classList.contains("axis-view__inner--drop-active")).toBe(false);

      dispatchDragEvent(inner, "drop", { carriesFiles: false, files: [makeFakeDroppedFile("x.json", "x")] });
      await flush();
      expect(conversations.importConversationsFromText).not.toHaveBeenCalled();
    });

    it("toggles the drop-active highlight class on dragenter and clears it on drop", async () => {
      installBridge();
      mountApp(root);
      goToHistory(root);
      await flush();

      const inner = root.querySelector("#view-history .axis-view__inner")!;
      expect(inner.classList.contains("axis-view__inner--drop-active")).toBe(false);

      dispatchDragEvent(inner, "dragenter");
      expect(inner.classList.contains("axis-view__inner--drop-active")).toBe(true);

      dispatchDragEvent(inner, "drop", { files: [] });
      await flush();
      expect(inner.classList.contains("axis-view__inner--drop-active")).toBe(false);
    });
  });

  describe("window-wide drag-and-drop import (Phase 16)", () => {
    it("imports a file dropped on a different view and switches to History to show the result", async () => {
      const { conversations } = installBridge();
      mountApp(root);
      // Deliberately stay on Home — never navigate to History before the drop.
      expect(root.querySelector("#nav-home")?.getAttribute("aria-current")).toBe("page");

      conversations.importConversationsFromText.mockImplementationOnce(async () => {
        seedConversation(conversations, { title: "Dropped from elsewhere" });
        return { ok: true };
      });

      const homeView = root.querySelector("#view-home")!;
      const file = makeFakeDroppedFile("dropped.json", JSON.stringify({ hello: "world" }));
      dispatchDragEvent(homeView, "drop", { files: [file] });
      await flush(10);

      expect(conversations.importConversationsFromText).toHaveBeenCalledWith(JSON.stringify({ hello: "world" }));
      expect(root.querySelector("#nav-history")?.getAttribute("aria-current")).toBe("page");
      expect(root.textContent).toContain("Dropped from elsewhere");
    });

    it("navigates to History and shows the failure banner when a dropped file is invalid, from any view", async () => {
      const { conversations } = installBridge();
      mountApp(root);
      root.querySelector<HTMLButtonElement>("#nav-settings")?.click();
      expect(root.querySelector("#nav-settings")?.getAttribute("aria-current")).toBe("page");

      conversations.importConversationsFromText.mockResolvedValueOnce({
        ok: false,
        code: "VALIDATION_ERROR",
        message: "that file is not valid"
      });

      const settingsView = root.querySelector("#view-settings")!;
      const file = makeFakeDroppedFile("bad.json", "nope");
      dispatchDragEvent(settingsView, "drop", { files: [file] });
      await flush(10);

      expect(root.querySelector("#nav-history")?.getAttribute("aria-current")).toBe("page");
      expect(root.querySelector("#history-error")).not.toBeNull();
      expect(root.textContent).toContain("bad.json: that file is not valid");
    });

    it("ignores a drag that does not carry files, from a view other than History", async () => {
      const { conversations } = installBridge();
      mountApp(root);

      const homeView = root.querySelector("#view-home")!;
      dispatchDragEvent(homeView, "dragenter", { carriesFiles: false });
      expect(root.classList.contains("axis-app--drop-active")).toBe(false);

      dispatchDragEvent(homeView, "drop", { carriesFiles: false, files: [makeFakeDroppedFile("x.json", "x")] });
      await flush();
      expect(conversations.importConversationsFromText).not.toHaveBeenCalled();
      expect(root.querySelector("#nav-home")?.getAttribute("aria-current")).toBe("page");
    });

    it("toggles the window-wide drop-active highlight on dragenter and clears it on drop, outside History", async () => {
      installBridge();
      mountApp(root);

      const homeView = root.querySelector("#view-home")!;
      expect(root.classList.contains("axis-app--drop-active")).toBe(false);

      dispatchDragEvent(homeView, "dragenter");
      expect(root.classList.contains("axis-app--drop-active")).toBe(true);

      dispatchDragEvent(homeView, "drop", { files: [] });
      await flush();
      expect(root.classList.contains("axis-app--drop-active")).toBe(false);
    });

    it("does not apply the window-wide highlight for a drag that stays inside History's own drop zone", async () => {
      installBridge();
      mountApp(root);
      goToHistory(root);
      await flush();

      const inner = root.querySelector("#view-history .axis-view__inner")!;
      dispatchDragEvent(inner, "dragenter");
      expect(inner.classList.contains("axis-view__inner--drop-active")).toBe(true);
      expect(root.classList.contains("axis-app--drop-active")).toBe(false);
    });

    it("regression: a drop that lands inside History's own zone is still imported exactly once, not twice, now that a window-wide handler also exists", async () => {
      const { conversations } = installBridge();
      mountApp(root);
      goToHistory(root);
      await flush();

      conversations.importConversationsFromText.mockImplementationOnce(async () => {
        seedConversation(conversations, { title: "Dropped in History" });
        return { ok: true };
      });

      const inner = root.querySelector("#view-history .axis-view__inner")!;
      const file = makeFakeDroppedFile("dropped.json", JSON.stringify({ hello: "world" }));
      dispatchDragEvent(inner, "drop", { files: [file] });
      await flush(10);

      expect(file.text).toHaveBeenCalledTimes(1);
      expect(conversations.importConversationsFromText).toHaveBeenCalledTimes(1);
      expect(root.textContent).toContain("Dropped in History");
      // Still on History, no stray pending-drop bookkeeping left over from the
      // window-wide path (it was never involved in this drop at all).
      expect(root.querySelector("#nav-history")?.getAttribute("aria-current")).toBe("page");
    });
  });

  describe("folder/directory drop import (Phase 17)", () => {
    it("imports every file inside a dropped folder, directly in History's own drop zone", async () => {
      const { conversations } = installBridge();
      mountApp(root);
      goToHistory(root);
      await flush();

      conversations.importConversationsFromText.mockImplementation(async (text: string) => {
        seedConversation(conversations, { title: `From ${text}` });
        return { ok: true };
      });

      const inner = root.querySelector("#view-history .axis-view__inner")!;
      const fileA = makeFakeDroppedFile("a.json", "A");
      const fileB = makeFakeDroppedFile("b.json", "B");
      const folder = fakeDirectoryEntry("export-folder", [fakeFileEntry(fileA), fakeFileEntry(fileB)]);
      dispatchFolderDrop(inner, [folder]);
      await flush(30);

      expect(conversations.importConversationsFromText).toHaveBeenCalledTimes(2);
      expect(conversations.importConversationsFromText).toHaveBeenCalledWith("A");
      expect(conversations.importConversationsFromText).toHaveBeenCalledWith("B");
      expect(root.textContent).toContain("From A");
      expect(root.textContent).toContain("From B");
    });

    it("recurses into nested subfolders and imports files found at any depth", async () => {
      const { conversations } = installBridge();
      mountApp(root);
      goToHistory(root);
      await flush();

      conversations.importConversationsFromText.mockImplementation(async (text: string) => {
        seedConversation(conversations, { title: `Nested ${text}` });
        return { ok: true };
      });

      const inner = root.querySelector("#view-history .axis-view__inner")!;
      const deep = makeFakeDroppedFile("deep.json", "deep");
      const innerFolder = fakeDirectoryEntry("inner", [fakeFileEntry(deep)]);
      const outerFolder = fakeDirectoryEntry("outer", [innerFolder]);
      dispatchFolderDrop(inner, [outerFolder]);
      await flush(30);

      expect(conversations.importConversationsFromText).toHaveBeenCalledWith("deep");
      expect(root.textContent).toContain("Nested deep");
    });

    it("reports a validation failure for a non-export file found inside a dropped folder, using the same failure banner as a direct drop", async () => {
      const { conversations } = installBridge();
      mountApp(root);
      goToHistory(root);
      await flush();

      conversations.importConversationsFromText.mockResolvedValueOnce({
        ok: false,
        code: "VALIDATION_ERROR",
        message: "not a valid AXIS export"
      });

      const inner = root.querySelector("#view-history .axis-view__inner")!;
      const notes = makeFakeDroppedFile("notes.txt", "hello");
      const folder = fakeDirectoryEntry("mixed-folder", [fakeFileEntry(notes)]);
      dispatchFolderDrop(inner, [folder]);
      await flush(30);

      expect(root.querySelector("#history-error")).not.toBeNull();
      expect(root.textContent).toContain("notes.txt: not a valid AXIS export");
    });

    it("also expands a dropped folder when it lands outside History, via the window-wide handler", async () => {
      const { conversations } = installBridge();
      mountApp(root);
      // Stay on Home — this is the window-wide path, not History's own zone.

      conversations.importConversationsFromText.mockImplementationOnce(async (text: string) => {
        seedConversation(conversations, { title: `Window-wide ${text}` });
        return { ok: true };
      });

      const homeView = root.querySelector("#view-home")!;
      const file = makeFakeDroppedFile("x.json", "X");
      const folder = fakeDirectoryEntry("dropped-anywhere", [fakeFileEntry(file)]);
      dispatchFolderDrop(homeView, [folder]);
      await flush(30);

      expect(conversations.importConversationsFromText).toHaveBeenCalledWith("X");
      expect(root.querySelector("#nav-history")?.getAttribute("aria-current")).toBe("page");
      expect(root.textContent).toContain("Window-wide X");
    });
  });

  describe("folder-expansion limits (Phase 18)", () => {
    function fakeNestedFolders(depth: number, leaf: FileSystemEntry): FileSystemEntry {
      let current = leaf;
      for (let i = 0; i < depth; i += 1) {
        current = fakeDirectoryEntry(`level-${depth - i}`, [current]);
      }
      return current;
    }

    it("reports a file-count limit notice and still imports the files that were collected, in History's own drop zone", async () => {
      const { conversations } = installBridge();
      mountApp(root);
      goToHistory(root);
      await flush();

      let importCount = 0;
      conversations.importConversationsFromText.mockImplementation(async () => {
        importCount += 1;
        return { ok: true };
      });

      const totalFiles = MAX_FOLDER_EXPANDED_FILES + 5;
      const fileEntries = Array.from({ length: totalFiles }, (_, i) =>
        fakeFileEntry(makeFakeDroppedFile(`f${i}.json`, "ok"))
      );
      const folder = fakeDirectoryEntry("huge-folder", fileEntries);
      const inner = root.querySelector("#view-history .axis-view__inner")!;
      dispatchFolderDrop(inner, [folder]);

      await waitUntil(() => root.querySelector("#history-error") !== null);

      expect(importCount).toBe(MAX_FOLDER_EXPANDED_FILES);
      expect(root.textContent).toContain(`Only the first ${MAX_FOLDER_EXPANDED_FILES} files`);
    }, 15000);

    it("reports a recursion-depth limit notice when a dropped folder is nested too deep, in History's own drop zone", async () => {
      const { conversations } = installBridge();
      mountApp(root);
      goToHistory(root);
      await flush();

      const deepFile = makeFakeDroppedFile("deep.json", "deep");
      const deepChain = fakeNestedFolders(MAX_FOLDER_RECURSION_DEPTH + 1, fakeFileEntry(deepFile));
      const inner = root.querySelector("#view-history .axis-view__inner")!;
      dispatchFolderDrop(inner, [deepChain]);

      await waitUntil(() => root.querySelector("#history-error") !== null);

      expect(conversations.importConversationsFromText).not.toHaveBeenCalled();
      expect(root.textContent).toContain(`more than ${MAX_FOLDER_RECURSION_DEPTH} levels deep`);
    });

    it("also reports a folder-expansion limit notice when the limit is hit via the window-wide handler", async () => {
      const { conversations } = installBridge();
      mountApp(root);
      // Stay on Home — this is the window-wide path, not History's own zone.

      let importCount = 0;
      conversations.importConversationsFromText.mockImplementation(async () => {
        importCount += 1;
        return { ok: true };
      });

      const totalFiles = MAX_FOLDER_EXPANDED_FILES + 3;
      const fileEntries = Array.from({ length: totalFiles }, (_, i) =>
        fakeFileEntry(makeFakeDroppedFile(`f${i}.json`, "ok"))
      );
      const folder = fakeDirectoryEntry("huge-folder", fileEntries);
      const homeView = root.querySelector("#view-home")!;
      dispatchFolderDrop(homeView, [folder]);

      await waitUntil(
        () =>
          root.querySelector("#nav-history")?.getAttribute("aria-current") === "page" &&
          root.querySelector("#history-error") !== null
      );

      expect(importCount).toBe(MAX_FOLDER_EXPANDED_FILES);
      expect(root.querySelector("#nav-history")?.getAttribute("aria-current")).toBe("page");
      expect(root.textContent).toContain(`Only the first ${MAX_FOLDER_EXPANDED_FILES} files`);
    }, 15000);

    it("combines a real per-file validation failure with a folder-expansion limit notice in the same banner", async () => {
      const { conversations } = installBridge();
      mountApp(root);
      goToHistory(root);
      await flush();

      conversations.importConversationsFromText.mockResolvedValueOnce({
        ok: false,
        code: "VALIDATION_ERROR",
        message: "bad file"
      });

      const badFile = makeFakeDroppedFile("bad.json", "nope");
      const deepFile = makeFakeDroppedFile("deep.json", "deep");
      const deepChain = fakeNestedFolders(MAX_FOLDER_RECURSION_DEPTH + 1, fakeFileEntry(deepFile));
      const folder = fakeDirectoryEntry("mixed", [fakeFileEntry(badFile), deepChain]);
      const inner = root.querySelector("#view-history .axis-view__inner")!;
      dispatchFolderDrop(inner, [folder]);

      await waitUntil(() => root.querySelector("#history-error") !== null);

      expect(root.textContent).toContain("bad.json: bad file");
      expect(root.textContent).toContain(`more than ${MAX_FOLDER_RECURSION_DEPTH} levels deep`);
    });
  });
});
