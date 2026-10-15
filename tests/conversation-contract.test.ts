import { describe, expect, it } from "vitest";
import {
  CONVERSATION_BULK_KIND,
  CONVERSATION_SCHEMA_VERSION,
  MAX_MESSAGES_PER_CONVERSATION,
  MAX_MESSAGE_TEXT_CHARS,
  MAX_TITLE_CHARS,
  generateConversationTitle,
  isValidConversationBulkFile,
  isValidConversationFile,
  isValidConversationId,
  isValidConversationIdPayload,
  isValidConversationMessage,
  isValidConversationRecord,
  isValidImportTextPayload,
  isValidRenamePayload,
  isValidSearchPayload,
  MAX_BULK_IMPORT_CONVERSATIONS,
  MAX_DROPPED_IMPORT_TEXT_CHARS,
  normalizeConversationRecord,
  summarizeConversation,
  truncateForPreview,
  type ConversationMessage,
  type ConversationRecord
} from "../src/shared/conversation-contract";

function makeMessage(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id: "msg-1",
    role: "user",
    text: "hello",
    status: "complete",
    truncated: false,
    createdAt: Date.now(),
    ...overrides
  };
}

function makeRecord(overrides: Partial<ConversationRecord> = {}): ConversationRecord {
  return {
    id: "conv-1",
    title: "Hello",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [makeMessage()],
    ...overrides
  };
}

describe("conversation id validation", () => {
  it("accepts a safe id", () => {
    expect(isValidConversationId("abc-123_XYZ")).toBe(true);
  });

  it("rejects path-traversal-shaped or unsafe ids", () => {
    expect(isValidConversationId("../../etc/passwd")).toBe(false);
    expect(isValidConversationId("a/b")).toBe(false);
    expect(isValidConversationId("")).toBe(false);
    expect(isValidConversationId("a".repeat(200))).toBe(false);
    expect(isValidConversationId(42)).toBe(false);
    expect(isValidConversationId(null)).toBe(false);
  });
});

describe("isValidConversationMessage", () => {
  it("accepts a well-formed message", () => {
    expect(isValidConversationMessage(makeMessage())).toBe(true);
  });

  it("accepts every valid status including the new incomplete state", () => {
    for (const status of ["complete", "cancelled", "error", "incomplete"] as const) {
      expect(isValidConversationMessage(makeMessage({ status }))).toBe(true);
    }
  });

  it("rejects an unknown status, role, or missing fields", () => {
    expect(isValidConversationMessage(makeMessage({ status: "weird" as never }))).toBe(false);
    expect(isValidConversationMessage(makeMessage({ role: "system" as never }))).toBe(false);
    expect(isValidConversationMessage({ ...makeMessage(), id: undefined })).toBe(false);
    expect(isValidConversationMessage(null)).toBe(false);
    expect(isValidConversationMessage("not an object")).toBe(false);
  });

  it("rejects oversized text", () => {
    expect(isValidConversationMessage(makeMessage({ text: "x".repeat(MAX_MESSAGE_TEXT_CHARS + 1) }))).toBe(false);
  });
});

describe("isValidConversationRecord", () => {
  it("accepts a well-formed record", () => {
    expect(isValidConversationRecord(makeRecord())).toBe(true);
  });

  it("rejects an empty title outright, but accepts a title longer than the display cap (it is clamped on save, not rejected)", () => {
    expect(isValidConversationRecord(makeRecord({ title: "" }))).toBe(false);
    expect(isValidConversationRecord(makeRecord({ title: "x".repeat(MAX_TITLE_CHARS + 1) }))).toBe(true);
  });

  it("rejects a title past the generous raw rejection ceiling", () => {
    expect(isValidConversationRecord(makeRecord({ title: "x".repeat(501) }))).toBe(false);
  });

  it("rejects too many messages", () => {
    const messages = Array.from({ length: MAX_MESSAGES_PER_CONVERSATION + 1 }, (_, i) => makeMessage({ id: `m${i}` }));
    expect(isValidConversationRecord(makeRecord({ messages }))).toBe(false);
  });

  it("rejects a record containing one invalid message", () => {
    expect(isValidConversationRecord(makeRecord({ messages: [makeMessage(), { bad: true } as never] }))).toBe(false);
  });
});

