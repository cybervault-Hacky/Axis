import { h } from "../dom";
import { icons } from "../icons";
import { createPageHeader } from "../components/pageHeader";
import { buildFolderExpansionNotices, dragCarriesFiles, expandDroppedEntries } from "../dragDropFiles";
import {
  clearAllConversations,
  deleteConversation,
  exportAllConversations,
  exportConversation,
  importAllConversations,
  importConversation,
  importConversationsFromText,
  listConversations,
  renameConversation,
  searchConversations
} from "../ai/conversationRepositoryClient";
import type { ConversationSummary } from "../../../shared/conversation-contract";
import type { AxisStore } from "../state";

const SEARCH_DEBOUNCE_MS = 250;
const DELETE_CONFIRM_WINDOW_MS = 4000;
const CLEAR_ALL_CONFIRM_WINDOW_MS = 4000;
/**
 * Phase 15: a multi-file drag-and-drop import reports every failure, not
 * just the first — but the error banner is still a single, bounded
 * paragraph (one `<p>`, no new list/stacked-banner UI), so the detail is
 * capped at this many files; anything beyond that is summarized as
 * "and N more" rather than growing the banner without limit for an
 * unusually large drop.
 */
const MAX_DROP_FAILURE_DETAILS = 3;

type HistoryUiState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; summaries: ConversationSummary[] };

function formatTimestamp(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  } catch {
    return new Date(ms).toISOString();
  }
}

