// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";

// conversationsController.ts imports the real `dialog` from "electron" for
// the Phase 7 export/import handlers. Tests run under plain Node (no real
// Electron binary installed in this sandbox), so — exactly like
// credentialStore.test.ts — "electron" is mocked with a controllable fake
// of just the one API this module actually uses.
vi.mock("electron", () => ({
  dialog: {
    showSaveDialog: vi.fn(),
    showOpenDialog: vi.fn()
  }
}));

import { dialog } from "electron";
import { createConversationsController } from "../../src/main/conversations/conversationsController";
import type { ConversationRecord } from "../../src/shared/conversation-contract";

function makeFakeWindow() {
  const mainFrame = { id: "main-frame" } as unknown as Electron.WebFrameMain;
  const webContents = { mainFrame, id: Math.floor(Math.random() * 100000) } as unknown as Electron.WebContents;
  const win = { isDestroyed: () => false, webContents } as unknown as Electron.BrowserWindow;
  return { win, webContents, mainFrame };
}

function makeEvent(webContents: Electron.WebContents, senderFrame: Electron.WebFrameMain): IpcMainInvokeEvent {
  return { sender: webContents, senderFrame } as unknown as IpcMainInvokeEvent;
}

function makeRecord(overrides: Partial<ConversationRecord> = {}): ConversationRecord {
  const now = Date.now();
  return {
    id: "conv-1",
    title: "Hello",
    createdAt: now,
    updatedAt: now,
    messages: [{ id: "m1", role: "user", text: "hi", status: "complete", truncated: false, createdAt: now }],
    ...overrides
  };
}

function makeFakeRepository() {
  return {
    listSummaries: vi.fn(),
    searchSummaries: vi.fn(),
    getConversation: vi.fn(),
    saveConversation: vi.fn(),
    renameConversation: vi.fn(),
    deleteConversation: vi.fn(),
    clearAll: vi.fn(),
    exportConversationToFile: vi.fn(),
    exportAllToFile: vi.fn(),
    importConversationFromFile: vi.fn(),
    importAllFromFile: vi.fn(),
    importAnyFromText: vi.fn()
  };
}

