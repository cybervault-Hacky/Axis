// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createConversationRepository, type ConversationRepository } from "../../src/main/conversations/conversationRepository";
import {
  CONVERSATION_SCHEMA_VERSION,
  MAX_BULK_IMPORT_CONVERSATIONS,
  MAX_DROPPED_IMPORT_TEXT_CHARS,
  type ConversationMessage,
  type ConversationRecord
} from "../../src/shared/conversation-contract";

/** Creates a file of exactly `size` bytes without writing real content — a sparse file is instant and avoids slow multi-hundred-MB test fixtures. */
function writeSparseFile(filePath: string, size: number): void {
  fs.writeFileSync(filePath, "");
  fs.truncateSync(filePath, size);
}

let baseDir = "";
let repo: ConversationRepository;

function makeMessage(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id: "msg-1",
    role: "user",
    text: "hello there",
    status: "complete",
    truncated: false,
    createdAt: Date.now(),
    ...overrides
  };
}

function makeRecord(overrides: Partial<ConversationRecord> = {}): ConversationRecord {
  const now = Date.now();
  return {
    id: `conv-${Math.random().toString(36).slice(2)}`,
    title: "A conversation",
    createdAt: now,
    updatedAt: now,
    messages: [makeMessage()],
    ...overrides
  };
}

