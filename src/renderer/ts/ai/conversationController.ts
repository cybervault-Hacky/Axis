import { AI_ERROR_MESSAGES, AI_PROVIDER_LABELS } from "../../../shared/ai-contract";
import { generateConversationTitle, type ConversationRecord } from "../../../shared/conversation-contract";
import type { ComposerHandle } from "../components/composer";
import type { ConversationViewHandle } from "../components/conversationView";
import type { AxisStore } from "../state";
import { buildSendPayload, cancelPrompt, makeRequestId, onStreamEvent, sendStreamingRequest } from "./aiClient";
import type { ConversationContext, ConversationTurn } from "./conversationContext";
import { buildConversationRecord, messagesToTurns } from "./conversationPersistence";
import { saveConversation } from "./conversationRepositoryClient";

/** How long to wait after a streamed delta before writing to disk, so a fast stream never causes per-token disk I/O. */
const SAVE_DEBOUNCE_MS = 1500;

/**
 * Generates a fresh conversation id. Deliberately separate from
 * `makeRequestId` in `aiClient.ts` (even though the algorithm is the same)
 * so conversation-id generation is never coupled to, or mistaken for, a
 * per-request id — and so mocking `aiClient.ts` in a test never silently
 * changes conversation-id behaviour too.
 */
function makeConversationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `conv-${crypto.randomUUID()}`;
  }
  return `conv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface ConversationSaveStatus {
  ok: boolean;
  message?: string;
}

export interface ConversationControllerHandle {
  /** Wire this as the composer's onSubmitAttempt. */
  submit: (value: string) => void;
  /** Wire this as the composer's onCancelRequest — this is the "stop generation" control. */
  cancel: () => void;
  /** Wire this to a turn's Retry control. Resends the same prompt as a brand-new request. */
  retry: (turn: ConversationTurn) => void;
  /** Explicit "new conversation" action: cancels anything in flight, flushes a save, then starts a fresh conversation id. */
  newConversation: () => void;
  hasActiveRequest: () => boolean;
  /** The stable id of the conversation currently shown — a fresh one until the first save actually happens. */
  getConversationId: () => string;
  /** The current (auto-generated or renamed) title for this conversation. */
  getTitle: () => string;
  /**
   * Applies a rename that happened elsewhere (the History screen) to this
   * conversation's displayed title, but only if `id` matches the
   * conversation currently shown here — a rename of any other saved
   * conversation is a correct no-op. Never reopens or reloads anything; it
   * only updates the one title value this controller already owns.
   */
  setTitleIfCurrent: (id: string, title: string) => void;
  /**
   * Replaces the whole transcript with a previously-saved conversation.
   * Always cancels any in-flight request first (flushing its own save) so
   * a late response from the conversation being left can never leak into
   * the one being opened.
   */
  loadConversation: (record: ConversationRecord) => void;
}

/**
 * The AI Workspace's real conversation request lifecycle: streaming
 * generation, bounded in-memory context, stable per-turn request IDs,
 * single-flight + stale-event guarding, explicit (never automatic) retry,
 * and (Phase 5) local persistence of the transcript. This intentionally
 * does not reuse `requestLifecycle.ts` — that module's single-slot,
 * non-streaming model is a genuinely different shape (Home keeps using it
 * unchanged) — but it reuses every lower-level piece (`aiClient`, the
 * shared contract, the composer, the conversation repository client)
 * rather than re-deriving them.
 *
 * Persistence model: every terminal stream outcome (done/cancelled/error)
 * flushes a save immediately; a still-streaming turn only ever schedules a
 * debounced save (at most roughly every `SAVE_DEBOUNCE_MS`) so a fast
 * stream never causes a disk write per token. Switching away from this
 * conversation (`newConversation()`/`loadConversation()`) always cancels
 * any active request *first* — which both flushes the outgoing
 * conversation's own save and clears `activeRequestId`, so any event that
 * still arrives afterwards for the old request is guaranteed to fail the
 * stale-id check below and can never be misapplied to the new conversation
 * now in view.
 */
export function createConversationController(
  store: AxisStore,
  getComposer: () => ComposerHandle,
  context: ConversationContext,
  view: ConversationViewHandle,
  onSaveStatusChange?: (status: ConversationSaveStatus) => void
): ConversationControllerHandle {
  let activeRequestId: string | null = null;
  let unsubscribeStream: (() => void) | null = null;

  let conversationId = makeConversationId();
  let conversationTitle: string | null = null;
  let conversationCreatedAt = Date.now();
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let saveInFlight = false;
  let saveQueuedAgain = false;

  function refresh(): void {
    view.render(context.getTurns());
  }

  function finishLocally(): void {
    activeRequestId = null;
    getComposer().setBusy(false);
  }

  function ensureTitle(prompt: string): void {
    if (conversationTitle === null) conversationTitle = generateConversationTitle(prompt);
  }

  function cancelPendingSaveTimer(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
  }

  /** Writes the current transcript to disk now. Safe to call anytime; no-ops on an empty transcript. */
  function flushSaveNow(): void {
    cancelPendingSaveTimer();
    if (context.getTurns().length === 0) return;

    if (saveInFlight) {
      // A save is already in flight — queue exactly one more flush with
      // whatever the state looks like once it resolves, rather than racing
      // two concurrent writes for the same conversation out of order.
      saveQueuedAgain = true;
      return;
    }

    saveInFlight = true;
    const record = buildConversationRecord({
      id: conversationId,
      title: conversationTitle ?? "New conversation",
      createdAt: conversationCreatedAt,
      turns: context.getTurns()
    });

    void saveConversation(record)
      .then((result) => {
        onSaveStatusChange?.({ ok: result.ok, message: result.ok ? undefined : result.message });
      })
      .catch(() => {
        // A rejected promise here would mean the repository client itself
        // threw, which it is designed never to do — defence in depth only.
        onSaveStatusChange?.({ ok: false, message: "Could not save this conversation locally." });
      })
      .finally(() => {
        saveInFlight = false;
        if (saveQueuedAgain) {
          saveQueuedAgain = false;
          flushSaveNow();
        }
      });
  }

  function scheduleDebouncedSave(): void {
    if (context.getTurns().length === 0) return;
    if (saveTimer) return; // already scheduled — it will pick up the latest state when it fires.
    saveTimer = setTimeout(() => {
      saveTimer = null;
      flushSaveNow();
    }, SAVE_DEBOUNCE_MS);
  }

  function ensureSubscribed(): void {
    if (unsubscribeStream) return;
    unsubscribeStream = onStreamEvent((event) => {
      // The single most important guard in this module: an event for any
      // request other than the one currently tracked is stale/superseded
      // (it belongs to an already-cancelled or already-finished turn, or
      // to a conversation the user has since switched away from) and must
      // never be allowed to mutate the UI.
      if (event.requestId !== activeRequestId) return;

      if (event.type === "delta") {
        context.appendDelta(event.requestId, event.text);
        refresh();
        scheduleDebouncedSave();
        return;
      }
      if (event.type === "done") {
        context.completeTurn(event.requestId, { truncated: event.truncated });
        finishLocally();
        refresh();
        flushSaveNow();
        return;
      }
      if (event.type === "cancelled") {
        context.cancelTurn(event.requestId);
        finishLocally();
        refresh();
        flushSaveNow();
        return;
      }
      context.failTurn(event.requestId, event.message);
      finishLocally();
      refresh();
      flushSaveNow();
    });
  }

  function recordImmediateFailure(prompt: string, message: string): void {
    const id = makeRequestId();
    ensureTitle(prompt);
    context.startTurn(id, prompt);
    context.failTurn(id, message);
    refresh();
    flushSaveNow();
  }

  function startRequest(prompt: string): void {
    if (activeRequestId) return; // single-flight, defence in depth alongside the composer's own disabled Send.

    const provider = store.getState().settings.aiProvider;
    const providerLabel = AI_PROVIDER_LABELS[provider];
    const status = store.getState().aiStatus;
    if (!status.nativeBridgeAvailable) {
      recordImmediateFailure(
        prompt,
        `This preview window has no AI engine connected — run the AXIS desktop app to send a message to ${providerLabel}.`
      );
      return;
    }
    if (!status.configured) {
      recordImmediateFailure(prompt, `Add a ${providerLabel} API key in Settings to send a message.`);
      return;
    }

    const payload = buildSendPayload(prompt, {
      timeoutMs: store.getState().settings.aiRequestTimeoutMs,
      history: context.buildHistoryForRequest(),
      provider
    });
    if (!payload) {
      recordImmediateFailure(prompt, AI_ERROR_MESSAGES.VALIDATION_ERROR);
      return;
    }

    ensureSubscribed();
    ensureTitle(prompt);
    context.startTurn(payload.requestId, prompt);
    activeRequestId = payload.requestId;
    getComposer().setBusy(true);
    refresh();
    scheduleDebouncedSave();

    void sendStreamingRequest(payload).then((start) => {
      // The stream was rejected before it could start (validation, missing
      // credential, duplicate, bridge gone) — surface it the same way a
      // terminal stream event would, but only if this is still the active
      // request (a fast cancel could already have superseded it).
      if (start.ok) return;
      if (activeRequestId !== payload.requestId) return;
      context.failTurn(payload.requestId, start.message);
      finishLocally();
      refresh();
      flushSaveNow();
    });
  }

  function submit(value: string): void {
    startRequest(value);
  }

  function cancel(): void {
    if (!activeRequestId) return;
    const id = activeRequestId;
    // Optimistic, immediate local cancellation — mirrors the Home lifecycle:
    // the UI must never wait on a round trip to become responsive again.
    // Clearing activeRequestId first means any event that still arrives
    // for `id` (including the provider's own eventual "cancelled"
    // confirmation) is now correctly treated as stale and ignored.
    activeRequestId = null;
    context.cancelTurn(id);
    getComposer().setBusy(false);
    refresh();
    flushSaveNow();
    void cancelPrompt(id);
  }

  function retry(turn: ConversationTurn): void {
    if (activeRequestId) return;
    startRequest(turn.prompt);
  }

  function newConversation(): void {
    if (activeRequestId) cancel();
    context.reset();
    conversationId = makeConversationId();
    conversationTitle = null;
    conversationCreatedAt = Date.now();
    refresh();
  }

  function setTitleIfCurrent(id: string, title: string): void {
    if (id !== conversationId) return;
    conversationTitle = title;
    refresh();
  }

  function loadConversation(record: ConversationRecord): void {
    // Cancel-first is the entire isolation mechanism: it flushes the
    // outgoing conversation's own save and nulls activeRequestId *before*
    // the transcript is swapped, so a late event for the old request fails
    // the stale-id check above regardless of which conversation is now on
    // screen — it can never be misapplied to the newly-loaded one.
    if (activeRequestId) cancel();
    context.replaceTurns(messagesToTurns(record.messages));
    conversationId = record.id;
    conversationTitle = record.title;
    conversationCreatedAt = record.createdAt;
    refresh();
  }

  return {
    submit,
    cancel,
    retry,
    newConversation,
    hasActiveRequest: () => activeRequestId !== null,
    getConversationId: () => conversationId,
    getTitle: () => conversationTitle ?? "New conversation",
    setTitleIfCurrent,
    loadConversation
  };
}
