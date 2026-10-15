import { describe, expect, it } from "vitest";
import {
  buildFolderExpansionNotices,
  dragCarriesFiles,
  expandDroppedEntries,
  MAX_FOLDER_EXPANDED_FILES,
  MAX_FOLDER_RECURSION_DEPTH
} from "../src/renderer/ts/dragDropFiles";

/** Minimal fake FileSystemFileEntry — resolves to `file` via its `file()` callback. */
function fakeFileEntry(file: File, failRead = false): FileSystemEntry {
  return {
    isFile: true,
    isDirectory: false,
    name: file.name,
    file: (onSuccess: (f: File) => void, onError?: (e: DOMException) => void) => {
      if (failRead) onError?.(new DOMException("boom"));
      else onSuccess(file);
    }
  } as unknown as FileSystemEntry;
}

/**
 * Minimal fake FileSystemDirectoryEntry. `batches` is consumed one array at
 * a time by successive `readEntries()` calls (mirroring the real API's
 * paging contract: callers must keep calling until an empty array comes
 * back), then an empty array forever after.
 */
function fakeDirectoryEntry(name: string, batches: FileSystemEntry[][]): FileSystemEntry {
  const queue = [...batches, []];
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => ({
      readEntries: (onSuccess: (entries: FileSystemEntry[]) => void) => {
        onSuccess(queue.length > 0 ? queue.shift()! : []);
      }
    })
  } as unknown as FileSystemEntry;
}

/** Builds a chain of nested single-child folders `depth` levels deep, with `leaf` at the bottom. */
function fakeNestedFolders(depth: number, leaf: FileSystemEntry): FileSystemEntry {
  let current = leaf;
  for (let i = 0; i < depth; i += 1) {
    current = fakeDirectoryEntry(`level-${depth - i}`, [[current]]);
  }
  return current;
}

function fakeDataTransferWithEntries(entries: Array<FileSystemEntry | null>): DataTransfer {
  return {
    items: entries.map((entry) => ({ webkitGetAsEntry: () => entry })),
    files: []
  } as unknown as DataTransfer;
}

describe("dragCarriesFiles", () => {
  it("is true when dataTransfer.types includes 'Files'", () => {
    const event = { dataTransfer: { types: ["Files"] } } as unknown as DragEvent;
    expect(dragCarriesFiles(event)).toBe(true);
  });

  it("is false for a non-file drag (e.g. dragging selected text)", () => {
    const event = { dataTransfer: { types: ["text/plain"] } } as unknown as DragEvent;
    expect(dragCarriesFiles(event)).toBe(false);
  });

  it("is false when there is no dataTransfer at all", () => {
    const event = {} as unknown as DragEvent;
    expect(dragCarriesFiles(event)).toBe(false);
  });
});