describe("conversationsController", () => {
  let repo: ReturnType<typeof makeFakeRepository>;

  beforeEach(() => {
    repo = makeFakeRepository();
    vi.mocked(dialog.showSaveDialog).mockReset();
    vi.mocked(dialog.showOpenDialog).mockReset();
  });

  it("rejects every handler for an untrusted sender and never touches the repository", async () => {
    const { win } = makeFakeWindow();
    const { webContents: otherWebContents, mainFrame: otherFrame } = makeFakeWindow();
    const controller = createConversationsController({ getMainWindow: () => win, repository: repo as never });
    const event = makeEvent(otherWebContents, otherFrame);

    const list = await controller.listHandler(event);
    expect(list.ok).toBe(false);
    expect(list.summaries).toEqual([]);
    expect(repo.listSummaries).not.toHaveBeenCalled();

    const got = await controller.getHandler(event, { id: "conv-1" });
    expect(got.ok).toBe(false);
    expect(repo.getConversation).not.toHaveBeenCalled();

    const saved = await controller.saveHandler(event, makeRecord());
    expect(saved.ok).toBe(false);
    expect(repo.saveConversation).not.toHaveBeenCalled();

    const renamed = await controller.renameHandler(event, { id: "conv-1", title: "x" });
    expect(renamed.ok).toBe(false);
    expect(repo.renameConversation).not.toHaveBeenCalled();

    const deleted = await controller.deleteHandler(event, { id: "conv-1" });
    expect(deleted.ok).toBe(false);
    expect(repo.deleteConversation).not.toHaveBeenCalled();

    const cleared = await controller.clearAllHandler(event);
    expect(cleared.ok).toBe(false);
    expect(repo.clearAll).not.toHaveBeenCalled();

    const exported = await controller.exportHandler(event, { id: "conv-1" });
    expect(exported.ok).toBe(false);
    expect(repo.getConversation).not.toHaveBeenCalled();
    expect(repo.exportConversationToFile).not.toHaveBeenCalled();
    expect(dialog.showSaveDialog).not.toHaveBeenCalled();

    const exportedAll = await controller.exportAllHandler(event);
    expect(exportedAll.ok).toBe(false);
    expect(repo.exportAllToFile).not.toHaveBeenCalled();
    expect(dialog.showSaveDialog).not.toHaveBeenCalled();

    const imported = await controller.importHandler(event);
    expect(imported.ok).toBe(false);
    expect(repo.importConversationFromFile).not.toHaveBeenCalled();
    expect(dialog.showOpenDialog).not.toHaveBeenCalled();

    const importedAll = await controller.importAllHandler(event);
    expect(importedAll.ok).toBe(false);
    expect(repo.importAllFromFile).not.toHaveBeenCalled();
    expect(dialog.showOpenDialog).not.toHaveBeenCalled();

    const importedFromText = await controller.importFromTextHandler(event, { text: "{}" });
    expect(importedFromText.ok).toBe(false);
    expect(repo.importAnyFromText).not.toHaveBeenCalled();
  });

  it("lists conversations for a trusted sender", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    repo.listSummaries.mockResolvedValue({ ok: true, summaries: [{ id: "a" }] });
    const controller = createConversationsController({ getMainWindow: () => win, repository: repo as never });

    const result = await controller.listHandler(makeEvent(webContents, mainFrame));
    expect(result.ok).toBe(true);
    expect(result.summaries).toEqual([{ id: "a" }]);
  });

  it("rejects a malformed search payload before reaching the repository", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createConversationsController({ getMainWindow: () => win, repository: repo as never });
    const result = await controller.searchHandler(makeEvent(webContents, mainFrame), { query: 123 });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("VALIDATION_ERROR");
    expect(repo.searchSummaries).not.toHaveBeenCalled();
  });

  it("forwards a valid search query to the repository", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    repo.searchSummaries.mockResolvedValue({ ok: true, summaries: [] });
    const controller = createConversationsController({ getMainWindow: () => win, repository: repo as never });
    await controller.searchHandler(makeEvent(webContents, mainFrame), { query: "kyoto" });
    expect(repo.searchSummaries).toHaveBeenCalledWith("kyoto");
  });

  it("rejects a get/delete payload with a path-traversal-shaped id", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createConversationsController({ getMainWindow: () => win, repository: repo as never });
    const event = makeEvent(webContents, mainFrame);

    const got = await controller.getHandler(event, { id: "../../etc/passwd" });
    expect(got.ok).toBe(false);
    expect(got.code).toBe("VALIDATION_ERROR");
    expect(repo.getConversation).not.toHaveBeenCalled();

    const deleted = await controller.deleteHandler(event, { id: "../../etc/passwd" });
    expect(deleted.ok).toBe(false);
    expect(repo.deleteConversation).not.toHaveBeenCalled();
  });

  it("rejects a save payload that is not a valid conversation record", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createConversationsController({ getMainWindow: () => win, repository: repo as never });
    const result = await controller.saveHandler(makeEvent(webContents, mainFrame), { not: "valid" });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("VALIDATION_ERROR");
    expect(repo.saveConversation).not.toHaveBeenCalled();
  });

  it("saves a valid conversation record", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    repo.saveConversation.mockResolvedValue({ ok: true, conversation: makeRecord() });
    const controller = createConversationsController({ getMainWindow: () => win, repository: repo as never });
    const result = await controller.saveHandler(makeEvent(webContents, mainFrame), makeRecord());
    expect(result.ok).toBe(true);
    expect(repo.saveConversation).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty-after-trim rename title", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    const controller = createConversationsController({ getMainWindow: () => win, repository: repo as never });
    const result = await controller.renameHandler(makeEvent(webContents, mainFrame), { id: "conv-1", title: "   " });
    expect(result.ok).toBe(false);
    expect(repo.renameConversation).not.toHaveBeenCalled();
  });

  it("propagates a repository failure (e.g. NOT_FOUND) honestly rather than claiming success", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    repo.renameConversation.mockResolvedValue({ ok: false, code: "NOT_FOUND", message: "gone" });
    const controller = createConversationsController({ getMainWindow: () => win, repository: repo as never });
    const result = await controller.renameHandler(makeEvent(webContents, mainFrame), { id: "conv-1", title: "New" });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("NOT_FOUND");
  });

  it("deletes and clears all for a trusted sender", async () => {
    const { win, webContents, mainFrame } = makeFakeWindow();
    repo.deleteConversation.mockResolvedValue({ ok: true });
    repo.clearAll.mockResolvedValue({ ok: true });
    const controller = createConversationsController({ getMainWindow: () => win, repository: repo as never });
    const event = makeEvent(webContents, mainFrame);

    const deleted = await controller.deleteHandler(event, { id: "conv-1" });
    expect(deleted.ok).toBe(true);

    const cleared = await controller.clearAllHandler(event);
    expect(cleared.ok).toBe(true);
  });

  describe("export", () => {
    it("rejects a malformed id payload before ever opening a dialog or touching the repository", async () => {
      const { win, webContents, mainFrame } = makeFakeWindow();
      const controller = createConversationsController({ getMainWindow: () => win, repository: repo as never });
      const result = await controller.exportHandler(makeEvent(webContents, mainFrame), { id: "../../etc/passwd" });
      expect(result.ok).toBe(false);
      expect(result.code).toBe("VALIDATION_ERROR");
      expect(repo.getConversation).not.toHaveBeenCalled();
      expect(dialog.showSaveDialog).not.toHaveBeenCalled();
    });

    it("fails fast with the repository's own error (e.g. NOT_FOUND) without ever opening the save dialog", async () => {
      const { win, webContents, mainFrame } = makeFakeWindow();
      repo.getConversation.mockResolvedValue({ ok: false, code: "NOT_FOUND", message: "gone" });
      const controller = createConversationsController({ getMainWindow: () => win, repository: repo as never });
      const result = await controller.exportHandler(makeEvent(webContents, mainFrame), { id: "conv-1" });
      expect(result.ok).toBe(false);
      expect(result.code).toBe("NOT_FOUND");
      expect(dialog.showSaveDialog).not.toHaveBeenCalled();
    });

    it("reports CANCELLED (not an error) when the user dismisses the save dialog, and never touches the repository's write path", async () => {
      const { win, webContents, mainFrame } = makeFakeWindow();
      repo.getConversation.mockResolvedValue({ ok: true, conversation: makeRecord() });
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: undefined } as never);
      const controller = createConversationsController({ getMainWindow: () => win, repository: repo as never });
      const result = await controller.exportHandler(makeEvent(webContents, mainFrame), { id: "conv-1" });
      expect(result.ok).toBe(false);
      expect(result.code).toBe("CANCELLED");
      expect(repo.exportConversationToFile).not.toHaveBeenCalled();
    });

    it("writes to the chosen path via the repository once the user confirms the save dialog", async () => {
      const { win, webContents, mainFrame } = makeFakeWindow();
      repo.getConversation.mockResolvedValue({ ok: true, conversation: makeRecord({ title: "Trip to Kyoto" }) });
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: "/tmp/Trip to Kyoto.json" } as never);
      repo.exportConversationToFile.mockResolvedValue({ ok: true });
      const controller = createConversationsController({ getMainWindow: () => win, repository: repo as never });
      const result = await controller.exportHandler(makeEvent(webContents, mainFrame), { id: "conv-1" });
      expect(result.ok).toBe(true);
      expect(repo.exportConversationToFile).toHaveBeenCalledWith("conv-1", "/tmp/Trip to Kyoto.json");
    });

    it("propagates a repository write failure honestly rather than claiming success", async () => {
      const { win, webContents, mainFrame } = makeFakeWindow();
      repo.getConversation.mockResolvedValue({ ok: true, conversation: makeRecord() });
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: "/tmp/out.json" } as never);
      repo.exportConversationToFile.mockResolvedValue({ ok: false, code: "STORAGE_ERROR", message: "disk full" });
      const controller = createConversationsController({ getMainWindow: () => win, repository: repo as never });
      const result = await controller.exportHandler(makeEvent(webContents, mainFrame), { id: "conv-1" });
      expect(result.ok).toBe(false);
      expect(result.code).toBe("STORAGE_ERROR");
    });
  });

  describe("export all", () => {
    it("reports CANCELLED (not an error) when the user dismisses the save dialog, and never touches the repository's write path", async () => {
      const { win, webContents, mainFrame } = makeFakeWindow();
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: undefined } as never);
      const controller = createConversationsController({ getMainWindow: () => win, repository: repo as never });
      const result = await controller.exportAllHandler(makeEvent(webContents, mainFrame));
      expect(result.ok).toBe(false);
      expect(result.code).toBe("CANCELLED");
      expect(repo.exportAllToFile).not.toHaveBeenCalled();
    });

    it("writes to the chosen path via the repository once the user confirms the save dialog, with no id payload required", async () => {
      const { win, webContents, mainFrame } = makeFakeWindow();
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: "/tmp/axis-conversations-export.json" } as never);
      repo.exportAllToFile.mockResolvedValue({ ok: true });
      const controller = createConversationsController({ getMainWindow: () => win, repository: repo as never });
      const result = await controller.exportAllHandler(makeEvent(webContents, mainFrame));
      expect(result.ok).toBe(true);
      expect(repo.exportAllToFile).toHaveBeenCalledWith("/tmp/axis-conversations-export.json");
      expect(repo.getConversation).not.toHaveBeenCalled();
    });

    it("propagates a repository write failure honestly rather than claiming success", async () => {
      const { win, webContents, mainFrame } = makeFakeWindow();
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: "/tmp/out.json" } as never);
      repo.exportAllToFile.mockResolvedValue({ ok: false, code: "STORAGE_ERROR", message: "disk full" });
      const controller = createConversationsController({ getMainWindow: () => win, repository: repo as never });
      const result = await controller.exportAllHandler(makeEvent(webContents, mainFrame));
      expect(result.ok).toBe(false);
      expect(result.code).toBe("STORAGE_ERROR");
    });
  });

  describe("import", () => {
    it("reports CANCELLED (not an error) when the user dismisses the open dialog, and never touches the repository", async () => {
      const { win, webContents, mainFrame } = makeFakeWindow();
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] } as never);
      const controller = createConversationsController({ getMainWindow: () => win, repository: repo as never });
      const result = await controller.importHandler(makeEvent(webContents, mainFrame));
      expect(result.ok).toBe(false);
      expect(result.code).toBe("CANCELLED");
      expect(repo.importConversationFromFile).not.toHaveBeenCalled();
    });

    it("imports the chosen file via the repository once the user confirms the open dialog", async () => {
      const { win, webContents, mainFrame } = makeFakeWindow();
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: ["/tmp/import.json"] } as never);
      repo.importConversationFromFile.mockResolvedValue({ ok: true, conversation: makeRecord() });
      const controller = createConversationsController({ getMainWindow: () => win, repository: repo as never });
      const result = await controller.importHandler(makeEvent(webContents, mainFrame));
      expect(result.ok).toBe(true);
      expect(repo.importConversationFromFile).toHaveBeenCalledWith("/tmp/import.json");
    });

    it("propagates a repository validation failure (e.g. a malformed or hand-edited file) honestly", async () => {
      const { win, webContents, mainFrame } = makeFakeWindow();
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: ["/tmp/bad.json"] } as never);
      repo.importConversationFromFile.mockResolvedValue({
        ok: false,
        code: "VALIDATION_ERROR",
        message: "not a valid AXIS conversation export"
      });
      const controller = createConversationsController({ getMainWindow: () => win, repository: repo as never });
      const result = await controller.importHandler(makeEvent(webContents, mainFrame));
      expect(result.ok).toBe(false);
      expect(result.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("import all", () => {
    it("reports CANCELLED (not an error) when the user dismisses the open dialog, and never touches the repository", async () => {
      const { win, webContents, mainFrame } = makeFakeWindow();
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] } as never);
      const controller = createConversationsController({ getMainWindow: () => win, repository: repo as never });
      const result = await controller.importAllHandler(makeEvent(webContents, mainFrame));
      expect(result.ok).toBe(false);
      expect(result.code).toBe("CANCELLED");
      expect(repo.importAllFromFile).not.toHaveBeenCalled();
    });

    it("imports the chosen bulk file via the repository once the user confirms the open dialog, discarding the imported count", async () => {
      const { win, webContents, mainFrame } = makeFakeWindow();
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: ["/tmp/bulk-export.json"] } as never);
      repo.importAllFromFile.mockResolvedValue({ ok: true, importedCount: 3 });
      const controller = createConversationsController({ getMainWindow: () => win, repository: repo as never });
      const result = await controller.importAllHandler(makeEvent(webContents, mainFrame));
      expect(result.ok).toBe(true);
      expect(result).not.toHaveProperty("importedCount");
      expect(repo.importAllFromFile).toHaveBeenCalledWith("/tmp/bulk-export.json");
    });

    it("propagates a repository validation failure (e.g. a single-conversation file, not a bulk one) honestly", async () => {
      const { win, webContents, mainFrame } = makeFakeWindow();
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: ["/tmp/wrong-shape.json"] } as never);
      repo.importAllFromFile.mockResolvedValue({
        ok: false,
        code: "VALIDATION_ERROR",
        message: "not a valid AXIS bulk conversation export"
      });
      const controller = createConversationsController({ getMainWindow: () => win, repository: repo as never });
      const result = await controller.importAllHandler(makeEvent(webContents, mainFrame));
      expect(result.ok).toBe(false);
      expect(result.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("import from text (Phase 13 drag-and-drop)", () => {
    it("rejects a malformed payload (missing text) without ever touching the repository", async () => {
      const { win, webContents, mainFrame } = makeFakeWindow();
      const controller = createConversationsController({ getMainWindow: () => win, repository: repo as never });
      const result = await controller.importFromTextHandler(makeEvent(webContents, mainFrame), {});
      expect(result.ok).toBe(false);
      expect(result.code).toBe("VALIDATION_ERROR");
      expect(repo.importAnyFromText).not.toHaveBeenCalled();
    });

    it("rejects a payload whose text is not a string", async () => {
      const { win, webContents, mainFrame } = makeFakeWindow();
      const controller = createConversationsController({ getMainWindow: () => win, repository: repo as never });
      const result = await controller.importFromTextHandler(makeEvent(webContents, mainFrame), { text: 42 });
      expect(result.ok).toBe(false);
      expect(result.code).toBe("VALIDATION_ERROR");
      expect(repo.importAnyFromText).not.toHaveBeenCalled();
    });

    it("delegates valid text to the repository, discarding the imported count, and never opens a dialog", async () => {
      const { win, webContents, mainFrame } = makeFakeWindow();
      repo.importAnyFromText.mockResolvedValue({ ok: true, importedCount: 2 });
      const controller = createConversationsController({ getMainWindow: () => win, repository: repo as never });
      const result = await controller.importFromTextHandler(makeEvent(webContents, mainFrame), { text: "{\"hello\":1}" });
      expect(result.ok).toBe(true);
      expect(result).not.toHaveProperty("importedCount");
      expect(repo.importAnyFromText).toHaveBeenCalledWith("{\"hello\":1}");
      expect(dialog.showOpenDialog).not.toHaveBeenCalled();
    });

    it("propagates a repository validation failure honestly", async () => {
      const { win, webContents, mainFrame } = makeFakeWindow();
      repo.importAnyFromText.mockResolvedValue({
        ok: false,
        code: "VALIDATION_ERROR",
        message: "That file is not a valid AXIS conversation export (single or \"Export all\")."
      });
      const controller = createConversationsController({ getMainWindow: () => win, repository: repo as never });
      const result = await controller.importFromTextHandler(makeEvent(webContents, mainFrame), { text: "not valid" });
      expect(result.ok).toBe(false);
      expect(result.code).toBe("VALIDATION_ERROR");
    });
  });
});
