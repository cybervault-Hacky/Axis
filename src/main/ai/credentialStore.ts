import { app, dialog, safeStorage, type BrowserWindow } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  AI_PROVIDER_LABELS,
  type AiCredentialBackend,
  type AiImportCredentialPayload,
  type AiImportCredentialResult,
  type AiProviderId,
  type AiProviderStatus,
  type AiRemoveCredentialResult
} from "../../shared/ai-contract";

/**
 * Provider API key storage (main process only).
 *
 * Security model:
 *  - The raw key is only ever held in this module (main process memory) or
 *    on disk, encrypted with Electron's `safeStorage` (OS-backed: DPAPI on
 *    Windows, Keychain on macOS, the system secret service on Linux).
 *  - `safeStorage.isEncryptionAvailable()` is checked before every write and
 *    is also what Phase 3 relies on to decide whether it is honest to call
 *    the saved credential "encrypted". If it is false, AXIS never silently
 *    writes plaintext to disk — it only accepts an explicit, separately
 *    requested session-only (memory-only, never persisted) mode.
 *  - The user's original key file is only ever read, never modified or
 *    deleted.
 *  - Nothing here ever logs or returns the raw key to a caller outside this
 *    module; IPC handlers in aiController.ts only ever forward status
 *    booleans/enums, never key material.
 *
 * Multi-provider isolation (Phase 9): every function below is scoped by an
 * explicit `provider` parameter (defaulting to `"gemini"` so every Phase 3
 * call site and test keeps working unchanged). Each provider gets its own
 * on-disk file (`secure/<provider>.cred`) and its own in-memory session-key
 * slot, keyed strictly by provider id — there is no shared "current
 * provider" mutable state anywhere in this module, so a request for one
 * provider can never accidentally read another provider's key.
 */

const CREDENTIAL_DIR_NAME = "secure";
const MAX_KEY_FILE_BYTES = 10 * 1024; // generous upper bound for a one-line key file
const MIN_KEY_LENGTH = 10;
const MAX_KEY_LENGTH = 300;
const KEY_CHARSET = /^[A-Za-z0-9_\-.:]+$/;

/**
 * In-memory-only fallback, one slot per provider. Cleared whenever the app
 * process exits. A provider's session key is stored only under its own key
 * in this map — never merged or shared across providers.
 */
const sessionKeys = new Map<AiProviderId, string>();

function credentialFilePath(provider: AiProviderId): string {
  return path.join(app.getPath("userData"), CREDENTIAL_DIR_NAME, `${provider}.cred`);
}

function diskFileExists(provider: AiProviderId): boolean {
  try {
    return fs.existsSync(credentialFilePath(provider));
  } catch {
    return false;
  }
}

export function getStatus(provider: AiProviderId = "gemini"): AiProviderStatus {
  const persistentStorageAvailable = safeStorage.isEncryptionAvailable();
  const hasSession = sessionKeys.has(provider);
  const hasDisk = diskFileExists(provider);
  const backend: AiCredentialBackend = hasSession ? "session" : hasDisk ? "os-encrypted" : "none";

  return {
    provider,
    configured: hasSession || hasDisk,
    backend,
    secure: backend === "os-encrypted",
    persistentStorageAvailable,
    nativeBridgeAvailable: true
  };
}

export interface KeyLookupOk {
  ok: true;
  key: string;
}
export interface KeyLookupErr {
  ok: false;
  code: "MISSING_CREDENTIALS" | "STORAGE_ERROR";
  message: string;
}
export type KeyLookupResult = KeyLookupOk | KeyLookupErr;

/** Resolves the key to actually use for a request. Never logged, never returned over IPC. */
export function getApiKeyForRequest(provider: AiProviderId = "gemini"): KeyLookupResult {
  const session = sessionKeys.get(provider);
  if (session !== undefined) {
    return { ok: true, key: session };
  }
  if (!diskFileExists(provider)) {
    return { ok: false, code: "MISSING_CREDENTIALS", message: "No credential is configured." };
  }
  try {
    const encrypted = fs.readFileSync(credentialFilePath(provider));
    const key = safeStorage.decryptString(encrypted);
    if (!key) {
      return { ok: false, code: "STORAGE_ERROR", message: "Stored credential decrypted to an empty value." };
    }
    return { ok: true, key };
  } catch {
    return { ok: false, code: "STORAGE_ERROR", message: "Could not decrypt the stored credential on this device." };
  }
}

