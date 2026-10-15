/**
 * True when a drag event's payload actually includes at least one file (as
 * opposed to, say, dragging selected text or a link) — used everywhere AXIS
 * listens for a dropped file so a non-file drag is always ignored rather
 * than accidentally intercepted. Shared by the History view's own drop zone
 * (Phase 13) and the window-wide drop zone (Phase 16) so both agree on
 * exactly the same definition of "this drag carries a file" rather than two
 * copies of the same one-line check drifting apart.
 */
export function dragCarriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/**
 * Phase 18: hard caps on folder expansion (Phase 17), added after Phase 17
 * itself flagged — in its own README "known limitations" note — that
 * folder/directory drop had no bound on recursion depth or total file
 * count. A user dropping a folder with an extreme structure (very deep
 * nesting, or an enormous number of files — accidentally or otherwise)
 * could previously make the renderer walk and read an unbounded number of
 * filesystem entries before anything was shown. These limits keep that
 * work bounded and predictable while still comfortably covering any
 * realistic AXIS export folder. Hitting either limit is reported to the
 * user (see `buildFolderExpansionNotices` below) rather than silently
 * dropping files — it reuses History's existing drop-result banner, so no
 * new UI is introduced.
 */
export const MAX_FOLDER_RECURSION_DEPTH = 12;
export const MAX_FOLDER_EXPANDED_FILES = 500;

interface ExpansionContext {
  files: File[];
  truncatedByFileCount: boolean;
  truncatedByDepth: boolean;
}

/**
 * Reads a single File and Directory Entries API entry into a flat list of
 * `File`s, recursing into subdirectories (Phase 17: folder/directory drop).
 * A plain file entry contributes exactly one `File`; a directory entry is
 * paged through via `readEntries()` (which the spec requires calling
 * repeatedly until it returns an empty array — a single call is not
 * guaranteed to return every child) and each child is walked the same way.
 *
 * Phase 18: bounded by `MAX_FOLDER_RECURSION_DEPTH` (a directory nested
 * deeper than this is skipped rather than descended into) and
 * `MAX_FOLDER_EXPANDED_FILES` (once that many files have been collected
 * across the whole drop, every further file/directory is skipped). Both
 * are recorded on `ctx` rather than thrown, so a drop that hits a limit
 * still imports everything collected up to that point instead of failing
 * outright.
 */
async function collectFilesFromEntry(entry: FileSystemEntry, depth: number, ctx: ExpansionContext): Promise<void> {
  if (ctx.truncatedByFileCount) return;

  if (entry.isFile) {
    if (ctx.files.length >= MAX_FOLDER_EXPANDED_FILES) {
      ctx.truncatedByFileCount = true;
      return;
    }
    const file = await new Promise<File | null>((resolve) => {
      (entry as FileSystemFileEntry).file(resolve, () => resolve(null));
    });
    if (file) ctx.files.push(file);
    return;
  }

  if (entry.isDirectory) {
    if (depth >= MAX_FOLDER_RECURSION_DEPTH) {
      ctx.truncatedByDepth = true;
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      if (ctx.truncatedByFileCount) break;
      const batch = await new Promise<FileSystemEntry[]>((resolve) => {
        reader.readEntries(resolve, () => resolve([]));
      });
      if (batch.length === 0) break;
      for (const child of batch) {
        if (ctx.truncatedByFileCount) break;
        await collectFilesFromEntry(child, depth + 1, ctx);
      }
    }
  }
}

/** Result of expanding a drop's `DataTransfer` into the files it carries (Phase 17/18). */
export interface DroppedEntriesExpansion {
  files: File[];
  /** True once `MAX_FOLDER_EXPANDED_FILES` was reached and the rest of the drop was skipped. */
  truncatedByFileCount: boolean;
  /** True if at least one folder was nested deeper than `MAX_FOLDER_RECURSION_DEPTH` and was skipped. */
  truncatedByDepth: boolean;
}

/**
 * Expands a drop's `DataTransfer` into the flat list of `File`s it carries,
 * transparently expanding any dropped folders into the files they contain
 * (Phase 17), bounded by the Phase 18 limits above. Folder expansion relies
 * on each `DataTransferItem`'s `webkitGetAsEntry()` — non-standard in name
 * but supported by every Chromium build, and therefore by Electron, which
 * is the only runtime AXIS ships on; where that API is unavailable (older/
 * other browsers, and this project's own jsdom-based tests, which do not
 * implement it) this falls back to the plain `dataTransfer.files` list AXIS
 * already used before Phase 17, so a folder dropped there is simply
 * ignored exactly as it silently was previously — a graceful, unchanged
 * fallback rather than a new failure mode. That plain-files fallback is
 * never itself subject to the Phase 18 caps: it is already a flat list
 * handed directly to this renderer by the browser, not something AXIS
 * recursively walks.
 */
export async function expandDroppedEntries(dataTransfer: DataTransfer | null | undefined): Promise<DroppedEntriesExpansion> {
  const plainFiles = (): File[] => (dataTransfer?.files ? Array.from(dataTransfer.files) : []);
  const noLimits = (files: File[]): DroppedEntriesExpansion => ({ files, truncatedByFileCount: false, truncatedByDepth: false });

  const items = dataTransfer?.items;
  if (!items || items.length === 0) return noLimits(plainFiles());

  const entries: FileSystemEntry[] = [];
  let sawEntrySupport = false;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const getEntry = item?.webkitGetAsEntry;
    if (typeof getEntry !== "function") continue;
    sawEntrySupport = true;
    const entry = getEntry.call(item);
    if (entry) entries.push(entry);
  }

  if (!sawEntrySupport) return noLimits(plainFiles());

  const ctx: ExpansionContext = { files: [], truncatedByFileCount: false, truncatedByDepth: false };
  for (const entry of entries) {
    if (ctx.truncatedByFileCount) break;
    await collectFilesFromEntry(entry, 0, ctx);
  }
  return { files: ctx.files, truncatedByFileCount: ctx.truncatedByFileCount, truncatedByDepth: ctx.truncatedByDepth };
}

/**
 * Turns the Phase 18 truncation flags from `expandDroppedEntries` into
 * plain, user-facing sentences. Shared by History's own drop zone and the
 * window-wide drop handler so both report a limit being hit identically
 * (and so the wording lives in exactly one place). Returns an empty array
 * when neither limit was hit, which is the overwhelmingly common case.
 */
export function buildFolderExpansionNotices(expansion: Pick<DroppedEntriesExpansion, "truncatedByFileCount" | "truncatedByDepth">): string[] {
  const notices: string[] = [];
  if (expansion.truncatedByFileCount) {
    notices.push(
      `Only the first ${MAX_FOLDER_EXPANDED_FILES} files from the dropped folder were imported — the rest were skipped to avoid importing an unbounded number of files at once.`
    );
  }
  if (expansion.truncatedByDepth) {
    notices.push(
      `A folder nested more than ${MAX_FOLDER_RECURSION_DEPTH} levels deep was skipped to avoid unbounded recursion.`
    );
  }
  return notices;
}
