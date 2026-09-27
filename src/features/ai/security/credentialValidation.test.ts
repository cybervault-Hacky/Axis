import { describe, expect, it } from "vitest";
import { validateCredentialInput } from "./credentialValidation";

describe("credential input validation", () => {
  it("accepts an opaque non-whitespace credential without assuming a provider prefix", () => {
    expect(validateCredentialInput("obvious-test-placeholder-key")).toEqual({ valid: true });
  });

  it.each([
    ["", "Enter an API key"],
    [" short ", "Remove spaces"],
    ["short", "too short"],
    ["placeholder key", "cannot contain whitespace"],
    [`placeholder${String.fromCharCode(1)}key`, "unsupported characters"],
    [`placeholder${String.fromCharCode(127)}key`, "unsupported characters"],
  ])("rejects malformed credential input", (value, message) => {
    const result = validateCredentialInput(value);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.message).toContain(message);
  });
});