function validateKeyMaterial(raw: string): { ok: true; key: string } | { ok: false; message: string } {
  const normalized = raw.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0) {
    return { ok: false, message: "The selected file is empty." };
  }
  if (lines.length > 1) {
    return { ok: false, message: "Expected a single API key on one line." };
  }
  const key = lines[0] as string;
  if (key.length < MIN_KEY_LENGTH) {
    return { ok: false, message: "That does not look like a complete API key (too short)." };
  }
  if (key.length > MAX_KEY_LENGTH) {
    return { ok: false, message: "That does not look like an API key (too long)." };
  }
  if (!KEY_CHARSET.test(key)) {
    return { ok: false, message: "That file contains unexpected characters for an API key." };
  }
  return { ok: true, key };
}

/**
 * Opens a native, main-process-owned file picker, reads the selected file
 * READ-ONLY, validates it looks like a key, and stores it per the policy
 * above. Never invoked from a background/hidden window — always passed the
 * real focused BrowserWindow so the OS dialog is modal to the app.
 */
export async function importCredential(
  window: BrowserWindow,
  payload: AiImportCredentialPayload,
  provider: AiProviderId = "gemini"
): Promise<AiImportCredentialResult> {
  const providerLabel = AI_PROVIDER_LABELS[provider];
  let selection: Electron.OpenDialogReturnValue;
  try {
    selection = await dialog.showOpenDialog(window, {
      title: `Import ${providerLabel} API key`,
      message: `Select a text file containing only your ${providerLabel} API key.`,
      properties: ["openFile"],
      filters: [
        { name: "Key or text file", extensions: ["txt", "key", "pem", "env"] },
        { name: "All files", extensions: ["*"] }
      ]
    });
  } catch {
    return { ok: false, code: "STORAGE_ERROR", message: "Could not open the file picker." };
  }

  if (selection.canceled || selection.filePaths.length === 0) {
    return { ok: false, code: "CANCELLED" };
  }

  const filePath = selection.filePaths[0] as string;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return { ok: false, code: "STORAGE_ERROR", message: "Could not read the selected file." };
  }
  if (!stat.isFile() || stat.size === 0) {
    return { ok: false, code: "VALIDATION_ERROR", message: "The selected item is not a readable file." };
  }
  if (stat.size > MAX_KEY_FILE_BYTES) {
    return { ok: false, code: "VALIDATION_ERROR", message: "That file is too large to be an API key file." };
  }

  let raw: string;
  try {
    // Read-only: the user's original file is never written to or removed.
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return { ok: false, code: "STORAGE_ERROR", message: "Could not read the selected file." };
  }

  const validated = validateKeyMaterial(raw);
  if (!validated.ok) {
    return { ok: false, code: "VALIDATION_ERROR", message: validated.message };
  }

  const persistentStorageAvailable = safeStorage.isEncryptionAvailable();

  if (persistentStorageAvailable) {
    try {
      const dir = path.dirname(credentialFilePath(provider));
      fs.mkdirSync(dir, { recursive: true });
      const encrypted = safeStorage.encryptString(validated.key);
      fs.writeFileSync(credentialFilePath(provider), encrypted, { mode: 0o600 });
    } catch {
      return { ok: false, code: "STORAGE_ERROR", message: "Could not save the encrypted credential on this device." };
    }
    sessionKeys.delete(provider);
    return { ok: true, backend: "os-encrypted", secure: true };
  }

  if (payload.allowSessionOnly === true) {
    sessionKeys.set(provider, validated.key);
    return { ok: true, backend: "session", secure: false };
  }

  return {
    ok: false,
    code: "STORAGE_ERROR",
    message:
      "Encrypted storage isn't available on this device, so AXIS did not save the key. " +
      "Choose the session-only option to keep it in memory for this run instead."
  };
}

export function removeCredential(provider: AiProviderId = "gemini"): AiRemoveCredentialResult {
  sessionKeys.delete(provider);
  try {
    if (diskFileExists(provider)) {
      fs.unlinkSync(credentialFilePath(provider));
    }
  } catch {
    return { ok: false, code: "STORAGE_ERROR", message: "Could not remove the stored credential on this device." };
  }
  return { ok: true };
}

/** Test-only hook: resets in-memory session state between unit tests. */
export function __resetForTests(): void {
  sessionKeys.clear();
}
