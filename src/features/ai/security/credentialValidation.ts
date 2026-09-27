export type CredentialValidationResult =
  | { valid: true }
  | { valid: false; message: string };

export function validateCredentialInput(value: string): CredentialValidationResult {
  if (!value) return { valid: false, message: "Enter an API key." };
  if (value !== value.trim()) {
    return { valid: false, message: "Remove spaces before or after the API key." };
  }
  if (value.length < 8) {
    return { valid: false, message: "The API key is too short to validate." };
  }
  if (value.length > 2048) {
    return { valid: false, message: "The API key is longer than the supported limit." };
  }
  if (/\s/.test(value)) {
    return { valid: false, message: "API keys cannot contain whitespace." };
  }
  const containsControlCharacter = [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
  });
  if (containsControlCharacter) {
    return { valid: false, message: "The API key contains unsupported characters." };
  }
  return { valid: true };
}
