import { clampHistory, type AiHistoryTurn } from "../../../shared/ai-contract";
import { MAX_MESSAGE_TEXT_CHARS } from "../../../shared/conversation-contract";

/**
 * In-memory conversation context for the AI Workspace (Phase 4).
 *
 * Scope, deliberately narrow:
 *  - Lives only in renderer memory for the lifetime of the current app
 *    session/page — nothing here is ever written to disk, and
 *    `reset()`/a page reload both lose it completely. AXIS never claims the
 *    model "remembers" anything across an app restart.
 *  - Only ever holds plain prompt/response text. It is structurally
 *    impossible for a credential to end up here — this module has no
 *    access to `credentialStore` or any API key, and never did.
 *  - A turn only ever contributes to the context sent with the *next*
 *    request once it has reached the terminal "complete" status. A
 *    cancelled, failed, or still-in-flight turn is excluded from history —
 *    it is never silently treated as a completed exchange.
 *  - `buildHistoryForRequest()` reuses the exact same `clampHistory` bound
 *    the main process re-applies authoritatively, so the renderer never
 *    sends more than the provider-facing contract allows.
 */

/**
 * "incomplete" (Phase 5) marks a turn that was restored from a saved
 * conversation and was still generating when it was last written to disk
 * (e.g. the app closed mid-stream). It is distinct from "pending": nothing
 * is actively streaming for it anymore, so it is never shown as
 * "Generating…" — that would be dishonest, since no event will ever arrive
 * for it again. A turn only ever enters this state via `replaceTurns()`
 * (i.e. loading a saved conversation), never as a live transition.
 */
export type ConversationTurnStatus = "pending" | "complete" | "cancelled" | "error" | "incomplete";

export interface ConversationTurn {
  /** Equal to the request id used for this turn's send/stream call. */
  id: string;
  prompt: string;
  responseText: string;
  status: ConversationTurnStatus;
  truncated: boolean;
  errorMessage?: string;
  createdAt: number;
}

/** Caps how many turns the transcript itself keeps in memory (display + context pool). */
export const MAX_DISPLAY_TURNS = 40;

export interface ConversationContext {
  getTurns(): readonly ConversationTurn[];
  getTurn(id: string): ConversationTurn | undefined;
  /** Starts a new turn in the "pending" state and returns it. */
  startTurn(id: string, prompt: string): ConversationTurn;
  /** Appends streamed delta text to a still-pending turn. No-op for any other turn/status. */
  appendDelta(id: string, text: string): void;
  /** Marks a turn complete, optionally replacing its text wholesale (non-streaming path). */
  completeTurn(id: string, options?: { text?: string; truncated?: boolean }): void;
  /** Marks a turn as explicitly cancelled by the user. */
  cancelTurn(id: string): void;
  /** Marks a turn as failed with a normalized, user-safe message. */
  failTurn(id: string, message: string): void;
  /** Builds the bounded history to send with the *next* request — only "complete" turns contribute. */
  buildHistoryForRequest(): AiHistoryTurn[];
  /** Clears the entire transcript and context — the explicit "new conversation" action. */
  reset(): void;
  /**
   * Wholesale-replaces the transcript (Phase 5: loading a saved
   * conversation). Unlike every other mutator, this does not go through
   * `startTurn`/`completeTurn` — the turns are already in a terminal (or
   * "incomplete") state by construction, since nothing here is live.
   */
  replaceTurns(turns: readonly ConversationTurn[]): void;
}

/**
 * Factory (not a singleton) so each AI Workspace mount gets its own
 * isolated context and tests never leak state between cases.
 */
export function createConversationContext(): ConversationContext {
  let turns: ConversationTurn[] = [];

  function find(id: string): ConversationTurn | undefined {
    return turns.find((turn) => turn.id === id);
  }

  function trimToCapacity(): void {
    if (turns.length > MAX_DISPLAY_TURNS) {
      turns = turns.slice(turns.length - MAX_DISPLAY_TURNS);
    }
  }

  return {
    getTurns() {
      return turns;
    },
    getTurn(id: string) {
      return find(id);
    },
    startTurn(id: string, prompt: string): ConversationTurn {
      const turn: ConversationTurn = {
        id,
        prompt,
        responseText: "",
        status: "pending",
        truncated: false,
        createdAt: Date.now()
      };
      turns.push(turn);
      trimToCapacity();
      return turn;
    },
    appendDelta(id: string, text: string): void {
      const turn = find(id);
      if (!turn || turn.status !== "pending") return;
      // Phase 19: bounded, same ceiling `normalizeConversationRecord`
      // already enforces at save-time (`MAX_MESSAGE_TEXT_CHARS`). Without
      // this, a misbehaving or malicious streaming response that never
      // sends a terminal event could grow this string (and the DOM text
      // rebuilt from it on every single delta) without any limit for as
      // long as the stream stays open. Once the cap is reached, any
      // further delta text for this turn is silently dropped rather than
      // aborting the stream — the same "degrade, never crash" policy
      // every other bound in this app already follows.
      if (turn.responseText.length >= MAX_MESSAGE_TEXT_CHARS) return;
      const remaining = MAX_MESSAGE_TEXT_CHARS - turn.responseText.length;
      turn.responseText += text.length > remaining ? text.slice(0, remaining) : text;
    },
    completeTurn(id: string, options?: { text?: string; truncated?: boolean }): void {
      const turn = find(id);
      if (!turn) return;
      if (options?.text !== undefined) turn.responseText = options.text;
      // Phase 19: honestly reflect truncation either when the provider
      // itself reported it, or when AXIS's own `MAX_MESSAGE_TEXT_CHARS`
      // safety cap above was the thing that cut this response short —
      // the existing "this response may be incomplete" UI note should
      // show in both cases, not only the provider-reported one.
      turn.truncated = Boolean(options?.truncated) || turn.responseText.length >= MAX_MESSAGE_TEXT_CHARS;
      turn.status = "complete";
    },
    cancelTurn(id: string): void {
      const turn = find(id);
      if (!turn) return;
      turn.status = "cancelled";
    },
    failTurn(id: string, message: string): void {
      const turn = find(id);
      if (!turn) return;
      turn.status = "error";
      turn.errorMessage = message;
    },
    buildHistoryForRequest(): AiHistoryTurn[] {
      const raw: AiHistoryTurn[] = [];
      for (const turn of turns) {
        if (turn.status !== "complete") continue;
        raw.push({ role: "user", text: turn.prompt });
        raw.push({ role: "model", text: turn.responseText });
      }
      return clampHistory(raw);
    },
    reset(): void {
      turns = [];
    },
    replaceTurns(incoming: readonly ConversationTurn[]): void {
      turns = incoming.slice(-MAX_DISPLAY_TURNS).map((turn) => ({ ...turn }));
    }
  };
}