export function createHistoryView(store: AxisStore): HTMLElement {
  const header = createPageHeader({
    eyebrow: "History",
    title: "Past conversations",
    description: "Local search only, by title and message text — never sent to Gemini or any other service.",
    titleId: "history-title"
  });

  let uiState: HistoryUiState = { kind: "loading" };
  let currentQuery = "";
  let renamingId: string | null = null;
  let deleteArmedId: string | null = null;
  let deleteTimer: ReturnType<typeof setTimeout> | null = null;
  let clearAllArmed = false;
  let clearAllTimer: ReturnType<typeof setTimeout> | null = null;
  let loadToken = 0;

  const searchInput = h("input", {
    type: "search",
    className: "axis-history-search",
    id: "history-search",
    placeholder: "Search by title or message text...",
    "aria-label": "Search conversation history"
  }) as HTMLInputElement;

  const importButton = h(
    "button",
    { type: "button", className: "axis-btn axis-btn--secondary", id: "history-import" },
    ["Import…"]
  ) as HTMLButtonElement;

  const importAllButton = h(
    "button",
    { type: "button", className: "axis-btn axis-btn--secondary", id: "history-import-all" },
    ["Import all…"]
  ) as HTMLButtonElement;

  const exportAllButton = h(
    "button",
    { type: "button", className: "axis-btn axis-btn--secondary", id: "history-export-all" },
    ["Export all"]
  ) as HTMLButtonElement;

  const clearAllButton = h(
    "button",
    { type: "button", className: "axis-btn axis-btn--ghost", id: "history-clear-all" },
    ["Clear all"]
  ) as HTMLButtonElement;

  const controls = h("div", { className: "axis-history-controls" }, [
    searchInput,
    importButton,
    importAllButton,
    exportAllButton,
    clearAllButton
  ]);

  const listHost = h("div", { className: "axis-history-list-host", id: "history-list-host" });

  function disarmDelete(): void {
    deleteArmedId = null;
    if (deleteTimer) clearTimeout(deleteTimer);
    deleteTimer = null;
  }

  function disarmClearAll(): void {
    clearAllArmed = false;
    if (clearAllTimer) clearTimeout(clearAllTimer);
    clearAllTimer = null;
    clearAllButton.textContent = "Clear all";
  }

  async function refresh(): Promise<void> {
    const token = ++loadToken;
    uiState = { kind: "loading" };
    render();

    const result = currentQuery.trim().length > 0 ? await searchConversations(currentQuery) : await listConversations();

    if (token !== loadToken) return; // a newer refresh has since superseded this one.

    if (!result.ok) {
      uiState = { kind: "error", message: result.message ?? "Could not load conversation history." };
    } else {
      uiState = { kind: "ready", summaries: result.summaries };
    }
    render();
  }

  searchInput.addEventListener("input", () => {
    currentQuery = searchInput.value;
    disarmDelete();
    const token = loadToken;
    setTimeout(() => {
      // Only the most recent keystroke's debounce actually triggers a fetch.
      if (token === loadToken) void refresh();
    }, SEARCH_DEBOUNCE_MS);
  });

  importButton.addEventListener("click", () => {
    if (importButton.disabled) return;
    importButton.disabled = true;
    void importConversation()
      .then((result) => {
        if (!result.ok) {
          // A cancelled native dialog isn't an error — the user just closed
          // it without picking a file, so this is a silent no-op, the same
          // way the Settings credential-import flow treats CANCELLED.
          if (result.code === "CANCELLED") return;
          uiState = { kind: "error", message: result.message ?? "Could not import that conversation." };
          render();
          return;
        }
        void refresh();
      })
      .finally(() => {
        importButton.disabled = false;
      });
  });

  importAllButton.addEventListener("click", () => {
    if (importAllButton.disabled) return;
    importAllButton.disabled = true;
    void importAllConversations()
      .then((result) => {
        if (!result.ok) {
          // A cancelled native dialog isn't an error, same as the
          // per-conversation Import action above.
          if (result.code === "CANCELLED") return;
          uiState = { kind: "error", message: result.message ?? "Could not import those conversations." };
          render();
          return;
        }
        void refresh();
      })
      .finally(() => {
        importAllButton.disabled = false;
      });
  });

  exportAllButton.addEventListener("click", () => {
    if (exportAllButton.disabled || uiState.kind !== "ready" || uiState.summaries.length === 0) return;
    exportAllButton.disabled = true;
    void exportAllConversations()
      .then((result) => {
        if (!result.ok) {
          // A cancelled save dialog is not an error — nothing happened,
          // mirroring the per-conversation Export action above.
          if (result.code === "CANCELLED") return;
          uiState = { kind: "error", message: result.message ?? "Could not export all conversations." };
          render();
        }
      })
      .finally(() => {
        exportAllButton.disabled = false;
      });
  });

  clearAllButton.addEventListener("click", () => {
    if (uiState.kind !== "ready" || uiState.summaries.length === 0) return;
    if (!clearAllArmed) {
      clearAllArmed = true;
      clearAllButton.textContent = "Click again to clear all";
      clearAllTimer = setTimeout(disarmClearAll, CLEAR_ALL_CONFIRM_WINDOW_MS);
      return;
    }
    disarmClearAll();
    void clearAllConversations().then((result) => {
      if (!result.ok) {
        uiState = { kind: "error", message: result.message ?? "Could not clear conversation history." };
        render();
        return;
      }
      void refresh();
    });
  });

  function renderLoading(): HTMLElement {
    return h("div", { className: "axis-empty-state", id: "history-loading" }, [
      h("p", { className: "axis-empty-state__title" }, ["Loading conversations…"])
    ]);
  }

  function renderError(message: string): HTMLElement {
    return h("div", { className: "axis-empty-state", id: "history-error" }, [
      h("div", { className: "axis-empty-state__icon", "aria-hidden": "true" }, [icons.history()]),
      h("span", { className: "axis-badge axis-badge--warning" }, ["Unavailable"]),
      h("p", { className: "axis-empty-state__title" }, ["History isn't available right now"]),
      h("p", { className: "axis-empty-state__body" }, [message])
    ]);
  }

  function renderEmpty(): HTMLElement {
    return h("div", { className: "axis-empty-state", id: "history-empty" }, [
      h("div", { className: "axis-empty-state__icon", "aria-hidden": "true" }, [icons.history()]),
      h("p", { className: "axis-empty-state__title" }, ["No conversations yet"]),
      h("p", { className: "axis-empty-state__body" }, [
        "Start a conversation in the AI Workspace and it will be saved here automatically so you can find and " +
          "resume it later."
      ])
    ]);
  }

  function renderNoSearchResults(): HTMLElement {
    return h("div", { className: "axis-empty-state", id: "history-no-results" }, [
      h("p", { className: "axis-empty-state__title" }, ["No matching conversations"]),
      h("p", { className: "axis-empty-state__body" }, [`Nothing saved locally matches "${currentQuery.trim()}".`])
    ]);
  }

  function renderItem(summary: ConversationSummary): HTMLElement {
    const isRenaming = renamingId === summary.id;
    const isDeleteArmed = deleteArmedId === summary.id;

    const titleBlock = isRenaming
      ? renderRenameForm(summary)
      : h("div", { className: "axis-history-item__title-row" }, [
          h("span", { className: "axis-history-item__title" }, [summary.title])
        ]);

    const meta = h("p", { className: "axis-history-item__meta" }, [
      `Updated ${formatTimestamp(summary.updatedAt)} · ${summary.messageCount} message${summary.messageCount === 1 ? "" : "s"}`
    ]);

    const preview = summary.preview
      ? h("p", { className: "axis-history-item__preview" }, [summary.preview])
      : null;

    const openButton = h(
      "button",
      { type: "button", className: "axis-btn axis-btn--secondary axis-btn--compact", "aria-label": `Open conversation: ${summary.title}` },
      ["Open"]
    ) as HTMLButtonElement;
    openButton.addEventListener("click", () => store.requestOpenConversation(summary.id));

    const renameButton = h(
      "button",
      { type: "button", className: "axis-btn axis-btn--ghost axis-btn--compact", "aria-label": `Rename conversation: ${summary.title}` },
      ["Rename"]
    ) as HTMLButtonElement;
    renameButton.addEventListener("click", () => {
      disarmDelete();
      renamingId = summary.id;
      render();
    });

    const deleteButton = h(
      "button",
      {
        type: "button",
        className: "axis-btn axis-btn--ghost axis-btn--compact",
        "aria-label": isDeleteArmed ? `Click again to delete: ${summary.title}` : `Delete conversation: ${summary.title}`
      },
      [isDeleteArmed ? "Click again to delete" : "Delete"]
    ) as HTMLButtonElement;
    deleteButton.addEventListener("click", () => {
      if (!isDeleteArmed) {
        disarmDelete();
        deleteArmedId = summary.id;
        deleteTimer = setTimeout(() => {
          disarmDelete();
          render();
        }, DELETE_CONFIRM_WINDOW_MS);
        render();
        return;
      }
      disarmDelete();
      void deleteConversation(summary.id).then((result) => {
        if (!result.ok) {
          uiState = { kind: "error", message: result.message ?? "Could not delete that conversation." };
          render();
          return;
        }
        void refresh();
      });
    });

    const exportButton = h(
      "button",
      {
        type: "button",
        className: "axis-btn axis-btn--ghost axis-btn--compact",
        "aria-label": `Export conversation: ${summary.title}`
      },
      ["Export"]
    ) as HTMLButtonElement;
    exportButton.addEventListener("click", () => {
      if (exportButton.disabled) return;
      exportButton.disabled = true;
      void exportConversation(summary.id)
        .then((result) => {
          if (!result.ok) {
            // A cancelled save dialog is not an error — nothing happened.
            if (result.code === "CANCELLED") return;
            uiState = { kind: "error", message: result.message ?? "Could not export that conversation." };
            render();
          }
        })
        .finally(() => {
          exportButton.disabled = false;
        });
    });

    const actions = h("div", { className: "axis-history-item__actions" }, [
      openButton,
      renameButton,
      exportButton,
      deleteButton
    ]);

    return h("li", { className: "axis-history-item", "data-conversation-id": summary.id }, [
      h("div", { className: "axis-history-item__body" }, [titleBlock, meta, ...(preview ? [preview] : [])]),
      actions
    ]);
  }

  function renderRenameForm(summary: ConversationSummary): HTMLElement {
    const input = h("input", {
      type: "text",
      className: "axis-history-rename-input",
      value: summary.title,
      "aria-label": `New title for ${summary.title}`
    }) as HTMLInputElement;

    const saveButton = h("button", { type: "button", className: "axis-btn axis-btn--primary axis-btn--compact" }, [
      "Save"
    ]) as HTMLButtonElement;
    const cancelButton = h("button", { type: "button", className: "axis-btn axis-btn--ghost axis-btn--compact" }, [
      "Cancel"
    ]) as HTMLButtonElement;

    function commit(): void {
      const next = input.value.trim();
      if (next.length === 0) return;
      void renameConversation(summary.id, next).then((result) => {
        renamingId = null;
        if (!result.ok) {
          uiState = { kind: "error", message: result.message ?? "Could not rename that conversation." };
          render();
          return;
        }
        // Keep an already-open AI Workspace conversation's title in sync
        // without reopening it — a no-op there if a different conversation
        // (or none) is currently open.
        store.notifyConversationRenamed(summary.id, next);
        void refresh();
      });
    }

    saveButton.addEventListener("click", commit);
    cancelButton.addEventListener("click", () => {
      renamingId = null;
      render();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      } else if (event.key === "Escape") {
        renamingId = null;
        render();
      }
    });

    return h("div", { className: "axis-history-item__rename-row" }, [input, saveButton, cancelButton]);
  }

  function render(): void {
    listHost.replaceChildren();

    if (uiState.kind === "loading") {
      listHost.append(renderLoading());
      controls.hidden = true;
      return;
    }
    if (uiState.kind === "error") {
      listHost.append(renderError(uiState.message));
      controls.hidden = true;
      return;
    }

    controls.hidden = false;
    exportAllButton.disabled = uiState.summaries.length === 0;
    clearAllButton.disabled = uiState.summaries.length === 0;

    if (uiState.summaries.length === 0) {
      listHost.append(currentQuery.trim().length > 0 ? renderNoSearchResults() : renderEmpty());
      return;
    }

    const list = h(
      "ul",
      { className: "axis-history-list", id: "history-list", "aria-label": "Saved conversations" },
      uiState.summaries.map((summary) => renderItem(summary))
    );
    listHost.append(list);
  }

  render();
  void refresh();

  const dropHint = h("p", { className: "axis-history-drop-hint" }, [
    "You can also drag a conversation export file (single or \"Export all\"), or a folder containing several, " +
      "anywhere in this list — or anywhere in the AXIS window — to import it."
  ]);

  const inner = h("div", { className: "axis-view__inner" }, [header, controls, dropHint, listHost]);

  /**
   * Formats every per-file failure from a multi-file drop into one
   * bounded, readable sentence for the existing single-paragraph error
   * state (Phase 15) — never a raw, unbounded dump of every filename for
   * an unusually large drop. A single failure keeps the exact
   * "<name>: <reason>" shape Phase 13 originally used; two or more are
   * prefixed with an explicit "N of M files could not be imported" count
   * so a partial failure is never mistaken for a total one, and at most
   * `MAX_DROP_FAILURE_DETAILS` are named individually before the rest are
   * summarized as "and N more".
   */
  function formatDropFailures(failures: Array<{ name: string; message: string }>, totalFiles: number): string {
    const only = failures.length === 1 ? failures[0] : undefined;
    if (only) {
      return `${only.name}: ${only.message}`;
    }
    const shown = failures.slice(0, MAX_DROP_FAILURE_DETAILS);
    const detail = shown.map((failure) => `${failure.name}: ${failure.message}`).join("; ");
    const remaining = failures.length - shown.length;
    const suffix = remaining > 0 ? ` (and ${remaining} more)` : "";
    return `${failures.length} of ${totalFiles} files could not be imported: ${detail}${suffix}`;
  }

  /**
   * Phase 18: combines the per-file failure summary above (unchanged) with
   * any folder-expansion limit notices (Phase 18's depth/file-count caps in
   * `dragDropFiles.ts`) into the single message History's existing error
   * state shows — reusing that one banner rather than introducing a
   * second, separate kind of notice for "some files were skipped because a
   * limit was hit" versus "some files failed validation". Returns `null`
   * when there is nothing at all to report (the common case).
   */
  function buildDropResultMessage(failures: Array<{ name: string; message: string }>, notices: string[], totalFiles: number): string | null {
    const parts: string[] = [];
    if (failures.length > 0) parts.push(formatDropFailures(failures, totalFiles));
    if (notices.length > 0) parts.push(notices.join(" "));
    return parts.length > 0 ? parts.join(" ") : null;
  }

  /**
   * Phase 13: drag-and-drop import. Only the standard Web `File.text()`
   * API is used to read a dropped file's content in the renderer — never
   * a file path, and never anything beyond what the browser itself grants
   * for a file the OS just handed this window via a genuine drag gesture.
   * Every file is sent to the main process as opaque, untrusted text and
   * re-validated there exactly like every other import path
   * (`importConversationsFromText` → `repository.importAnyFromText`).
   * Multiple dropped files are imported one at a time so a folder's worth
   * of individually-exported conversations (or a mix of single and bulk
   * export files) can be restored in one drag.
   *
   * Phase 15: every failure is now surfaced (bounded and summarized by
   * `formatDropFailures` above), not just the first one Phase 13 reported
   * — a drop with several bad files no longer hides all but one reason.
   * Any successful imports are saved and refreshed **before** a failure
   * is ever rendered (rather than racing an unawaited refresh against the
   * error render), so the outcome is deterministic: a successful import
   * is never silently lost or overwritten by a later error render, and a
   * failure banner is never clobbered by a refresh that was still
   * in flight. This still follows the same "the most recent outcome wins
   * the view" convention every other History action already uses (a
   * failed rename/delete/export also fully replaces the list with the
   * same error state) — this phase does not introduce a new way of
   * displaying an error, only a more complete message for this one.
   *
   * Phase 18: `notices` carries any folder-expansion limit messages (see
   * `buildFolderExpansionNotices`) that go with this exact batch of files,
   * so a dropped folder that hit the new depth/file-count caps still tells
   * the user what happened instead of silently importing a subset.
   */
  async function handleDroppedFiles(fileList: File[], notices: string[] = []): Promise<void> {
    const files = fileList;
    if (files.length === 0 && notices.length === 0) return;

    let importedCount = 0;
    const failures: Array<{ name: string; message: string }> = [];

    for (const file of files) {
      let text: string;
      try {
        text = await file.text();
      } catch {
        failures.push({ name: file.name, message: "Could not read that file." });
        continue;
      }
      const result = await importConversationsFromText(text);
      if (result.ok) {
        importedCount += 1;
      } else {
        failures.push({ name: file.name, message: result.message ?? "That file is not a valid AXIS conversation export." });
      }
    }

    if (importedCount > 0) await refresh();
    const message = buildDropResultMessage(failures, notices, files.length);
    if (message) {
      uiState = { kind: "error", message };
      render();
    }
  }

  /**
   * Phase 16: History's own drop zone is now one of two places a file can
   * be dropped (the other is anywhere else in the window — see
   * `app.ts`'s window-wide handler). `stopPropagation` here means a drop
   * that lands inside this view's own list is fully handled right here,
   * exactly as it always was, and is never also seen by the window-wide
   * handler — so it can never be double-imported now that a second,
   * broader listener also exists on the shell.
   */
  let dragDepth = 0;

  inner.addEventListener("dragenter", (event) => {
    if (!dragCarriesFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepth += 1;
    inner.classList.add("axis-view__inner--drop-active");
  });

  inner.addEventListener("dragover", (event) => {
    if (!dragCarriesFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });

  inner.addEventListener("dragleave", (event) => {
    if (!dragCarriesFiles(event)) return;
    event.stopPropagation();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) inner.classList.remove("axis-view__inner--drop-active");
  });

  inner.addEventListener("drop", (event) => {
    if (!dragCarriesFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepth = 0;
    inner.classList.remove("axis-view__inner--drop-active");
    const dataTransfer = event.dataTransfer;
    void (async () => {
      // Phase 17: expand any dropped folder(s) into the files they contain
      // before handing everything to the same import pipeline a plain
      // multi-file drop already used. Phase 18: `notices` reports whether
      // that expansion hit the depth/file-count caps, so it still gets
      // surfaced even though every file that *was* collected still imports
      // normally below.
      const expansion = await expandDroppedEntries(dataTransfer);
      const notices = buildFolderExpansionNotices(expansion);
      if (expansion.files.length > 0 || notices.length > 0) await handleDroppedFiles(expansion.files, notices);
    })();
  });

  /**
   * Phase 16: a file dropped anywhere else in the app window is routed here
   * via the store (`app.ts`'s window-wide drop handler calls
   * `store.requestImportDroppedFiles`, which also switches to this view so
   * the result is immediately visible) rather than this view reaching out
   * to the DOM itself. This mirrors the exact `pendingOpenConversationId`
   * idiom the AI Workspace already uses for History's "Open" action: a
   * local guard prevents the same pending file list from being processed
   * twice if the store notifies again before the (async) import settles,
   * and the pending value is only cleared from the store once that import
   * has fully finished. The actual import logic is the same
   * `handleDroppedFiles` used by this view's own drop zone above — nothing
   * about file reading, validation, or error reporting is duplicated.
   *
   * Phase 18: also forwards any `pendingDroppedFileNotices` the window-wide
   * handler recorded (a folder-expansion limit hit before History ever saw
   * the drop) so it is reported the same way a local folder-limit hit
   * already is.
   */
  let processingPendingDroppedFiles = false;
  store.subscribe((state) => {
    const pending = state.pendingDroppedFiles;
    const notices = state.pendingDroppedFileNotices;
    const hasWork = (pending !== null && pending.length > 0) || notices.length > 0;
    if (!hasWork || processingPendingDroppedFiles) return;
    processingPendingDroppedFiles = true;
    void handleDroppedFiles(pending ?? [], notices).finally(() => {
      processingPendingDroppedFiles = false;
      store.clearPendingDroppedFiles();
    });
  });

  return h("section", { className: "axis-view", id: "view-history", role: "tabpanel", "aria-labelledby": "nav-history" }, [inner]);
}

