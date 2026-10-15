import { isValidProviderId, type AiProviderStatus } from "../../shared/ai-contract";
import { DEFAULT_SETTINGS, type AxisSettings, type ViewId } from "./types";

/**
 * Conservative default shown until the real status is fetched from the main
 * process (or confirmed absent in the browser preview). Never claims a key
 * is configured before that is actually known.
 */
export const UNKNOWN_AI_STATUS: AiProviderStatus = {
  provider: "gemini",
  configured: false,
  backend: "none",
  secure: false,
  persistentStorageAvailable: false,
  nativeBridgeAvailable: false
};

export interface AxisState {
  activeView: ViewId;
  settings: AxisSettings;
  aboutOpen: boolean;
  aiStatus: AiProviderStatus;
  /**
   * Phase 5: set by the History view's "Open" action to hand a saved
   * conversation id to the AI Workspace. The Workspace view is mounted
   * once at startup (like every other view) and simply subscribes to this
   * field; it is responsible for clearing it immediately after consuming
   * it, so navigating to Workspace by any other route never re-opens a
   * stale conversation.
   */
  pendingOpenConversationId: string | null;
  /**
   * Phase 16: set by the window-wide drag-and-drop handler (`app.ts`) when
   * a conversation export file is dropped anywhere **other than** the
   * History view's own drop zone (that zone, added in Phase 13, still
   * handles its own drops directly and never touches this field). History
   * is mounted once at startup like every other view and simply subscribes
   * to this field, exactly like the AI Workspace already does for
   * `pendingOpenConversationId`; it is responsible for clearing it once the
   * import has finished, so switching to History by any other route never
   * re-processes a stale drop. A plain `File[]` rather than the raw
   * `FileList` the drop event itself carries, since Phase 17's folder/
   * directory drop support expands any dropped folder into the individual
   * files it contains before this field is ever set.
   */
  pendingDroppedFiles: File[] | null;
  /**
   * Phase 18: any folder-expansion limit notices (see
   * `buildFolderExpansionNotices` in `dragDropFiles.ts`) that go with the
   * window-wide drop currently in `pendingDroppedFiles` — e.g. a dropped
   * folder was too deep or had too many files, so only part of it was
   * imported. Always `[]` when there is nothing to report. Carried
   * alongside `pendingDroppedFiles` (rather than inferred later) because by
   * the time History processes the drop, the original `DataTransfer` is
   * long gone — only `app.ts`'s window-wide handler, which actually
   * expanded the drop, knows whether a limit was hit.
   */
  pendingDroppedFileNotices: string[];
}


export type Listener = (state: Readonly<AxisState>) => void;

/** Fired once, immediately, when a conversation is renamed from History — never retained as state. */
export type ConversationRenamedListener = (id: string, title: string) => void;

const SETTINGS_STORAGE_KEY = "axis.settings.v1";

function loadPersistedSettings(): AxisSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AxisSettings>;
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    // Defence in depth: a hand-edited or stale localStorage value must never
    // select an unrecognized/unsupported provider id.
    if (!isValidProviderId(merged.aiProvider)) merged.aiProvider = DEFAULT_SETTINGS.aiProvider;
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Minimal, dependency-free observable store for the renderer. Keeps the UI
 * state transitions easy to unit test without pulling in a UI framework.
 */
export function createStore(initial?: Partial<AxisState>) {
  let state: AxisState = {
    activeView: "home",
    settings: loadPersistedSettings(),
    aboutOpen: false,
    aiStatus: UNKNOWN_AI_STATUS,
    pendingOpenConversationId: null,
    pendingDroppedFiles: null,
    pendingDroppedFileNotices: [],
    ...initial
  };

  const listeners = new Set<Listener>();
  // A plain push-event channel (deliberately NOT part of `AxisState`): the
  // conversation's renamed title already lives in exactly one place — the
  // AI Workspace's own conversationController — so this only ever relays a
  // one-shot notification rather than duplicating that title in the store.
  const conversationRenameListeners = new Set<ConversationRenamedListener>();

  function notify(): void {
    for (const listener of listeners) listener(state);
  }

  function persistSettings(): void {
    try {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(state.settings));
    } catch {
      // Storage unavailable (e.g. restrictive environment) — safe to ignore,
      // preferences simply won't persist across launches.
    }
  }

  return {
    getState(): Readonly<AxisState> {
      return state;
    },
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    setActiveView(view: ViewId): void {
      if (state.activeView === view) return;
      state = { ...state, activeView: view };
      notify();
    },
    updateSettings(patch: Partial<AxisSettings>): void {
      state = { ...state, settings: { ...state.settings, ...patch } };
      persistSettings();
      notify();
    },
    toggleSidebar(): void {
      state = { ...state, settings: { ...state.settings, sidebarCollapsed: !state.settings.sidebarCollapsed } };
      persistSettings();
      notify();
    },
    openAbout(): void {
      if (state.aboutOpen) return;
      state = { ...state, aboutOpen: true };
      notify();
    },
    closeAbout(): void {
      if (!state.aboutOpen) return;
      state = { ...state, aboutOpen: false };
      notify();
    },
    setAiStatus(status: AiProviderStatus): void {
      state = { ...state, aiStatus: status };
      notify();
    },
    /** History's "Open" action: switches to the Workspace view and asks it to load this saved conversation. */
    requestOpenConversation(id: string): void {
      state = { ...state, activeView: "workspace", pendingOpenConversationId: id };
      notify();
    },
    /** Called by the Workspace view once it has consumed (or discarded) a pending open request. */
    clearPendingOpenConversation(): void {
      if (state.pendingOpenConversationId === null) return;
      state = { ...state, pendingOpenConversationId: null };
      notify();
    },
    /**
     * The window-wide drag-and-drop handler's entry point (Phase 16): a
     * file (or, as of Phase 17, the already-expanded contents of a dropped
     * folder) was dropped somewhere other than History's own drop zone, so
     * switch to History (where the import's success/failure is shown,
     * reusing its existing states — no separate notification UI) and hand
     * it the not-yet-read files to import. `notices` (Phase 18) carries any
     * folder-expansion limit messages (see `buildFolderExpansionNotices`)
     * so History can report them the same way it reports any other
     * drop-related issue, even though the limit was actually hit here,
     * before History ever saw the drop.
     */
    requestImportDroppedFiles(files: File[], notices: string[] = []): void {
      state = { ...state, activeView: "history", pendingDroppedFiles: files, pendingDroppedFileNotices: notices };
      notify();
    },
    /** Called by the History view once it has fully finished importing (or failing to import) a pending drop. */
    clearPendingDroppedFiles(): void {
      if (state.pendingDroppedFiles === null && state.pendingDroppedFileNotices.length === 0) return;
      state = { ...state, pendingDroppedFiles: null, pendingDroppedFileNotices: [] };
      notify();
    },
    /**
     * History calls this immediately after a rename is saved to disk, so an
     * already-open AI Workspace conversation can update its displayed title
     * in place — without reopening it and without a second copy of "the
     * title" ever being held in the store itself.
     */
    onConversationRenamed(listener: ConversationRenamedListener): () => void {
      conversationRenameListeners.add(listener);
      return () => conversationRenameListeners.delete(listener);
    },
    notifyConversationRenamed(id: string, title: string): void {
      for (const listener of conversationRenameListeners) listener(id, title);
    }
  };
}

export type AxisStore = ReturnType<typeof createStore>;