describe("expandDroppedEntries (Phase 17 folder/directory drop)", () => {
  it("falls back to the plain files list when dataTransfer.items is absent (e.g. this project's own jsdom tests)", async () => {
    const file = new File(["{}"], "a.json");
    const dataTransfer = { files: [file] } as unknown as DataTransfer;
    const result = await expandDroppedEntries(dataTransfer);
    expect(result.files).toEqual([file]);
    expect(result.truncatedByFileCount).toBe(false);
    expect(result.truncatedByDepth).toBe(false);
  });

  it("falls back to the plain files list when items exist but none support webkitGetAsEntry", async () => {
    const file = new File(["{}"], "a.json");
    const dataTransfer = { items: [{}], files: [file] } as unknown as DataTransfer;
    const result = await expandDroppedEntries(dataTransfer);
    expect(result.files).toEqual([file]);
  });

  it("returns an empty list for an empty drop", async () => {
    const dataTransfer = { files: [] } as unknown as DataTransfer;
    const result = await expandDroppedEntries(dataTransfer);
    expect(result.files).toEqual([]);
    expect(result.truncatedByFileCount).toBe(false);
    expect(result.truncatedByDepth).toBe(false);
  });

  it("returns a single dropped file as-is via its entry", async () => {
    const file = new File(["{}"], "single.json");
    const dataTransfer = fakeDataTransferWithEntries([fakeFileEntry(file)]);
    const result = await expandDroppedEntries(dataTransfer);
    expect(result.files).toEqual([file]);
  });

  it("expands a dropped folder into the files it directly contains", async () => {
    const fileA = new File(["A"], "a.json");
    const fileB = new File(["B"], "b.json");
    const folder = fakeDirectoryEntry("export-folder", [[fakeFileEntry(fileA), fakeFileEntry(fileB)]]);
    const dataTransfer = fakeDataTransferWithEntries([folder]);
    const result = await expandDroppedEntries(dataTransfer);
    expect(result.files).toEqual([fileA, fileB]);
  });

  it("recurses into nested subfolders of any depth (within the Phase 18 cap)", async () => {
    const top = new File(["top"], "top.json");
    const nested = new File(["nested"], "nested.json");
    const deepNested = new File(["deep"], "deep.json");
    const innerFolder = fakeDirectoryEntry("inner", [[fakeFileEntry(deepNested)]]);
    const middleFolder = fakeDirectoryEntry("middle", [[fakeFileEntry(nested), innerFolder]]);
    const dataTransfer = fakeDataTransferWithEntries([fakeFileEntry(top), middleFolder]);
    const result = await expandDroppedEntries(dataTransfer);
    expect(result.files).toEqual([top, nested, deepNested]);
    expect(result.truncatedByDepth).toBe(false);
  });

  it("pages through readEntries() across multiple calls, as the directory-reader contract requires", async () => {
    const fileA = new File(["A"], "a.json");
    const fileB = new File(["B"], "b.json");
    const fileC = new File(["C"], "c.json");
    // Three separate batches, exercising the "call until empty" paging loop.
    const folder = fakeDirectoryEntry("paged", [[fakeFileEntry(fileA)], [fakeFileEntry(fileB)], [fakeFileEntry(fileC)]]);
    const dataTransfer = fakeDataTransferWithEntries([folder]);
    const result = await expandDroppedEntries(dataTransfer);
    expect(result.files).toEqual([fileA, fileB, fileC]);
  });

  it("imports a mix of plain files and folders dropped together", async () => {
    const plain = new File(["plain"], "plain.json");
    const inFolder = new File(["inFolder"], "in-folder.json");
    const folder = fakeDirectoryEntry("mixed", [[fakeFileEntry(inFolder)]]);
    const dataTransfer = fakeDataTransferWithEntries([fakeFileEntry(plain), folder]);
    const result = await expandDroppedEntries(dataTransfer);
    expect(result.files).toEqual([plain, inFolder]);
  });

  it("skips (without throwing) a file inside a folder that fails to be read", async () => {
    const good = new File(["good"], "good.json");
    const bad = new File(["bad"], "bad.json");
    const folder = fakeDirectoryEntry("partial-fail", [[fakeFileEntry(good), fakeFileEntry(bad, true)]]);
    const dataTransfer = fakeDataTransferWithEntries([folder]);
    const result = await expandDroppedEntries(dataTransfer);
    expect(result.files).toEqual([good]);
  });

  it("ignores a null entry returned by webkitGetAsEntry (e.g. a dragged non-file item)", async () => {
    const file = new File(["{}"], "a.json");
    const dataTransfer = fakeDataTransferWithEntries([fakeFileEntry(file), null]);
    const result = await expandDroppedEntries(dataTransfer);
    expect(result.files).toEqual([file]);
  });

  it("returns an empty list when dataTransfer itself is null or undefined", async () => {
    expect((await expandDroppedEntries(null)).files).toEqual([]);
    expect((await expandDroppedEntries(undefined)).files).toEqual([]);
  });
});

