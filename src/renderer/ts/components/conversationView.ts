import { h } from "../dom";
import type { ConversationTurn } from "../ai/conversationContext";
import { splitIntoSegments } from "../ai/textSegments";

export interface ConversationViewOptions {
  idPrefix: string;
  /** Called when the user activates "Retry" on a failed or cancelled turn. */
  onRetry: (turn: ConversationTurn) => void;
}

export interface ConversationViewHandle {
  element: HTMLElement;
  render: (turns: readonly ConversationTurn[]) => void;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the honest "unavailable" result below.
  }
  return false;
}

function createCopyButton(label: string, getText: () => string): HTMLButtonElement {
  const button = h("button", { type: "button", className: "axis-btn axis-btn--ghost axis-btn--compact" }, [label]) as HTMLButtonElement;
  let resetTimer: ReturnType<typeof setTimeout> | null = null;
  button.addEventListener("click", () => {
    void copyToClipboard(getText()).then((ok) => {
      if (resetTimer) clearTimeout(resetTimer);
      button.textContent = ok ? "Copied" : "Copy unavailable";
      resetTimer = setTimeout(() => {
        button.textContent = label;
      }, 1500);
    });
  });
  return button;
}

function statusLabel(status: ConversationTurn["status"]): string {
  switch (status) {
    case "pending":
      return "Generating…";
    case "complete":
      return "Response";
    case "cancelled":
      return "Stopped";
    case "error":
      return "Failed";
    case "incomplete":
      return "Incomplete";
  }
}

/**
 * Whether a turn's visible "this response may be incomplete" note should
 * show, and its exact text — kept as a pure function so creating a turn's
 * initial DOM and later patching it in place always agree on the same
 * rule, with no risk of the two diverging.
 */
function computeNoteText(turn: ConversationTurn): string | null {
  if (turn.status === "complete" && turn.truncated) {
    return "This response may be incomplete — the provider cut it short.";
  }
  if (turn.status === "incomplete" && turn.responseText.length > 0) {
    return "This response was still generating when the conversation was last saved — it may be incomplete.";
  }
  return null;
}

/** Whether a turn's actions row should show an explicit Retry control. */
function shouldShowRetry(turn: ConversationTurn): boolean {
  return turn.status === "error" || turn.status === "cancelled" || turn.status === "incomplete";
}

function renderResponseBody(turn: ConversationTurn): HTMLElement {
  const body = h("div", { className: "axis-turn__body" }, []);

  if (turn.status === "error") {
    body.append(h("p", { className: "axis-turn__paragraph axis-turn__paragraph--error" }, [turn.errorMessage ?? "That request failed."]));
    return body;
  }

  if (turn.status === "pending" && turn.responseText.length === 0) {
    body.append(h("p", { className: "axis-turn__paragraph axis-turn__paragraph--muted" }, ["Waiting for Gemini…"]));
    return body;
  }

  if (turn.status === "cancelled" && turn.responseText.length === 0) {
    body.append(h("p", { className: "axis-turn__paragraph axis-turn__paragraph--muted" }, ["Stopped before any text was received."]));
    return body;
  }

  if (turn.status === "incomplete" && turn.responseText.length === 0) {
    body.append(
      h("p", { className: "axis-turn__paragraph axis-turn__paragraph--muted" }, [
        "This message was still generating when the conversation was last saved, so no response text was kept."
      ])
    );
    return body;
  }

  const segments = splitIntoSegments(turn.responseText);
  for (const segment of segments) {
    if (segment.type === "text") {
      if (segment.content.length === 0) continue;
      // `h()` only ever sets text nodes — never innerHTML — so this can
      // never be interpreted as markup even if the model's own output
      // contains characters that look like HTML or script tags.
      body.append(h("p", { className: "axis-turn__paragraph" }, [segment.content]));
    } else {
      const codeId = segment.content;
      const header = h("div", { className: "axis-code__header" }, [
        h("span", { className: "axis-code__lang" }, [segment.language ?? "code"]),
        createCopyButton("Copy code", () => codeId)
      ]);
      const pre = h("pre", { className: "axis-code__pre" }, [h("code", { className: "axis-code__code" }, [segment.content])]);
      body.append(h("div", { className: "axis-code" }, [header, pre]));
    }
  }
  return body;
}

/**
 * Per-turn DOM handle + the last-rendered snapshot of the fields that
 * affect its output. `prompt`/`id`/`createdAt` never change once a turn
 * exists (see `conversationContext.ts`), so only `status`, `responseText`,
 * `truncated`, and `errorMessage` ever need to be compared.
 */
interface TurnEntry {
  li: HTMLLIElement;
  responseBlock: HTMLElement;
  stateLabel: HTMLElement;
  actions: HTMLElement;
  bodyEl: HTMLElement;
  retryButton: HTMLButtonElement | null;
  noteEl: HTMLElement | null;
  status: ConversationTurn["status"];
  responseText: string;
  truncated: boolean;
  errorMessage: string | undefined;
}

