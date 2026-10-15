import { describe, expect, it } from "vitest";
import { createConversationContext, MAX_DISPLAY_TURNS } from "../src/renderer/ts/ai/conversationContext";
import { MAX_HISTORY_TURNS } from "../src/shared/ai-contract";
import { MAX_MESSAGE_TEXT_CHARS } from "../src/shared/conversation-contract";

describe("conversationContext", () => {
  it("starts empty with no turns and an empty history", () => {
    const ctx = createConversationContext();
    expect(ctx.getTurns()).toEqual([]);
    expect(ctx.buildHistoryForRequest()).toEqual([]);
  });

  it("tracks a turn through pending -> streamed deltas -> complete", () => {
    const ctx = createConversationContext();
    ctx.startTurn("r1", "Hello");
    ctx.appendDelta("r1", "Hi");
    ctx.appendDelta("r1", " there");
    let turn = ctx.getTurn("r1");
    expect(turn?.status).toBe("pending");
    expect(turn?.responseText).toBe("Hi there");

    ctx.completeTurn("r1", { truncated: false });
    turn = ctx.getTurn("r1");
    expect(turn?.status).toBe("complete");
    expect(turn?.responseText).toBe("Hi there");
  });

  it("ignores appendDelta/completeTurn-adjacent calls for a turn that does not exist", () => {
    const ctx = createConversationContext();
    expect(() => ctx.appendDelta("missing", "x")).not.toThrow();
    expect(() => ctx.completeTurn("missing")).not.toThrow();
    expect(() => ctx.cancelTurn("missing")).not.toThrow();
    expect(() => ctx.failTurn("missing", "x")).not.toThrow();
    expect(ctx.getTurns()).toEqual([]);
  });

  it("ignores further deltas once a turn is no longer pending (late/stale delta protection)", () => {
    const ctx = createConversationContext();
    ctx.startTurn("r1", "Hello");
    ctx.completeTurn("r1", { text: "final answer", truncated: false });
    ctx.appendDelta("r1", " MORE TEXT THAT SHOULD NEVER APPEAR");
    expect(ctx.getTurn("r1")?.responseText).toBe("final answer");
  });

  it("marks a turn cancelled and a turn failed with a safe message, leaving both out of request history", () => {
    const ctx = createConversationContext();
    ctx.startTurn("r1", "one");
    ctx.cancelTurn("r1");
    ctx.startTurn("r2", "two");
    ctx.failTurn("r2", "Something went wrong.");

    expect(ctx.getTurn("r1")?.status).toBe("cancelled");
    expect(ctx.getTurn("r2")?.status).toBe("error");
    expect(ctx.getTurn("r2")?.errorMessage).toBe("Something went wrong.");
    // Neither an incomplete, cancelled, nor failed turn is ever treated as
    // completed history.
    expect(ctx.buildHistoryForRequest()).toEqual([]);
  });

  it("includes only complete turns (as alternating user/model pairs) in the bounded request history", () => {
    const ctx = createConversationContext();
    ctx.startTurn("r1", "What is 2+2?");
    ctx.completeTurn("r1", { text: "4", truncated: false });
    ctx.startTurn("r2", "And 3+3?");
    ctx.cancelTurn("r2"); // must be excluded
    ctx.startTurn("r3", "And 10+10?");
    ctx.completeTurn("r3", { text: "20", truncated: false });

    expect(ctx.buildHistoryForRequest()).toEqual([
      { role: "user", text: "What is 2+2?" },
      { role: "model", text: "4" },
      { role: "user", text: "And 10+10?" },
      { role: "model", text: "20" }
    ]);
  });

  it("bounds the request history to at most MAX_HISTORY_TURNS entries even with many completed turns", () => {
    const ctx = createConversationContext();
    for (let i = 0; i < 20; i += 1) {
      ctx.startTurn(`r${i}`, `prompt ${i}`);
      ctx.completeTurn(`r${i}`, { text: `answer ${i}`, truncated: false });
    }
    const history = ctx.buildHistoryForRequest();
    expect(history.length).toBeLessThanOrEqual(MAX_HISTORY_TURNS);
    // Most recent exchange must be present.
    expect(history.at(-1)).toEqual({ role: "model", text: "answer 19" });
  });

  it("bounds the in-memory transcript itself to MAX_DISPLAY_TURNS entries", () => {
    const ctx = createConversationContext();
    for (let i = 0; i < MAX_DISPLAY_TURNS + 15; i += 1) {
      ctx.startTurn(`r${i}`, `prompt ${i}`);
      ctx.completeTurn(`r${i}`, { text: `answer ${i}`, truncated: false });
    }
    expect(ctx.getTurns().length).toBe(MAX_DISPLAY_TURNS);
    expect(ctx.getTurns().at(-1)?.id).toBe(`r${MAX_DISPLAY_TURNS + 14}`);
  });

  it("reset() clears every turn and the context resets to empty (the explicit 'new conversation' action)", () => {
    const ctx = createConversationContext();
    ctx.startTurn("r1", "one");
    ctx.completeTurn("r1", { text: "done", truncated: false });
    expect(ctx.getTurns().length).toBe(1);

    ctx.reset();
    expect(ctx.getTurns()).toEqual([]);
    expect(ctx.buildHistoryForRequest()).toEqual([]);
  });

  it("replaceTurns() wholesale-replaces the transcript (Phase 5: loading a saved conversation)", () => {
    const ctx = createConversationContext();
    ctx.startTurn("r1", "will be replaced");
    ctx.completeTurn("r1", { text: "gone", truncated: false });

    ctx.replaceTurns([
      { id: "loaded-1", prompt: "restored prompt", responseText: "restored answer", status: "complete", truncated: false, createdAt: 123 },
      { id: "loaded-2", prompt: "an interrupted one", responseText: "half", status: "incomplete", truncated: false, createdAt: 456 }
    ]);

    expect(ctx.getTurns()).toHaveLength(2);
    expect(ctx.getTurn("r1")).toBeUndefined();
    expect(ctx.getTurn("loaded-1")?.prompt).toBe("restored prompt");
    expect(ctx.getTurn("loaded-2")?.status).toBe("incomplete");
  });

  it("an 'incomplete' turn (restored, interrupted mid-stream in an earlier session) is excluded from request history, same as cancelled/error", () => {
    const ctx = createConversationContext();
    ctx.replaceTurns([
      { id: "r1", prompt: "finished one", responseText: "done", status: "complete", truncated: false, createdAt: 1 },
      { id: "r2", prompt: "interrupted one", responseText: "half", status: "incomplete", truncated: false, createdAt: 2 }
    ]);
    expect(ctx.buildHistoryForRequest()).toEqual([{ role: "user", text: "finished one" }, { role: "model", text: "done" }]);
  });

  it("replaceTurns() also respects the MAX_DISPLAY_TURNS cap", () => {
    const ctx = createConversationContext();
    const many = Array.from({ length: MAX_DISPLAY_TURNS + 10 }, (_, i) => ({
      id: `r${i}`,
      prompt: `p${i}`,
      responseText: `a${i}`,
      status: "complete" as const,
      truncated: false,
      createdAt: i
    }));
    ctx.replaceTurns(many);
    expect(ctx.getTurns().length).toBe(MAX_DISPLAY_TURNS);
    expect(ctx.getTurns().at(-1)?.id).toBe(`r${MAX_DISPLAY_TURNS + 9}`);
  });

  it("caps a streaming turn's accumulated response text at MAX_MESSAGE_TEXT_CHARS (Phase 19)", () => {
    const ctx = createConversationContext();
    ctx.startTurn("r1", "Hello");

    // A delta that lands exactly on the boundary — fully accepted, not yet over.
    ctx.appendDelta("r1", "a".repeat(MAX_MESSAGE_TEXT_CHARS - 10));
    ctx.appendDelta("r1", "b".repeat(10));
    expect(ctx.getTurn("r1")?.responseText.length).toBe(MAX_MESSAGE_TEXT_CHARS);

    // Any further delta text is silently dropped — never grows past the cap,
    // and never throws for an unbounded/misbehaving stream.
    ctx.appendDelta("r1", "more text that must never be appended");
    expect(ctx.getTurn("r1")?.responseText.length).toBe(MAX_MESSAGE_TEXT_CHARS);
    expect(ctx.getTurn("r1")?.responseText.endsWith("b")).toBe(true);
  });

  it("partially accepts a single delta that would cross the cap, keeping exactly MAX_MESSAGE_TEXT_CHARS", () => {
    const ctx = createConversationContext();
    ctx.startTurn("r1", "Hello");
    ctx.appendDelta("r1", "a".repeat(MAX_MESSAGE_TEXT_CHARS - 5));
    // This single delta is longer than the 5 characters of room left.
    ctx.appendDelta("r1", "0123456789");
    const turn = ctx.getTurn("r1");
    expect(turn?.responseText.length).toBe(MAX_MESSAGE_TEXT_CHARS);
    expect(turn?.responseText.endsWith("01234")).toBe(true);
  });

  it("marks a turn truncated when AXIS's own response-text cap was hit, even though the provider never reported truncation", () => {
    const ctx = createConversationContext();
    ctx.startTurn("r1", "Hello");
    ctx.appendDelta("r1", "a".repeat(MAX_MESSAGE_TEXT_CHARS + 500));
    ctx.completeTurn("r1", { truncated: false });
    const turn = ctx.getTurn("r1");
    expect(turn?.truncated).toBe(true);
    expect(turn?.responseText.length).toBe(MAX_MESSAGE_TEXT_CHARS);
  });

  it("does not mark a short, normal turn as truncated", () => {
    const ctx = createConversationContext();
    ctx.startTurn("r1", "Hello");
    ctx.appendDelta("r1", "short answer");
    ctx.completeTurn("r1", { truncated: false });
    expect(ctx.getTurn("r1")?.truncated).toBe(false);
  });

  it("never stores anything beyond prompt/response plain text (no credential-shaped fields)", () => {
    const ctx = createConversationContext();
    ctx.startTurn("r1", "hello");
    ctx.completeTurn("r1", { text: "hi", truncated: false });
    const turn = ctx.getTurn("r1");
    expect(Object.keys(turn ?? {}).sort()).toEqual(["createdAt", "id", "prompt", "responseText", "status", "truncated"]);
  });
});
