import type { ConversationMessage, ConversationMessageStatus, ConversationRecord } from "../../../shared/conversation-contract";
import type { ConversationTurn, ConversationTurnStatus } from "./conversationContext";

/**
 * Pure mapping between the renderer's in-memory `ConversationTurn` shape
 * (Phase 4) and the persisted `ConversationMessage` shape (Phase 5). Kept
 * as small, dependency-free pure functions so the mapping itself is
 * directly unit-testable without touching IPC, timers, or the DOM.
 *
 * One turn maps to exactly two messages (one "user", one "assistant") so a
 * restored conversation renders through the exact same `ConversationTurn`
 * rendering path as a live one — no separate "persisted message" renderer
 * is ever needed.
 *
 * Status mapping is the one place this module is not a trivial 1:1 copy:
 * a turn that is still "pending" (actively streaming in *this* renderer
 * session) is never written to disk as "pending" — a persisted snapshot
 * has no live connotation and could outlive the session at any moment, so
 * it is always saved as "incomplete" instead. Symmetrically, a message
 * loaded back as "incomplete" always becomes an "incomplete" turn, never
 * "pending" — nothing is actively generating for it anymore.
 */

export function turnStatusToMessageStatus(status: ConversationTurnStatus): ConversationMessageStatus {
  switch (status) {
    case "pending":
      return "incomplete";
    case "incomplete":
      return "incomplete";
    case "complete":
      return "complete";
    case "cancelled":
      return "cancelled";
    case "error":
      return "error";
  }
}

export function messageStatusToTurnStatus(status: ConversationMessageStatus): ConversationTurnStatus {
  switch (status) {
    case "incomplete":
      return "incomplete";
    case "complete":
      return "complete";
    case "cancelled":
      return "cancelled";
    case "error":
      return "error";
  }
}

export function turnToMessages(turn: ConversationTurn): [ConversationMessage, ConversationMessage] {
  const userMessage: ConversationMessage = {
    id: `${turn.id}-user`,
    role: "user",
    text: turn.prompt,
    status: "complete",
    truncated: false,
    createdAt: turn.createdAt
  };
  const assistantMessage: ConversationMessage = {
    id: `${turn.id}-assistant`,
    role: "assistant",
    text: turn.responseText,
    status: turnStatusToMessageStatus(turn.status),
    truncated: turn.truncated,
    createdAt: turn.createdAt
  };
  if (turn.errorMessage !== undefined) assistantMessage.errorMessage = turn.errorMessage;
  return [userMessage, assistantMessage];
}

export function turnsToMessages(turns: readonly ConversationTurn[]): ConversationMessage[] {
  return turns.flatMap((turn) => turnToMessages(turn));
}

/**
 * Inverse of `turnsToMessages`: groups messages back into turns, pairing
 * each "user" message with the very next "assistant" message. Tolerant of
 * a trailing unpaired user message (defensive, should not normally occur)
 * by treating it as an "incomplete" turn with empty response text rather
 * than dropping the user's prompt entirely.
 */
export function messagesToTurns(messages: readonly ConversationMessage[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const current = messages[i];
    if (!current || current.role !== "user") continue;
    const next = messages[i + 1];
    if (next && next.role === "assistant") {
      const turn: ConversationTurn = {
        id: baseTurnId(next.id),
        prompt: current.text,
        responseText: next.text,
        status: messageStatusToTurnStatus(next.status),
        truncated: next.truncated,
        createdAt: current.createdAt
      };
      if (next.errorMessage !== undefined) turn.errorMessage = next.errorMessage;
      turns.push(turn);
      i += 1; // consumed the paired assistant message too.
    } else {
      turns.push({
        id: baseTurnId(current.id),
        prompt: current.text,
        responseText: "",
        status: "incomplete",
        truncated: false,
        createdAt: current.createdAt
      });
    }
  }
  return turns;
}

function baseTurnId(messageId: string): string {
  return messageId.replace(/-(user|assistant)$/, "");
}

export function buildConversationRecord(params: {
  id: string;
  title: string;
  createdAt: number;
  turns: readonly ConversationTurn[];
}): ConversationRecord {
  return {
    id: params.id,
    title: params.title,
    createdAt: params.createdAt,
    updatedAt: Date.now(),
    messages: turnsToMessages(params.turns)
  };
}
