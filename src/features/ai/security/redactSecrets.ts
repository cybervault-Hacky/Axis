const REDACTED = "[REDACTED]";
const sensitiveFieldPattern = /(?:api[-_ ]?key|x-goog-api-key|authorization|proxy-authorization|auth(?:entication)?|bearer|access[-_ ]?token|refresh[-_ ]?token|token|password|secret|credential|cookie|private[-_ ]?key)/i;

const textPatterns: readonly [RegExp, string][] = [
  // Explicitly named fields are safe to redact generically, including quoted JSON values.
  [
    /(["']?(?:authorization|proxy-authorization|x-api-key|x-goog-api-key|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|token|password|secret|credential|cookie|private[-_ ]?key)["']?\s*[:=]\s*)(?:(?:bearer|basic)\s+)?(?:"[^"]*"|'[^']*'|[^\s,;|"'}`]+)/gi,
    `$1${REDACTED}`,
  ],
  // A standalone auth scheme still marks its following value as sensitive.
  [/(\b(?:bearer|basic)\s+)[^\s,;|"'}`]+/gi, `$1${REDACTED}`],
  // URLs must never retain user-info if an error or diagnostic includes an endpoint.
  [/\b(https?:\/\/)\S*?@(?=[^/\s]+(?:[/?#]|$))/gi, `$1${REDACTED}@`],
  // Retain provider-specific patterns as defense in depth for unlabeled messages.
  [/(?:sk|gsk)[-_][a-z0-9_-]{8,}/gi, REDACTED],
  [/(?:AIza)[a-z0-9_-]{12,}/gi, REDACTED],
];

export function redactSecretText(value: string): string {
  return textPatterns.reduce(
    (redacted, [pattern, replacement]) => redacted.replace(pattern, replacement),
    value,
  );
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactSecretText(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (value instanceof Error) {
    // Stack traces add little to user-facing diagnostics and can contain request details.
    return {
      name: redactSecretText(value.name),
      message: redactSecretText(value.message),
      ...(value.cause !== undefined ? { cause: redactValue(value.cause, seen) } : {}),
    };
  }

  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));
  if (value instanceof Date) return value.toISOString();

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      redactSecretText(key),
      sensitiveFieldPattern.test(key) ? REDACTED : redactValue(nestedValue, seen),
    ]),
  );
}

export function redactSecrets<T>(value: T): T {
  return redactValue(value, new WeakSet<object>()) as T;
}

export function isSensitiveFieldName(fieldName: string): boolean {
  return sensitiveFieldPattern.test(fieldName);
}
