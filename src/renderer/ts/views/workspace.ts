import { h } from "../dom";
import { createConversationContext } from "../ai/conversationContext";
import { createConversationController, type ConversationControllerHandle, type ConversationSaveStatus } from "../ai/conversationController";
import { createComposer, type ComposerHandle } from "../components/composer";
import { createConversationView, type ConversationViewHandle } from "../components/conversationView";
import { createExamplePromptGrid } from "../components/examplePrompts";
import { createPageHeader } from "../components/pageHeader";
import { createStatusArea } from "../components/statusArea";
import { EXAMPLE_PROMPTS } from "../data/examplePrompts";
import { getConversation } from "../ai/conversationRepositoryClient";
import type { AxisStore } from "../state";

const NEW_CONVERSATION_LABEL = "New conversation";
const NEW_CONVERSATION_CONFIRM_LABEL = "Click again to clear";
const NEW_CONVERSATION_CONFIRM_WINDOW_MS = 4000;

export function createWorkspaceView(store: AxisStore): HTMLElement {
  const status = createStatusArea("workspace");
  const context = createConversationContext();

  const conversationViewInner = createConversationView({
    idPrefix: "workspace",
    onRetry: (turn) => controller.retry(turn)
  });

  const titleLabel = h("span", { className: "axis-section-label", id: "workspace-conversation-title" }, ["New conversation"]);

  const saveStatus = h("p", { className: "axis-workspace__save-status", id: "workspace-save-status", hidden: true });

  function handleSaveStatusChange(result: ConversationSaveStatus): void {
    if (result.ok) {
      saveStatus.hidden = true;
      saveStatus.textContent = "";
      return;
    }
    saveStatus.hidden = false;
    saveStatus.textContent = result.message ?? "This conversation could not be saved locally.";
  }

  // `conversationView` is a thin wrapper around the real rendering
  // component: every render also keeps the visible title in sync, without
  // conversationController or conversationView needing to know about each
  // other's existence.
  const conversationView: ConversationViewHandle = {
    element: conversationViewInner.element,
    render(turns) {
      conversationViewInner.render(turns);
      titleLabel.textContent = controller.getTitle();
    }
  };

  let composer: ComposerHandle;
  const controller: ConversationControllerHandle = createConversationController(
    store,
    () => composer,
    context,
    conversationView,
    handleSaveStatusChange
  );
  composer = createComposer({
    idPrefix: "workspace-composer",
    large: true,
    placeholder: "Describe the task you want help with in detail...",
    onSubmitAttempt: controller.submit,
    onCancelRequest: controller.cancel
  });

  const examples = createExamplePromptGrid(EXAMPLE_PROMPTS, (prompt) => composer.setValue(prompt.prompt));

  // Phase 6: if History renames the conversation currently open here, keep
  // the displayed title in sync in place — controller.setTitleIfCurrent is
  // a no-op for every other conversation id, so this can never cross-apply
  // a rename to the wrong conversation.
  store.onConversationRenamed((id, title) => controller.setTitleIfCurrent(id, title));

  // "New conversation" needs an explicit second click within a short window
  // before it actually clears anything — a real two-step confirmation that
  // works the same in tests as in the app, without depending on a native
  // confirm() dialog.
  const newConversationButton = h(
    "button",
    { type: "button", className: "axis-btn axis-btn--ghost", id: "workspace-new-conversation" },
    [NEW_CONVERSATION_LABEL]
  ) as HTMLButtonElement;
  let confirmArmed = false;
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;
  function disarmConfirm(): void {
    confirmArmed = false;
    if (confirmTimer) clearTimeout(confirmTimer);
    confirmTimer = null;
    newConversationButton.textContent = NEW_CONVERSATION_LABEL;
  }
  newConversationButton.addEventListener("click", () => {
    if (context.getTurns().length === 0) return;
    if (!confirmArmed) {
      confirmArmed = true;
      newConversationButton.textContent = NEW_CONVERSATION_CONFIRM_LABEL;
      confirmTimer = setTimeout(disarmConfirm, NEW_CONVERSATION_CONFIRM_WINDOW_MS);
      return;
    }
    disarmConfirm();
    controller.newConversation();
    saveStatus.hidden = true;
    composer.focusEnd();
  });

  const header = createPageHeader({
    eyebrow: "AI Workspace",
    title: "Conversation",
    description: "Streaming replies from Gemini, saved locally and resumable from History.",
    titleId: "workspace-title"
  });

  const conversationHeader = h("div", { className: "axis-workspace__conversation-header" }, [titleLabel, newConversationButton]);

  const composerSection = h("section", { "aria-label": "Composer" }, [
    conversationHeader,
    saveStatus,
    conversationViewInner.element,
    composer.element
  ]);
  const statusSection = h("section", { "aria-label": "AI engine status" }, [status.element]);
  const examplesSection = h("section", { "aria-labelledby": "workspace-examples-label" }, [
    h("div", { className: "axis-section-label", id: "workspace-examples-label" }, ["Example prompts"]),
    examples
  ]);

  const inner = h("div", { className: "axis-view__inner" }, [header, composerSection, statusSection, examplesSection]);

  store.subscribe((state) => status.update(state.aiStatus));

  // Phase 5: History's "Open" action hands off a conversation id via the
  // store rather than calling into this view directly. A local guard
  // prevents the same pending id being processed twice if the store
  // notifies again before the (async) fetch resolves.
  let openingConversationId: string | null = null;
  store.subscribe((state) => {
    const pendingId = state.pendingOpenConversationId;
    if (pendingId === null || pendingId === openingConversationId) return;
    openingConversationId = pendingId;

    void getConversation(pendingId).then((result) => {
      if (result.ok && result.conversation) {
        controller.loadConversation(result.conversation);
        saveStatus.hidden = true;
      } else {
        handleSaveStatusChange({ ok: false, message: result.message ?? "That conversation could not be opened." });
      }
      openingConversationId = null;
      store.clearPendingOpenConversation();
    });
  });

  return h("section", { className: "axis-view", id: "view-workspace", role: "tabpanel", "aria-labelledby": "nav-workspace" }, [
    inner
  ]);
}