export function createConversationView(options: ConversationViewOptions): ConversationViewHandle {
  const emptyState = h("div", { className: "axis-conversation__empty", id: `${options.idPrefix}-conversation-empty` }, [
    h("p", { className: "axis-conversation__empty-title" }, ["No messages yet"]),
    h("p", { className: "axis-conversation__empty-text" }, [
      "Saved locally and available from History once you send a message."
    ])
  ]);

  const list = h("ol", { className: "axis-conversation__list", id: `${options.idPrefix}-conversation-list` }, []);
  const element = h("div", { className: "axis-conversation", id: `${options.idPrefix}-conversation`, "aria-live": "polite" }, [
    emptyState,
    list
  ]);

  /**
   * Keyed by turn id so a completed turn's DOM subtree is left completely
   * untouched while a *different* turn (almost always the one still
   * streaming) is the only thing being updated. Before this, every single
   * incoming delta rebuilt the entire visible transcript from scratch —
   * see README "Scope (Phase 20)" for the full before/after trace.
   */
  const entries = new Map<string, TurnEntry>();

  function createRetryButton(turn: ConversationTurn): HTMLButtonElement {
    const retryButton = h("button", { type: "button", className: "axis-btn axis-btn--ghost axis-btn--compact" }, [
      "Retry"
    ]) as HTMLButtonElement;
    retryButton.addEventListener("click", () => options.onRetry(turn));
    return retryButton;
  }

  function createEntry(turn: ConversationTurn): TurnEntry {
    const promptBlock = h("div", { className: "axis-turn__prompt" }, [
      h("span", { className: "axis-turn__role axis-turn__role--user" }, ["You"]),
      h("p", { className: "axis-turn__prompt-text" }, [turn.prompt])
    ]);

    const stateLabel = h("span", { className: "axis-turn__state" }, [statusLabel(turn.status)]);
    const actions = h("div", { className: "axis-turn__actions" }, [createCopyButton("Copy", () => turn.responseText)]);
    const retryButton = shouldShowRetry(turn) ? createRetryButton(turn) : null;
    if (retryButton) actions.append(retryButton);

    const bodyEl = renderResponseBody(turn);

    const noteText = computeNoteText(turn);
    const noteEl = noteText !== null ? h("p", { className: "axis-turn__note" }, [noteText]) : null;

    const responseHeader = h("div", { className: "axis-turn__response-header" }, [
      h("span", { className: "axis-turn__role axis-turn__role--assistant" }, ["AXIS"]),
      stateLabel,
      actions
    ]);

    const responseChildren: Array<HTMLElement> = [responseHeader, bodyEl];
    if (noteEl) responseChildren.push(noteEl);
    const responseBlock = h("div", { className: `axis-turn__response axis-turn__response--${turn.status}` }, responseChildren);

    const li = h("li", { className: "axis-turn", "data-turn-id": turn.id }, [promptBlock, responseBlock]) as HTMLLIElement;

    return {
      li,
      responseBlock,
      stateLabel,
      actions,
      bodyEl,
      retryButton,
      noteEl,
      status: turn.status,
      responseText: turn.responseText,
      truncated: turn.truncated,
      errorMessage: turn.errorMessage
    };
  }

  /**
   * Patches an existing turn's DOM in place to match its current field
   * values, touching only the specific sub-elements that can actually
   * differ (response status/body/note/retry control) — never the prompt
   * block, which is immutable once a turn exists, and never any *other*
   * turn's subtree. Returns immediately, doing nothing at all, when
   * nothing this turn renders has actually changed since the last call —
   * this is what keeps every already-finished turn's DOM completely
   * stable while a sibling turn streams.
   */
  function updateEntry(entry: TurnEntry, turn: ConversationTurn): void {
    if (
      entry.status === turn.status &&
      entry.responseText === turn.responseText &&
      entry.truncated === turn.truncated &&
      entry.errorMessage === turn.errorMessage
    ) {
      return;
    }

    if (entry.status !== turn.status) {
      entry.responseBlock.className = `axis-turn__response axis-turn__response--${turn.status}`;
      entry.stateLabel.textContent = statusLabel(turn.status);
    }

    const newBody = renderResponseBody(turn);
    entry.bodyEl.replaceWith(newBody);
    entry.bodyEl = newBody;

    const wantsRetry = shouldShowRetry(turn);
    if (wantsRetry && !entry.retryButton) {
      entry.retryButton = createRetryButton(turn);
      entry.actions.append(entry.retryButton);
    } else if (!wantsRetry && entry.retryButton) {
      entry.retryButton.remove();
      entry.retryButton = null;
    }

    const noteText = computeNoteText(turn);
    if (noteText !== null && !entry.noteEl) {
      entry.noteEl = h("p", { className: "axis-turn__note" }, [noteText]);
      entry.responseBlock.append(entry.noteEl);
    } else if (noteText !== null && entry.noteEl) {
      entry.noteEl.textContent = noteText;
    } else if (noteText === null && entry.noteEl) {
      entry.noteEl.remove();
      entry.noteEl = null;
    }

    entry.status = turn.status;
    entry.responseText = turn.responseText;
    entry.truncated = turn.truncated;
    entry.errorMessage = turn.errorMessage;
  }

  function render(turns: readonly ConversationTurn[]): void {
    emptyState.hidden = turns.length > 0;

    const nextIds = new Set(turns.map((turn) => turn.id));
    for (const [id, entry] of entries) {
      if (!nextIds.has(id)) {
        entry.li.remove();
        entries.delete(id);
      }
    }

    let previousSibling: ChildNode | null = null;
    for (const turn of turns) {
      let entry = entries.get(turn.id);
      if (!entry) {
        entry = createEntry(turn);
        entries.set(turn.id, entry);
      } else {
        updateEntry(entry, turn);
      }

      const expectedNext: ChildNode | null = previousSibling ? previousSibling.nextSibling : list.firstChild;
      if (expectedNext !== entry.li) {
        list.insertBefore(entry.li, expectedNext);
      }
      previousSibling = entry.li;
    }
  }

  return { element, render };
}
