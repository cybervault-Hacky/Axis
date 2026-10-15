import { describe, expect, it } from "vitest";
import {
  buildConversationRecord,
  messagesToTurns,
  messageStatusToTurnStatus,
  turnsToMessages,
  turnStatusToMessageStatus
} from "../src/renderer/ts/ai/conversationPersistence";
import type { ConversationTurn } from "../src/renderer/ts/ai/conversationContext";

function makeTurn(overrides: Partial<ConversationTurn> = {}): ConversationTurn {
  return {
    id: "turn-1",
    prompt: "Hello there",
    responseText: "General Kenobi",
    status: "complete",
    truncated: false,
    createdAt: 1000,
    ...overrides
  };
}

describe("status mapping", () => {
  it("always persists an actively-streaming turn as incomplete, never pending", () => {
    expect(turnStatusToMessageStatus("pending")).toBe("incomplete");
  });

  it("round-trips the other three statuses", () => {
    expect(turnStatusToMessageStatus("complete")).toBe("complete");
    expect(turnStatusToMessageStatus("cancelled")).toBe("cancelled");
    expect(turnStatusToMessageStatus("error")).toBe("error");
  });

  it("restores incomplete as incomplete, never as a live pending state", () => {
    expect(messageStatusToTurnStatus("incomplete")).toBe("incomplete");
  });
});

describe("turnToMessages / turnsToMessages", () => {
  it("produces exactly one user and one assistant message per turn, in order", () => {
    const messages = turnsToMessages([makeTurn()]);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.text).toBe("Hello there");
    expect(messages[1]?.role).toBe("assistant");
    expect(messages[1]?.text).toBe("General Kenobi");
    expect(messages[1]?.status).toBe("complete");
  });

  it("carries an error message through for a failed turn", () => {
    const messages = turnsToMessages([makeTurn({ status: "error", errorMessage: "Network error", responseText: "" })]);
    expect(messages[1]?.status).toBe("error");
    expect(messages[1]?.errorMessage).toBe("Network error");
  });

  it("a still-generating turn is persisted as incomplete, not pending", () => {
    const messages = turnsToMessages([makeTurn({ status: "pending", responseText: "partial" })]);
    expect(messages[1]?.status).toBe("incomplete");
    expect(messages[1]?.text).toBe("partial");
  });

  it("flattens multiple turns in order", () => {
    const messages = turnsToMessages([makeTurn({ id: "t1" }), makeTurn({ id: "t2", prompt: "second" })]);
    expect(messages).toHaveLength(4);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });
});

describe("messagesToTurns", () => {
  it("is the inverse of turnsToMessages for a normal complete turn", () => {
    const original = makeTurn();
    const messages = turnsToMessages([original]);
    const restored = messagesToTurns(messages);
    expect(restored).toHaveLength(1);
    expect(restored[0]?.prompt).toBe(original.prompt);
    expect(restored[0]?.responseText).toBe(original.responseText);
    expect(restored[0]?.status).toBe("complete");
    expect(restored[0]?.truncated).toBe(false);
  });

  it("restores an incomplete message as an incomplete turn, never pending", () => {
    const messages = turnsToMessages([makeTurn({ status: "pending", responseText: "partial answer" })]);
    const restored = messagesToTurns(messages);
    expect(restored[0]?.status).toBe("incomplete");
    expect(restored[0]?.responseText).toBe("partial answer");
  });

  it("restores multiple turns in the original order", () => {
    const messages = turnsToMessages([makeTurn({ id: "t1", prompt: "first" }), makeTurn({ id: "t2", prompt: "second" })]);
    const restored = messagesToTurns(messages);
    expect(restored.map((t) => t.prompt)).toEqual(["first", "second"]);
  });

  it("handles a trailing unpaired user message defensively, without dropping the prompt", () => {
    const messages = turnsToMessages([makeTurn()]);
    const withTrailingUser = [...messages, { id: "stray-user", role: "user" as const, text: "orphan prompt", status: "complete" as const, truncated: false, createdAt: 2000 }];
    const restored = messagesToTurns(withTrailingUser);
    expect(restored).toHaveLength(2);
    expect(restored[1]?.prompt).toBe("orphan prompt");
    expect(restored[1]?.status).toBe("incomplete");
    expect(restored[1]?.responseText).toBe("");
  });

  it("round-trips an error turn including the error message", () => {
    const messages = turnsToMessages([makeTurn({ status: "error", errorMessage: "Boom", responseText: "" })]);
    const restored = messagesToTurns(messages);
    expect(restored[0]?.status).toBe("error");
    expect(restored[0]?.errorMessage).toBe("Boom");
  });
});

describe("buildConversationRecord", () => {
  it("builds a record with the right id/title and mapped messages", () => {
    const record = buildConversationRecord({ id: "conv-1", title: "My title", createdAt: 500, turns: [makeTurn()] });
    expect(record.id).toBe("conv-1");
    expect(record.title).toBe("My title");
    expect(record.createdAt).toBe(500);
    expect(record.messages).toHaveLength(2);
    expect(record.updatedAt).toBeGreaterThanOrEqual(record.createdAt);
  });
});
