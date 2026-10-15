// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Tests run under plain Node (not real Electron), so `electron` is mocked
 * with a controllable fake of exactly the three APIs credentialStore.ts
 * uses: app.getPath, dialog.showOpenDialog, and safeStorage. The fake
 * safeStorage performs a real (if toy) reversible transform so tests can
 * assert the on-disk bytes never contain the plaintext key — a stand-in for
 * "genuinely encrypted", without requiring a real OS keychain in CI/sandbox.
 */
let encryptionAvailable = true;
let userDataDir = "";

function fakeEncrypt(plain: string): Buffer {
  const base64 = Buffer.from(plain, "utf8").toString("base64");
  return Buffer.from(base64.split("").reverse().join(""), "utf8");
}
function fakeDecrypt(buf: Buffer): string {
  const reversed = buf.toString("utf8");
  const base64 = reversed.split("").reverse().join("");
  const decoded = Buffer.from(base64, "base64").toString("utf8");
  if (Buffer.from(decoded, "utf8").toString("base64") !== base64) {
    throw new Error("bad ciphertext");
  }
  return decoded;
}

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => {
      if (name !== "userData") throw new Error(`unexpected getPath(${name})`);
      return userDataDir;
    }
  },
  dialog: {
    showOpenDialog: vi.fn()
  },
  safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (plain: string) => fakeEncrypt(plain),
    decryptString: (buf: Buffer) => fakeDecrypt(buf)
  }
}));

import { dialog } from "electron";
import {
  __resetForTests,
  getApiKeyForRequest,
  getStatus,
  importCredential,
  removeCredential
} from "../../src/main/ai/credentialStore";

const TEST_KEY = "AIzaSyTestKeyAbc1234567890";
const fakeWindow = {} as Parameters<typeof importCredential>[0];