describe("expandDroppedEntries folder-expansion limits (Phase 18)", () => {
  it("stops collecting once MAX_FOLDER_EXPANDED_FILES is reached and reports truncatedByFileCount", async () => {
    const extra = 10;
    const files = Array.from({ length: MAX_FOLDER_EXPANDED_FILES + extra }, (_, i) => new File([String(i)], `f${i}.json`));
    const folder = fakeDirectoryEntry("huge", [files.map((f) => fakeFileEntry(f))]);
    const dataTransfer = fakeDataTransferWithEntries([folder]);
    const result = await expandDroppedEntries(dataTransfer);

    expect(result.files).toHaveLength(MAX_FOLDER_EXPANDED_FILES);
    expect(result.files).toEqual(files.slice(0, MAX_FOLDER_EXPANDED_FILES));
    expect(result.truncatedByFileCount).toBe(true);
    expect(result.truncatedByDepth).toBe(false);
  });

  it("counts files across multiple dropped folders toward the same shared cap", async () => {
    const perFolder = Math.ceil((MAX_FOLDER_EXPANDED_FILES + 20) / 2);
    const makeFolder = (prefix: string) =>
      fakeDirectoryEntry(
        prefix,
        [Array.from({ length: perFolder }, (_, i) => fakeFileEntry(new File([prefix], `${prefix}-${i}.json`)))]
      );
    const dataTransfer = fakeDataTransferWithEntries([makeFolder("a"), makeFolder("b")]);
    const result = await expandDroppedEntries(dataTransfer);

    expect(result.files.length).toBe(MAX_FOLDER_EXPANDED_FILES);
    expect(result.truncatedByFileCount).toBe(true);
  });

  it("does not report truncatedByFileCount when the drop has exactly the cap's worth of files", async () => {
    const files = Array.from({ length: MAX_FOLDER_EXPANDED_FILES }, (_, i) => new File([String(i)], `f${i}.json`));
    const folder = fakeDirectoryEntry("exact", [files.map((f) => fakeFileEntry(f))]);
    const dataTransfer = fakeDataTransferWithEntries([folder]);
    const result = await expandDroppedEntries(dataTransfer);

    expect(result.files).toHaveLength(MAX_FOLDER_EXPANDED_FILES);
    expect(result.truncatedByFileCount).toBe(false);
  });

  it("skips a folder nested deeper than MAX_FOLDER_RECURSION_DEPTH and reports truncatedByDepth", async () => {
    const deepFile = new File(["deep"], "deep.json");
    // Dropped directly at the top level (depth 0), a chain of N nested
    // folders has its deepest folder checked at depth N-1. One folder more
    // than the cap (N = MAX + 1) means that deepest folder is checked at
    // depth MAX, which is rejected (>= MAX_FOLDER_RECURSION_DEPTH).
    const deepFolderChain = fakeNestedFolders(MAX_FOLDER_RECURSION_DEPTH + 1, fakeFileEntry(deepFile));
    const dataTransfer = fakeDataTransferWithEntries([deepFolderChain]);
    const result = await expandDroppedEntries(dataTransfer);

    expect(result.files).toEqual([]);
    expect(result.truncatedByDepth).toBe(true);
    expect(result.truncatedByFileCount).toBe(false);
  });

  it("still imports files found within the allowed recursion depth even if a deeper branch is skipped", async () => {
    const shallow = new File(["shallow"], "shallow.json");
    const deepFile = new File(["deep"], "deep.json");
    // Nested one level inside "mixed-depth" (so the chain's own first folder
    // starts at depth 1), a chain of MAX_FOLDER_RECURSION_DEPTH folders has
    // its deepest folder checked at depth MAX, which is rejected.
    const deepFolderChain = fakeNestedFolders(MAX_FOLDER_RECURSION_DEPTH, fakeFileEntry(deepFile));
    const folder = fakeDirectoryEntry("mixed-depth", [[fakeFileEntry(shallow), deepFolderChain]]);
    const dataTransfer = fakeDataTransferWithEntries([folder]);
    const result = await expandDroppedEntries(dataTransfer);

    expect(result.files).toEqual([shallow]);
    expect(result.truncatedByDepth).toBe(true);
  });

  it("does not report truncatedByDepth for a folder chain nested exactly at the allowed limit", async () => {
    const deepFile = new File(["deep"], "deep.json");
    // Dropped directly at the top level, a chain of exactly
    // MAX_FOLDER_RECURSION_DEPTH folders has its deepest folder checked at
    // depth MAX-1 — the last depth that is still allowed.
    const folderChain = fakeNestedFolders(MAX_FOLDER_RECURSION_DEPTH, fakeFileEntry(deepFile));
    const dataTransfer = fakeDataTransferWithEntries([folderChain]);
    const result = await expandDroppedEntries(dataTransfer);

    expect(result.files).toEqual([deepFile]);
    expect(result.truncatedByDepth).toBe(false);
  });
});

describe("buildFolderExpansionNotices (Phase 18)", () => {
  it("returns an empty array when neither limit was hit", () => {
    expect(buildFolderExpansionNotices({ truncatedByFileCount: false, truncatedByDepth: false })).toEqual([]);
  });

  it("mentions the file-count cap when truncatedByFileCount is true", () => {
    const notices = buildFolderExpansionNotices({ truncatedByFileCount: true, truncatedByDepth: false });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain(String(MAX_FOLDER_EXPANDED_FILES));
  });

  it("mentions the recursion-depth cap when truncatedByDepth is true", () => {
    const notices = buildFolderExpansionNotices({ truncatedByFileCount: false, truncatedByDepth: true });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain(String(MAX_FOLDER_RECURSION_DEPTH));
  });

  it("includes both notices when both limits were hit", () => {
    const notices = buildFolderExpansionNotices({ truncatedByFileCount: true, truncatedByDepth: true });
    expect(notices).toHaveLength(2);
  });
});