describe("isValidConversationFile (schema envelope / migration boundary)", () => {
  it("accepts the current schema version with a valid conversation", () => {
    expect(isValidConversationFile({ schemaVersion: CONVERSATION_SCHEMA_VERSION, conversation: makeRecord() })).toBe(true);
  });

  it("rejects a file with no schemaVersion at all (pre-versioned / unknown data)", () => {
    expect(isValidConversationFile({ conversation: makeRecord() })).toBe(false);
  });

  it("rejects a file claiming an older schema version than this build knows about", () => {
    expect(isValidConversationFile({ schemaVersion: 0, conversation: makeRecord() })).toBe(false);
  });

  it("rejects a file claiming a newer schema version than this build knows about", () => {
    expect(isValidConversationFile({ schemaVersion: 2, conversation: makeRecord() })).toBe(false);
  });

  it("rejects a file whose conversation payload does not validate even if schemaVersion matches", () => {
    expect(isValidConversationFile({ schemaVersion: CONVERSATION_SCHEMA_VERSION, conversation: { bad: true } })).toBe(false);
  });

  it("rejects non-object input without throwing", () => {
    expect(isValidConversationFile(null)).toBe(false);
    expect(isValidConversationFile("just a string")).toBe(false);
    expect(isValidConversationFile(42)).toBe(false);
  });
});

describe("isValidConversationBulkFile (Phase 11 'Export all' envelope)", () => {
  it("accepts a well-formed bulk file with zero or more conversations", () => {
    expect(
      isValidConversationBulkFile({
        schemaVersion: CONVERSATION_SCHEMA_VERSION,
        kind: CONVERSATION_BULK_KIND,
        exportedAt: Date.now(),
        conversations: []
      })
    ).toBe(true);
    expect(
      isValidConversationBulkFile({
        schemaVersion: CONVERSATION_SCHEMA_VERSION,
        kind: CONVERSATION_BULK_KIND,
        exportedAt: Date.now(),
        conversations: [makeRecord(), makeRecord({ id: "conv-2" })]
      })
    ).toBe(true);
  });

  it("rejects a per-conversation export file — the two envelopes are never confused", () => {
    expect(isValidConversationBulkFile({ schemaVersion: CONVERSATION_SCHEMA_VERSION, conversation: makeRecord() })).toBe(false);
  });

  it("rejects a wrong or missing schema version, kind, exportedAt, or conversations shape", () => {
    const base = { schemaVersion: CONVERSATION_SCHEMA_VERSION, kind: CONVERSATION_BULK_KIND, exportedAt: Date.now(), conversations: [] };
    expect(isValidConversationBulkFile({ ...base, schemaVersion: 2 })).toBe(false);
    expect(isValidConversationBulkFile({ ...base, kind: "something-else" })).toBe(false);
    expect(isValidConversationBulkFile({ ...base, exportedAt: "not-a-number" })).toBe(false);
    expect(isValidConversationBulkFile({ ...base, conversations: "not-an-array" })).toBe(false);
    expect(isValidConversationBulkFile({ ...base, conversations: [{ bad: true }] })).toBe(false);
    expect(isValidConversationBulkFile(null)).toBe(false);
    expect(isValidConversationBulkFile("just a string")).toBe(false);
  });

  it("rejects a bulk file with more conversations than MAX_BULK_IMPORT_CONVERSATIONS, accepts exactly the boundary (Phase 19)", () => {
    const tooMany = Array.from({ length: MAX_BULK_IMPORT_CONVERSATIONS + 1 }, (_, i) => makeRecord({ id: `conv-${i}` }));
    expect(
      isValidConversationBulkFile({
        schemaVersion: CONVERSATION_SCHEMA_VERSION,
        kind: CONVERSATION_BULK_KIND,
        exportedAt: Date.now(),
        conversations: tooMany
      })
    ).toBe(false);

    const exactlyAtCap = Array.from({ length: MAX_BULK_IMPORT_CONVERSATIONS }, (_, i) => makeRecord({ id: `conv-${i}` }));
    expect(
      isValidConversationBulkFile({
        schemaVersion: CONVERSATION_SCHEMA_VERSION,
        kind: CONVERSATION_BULK_KIND,
        exportedAt: Date.now(),
        conversations: exactlyAtCap
      })
    ).toBe(true);
  });
});

