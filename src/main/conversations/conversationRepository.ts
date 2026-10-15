import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
  CONVERSATION_BULK_KIND,
  CONVERSATION_SCHEMA_VERSION,
  isValidConversationBulkFile,
  isValidConversationFile,
  isValidConversationId,
  isValidConversationRecord,
  MAX_DROPPED_IMPORT_TEXT_CHARS,
  normalizeConversationRecord,
  summarizeConversation,
  type ConversationBulkFileV1,
  type ConversationFileV1,
  type ConversationRecord,
  type ConversationSummary
} from "../../shared/conversation-contract";

/**
 * Local conversation storage (main process only, Phase 5).
 *
 * Storage model:
 *  - One plain JSON file per conversation, named `<id>.json`, under an
 *    injected base directory (the real app passes
 *    `path.join(app.getPath("userData"), "conversations")`; tests pass a
 *    temp directory so no real Electron/user profile is ever touched).
 *  - Every write is "temp file then rename": the full JSON is written to a
 *    sibling `*.tmp` file first and only `fs.rename`d into place once that
 *    write has completed. A crash or power loss mid-write can only ever
 *    leave behind an orphaned `.tmp` file — the real `<id>.json` is never
 *    left half-written. (`fs.rename` is atomic on POSIX for same-filesystem
 *    renames; on Windows, Node implements it as an atomic replace. This
 *    has been exercised against the sandbox's Linux filesystem in this
 *    session's tests, not against a real Windows filesystem.)
 *  - `JSON.parse` is the only parser ever used — never `eval` or a
 *    template/code engine — so a corrupt or adversarially crafted file can
 *    only ever become inert data. Every record is still fully re-validated
 *    with `isValidConversationRecord` before it is trusted, independent of
 *    whether it parsed.
 *  - A corrupt, truncated, unreadable, or schema-mismatched file is always
 *    skipped rather than thrown — the repository never lets one bad file
 *    crash listing/search/other conversations.
 *  - This module has no knowledge of credentials at all: it never imports
 *    `credentialStore.ts` and the `ConversationRecord` shape has no field
 *    that could hold an API key.
 */

export interface ConversationRepositoryDeps {
  /** Directory conversation files live in. Created on demand if missing. */
  baseDir: string;
}

export type RepoErrorCode = "VALIDATION_ERROR" | "STORAGE_ERROR" | "NOT_FOUND";

export interface RepoFailure {
  ok: false;
  code: RepoErrorCode;
  message: string;
}

export interface RepoListResult {
  ok: true;
  summaries: ConversationSummary[];
}

export interface RepoGetResult {
  ok: true;
  conversation: ConversationRecord;
}

export interface RepoSaveResult {
  ok: true;
  conversation: ConversationRecord;
}

export interface RepoSimpleResult {
  ok: true;
}

/** Result of a Phase 12 bulk import — how many conversations from the file were actually saved. */
export interface RepoBulkImportResult {
  ok: true;
  importedCount: number;
}

const FILE_SUFFIX = ".json";

function isConversationFileName(name: string): boolean {
  return name.endsWith(FILE_SUFFIX) && !name.startsWith(".");
}

/**
 * Parses + validates a raw on-disk payload against the current schema
 * envelope. This is the designated migration boundary: today only version
 * 1 is understood, so this function is the one place a future
 * `case 2: return migrateV1ToV2(...)` branch would be added. An unknown or
 * missing version is treated as unreadable rather than guessed at — never
 * silently reinterpreted as the current shape.
 */
function loadConversationFile(raw: unknown): ConversationFileV1 | null {
  if (typeof raw !== "object" || raw === null) return null;
  const schemaVersion = (raw as Record<string, unknown>)["schemaVersion"];
  if (schemaVersion !== CONVERSATION_SCHEMA_VERSION) {
    // Older (pre-versioned) or newer-than-supported data. Both are
    // "outdated" in the sense this build cannot safely interpret them —
    // reported as unreadable rather than crashing or guessing.
    return null;
  }
  if (!isValidConversationFile(raw)) return null;
  return raw;
}

