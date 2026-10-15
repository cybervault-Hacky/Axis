import { beforeEach, describe, expect, it } from "vitest";
import { createStore } from "../src/renderer/ts/state";
import { DEFAULT_SETTINGS } from "../src/renderer/ts/types";

describe("createStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("starts on the home view with default settings and closed about dialog", () => {
    const store = createStore();
    const state = store.getState();
    expect(state.activeView).toBe("home");
    expect(state.settings).toEqual(DEFAULT_SETTINGS);
    expect(state.aboutOpen).toBe(false);
  });

  it("switches the active view and notifies subscribers", () => {
    const store = createStore();
    const seen: string[] = [];
    store.subscribe((state) => seen.push(state.activeView));

    store.setActiveView("workspace");
    store.setActiveView("settings");

    expect(seen).toEqual(["home", "workspace", "settings"]);
    expect(store.getState().activeView).toBe("settings");
  });

  it("does not notify when setting the same view twice", () => {
    const store = createStore();
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });

    store.setActiveView("home");
    store.setActiveView("home");

    expect(notifications).toBe(1); // only the initial immediate call
  });

  it("merges settings updates and persists them to localStorage", () => {
    const store = createStore();
    store.updateSettings({ accent: "graphite", density: "compact" });

    expect(store.getState().settings).toMatchObject({ accent: "graphite", density: "compact" });

    const persisted = JSON.parse(window.localStorage.getItem("axis.settings.v1") ?? "{}");
    expect(persisted).toMatchObject({ accent: "graphite", density: "compact" });
  });

  it("loads persisted settings on construction", () => {
    window.localStorage.setItem("axis.settings.v1", JSON.stringify({ accent: "graphite", sidebarCollapsed: true }));
    const store = createStore();
    expect(store.getState().settings.accent).toBe("graphite");
    expect(store.getState().settings.sidebarCollapsed).toBe(true);
    // Unspecified fields fall back to defaults.
    expect(store.getState().settings.density).toBe(DEFAULT_SETTINGS.density);
  });

  it("toggles the sidebar collapsed flag", () => {
    const store = createStore();
    expect(store.getState().settings.sidebarCollapsed).toBe(false);
    store.toggleSidebar();
    expect(store.getState().settings.sidebarCollapsed).toBe(true);
    store.toggleSidebar();
    expect(store.getState().settings.sidebarCollapsed).toBe(false);
  });

  it("opens and closes the about dialog idempotently", () => {
    const store = createStore();
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });

    store.openAbout();
    store.openAbout(); // no-op, already open
    expect(store.getState().aboutOpen).toBe(true);
    expect(notifications).toBe(2); // initial + one real open

    store.closeAbout();
    store.closeAbout(); // no-op, already closed
    expect(store.getState().aboutOpen).toBe(false);
    expect(notifications).toBe(3);
  });

  it("starts with no pending conversation to open", () => {
    const store = createStore();
    expect(store.getState().pendingOpenConversationId).toBeNull();
  });

  it("requestOpenConversation switches to the workspace view and records the pending id", () => {
    const store = createStore();
    store.requestOpenConversation("conv-123");
    expect(store.getState().activeView).toBe("workspace");
    expect(store.getState().pendingOpenConversationId).toBe("conv-123");
  });

  it("clearPendingOpenConversation clears the pending id and is idempotent (no extra notifications)", () => {
    const store = createStore();
    store.requestOpenConversation("conv-123");
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });

    store.clearPendingOpenConversation();
    expect(store.getState().pendingOpenConversationId).toBeNull();
    expect(notifications).toBe(2); // initial subscribe call + one real clear

    store.clearPendingOpenConversation(); // no-op, already clear
    expect(notifications).toBe(2);
  });

  it("starts with no pending dropped files", () => {
    const store = createStore();
    expect(store.getState().pendingDroppedFiles).toBeNull();
  });

  it("requestImportDroppedFiles switches to the history view and records the pending file list", () => {
    const store = createStore();
    const files = [new File(["{}"], "export.json", { type: "application/json" })];
    store.requestImportDroppedFiles(files);
    expect(store.getState().activeView).toBe("history");
    expect(store.getState().pendingDroppedFiles).toBe(files);
  });

  it("requestImportDroppedFiles switches to history even when another view is currently active", () => {
    const store = createStore();
    store.setActiveView("settings");
    const files = [new File(["{}"], "export.json")];
    store.requestImportDroppedFiles(files);
    expect(store.getState().activeView).toBe("history");
    expect(store.getState().pendingDroppedFiles).toBe(files);
  });

  it("clearPendingDroppedFiles clears the pending files and is idempotent (no extra notifications)", () => {
    const store = createStore();
    const files = [new File(["{}"], "export.json")];
    store.requestImportDroppedFiles(files);
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });

    store.clearPendingDroppedFiles();
    expect(store.getState().pendingDroppedFiles).toBeNull();
    expect(notifications).toBe(2); // initial subscribe call + one real clear

    store.clearPendingDroppedFiles(); // no-op, already clear
    expect(notifications).toBe(2);
  });

  it("starts with no pending dropped-file notices (Phase 18)", () => {
    const store = createStore();
    expect(store.getState().pendingDroppedFileNotices).toEqual([]);
  });

  it("requestImportDroppedFiles defaults to no notices when none are given", () => {
    const store = createStore();
    store.requestImportDroppedFiles([new File(["{}"], "export.json")]);
    expect(store.getState().pendingDroppedFileNotices).toEqual([]);
  });

  it("requestImportDroppedFiles records any folder-expansion limit notices alongside the files (Phase 18)", () => {
    const store = createStore();
    const files = [new File(["{}"], "export.json")];
    const notices = ["Only the first 500 files were imported."];
    store.requestImportDroppedFiles(files, notices);
    expect(store.getState().activeView).toBe("history");
    expect(store.getState().pendingDroppedFiles).toBe(files);
    expect(store.getState().pendingDroppedFileNotices).toBe(notices);
  });

  it("clearPendingDroppedFiles also clears any pending notices, and is idempotent", () => {
    const store = createStore();
    store.requestImportDroppedFiles([new File(["{}"], "export.json")], ["a limit was hit"]);
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });

    store.clearPendingDroppedFiles();
    expect(store.getState().pendingDroppedFiles).toBeNull();
    expect(store.getState().pendingDroppedFileNotices).toEqual([]);
    expect(notifications).toBe(2);

    store.clearPendingDroppedFiles(); // no-op, already clear
    expect(notifications).toBe(2);
  });

  it("notifyConversationRenamed delivers the id and title to every listener, and is a one-shot event (not stored state)", () => {
    const store = createStore();
    const seen: Array<[string, string]> = [];
    const unsubscribe = store.onConversationRenamed((id, title) => seen.push([id, title]));

    store.notifyConversationRenamed("conv-1", "New title");
    expect(seen).toEqual([["conv-1", "New title"]]);

    // Not retained anywhere in state — it is purely a push event.
    expect(store.getState()).not.toHaveProperty("renamedConversation");

    unsubscribe();
    store.notifyConversationRenamed("conv-1", "Yet another title");
    expect(seen).toEqual([["conv-1", "New title"]]); // unsubscribed listener hears nothing further
  });

  it("notifyConversationRenamed with no listeners does not throw", () => {
    const store = createStore();
    expect(() => store.notifyConversationRenamed("conv-1", "Title")).not.toThrow();
  });
});