function writeKeyFile(content: string): string {
  const file = path.join(userDataDir, `key-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(file, content, "utf8");
  return file;
}

describe("credentialStore", () => {
  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "axis-cred-"));
    encryptionAvailable = true;
    __resetForTests();
    vi.mocked(dialog.showOpenDialog).mockReset();
  });

  afterEach(() => {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  it("reports not configured when nothing has been imported", () => {
    const status = getStatus();
    expect(status.configured).toBe(false);
    expect(status.backend).toBe("none");
    expect(status.secure).toBe(false);
  });

  it("imports and stores a valid key encrypted on disk when OS encryption is available", async () => {
    const file = writeKeyFile(TEST_KEY);
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [file] } as never);

    const result = await importCredential(fakeWindow, {});
    expect(result.ok).toBe(true);
    expect(result.backend).toBe("os-encrypted");
    expect(result.secure).toBe(true);

    const status = getStatus();
    expect(status.configured).toBe(true);
    expect(status.backend).toBe("os-encrypted");
    expect(status.secure).toBe(true);

    const diskPath = path.join(userDataDir, "secure", "gemini.cred");
    expect(fs.existsSync(diskPath)).toBe(true);
    const onDisk = fs.readFileSync(diskPath, "utf8");
    expect(onDisk).not.toContain(TEST_KEY);

    // Read-only import: the user's original file must be untouched.
    expect(fs.readFileSync(file, "utf8")).toBe(TEST_KEY);

    const lookup = getApiKeyForRequest();
    expect(lookup.ok).toBe(true);
    if (lookup.ok) expect(lookup.key).toBe(TEST_KEY);
  });

  it("never silently falls back to plaintext when encryption is unavailable", async () => {
    encryptionAvailable = false;
    const file = writeKeyFile(TEST_KEY);
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [file] } as never);

    const result = await importCredential(fakeWindow, {});
    expect(result.ok).toBe(false);

    expect(getStatus().configured).toBe(false);
    expect(fs.existsSync(path.join(userDataDir, "secure", "gemini.cred"))).toBe(false);
  });

  it("accepts an explicit session-only credential when encryption is unavailable, and never writes it to disk", async () => {
    encryptionAvailable = false;
    const file = writeKeyFile(TEST_KEY);
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [file] } as never);

    const result = await importCredential(fakeWindow, { allowSessionOnly: true });
    expect(result.ok).toBe(true);
    expect(result.backend).toBe("session");
    expect(result.secure).toBe(false);

    const status = getStatus();
    expect(status.configured).toBe(true);
    expect(status.backend).toBe("session");
    expect(status.secure).toBe(false);
    expect(fs.existsSync(path.join(userDataDir, "secure", "gemini.cred"))).toBe(false);

    const lookup = getApiKeyForRequest();
    expect(lookup.ok).toBe(true);
    if (lookup.ok) expect(lookup.key).toBe(TEST_KEY);
  });

  it("rejects multi-line or non-key-shaped file content", async () => {
    const file = writeKeyFile("this is\nnot a single\nAPI key at all, it is prose.");
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [file] } as never);

    const result = await importCredential(fakeWindow, {});
    expect(result.ok).toBe(false);
    expect(result.code).toBe("VALIDATION_ERROR");
    expect(getStatus().configured).toBe(false);
  });

  it("rejects an empty file", async () => {
    const file = writeKeyFile("");
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [file] } as never);
    const result = await importCredential(fakeWindow, {});
    expect(result.ok).toBe(false);
    expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("reports cancellation without storing anything when the picker is dismissed", async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] } as never);
    const result = await importCredential(fakeWindow, {});
    expect(result.ok).toBe(false);
    expect(result.code).toBe("CANCELLED");
    expect(getStatus().configured).toBe(false);
  });

  it("removes a stored credential from both disk and memory", async () => {
    const file = writeKeyFile(TEST_KEY);
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [file] } as never);
    await importCredential(fakeWindow, {});
    expect(getStatus().configured).toBe(true);

    const removed = removeCredential();
    expect(removed.ok).toBe(true);
    expect(getStatus().configured).toBe(false);
    expect(fs.existsSync(path.join(userDataDir, "secure", "gemini.cred"))).toBe(false);

    const lookup = getApiKeyForRequest();
    expect(lookup.ok).toBe(false);
    if (!lookup.ok) expect(lookup.code).toBe("MISSING_CREDENTIALS");
  });
});

describe("credentialStore — multi-provider isolation (Phase 9/10)", () => {
  const GEMINI_KEY = "AIzaSyTestGeminiKeyAbc1234567890";
  const OPENAI_KEY = "sk-test-openai-key-abc1234567890";
  const ANTHROPIC_KEY = "sk-ant-test-anthropic-key-abc1234567890";

  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "axis-cred-"));
    encryptionAvailable = true;
    __resetForTests();
    vi.mocked(dialog.showOpenDialog).mockReset();
  });

  afterEach(() => {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  it("defaults every function to the gemini provider when none is given, preserving Phase 3 behaviour exactly", async () => {
    const file = writeKeyFile(GEMINI_KEY);
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [file] } as never);
    await importCredential(fakeWindow, {});
    expect(fs.existsSync(path.join(userDataDir, "secure", "gemini.cred"))).toBe(true);
    expect(getStatus().provider).toBe("gemini");
  });

  it("stores Gemini and OpenAI credentials under independent on-disk files and independent statuses", async () => {
    const geminiFile = writeKeyFile(GEMINI_KEY);
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [geminiFile] } as never);
    await importCredential(fakeWindow, {}, "gemini");

    const openaiFile = writeKeyFile(OPENAI_KEY);
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [openaiFile] } as never);
    await importCredential(fakeWindow, {}, "openai");

    expect(fs.existsSync(path.join(userDataDir, "secure", "gemini.cred"))).toBe(true);
    expect(fs.existsSync(path.join(userDataDir, "secure", "openai.cred"))).toBe(true);

    const geminiStatus = getStatus("gemini");
    const openaiStatus = getStatus("openai");
    expect(geminiStatus.configured).toBe(true);
    expect(openaiStatus.configured).toBe(true);

    const geminiLookup = getApiKeyForRequest("gemini");
    const openaiLookup = getApiKeyForRequest("openai");
    expect(geminiLookup.ok).toBe(true);
    expect(openaiLookup.ok).toBe(true);
    if (geminiLookup.ok) expect(geminiLookup.key).toBe(GEMINI_KEY);
    if (openaiLookup.ok) expect(openaiLookup.key).toBe(OPENAI_KEY);
  });

  it("never leaks one provider's session-only key into a lookup for the other provider", async () => {
    encryptionAvailable = false;
    const geminiFile = writeKeyFile(GEMINI_KEY);
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [geminiFile] } as never);
    await importCredential(fakeWindow, { allowSessionOnly: true }, "gemini");

    // No OpenAI credential was ever imported.
    const openaiLookup = getApiKeyForRequest("openai");
    expect(openaiLookup.ok).toBe(false);
    if (!openaiLookup.ok) expect(openaiLookup.code).toBe("MISSING_CREDENTIALS");

    const geminiLookup = getApiKeyForRequest("gemini");
    expect(geminiLookup.ok).toBe(true);
    if (geminiLookup.ok) expect(geminiLookup.key).toBe(GEMINI_KEY);

    expect(getStatus("openai").configured).toBe(false);
    expect(getStatus("gemini").configured).toBe(true);
  });

  it("removing one provider's credential never removes or affects the other provider's", async () => {
    const geminiFile = writeKeyFile(GEMINI_KEY);
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [geminiFile] } as never);
    await importCredential(fakeWindow, {}, "gemini");

    const openaiFile = writeKeyFile(OPENAI_KEY);
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [openaiFile] } as never);
    await importCredential(fakeWindow, {}, "openai");

    removeCredential("gemini");

    expect(getStatus("gemini").configured).toBe(false);
    expect(getStatus("openai").configured).toBe(true);
    const openaiLookup = getApiKeyForRequest("openai");
    expect(openaiLookup.ok).toBe(true);
    if (openaiLookup.ok) expect(openaiLookup.key).toBe(OPENAI_KEY);
  });

  it("stores Gemini, OpenAI, and Anthropic credentials under three independent on-disk files and independent statuses (Phase 10)", async () => {
    const geminiFile = writeKeyFile(GEMINI_KEY);
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [geminiFile] } as never);
    await importCredential(fakeWindow, {}, "gemini");

    const openaiFile = writeKeyFile(OPENAI_KEY);
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [openaiFile] } as never);
    await importCredential(fakeWindow, {}, "openai");

    const anthropicFile = writeKeyFile(ANTHROPIC_KEY);
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [anthropicFile] } as never);
    await importCredential(fakeWindow, {}, "anthropic");

    expect(fs.existsSync(path.join(userDataDir, "secure", "gemini.cred"))).toBe(true);
    expect(fs.existsSync(path.join(userDataDir, "secure", "openai.cred"))).toBe(true);
    expect(fs.existsSync(path.join(userDataDir, "secure", "anthropic.cred"))).toBe(true);

    expect(getStatus("gemini").configured).toBe(true);
    expect(getStatus("openai").configured).toBe(true);
    expect(getStatus("anthropic").configured).toBe(true);

    const geminiLookup = getApiKeyForRequest("gemini");
    const openaiLookup = getApiKeyForRequest("openai");
    const anthropicLookup = getApiKeyForRequest("anthropic");
    expect(geminiLookup.ok && geminiLookup.key).toBe(GEMINI_KEY);
    expect(openaiLookup.ok && openaiLookup.key).toBe(OPENAI_KEY);
    expect(anthropicLookup.ok && anthropicLookup.key).toBe(ANTHROPIC_KEY);
  });

  it("stores Gemini, OpenAI, Anthropic, and Mistral credentials under four independent on-disk files and independent statuses (Phase 14)", async () => {
    const MISTRAL_KEY = "mistral-test-key-abc1234567890";

    const geminiFile = writeKeyFile(GEMINI_KEY);
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [geminiFile] } as never);
    await importCredential(fakeWindow, {}, "gemini");

    const openaiFile = writeKeyFile(OPENAI_KEY);
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [openaiFile] } as never);
    await importCredential(fakeWindow, {}, "openai");

    const anthropicFile = writeKeyFile(ANTHROPIC_KEY);
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [anthropicFile] } as never);
    await importCredential(fakeWindow, {}, "anthropic");

    const mistralFile = writeKeyFile(MISTRAL_KEY);
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [mistralFile] } as never);
    await importCredential(fakeWindow, {}, "mistral");

    expect(fs.existsSync(path.join(userDataDir, "secure", "gemini.cred"))).toBe(true);
    expect(fs.existsSync(path.join(userDataDir, "secure", "openai.cred"))).toBe(true);
    expect(fs.existsSync(path.join(userDataDir, "secure", "anthropic.cred"))).toBe(true);
    expect(fs.existsSync(path.join(userDataDir, "secure", "mistral.cred"))).toBe(true);

    expect(getStatus("gemini").configured).toBe(true);
    expect(getStatus("openai").configured).toBe(true);
    expect(getStatus("anthropic").configured).toBe(true);
    expect(getStatus("mistral").configured).toBe(true);

    const mistralLookup = getApiKeyForRequest("mistral");
    expect(mistralLookup.ok && mistralLookup.key).toBe(MISTRAL_KEY);

    removeCredential("mistral");
    expect(getStatus("mistral").configured).toBe(false);
    expect(getStatus("gemini").configured).toBe(true);
    expect(getStatus("openai").configured).toBe(true);
    expect(getStatus("anthropic").configured).toBe(true);
  });

  it("never leaks a session-only Anthropic key into a lookup for Gemini or OpenAI, and removing Anthropic leaves both untouched (Phase 10)", async () => {
    encryptionAvailable = false;
    const anthropicFile = writeKeyFile(ANTHROPIC_KEY);
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [anthropicFile] } as never);
    await importCredential(fakeWindow, { allowSessionOnly: true }, "anthropic");

    expect(getApiKeyForRequest("gemini").ok).toBe(false);
    expect(getApiKeyForRequest("openai").ok).toBe(false);
    const anthropicLookup = getApiKeyForRequest("anthropic");
    expect(anthropicLookup.ok).toBe(true);
    if (anthropicLookup.ok) expect(anthropicLookup.key).toBe(ANTHROPIC_KEY);

    encryptionAvailable = true;
    const geminiFile = writeKeyFile(GEMINI_KEY);
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [geminiFile] } as never);
    await importCredential(fakeWindow, {}, "gemini");

    removeCredential("anthropic");

    expect(getStatus("anthropic").configured).toBe(false);
    expect(getStatus("gemini").configured).toBe(true);
    expect(getApiKeyForRequest("gemini").ok).toBe(true);
  });
});