describe("conversationRepository", () => {
  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "axis-conv-"));
    repo = createConversationRepository({ baseDir });
  });

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  it("starts with an empty list and creates the storage directory lazily", () => {
    expect(fs.existsSync(baseDir)).toBe(true);
  });

  it("saves and retrieves a conversation round-trip", async () => {
    const record = makeRecord();
    const saved = await repo.saveConversation(record);
    expect(saved.ok).toBe(true);

    const fetched = await repo.getConversation(record.id);
    expect(fetched.ok).toBe(true);
    if (fetched.ok) {
      expect(fetched.conversation.id).toBe(record.id);
      expect(fetched.conversation.title).toBe(record.title);
      expect(fetched.conversation.messages).toHaveLength(1);
    }
  });

  it("writes atomically: no stray .tmp files remain after a save", async () => {
    await repo.saveConversation(makeRecord());
    const entries = fs.readdirSync(baseDir);
    expect(entries.every((e) => !e.includes(".tmp"))).toBe(true);
    expect(entries.some((e) => e.endsWith(".json"))).toBe(true);
  });

  it("the on-disk file is a versioned envelope, never raw conversation data", async () => {
    const record = makeRecord();
    await repo.saveConversation(record);
    const filePath = path.join(baseDir, `${record.id}.json`);
    const onDisk = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(onDisk.schemaVersion).toBe(CONVERSATION_SCHEMA_VERSION);
    expect(onDisk.conversation.id).toBe(record.id);
  });

  it("never writes anything resembling credential material", async () => {
    const record = makeRecord({ messages: [makeMessage({ text: "my gemini key is not here" })] });
    await repo.saveConversation(record);
    const filePath = path.join(baseDir, `${record.id}.json`);
    const onDisk = fs.readFileSync(filePath, "utf8");
    expect(onDisk).not.toContain("apiKey");
    expect(onDisk).not.toContain("credential");
  });

  it("rejects a structurally invalid record without writing anything", async () => {
    const result = await repo.saveConversation({ bad: true } as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
    expect(fs.readdirSync(baseDir).filter((e) => e.endsWith(".json"))).toHaveLength(0);
  });

  it("clamps rather than rejects an overlong title on save", async () => {
    const record = makeRecord({ title: "t".repeat(500) });
    const result = await repo.saveConversation(record);
    expect(result.ok).toBe(true);
    const fetched = await repo.getConversation(record.id);
    expect(fetched.ok).toBe(true);
    if (fetched.ok) expect(fetched.conversation.title.length).toBeLessThanOrEqual(80);
  });

  it("reports NOT_FOUND for a missing conversation without crashing", async () => {
    const result = await repo.getConversation("does-not-exist");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });

  it("rejects a malformed id before ever touching the filesystem (path-traversal defence)", async () => {
    const result = await repo.getConversation("../../etc/passwd");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("lists saved conversations sorted by most-recently-updated first", async () => {
    const older = makeRecord({ id: "conv-older", updatedAt: 1000 });
    const newer = makeRecord({ id: "conv-newer", updatedAt: 2000 });
    await repo.saveConversation(older);
    await repo.saveConversation(newer);

    const list = await repo.listSummaries();
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.summaries.map((s) => s.id)).toEqual(["conv-newer", "conv-older"]);
    }
  });

  it("skips a corrupt JSON file instead of crashing listing", async () => {
    await repo.saveConversation(makeRecord({ id: "conv-good" }));
    fs.writeFileSync(path.join(baseDir, "conv-corrupt.json"), "{ not valid json ][", "utf8");

    const list = await repo.listSummaries();
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.summaries).toHaveLength(1);
      expect(list.summaries[0]?.id).toBe("conv-good");
    }
  });

  it("skips a file with an unknown/missing schema version instead of crashing or guessing", async () => {
    await repo.saveConversation(makeRecord({ id: "conv-good2" }));
    fs.writeFileSync(
      path.join(baseDir, "conv-future.json"),
      JSON.stringify({ schemaVersion: 999, conversation: makeRecord({ id: "conv-future" }) }),
      "utf8"
    );
    fs.writeFileSync(path.join(baseDir, "conv-noversion.json"), JSON.stringify({ conversation: makeRecord({ id: "x" }) }), "utf8");

    const list = await repo.listSummaries();
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.summaries.map((s) => s.id)).toEqual(["conv-good2"]);
    }
  });

  it("reading the future-schema conversation directly reports a storage error, not a crash", async () => {
    fs.writeFileSync(
      path.join(baseDir, "conv-future.json"),
      JSON.stringify({ schemaVersion: 999, conversation: makeRecord({ id: "conv-future" }) }),
      "utf8"
    );
    const result = await repo.getConversation("conv-future");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("STORAGE_ERROR");
  });

  it("searches by title and by message text, case-insensitively, local-only", async () => {
    await repo.saveConversation(makeRecord({ id: "conv-a", title: "Trip planning", messages: [makeMessage({ text: "Let's visit Kyoto" })] }));
    await repo.saveConversation(makeRecord({ id: "conv-b", title: "Recipe ideas", messages: [makeMessage({ text: "pasta with garlic" })] }));

    const byTitle = await repo.searchSummaries("TRIP");
    expect(byTitle.ok).toBe(true);
    if (byTitle.ok) expect(byTitle.summaries.map((s) => s.id)).toEqual(["conv-a"]);

    const byBody = await repo.searchSummaries("kyoto");
    expect(byBody.ok).toBe(true);
    if (byBody.ok) expect(byBody.summaries.map((s) => s.id)).toEqual(["conv-a"]);

    const noMatch = await repo.searchSummaries("nonexistent-term-xyz");
    expect(noMatch.ok).toBe(true);
    if (noMatch.ok) expect(noMatch.summaries).toHaveLength(0);
  });

  it("an empty search query behaves like listing everything", async () => {
    await repo.saveConversation(makeRecord({ id: "conv-a" }));
    await repo.saveConversation(makeRecord({ id: "conv-b" }));
    const result = await repo.searchSummaries("   ");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.summaries).toHaveLength(2);
  });

  it("renames a conversation and bumps updatedAt", async () => {
    const record = makeRecord({ id: "conv-rename", updatedAt: 1000 });
    await repo.saveConversation(record);
    const renamed = await repo.renameConversation("conv-rename", "Brand new title");
    expect(renamed.ok).toBe(true);
    const fetched = await repo.getConversation("conv-rename");
    expect(fetched.ok).toBe(true);
    if (fetched.ok) {
      expect(fetched.conversation.title).toBe("Brand new title");
      expect(fetched.conversation.updatedAt).toBeGreaterThan(1000);
    }
  });

  it("renaming a missing conversation reports NOT_FOUND", async () => {
    const result = await repo.renameConversation("missing-id", "New title");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });

  it("deletes a conversation so it is gone from disk and from future listings", async () => {
    await repo.saveConversation(makeRecord({ id: "conv-delete" }));
    const deleted = await repo.deleteConversation("conv-delete");
    expect(deleted.ok).toBe(true);
    expect(fs.existsSync(path.join(baseDir, "conv-delete.json"))).toBe(false);

    const list = await repo.listSummaries();
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.summaries.find((s) => s.id === "conv-delete")).toBeUndefined();
  });

  it("deleting an already-missing conversation is idempotent (reports success)", async () => {
    const result = await repo.deleteConversation("never-existed");
    expect(result.ok).toBe(true);
  });

  it("clearAll removes every saved conversation", async () => {
    await repo.saveConversation(makeRecord({ id: "conv-1" }));
    await repo.saveConversation(makeRecord({ id: "conv-2" }));
    await repo.saveConversation(makeRecord({ id: "conv-3" }));

    const cleared = await repo.clearAll();
    expect(cleared.ok).toBe(true);

    const list = await repo.listSummaries();
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.summaries).toHaveLength(0);
  });

  it("reports a graceful STORAGE_ERROR when the base directory cannot be created/read (unwritable location)", async () => {
    // Point the repository at a path whose parent is actually a *file*, so
    // mkdir(recursive) can never succeed — simulates an unavailable/unwritable
    // storage location without needing real OS permission tricks.
    const blockerFile = path.join(baseDir, "blocker");
    fs.writeFileSync(blockerFile, "not a directory", "utf8");
    const brokenRepo = createConversationRepository({ baseDir: path.join(blockerFile, "conversations") });

    const result = await brokenRepo.saveConversation(makeRecord());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("STORAGE_ERROR");

    // Listing must still degrade gracefully (empty list), never throw.
    const list = await brokenRepo.listSummaries();
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.summaries).toHaveLength(0);
  });

  describe("exportConversationToFile", () => {
    it("writes the full conversation envelope (schema version + record) to the given destination path", async () => {
      const record = makeRecord({ id: "conv-export", title: "Export me" });
      await repo.saveConversation(record);

      const destPath = path.join(baseDir, "exported.json");
      const result = await repo.exportConversationToFile("conv-export", destPath);
      expect(result.ok).toBe(true);

      const written = JSON.parse(fs.readFileSync(destPath, "utf8"));
      expect(written.schemaVersion).toBe(CONVERSATION_SCHEMA_VERSION);
      expect(written.conversation.id).toBe("conv-export");
      expect(written.conversation.title).toBe("Export me");
    });

    it("reports NOT_FOUND and writes nothing when the conversation does not exist", async () => {
      const destPath = path.join(baseDir, "should-not-exist.json");
      const result = await repo.exportConversationToFile("missing-id", destPath);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("NOT_FOUND");
      expect(fs.existsSync(destPath)).toBe(false);
    });

    it("reports STORAGE_ERROR when the destination cannot be written", async () => {
      const record = makeRecord({ id: "conv-export-2" });
      await repo.saveConversation(record);

      const badDest = path.join(baseDir, "no-such-parent-dir", "exported.json");
      const result = await repo.exportConversationToFile("conv-export-2", badDest);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("STORAGE_ERROR");
    });
  });

  describe("exportAllToFile", () => {
    it("writes a bulk envelope containing every saved conversation, newest-updated first", async () => {
      const older = makeRecord({ id: "conv-all-older", title: "Older one", updatedAt: 1000 });
      const newer = makeRecord({ id: "conv-all-newer", title: "Newer one", updatedAt: 2000 });
      await repo.saveConversation(older);
      await repo.saveConversation(newer);

      const destPath = path.join(baseDir, "all-exported.json");
      const result = await repo.exportAllToFile(destPath);
      expect(result.ok).toBe(true);

      const written = JSON.parse(fs.readFileSync(destPath, "utf8"));
      expect(written.schemaVersion).toBe(CONVERSATION_SCHEMA_VERSION);
      expect(written.kind).toBe("axis-conversations-bulk");
      expect(typeof written.exportedAt).toBe("number");
      expect(written.conversations).toHaveLength(2);
      expect(written.conversations[0].id).toBe("conv-all-newer");
      expect(written.conversations[1].id).toBe("conv-all-older");
    });

    it("writes an empty conversations array (not an error) when there is nothing saved yet", async () => {
      const destPath = path.join(baseDir, "all-exported-empty.json");
      const result = await repo.exportAllToFile(destPath);
      expect(result.ok).toBe(true);

      const written = JSON.parse(fs.readFileSync(destPath, "utf8"));
      expect(written.conversations).toEqual([]);
    });

    it("reports STORAGE_ERROR when the destination cannot be written", async () => {
      await repo.saveConversation(makeRecord({ id: "conv-all-bad" }));
      const badDest = path.join(baseDir, "no-such-parent-dir", "all-exported.json");
      const result = await repo.exportAllToFile(badDest);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("STORAGE_ERROR");
    });

    it("silently skips a corrupt conversation file rather than failing the whole export", async () => {
      await repo.saveConversation(makeRecord({ id: "conv-all-good", title: "Good one" }));
      fs.writeFileSync(path.join(baseDir, "corrupt.json"), "{ not valid json", "utf8");

      const destPath = path.join(baseDir, "all-exported-partial.json");
      const result = await repo.exportAllToFile(destPath);
      expect(result.ok).toBe(true);

      const written = JSON.parse(fs.readFileSync(destPath, "utf8"));
      expect(written.conversations).toHaveLength(1);
      expect(written.conversations[0].id).toBe("conv-all-good");
    });
  });

  describe("importConversationFromFile", () => {
    let sourceDir = "";

    beforeEach(() => {
      // Deliberately *outside* `baseDir` — baseDir is the repository's own
      // storage directory, and it scans every ".json" file inside it, so a
      // fixture file written there would be double-counted as if it were
      // one of the repository's own saved conversations.
      sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "axis-conv-import-src-"));
    });

    function writeExportFile(record: ConversationRecord): string {
      const filePath = path.join(sourceDir, `source-${record.id}.json`);
      fs.writeFileSync(filePath, JSON.stringify({ schemaVersion: CONVERSATION_SCHEMA_VERSION, conversation: record }), "utf8");
      return filePath;
    }

    it("saves the file's conversation under a brand-new id, never trusting the id already in the file", async () => {
      const record = makeRecord({ id: "conv-original", title: "Imported chat" });
      const filePath = writeExportFile(record);

      const result = await repo.importConversationFromFile(filePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.conversation.id).not.toBe("conv-original");
        expect(result.conversation.title).toBe("Imported chat");
      }

      const list = await repo.listSummaries();
      expect(list.ok).toBe(true);
      if (list.ok) {
        expect(list.summaries.find((s) => s.id === "conv-original")).toBeUndefined();
        expect(list.summaries).toHaveLength(1);
      }
    });

    it("importing the very same exported file twice produces two independent conversations, never a collision", async () => {
      const record = makeRecord({ id: "conv-dup", title: "Duplicate-safe" });
      const filePath = writeExportFile(record);

      const first = await repo.importConversationFromFile(filePath);
      const second = await repo.importConversationFromFile(filePath);
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (first.ok && second.ok) {
        expect(first.conversation.id).not.toBe(second.conversation.id);
      }

      const list = await repo.listSummaries();
      expect(list.ok).toBe(true);
      if (list.ok) expect(list.summaries).toHaveLength(2);
    });

    it("rejects a file that is not valid JSON", async () => {
      const filePath = path.join(baseDir, "not-json.json");
      fs.writeFileSync(filePath, "{ this is not json", "utf8");
      const result = await repo.importConversationFromFile(filePath);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
    });

    it("rejects a file that is valid JSON but not a valid AXIS conversation envelope", async () => {
      const filePath = path.join(baseDir, "wrong-shape.json");
      fs.writeFileSync(filePath, JSON.stringify({ hello: "world" }), "utf8");
      const result = await repo.importConversationFromFile(filePath);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
    });

    it("reports STORAGE_ERROR when the source file cannot be read at all", async () => {
      const result = await repo.importConversationFromFile(path.join(baseDir, "does-not-exist.json"));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("STORAGE_ERROR");
    });

    it("rejects a file larger than MAX_DROPPED_IMPORT_TEXT_CHARS before ever reading its contents (Phase 19)", async () => {
      const filePath = path.join(sourceDir, "huge.json");
      writeSparseFile(filePath, MAX_DROPPED_IMPORT_TEXT_CHARS + 1);

      const result = await repo.importConversationFromFile(filePath);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("VALIDATION_ERROR");
        expect(result.message).toContain("too large");
      }

      const list = await repo.listSummaries();
      expect(list.ok).toBe(true);
      if (list.ok) expect(list.summaries).toHaveLength(0);
    });

    it("still accepts a file exactly at the MAX_DROPPED_IMPORT_TEXT_CHARS boundary (rejected only for being invalid JSON, not for size)", async () => {
      const filePath = path.join(sourceDir, "boundary.json");
      writeSparseFile(filePath, MAX_DROPPED_IMPORT_TEXT_CHARS);

      const result = await repo.importConversationFromFile(filePath);
      expect(result.ok).toBe(false);
      // A sparse file reads back as a run of NUL bytes, not valid JSON — it
      // must fail for *that* reason, never for being "too large" at the
      // exact boundary.
      if (!result.ok) expect(result.message).not.toContain("too large");
    }, 15000);
  });

  describe("importAllFromFile", () => {
    let sourceDir = "";

    beforeEach(() => {
      // Deliberately *outside* baseDir, same reasoning as importConversationFromFile's tests.
      sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "axis-conv-import-all-src-"));
    });

    function writeBulkFile(records: ConversationRecord[]): string {
      const filePath = path.join(sourceDir, "bulk-export.json");
      fs.writeFileSync(
        filePath,
        JSON.stringify({ schemaVersion: CONVERSATION_SCHEMA_VERSION, kind: "axis-conversations-bulk", exportedAt: Date.now(), conversations: records }),
        "utf8"
      );
      return filePath;
    }

    it("saves every conversation in the bulk file, each under a brand-new id, never trusting the ids in the file", async () => {
      const first = makeRecord({ id: "conv-bulk-1", title: "First" });
      const second = makeRecord({ id: "conv-bulk-2", title: "Second" });
      const filePath = writeBulkFile([first, second]);

      const result = await repo.importAllFromFile(filePath);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.importedCount).toBe(2);

      const list = await repo.listSummaries();
      expect(list.ok).toBe(true);
      if (list.ok) {
        expect(list.summaries).toHaveLength(2);
        expect(list.summaries.map((s) => s.title).sort()).toEqual(["First", "Second"]);
        expect(list.summaries.find((s) => s.id === "conv-bulk-1")).toBeUndefined();
        expect(list.summaries.find((s) => s.id === "conv-bulk-2")).toBeUndefined();
      }
    });

    it("importing the same bulk file twice produces two independent sets of conversations, never a collision", async () => {
      const record = makeRecord({ id: "conv-bulk-dup", title: "Duplicate-safe" });
      const filePath = writeBulkFile([record]);

      const first = await repo.importAllFromFile(filePath);
      const second = await repo.importAllFromFile(filePath);
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);

      const list = await repo.listSummaries();
      expect(list.ok).toBe(true);
      if (list.ok) expect(list.summaries).toHaveLength(2);
    });

    it("imports zero conversations (not an error) from an empty bulk file", async () => {
      const filePath = writeBulkFile([]);
      const result = await repo.importAllFromFile(filePath);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.importedCount).toBe(0);

      const list = await repo.listSummaries();
      expect(list.ok).toBe(true);
      if (list.ok) expect(list.summaries).toHaveLength(0);
    });

    it("never overwrites an already-saved conversation that happens to share an id with one in the file", async () => {
      const existing = makeRecord({ id: "conv-existing", title: "Already here" });
      await repo.saveConversation(existing);

      const incoming = makeRecord({ id: "conv-existing", title: "From the bulk file" });
      const filePath = writeBulkFile([incoming]);
      const result = await repo.importAllFromFile(filePath);
      expect(result.ok).toBe(true);

      const list = await repo.listSummaries();
      expect(list.ok).toBe(true);
      if (list.ok) {
        expect(list.summaries).toHaveLength(2);
        expect(list.summaries.some((s) => s.title === "Already here")).toBe(true);
        expect(list.summaries.some((s) => s.title === "From the bulk file")).toBe(true);
      }
    });

    it("rejects a file that is not valid JSON", async () => {
      const filePath = path.join(baseDir, "not-json-bulk.json");
      fs.writeFileSync(filePath, "{ this is not json", "utf8");
      const result = await repo.importAllFromFile(filePath);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
    });

    it("rejects a per-conversation export file — the two envelopes are never confused", async () => {
      const record = makeRecord({ id: "conv-single" });
      const filePath = path.join(sourceDir, "single-export.json");
      fs.writeFileSync(filePath, JSON.stringify({ schemaVersion: CONVERSATION_SCHEMA_VERSION, conversation: record }), "utf8");

      const result = await repo.importAllFromFile(filePath);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");

      const list = await repo.listSummaries();
      expect(list.ok).toBe(true);
      if (list.ok) expect(list.summaries).toHaveLength(0);
    });

    it("rejects a file that is valid JSON but not a valid bulk envelope", async () => {
      const filePath = path.join(baseDir, "wrong-shape-bulk.json");
      fs.writeFileSync(filePath, JSON.stringify({ hello: "world" }), "utf8");
      const result = await repo.importAllFromFile(filePath);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
    });

    it("reports STORAGE_ERROR when the source file cannot be read at all", async () => {
      const result = await repo.importAllFromFile(path.join(baseDir, "does-not-exist-bulk.json"));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("STORAGE_ERROR");
    });

    it("rejects a file larger than MAX_DROPPED_IMPORT_TEXT_CHARS before ever reading its contents (Phase 19)", async () => {
      const filePath = path.join(sourceDir, "huge-bulk.json");
      writeSparseFile(filePath, MAX_DROPPED_IMPORT_TEXT_CHARS + 1);

      const result = await repo.importAllFromFile(filePath);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("VALIDATION_ERROR");
        expect(result.message).toContain("too large");
      }
    });

    it("rejects a bulk file with more conversations than MAX_BULK_IMPORT_CONVERSATIONS, importing none of them (Phase 19)", async () => {
      const records = Array.from({ length: MAX_BULK_IMPORT_CONVERSATIONS + 1 }, (_, i) =>
        makeRecord({ id: `conv-bulk-overflow-${i}`, title: `Conversation ${i}` })
      );
      const filePath = writeBulkFile(records);

      const result = await repo.importAllFromFile(filePath);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");

      const list = await repo.listSummaries();
      expect(list.ok).toBe(true);
      if (list.ok) expect(list.summaries).toHaveLength(0);
    }, 20000);

    it("accepts a bulk file with exactly MAX_BULK_IMPORT_CONVERSATIONS conversations", async () => {
      const records = Array.from({ length: MAX_BULK_IMPORT_CONVERSATIONS }, (_, i) =>
        makeRecord({ id: `conv-bulk-boundary-${i}`, title: `Conversation ${i}`, messages: [] })
      );
      const filePath = writeBulkFile(records);

      const result = await repo.importAllFromFile(filePath);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.importedCount).toBe(MAX_BULK_IMPORT_CONVERSATIONS);
    }, 20000);
  });

  describe("importAnyFromText (Phase 13 drag-and-drop)", () => {
    it("auto-detects and imports a single-conversation envelope, under a brand-new id", async () => {
      const record = makeRecord({ id: "conv-text-single", title: "Dropped single" });
      const text = JSON.stringify({ schemaVersion: CONVERSATION_SCHEMA_VERSION, conversation: record });

      const result = await repo.importAnyFromText(text);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.importedCount).toBe(1);

      const list = await repo.listSummaries();
      expect(list.ok).toBe(true);
      if (list.ok) {
        expect(list.summaries).toHaveLength(1);
        expect(list.summaries[0]?.title).toBe("Dropped single");
        expect(list.summaries[0]?.id).not.toBe("conv-text-single");
      }
    });

    it("auto-detects and imports a bulk envelope, saving every conversation under brand-new ids", async () => {
      const first = makeRecord({ id: "conv-text-bulk-1", title: "First dropped" });
      const second = makeRecord({ id: "conv-text-bulk-2", title: "Second dropped" });
      const text = JSON.stringify({
        schemaVersion: CONVERSATION_SCHEMA_VERSION,
        kind: "axis-conversations-bulk",
        exportedAt: Date.now(),
        conversations: [first, second]
      });

      const result = await repo.importAnyFromText(text);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.importedCount).toBe(2);

      const list = await repo.listSummaries();
      expect(list.ok).toBe(true);
      if (list.ok) {
        expect(list.summaries).toHaveLength(2);
        expect(list.summaries.map((s) => s.title).sort()).toEqual(["First dropped", "Second dropped"]);
      }
    });

    it("never overwrites an already-saved conversation sharing an id with the dropped text", async () => {
      const existing = makeRecord({ id: "conv-text-existing", title: "Already here" });
      await repo.saveConversation(existing);

      const incoming = makeRecord({ id: "conv-text-existing", title: "From dropped text" });
      const text = JSON.stringify({ schemaVersion: CONVERSATION_SCHEMA_VERSION, conversation: incoming });

      const result = await repo.importAnyFromText(text);
      expect(result.ok).toBe(true);

      const list = await repo.listSummaries();
      expect(list.ok).toBe(true);
      if (list.ok) {
        expect(list.summaries).toHaveLength(2);
        expect(list.summaries.some((s) => s.title === "Already here")).toBe(true);
        expect(list.summaries.some((s) => s.title === "From dropped text")).toBe(true);
      }
    });

    it("rejects text that is not valid JSON", async () => {
      const result = await repo.importAnyFromText("{ this is not json");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
    });

    it("rejects JSON that is neither a valid single-conversation nor a valid bulk envelope", async () => {
      const result = await repo.importAnyFromText(JSON.stringify({ hello: "world" }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");

      const list = await repo.listSummaries();
      expect(list.ok).toBe(true);
      if (list.ok) expect(list.summaries).toHaveLength(0);
    });

    it("imports zero conversations (not an error) from an empty bulk envelope", async () => {
      const text = JSON.stringify({
        schemaVersion: CONVERSATION_SCHEMA_VERSION,
        kind: "axis-conversations-bulk",
        exportedAt: Date.now(),
        conversations: []
      });
      const result = await repo.importAnyFromText(text);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.importedCount).toBe(0);
    });
  });
});