export function createConversationRepository(deps: ConversationRepositoryDeps) {
  function filePath(id: string): string {
    return path.join(deps.baseDir, `${id}${FILE_SUFFIX}`);
  }

  async function ensureDir(): Promise<RepoFailure | null> {
    try {
      await fs.mkdir(deps.baseDir, { recursive: true });
      return null;
    } catch {
      return { ok: false, code: "STORAGE_ERROR", message: "Could not access the conversation storage folder on this device." };
    }
  }

  /** Reads every valid conversation file. Corrupt/unreadable files are silently skipped. */
  async function readAllValidRecords(): Promise<ConversationRecord[]> {
    const dirError = await ensureDir();
    if (dirError) return [];

    let entries: string[];
    try {
      entries = await fs.readdir(deps.baseDir);
    } catch {
      return [];
    }

    const records: ConversationRecord[] = [];
    for (const entry of entries) {
      if (!isConversationFileName(entry)) continue;
      try {
        const raw = await fs.readFile(path.join(deps.baseDir, entry), "utf8");
        const parsed: unknown = JSON.parse(raw);
        const file = loadConversationFile(parsed);
        if (file) records.push(file.conversation);
      } catch {
        // Corrupt JSON, unreadable file, permission error, etc — never lets
        // one bad file break listing/search for every other conversation.
        continue;
      }
    }
    return records;
  }

  function sortByUpdatedDesc(records: ConversationRecord[]): ConversationRecord[] {
    return [...records].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async function atomicWriteRecord(record: ConversationRecord): Promise<void> {
    const target = filePath(record.id);
    const tmpPath = path.join(deps.baseDir, `.${record.id}.${process.pid}.${Date.now()}.tmp`);
    const file: ConversationFileV1 = { schemaVersion: CONVERSATION_SCHEMA_VERSION, conversation: record };
    const json = JSON.stringify(file);
    await fs.writeFile(tmpPath, json, { encoding: "utf8", mode: 0o600 });
    await fs.rename(tmpPath, target);
  }

  async function listSummaries(): Promise<RepoListResult | RepoFailure> {
    const records = await readAllValidRecords();
    return { ok: true, summaries: sortByUpdatedDesc(records).map(summarizeConversation) };
  }

  async function searchSummaries(query: string): Promise<RepoListResult | RepoFailure> {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return listSummaries();

    const records = await readAllValidRecords();
    const matches = records.filter((record) => {
      if (record.title.toLowerCase().includes(needle)) return true;
      return record.messages.some((message) => message.text.toLowerCase().includes(needle));
    });
    return { ok: true, summaries: sortByUpdatedDesc(matches).map(summarizeConversation) };
  }

  async function getConversation(id: string): Promise<RepoGetResult | RepoFailure> {
    if (!isValidConversationId(id)) {
      return { ok: false, code: "VALIDATION_ERROR", message: "That conversation id is not valid." };
    }
    let raw: string;
    try {
      raw = await fs.readFile(filePath(id), "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        return { ok: false, code: "NOT_FOUND", message: "That conversation could not be found — it may have already been deleted." };
      }
      return { ok: false, code: "STORAGE_ERROR", message: "Could not read that conversation from disk." };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, code: "STORAGE_ERROR", message: "That conversation's saved data is corrupted and could not be read." };
    }
    const file = loadConversationFile(parsed);
    if (!file) {
      return { ok: false, code: "STORAGE_ERROR", message: "That conversation's saved data is in an unrecognized or corrupted format." };
    }
    return { ok: true, conversation: file.conversation };
  }

  async function saveConversation(record: ConversationRecord): Promise<RepoSaveResult | RepoFailure> {
    if (!isValidConversationRecord(record)) {
      return { ok: false, code: "VALIDATION_ERROR", message: "That conversation data was not valid, so nothing was saved." };
    }
    const dirError = await ensureDir();
    if (dirError) return dirError;

    const normalized = normalizeConversationRecord(record);
    try {
      await atomicWriteRecord(normalized);
    } catch {
      return { ok: false, code: "STORAGE_ERROR", message: "Could not save this conversation to disk." };
    }
    return { ok: true, conversation: normalized };
  }

  async function renameConversation(id: string, title: string): Promise<RepoSaveResult | RepoFailure> {
    const existing = await getConversation(id);
    if (!existing.ok) return existing;
    const renamed: ConversationRecord = { ...existing.conversation, title, updatedAt: Date.now() };
    return saveConversation(renamed);
  }

  async function deleteConversation(id: string): Promise<RepoSimpleResult | RepoFailure> {
    if (!isValidConversationId(id)) {
      return { ok: false, code: "VALIDATION_ERROR", message: "That conversation id is not valid." };
    }
    try {
      await fs.unlink(filePath(id));
      return { ok: true };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") return { ok: true }; // already gone — deleting is idempotent.
      return { ok: false, code: "STORAGE_ERROR", message: "Could not delete that conversation from disk." };
    }
  }

  /**
   * Writes one saved conversation to an arbitrary, user-chosen destination
   * (Phase 7 export). Deliberately separate from `atomicWriteRecord`: the
   * destination is outside `deps.baseDir` and only ever a courtesy copy —
   * it is never read back as this app's source of truth, so a plain write
   * is enough (no rename-into-place dance needed for a one-off export).
   */
  async function exportConversationToFile(id: string, destPath: string): Promise<RepoSimpleResult | RepoFailure> {
    const existing = await getConversation(id);
    if (!existing.ok) return existing;
    const file: ConversationFileV1 = { schemaVersion: CONVERSATION_SCHEMA_VERSION, conversation: existing.conversation };
    try {
      await fs.writeFile(destPath, JSON.stringify(file, null, 2), "utf8");
    } catch {
      return { ok: false, code: "STORAGE_ERROR", message: "Could not write the export file." };
    }
    return { ok: true };
  }

  /**
   * Writes every saved conversation to a single user-chosen destination
   * (Phase 11 "Export all"). Reuses the exact same read path as
   * `listSummaries`/`searchSummaries` — `readAllValidRecords` +
   * `sortByUpdatedDesc` — so the bulk file's ordering matches what the
   * History list already shows, and a corrupt individual conversation file
   * is silently skipped rather than failing the whole export (same
   * tolerance `readAllValidRecords` already gives every other read path).
   * Like `exportConversationToFile`, this is a one-off courtesy copy to an
   * arbitrary external path — never read back as this app's source of
   * truth — so a plain write is enough; no empty-list special case either,
   * matching `clearAll`'s treatment of an already-empty directory.
   */
  async function exportAllToFile(destPath: string): Promise<RepoSimpleResult | RepoFailure> {
    const records = sortByUpdatedDesc(await readAllValidRecords());
    const file: ConversationBulkFileV1 = {
      schemaVersion: CONVERSATION_SCHEMA_VERSION,
      kind: CONVERSATION_BULK_KIND,
      exportedAt: Date.now(),
      conversations: records
    };
    try {
      await fs.writeFile(destPath, JSON.stringify(file, null, 2), "utf8");
    } catch {
      return { ok: false, code: "STORAGE_ERROR", message: "Could not write the export file." };
    }
    return { ok: true };
  }

  /**
   * Reads a user-picked file's text content, rejecting it outright (before
   * ever reading its bytes into memory) if it is larger than
   * `MAX_DROPPED_IMPORT_TEXT_CHARS` on disk (Phase 19). This mirrors, for
   * the native "Import"/"Import all" dialog path, the exact same backstop
   * `isValidImportTextPayload` already enforces for the Phase 13
   * drag-and-drop path — before this, a native-dialog import had no size
   * limit at all, so picking an arbitrarily large file would attempt to
   * read the whole thing into one in-memory string with no bound. A
   * legitimate AXIS export — including the largest single or bulk export
   * this schema can ever produce — stays well under this ceiling, so no
   * real export is affected.
   */
  async function readImportableFileText(sourcePath: string): Promise<{ ok: true; text: string } | RepoFailure> {
    try {
      const stat = await fs.stat(sourcePath);
      if (stat.size > MAX_DROPPED_IMPORT_TEXT_CHARS) {
        return { ok: false, code: "VALIDATION_ERROR", message: "That file is too large to import." };
      }
    } catch {
      return { ok: false, code: "STORAGE_ERROR", message: "Could not read the selected file." };
    }
    try {
      const text = await fs.readFile(sourcePath, "utf8");
      return { ok: true, text };
    } catch {
      return { ok: false, code: "STORAGE_ERROR", message: "Could not read the selected file." };
    }
  }

  /**
   * Reads and validates a file the user picked (Phase 7 import) using the
   * exact same envelope/schema validation as every file already in
   * `deps.baseDir` — a malformed or hand-edited file can never be
   * interpreted as trusted data, only rejected. Always assigns a brand-new
   * id rather than trusting the id in the file, so importing can never
   * silently overwrite an existing conversation (same id) and importing
   * the same export twice always produces two independent conversations
   * rather than a collision.
   */
  async function importConversationFromFile(sourcePath: string): Promise<RepoSaveResult | RepoFailure> {
    const read = await readImportableFileText(sourcePath);
    if (!read.ok) return read;
    const raw = read.text;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, code: "VALIDATION_ERROR", message: "That file is not a valid AXIS conversation export." };
    }
    const file = loadConversationFile(parsed);
    if (!file) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: "That file is not a valid, readable AXIS conversation export."
      };
    }
    const imported: ConversationRecord = {
      ...file.conversation,
      id: `conv-${randomUUID()}`,
      updatedAt: Date.now()
    };
    return saveConversation(imported);
  }

  /**
   * Reads and validates a Phase 11 bulk-export file ("Export all") and
   * saves every conversation inside it as a new, independent conversation
   * (Phase 12 "Import all"). Deliberately rejects a per-conversation
   * `ConversationFileV1` file outright — `isValidConversationBulkFile`
   * requires the distinct `kind: "axis-conversations-bulk"` discriminator,
   * so the two formats can never be confused or partially accepted.
   * Exactly like `importConversationFromFile`, every imported conversation
   * always gets a brand-new id (never the id recorded in the file), so
   * importing the same bulk file twice always produces two independent
   * sets of conversations rather than a collision, and importing a file
   * that happens to overlap with already-saved conversations never
   * overwrites anything. Conversations are saved one at a time through the
   * same `saveConversation` validation/normalization/atomic-write path
   * every other conversation already goes through; if an individual write
   * genuinely fails partway through, the conversations already written
   * stay written (same partial-progress honesty `clearAll` already has)
   * and the failure reports exactly how many succeeded before it.
   */
  async function importAllFromFile(sourcePath: string): Promise<RepoBulkImportResult | RepoFailure> {
    const read = await readImportableFileText(sourcePath);
    if (!read.ok) return read;
    const raw = read.text;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, code: "VALIDATION_ERROR", message: "That file is not a valid AXIS bulk conversation export." };
    }
    if (!isValidConversationBulkFile(parsed)) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: "That file is not a valid, readable AXIS bulk conversation export (\"Export all\" file)."
      };
    }

    let importedCount = 0;
    for (const conversation of parsed.conversations) {
      const imported: ConversationRecord = {
        ...conversation,
        id: `conv-${randomUUID()}`,
        updatedAt: Date.now()
      };
      const result = await saveConversation(imported);
      if (!result.ok) {
        return {
          ok: false,
          code: result.code,
          message: `Only ${importedCount} of ${parsed.conversations.length} conversation(s) could be imported before this error: ${result.message}`
        };
      }
      importedCount += 1;
    }
    return { ok: true, importedCount };
  }

  /** Shared save loop for a batch of not-yet-saved conversations, used by both `importAllFromFile` and `importAnyFromText`. */
  async function saveEachAsNew(conversations: ConversationRecord[]): Promise<RepoBulkImportResult | RepoFailure> {
    let importedCount = 0;
    for (const conversation of conversations) {
      const imported: ConversationRecord = {
        ...conversation,
        id: `conv-${randomUUID()}`,
        updatedAt: Date.now()
      };
      const result = await saveConversation(imported);
      if (!result.ok) {
        return {
          ok: false,
          code: result.code,
          message: `Only ${importedCount} of ${conversations.length} conversation(s) could be imported before this error: ${result.message}`
        };
      }
      importedCount += 1;
    }
    return { ok: true, importedCount };
  }

  /**
   * Phase 13: imports from raw JSON text instead of a file path — the one
   * conversations repository function that does not itself touch disk to
   * *read* its input (the main process still owns every *write*). This is
   * the main-process counterpart to drag-and-drop: the renderer reads a
   * dropped file's bytes via the standard, non-spoofable Web `File.text()`
   * API (a real file handle the browser itself granted because of an
   * actual OS drag gesture — not a path string a script could point at an
   * arbitrary location) and hands the resulting text to the main process,
   * which treats it as completely untrusted input, exactly like a file
   * read from disk. Auto-detects whether the text is a single-conversation
   * `ConversationFileV1` envelope or a `ConversationBulkFileV1` one by
   * trying each schema in turn — never guessed from a filename or
   * extension — and imports accordingly, always under brand-new id(s),
   * with the same no-overwrite, no-collision guarantee every other import
   * path already gives.
   */
  async function importAnyFromText(rawText: string): Promise<RepoBulkImportResult | RepoFailure> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return { ok: false, code: "VALIDATION_ERROR", message: "That file is not a valid AXIS conversation export." };
    }

    const singleFile = loadConversationFile(parsed);
    if (singleFile) {
      return saveEachAsNew([singleFile.conversation]);
    }

    if (isValidConversationBulkFile(parsed)) {
      return saveEachAsNew(parsed.conversations);
    }

    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "That file is not a valid AXIS conversation export (single or \"Export all\")."
    };
  }

  async function clearAll(): Promise<RepoSimpleResult | RepoFailure> {
    const dirError = await ensureDir();
    if (dirError) return dirError;
    let entries: string[];
    try {
      entries = await fs.readdir(deps.baseDir);
    } catch {
      return { ok: false, code: "STORAGE_ERROR", message: "Could not read conversation storage on this device." };
    }
    let anyFailed = false;
    for (const entry of entries) {
      if (!isConversationFileName(entry)) continue;
      try {
        await fs.unlink(path.join(deps.baseDir, entry));
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code !== "ENOENT") anyFailed = true;
      }
    }
    if (anyFailed) {
      return { ok: false, code: "STORAGE_ERROR", message: "Some saved conversations could not be deleted." };
    }
    return { ok: true };
  }

  return {
    listSummaries,
    searchSummaries,
    getConversation,
    saveConversation,
    renameConversation,
    deleteConversation,
    clearAll,
    exportConversationToFile,
    exportAllToFile,
    importConversationFromFile,
    importAllFromFile,
    importAnyFromText
  };
}

export type ConversationRepository = ReturnType<typeof createConversationRepository>;