describe("generateConversationTitle", () => {
  it("uses the whole prompt when short", () => {
    expect(generateConversationTitle("Explain quantum tunnelling")).toBe("Explain quantum tunnelling");
  });

  it("collapses internal whitespace", () => {
    expect(generateConversationTitle("hello   \n\n  world")).toBe("hello world");
  });

  it("never returns an empty title", () => {
    expect(generateConversationTitle("   ")).toBe("New conversation");
    expect(generateConversationTitle("")).toBe("New conversation");
  });

  it("truncates a long prompt at a word boundary with an ellipsis", () => {
    const long = "word ".repeat(40).trim();
    const title = generateConversationTitle(long);
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_CHARS);
    expect(title.endsWith("…")).toBe(true);
    expect(title.endsWith(" …")).toBe(false);
  });

  it("truncates a single very long word without a usable boundary", () => {
    const long = "x".repeat(300);
    const title = generateConversationTitle(long);
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_CHARS);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("truncateForPreview / summarizeConversation", () => {
  it("truncates long text with an ellipsis and collapses whitespace", () => {
    const preview = truncateForPreview("a".repeat(500));
    expect(preview.length).toBeLessThanOrEqual(141);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("summarizes using the last message and preserves counts/timestamps", () => {
    const record = makeRecord({
      messages: [makeMessage({ id: "m1", text: "first" }), makeMessage({ id: "m2", role: "assistant", text: "second reply" })]
    });
    const summary = summarizeConversation(record);
    expect(summary.id).toBe(record.id);
    expect(summary.title).toBe(record.title);
    expect(summary.messageCount).toBe(2);
    expect(summary.preview).toContain("second reply");
  });

  it("never throws for an empty conversation", () => {
    const summary = summarizeConversation(makeRecord({ messages: [] }));
    expect(summary.preview).toBe("");
    expect(summary.messageCount).toBe(0);
  });
});

describe("normalizeConversationRecord", () => {
  it("clamps an overlong title instead of rejecting it", () => {
    const normalized = normalizeConversationRecord(makeRecord({ title: "y".repeat(500) }));
    expect(normalized.title.length).toBeLessThanOrEqual(MAX_TITLE_CHARS);
  });

  it("clamps overlong message text and overlong message counts", () => {
    const messages = Array.from({ length: MAX_MESSAGES_PER_CONVERSATION + 50 }, (_, i) =>
      makeMessage({ id: `m${i}`, text: "z".repeat(MAX_MESSAGE_TEXT_CHARS + 10) })
    );
    const normalized = normalizeConversationRecord(makeRecord({ messages }));
    expect(normalized.messages.length).toBe(MAX_MESSAGES_PER_CONVERSATION);
    for (const message of normalized.messages) {
      expect(message.text.length).toBeLessThanOrEqual(MAX_MESSAGE_TEXT_CHARS);
    }
  });
});

describe("IPC payload validators", () => {
  it("validates id payloads", () => {
    expect(isValidConversationIdPayload({ id: "abc" })).toBe(true);
    expect(isValidConversationIdPayload({ id: "../bad" })).toBe(false);
    expect(isValidConversationIdPayload({})).toBe(false);
    expect(isValidConversationIdPayload(null)).toBe(false);
  });

  it("validates search payloads", () => {
    expect(isValidSearchPayload({ query: "hello" })).toBe(true);
    expect(isValidSearchPayload({ query: "" })).toBe(true);
    expect(isValidSearchPayload({ query: 5 })).toBe(false);
    expect(isValidSearchPayload({ query: "x".repeat(500) })).toBe(false);
  });

  it("validates rename payloads", () => {
    expect(isValidRenamePayload({ id: "abc", title: "New title" })).toBe(true);
    expect(isValidRenamePayload({ id: "abc", title: "   " })).toBe(false);
    expect(isValidRenamePayload({ id: "abc", title: "x".repeat(600) })).toBe(false);
    expect(isValidRenamePayload({ id: "../bad", title: "fine" })).toBe(false);
  });
});

describe("isValidImportTextPayload (Phase 13 drag-and-drop)", () => {
  it("accepts a payload with non-empty string text", () => {
    expect(isValidImportTextPayload({ text: "{\"hello\":1}" })).toBe(true);
    expect(isValidImportTextPayload({ text: "x" })).toBe(true);
  });

  it("rejects a missing, empty, or non-string text field", () => {
    expect(isValidImportTextPayload({})).toBe(false);
    expect(isValidImportTextPayload({ text: "" })).toBe(false);
    expect(isValidImportTextPayload({ text: 42 })).toBe(false);
    expect(isValidImportTextPayload({ text: null })).toBe(false);
    expect(isValidImportTextPayload({ text: ["a"] })).toBe(false);
  });

  it("rejects non-object values", () => {
    expect(isValidImportTextPayload(null)).toBe(false);
    expect(isValidImportTextPayload(undefined)).toBe(false);
    expect(isValidImportTextPayload("a string")).toBe(false);
    expect(isValidImportTextPayload(42)).toBe(false);
  });

  it("accepts text exactly at the size ceiling and rejects text one character over it", () => {
    const atLimit = "x".repeat(MAX_DROPPED_IMPORT_TEXT_CHARS);
    expect(isValidImportTextPayload({ text: atLimit })).toBe(true);

    const overLimit = atLimit + "x";
    expect(isValidImportTextPayload({ text: overLimit })).toBe(false);
  });
});
