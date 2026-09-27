const REDACTED = "[REDACTED]";
const sensitiveFieldPattern = /(?:api[-_ ]?key|authorization|bearer|access[-_ ]?token|refresh[-_ ]?token|password|secret|credential)/i;

const textPatterns: readonly [RegExp, string][] = [
  [
    /(\bauthorization\s*[:=]\s*)["']?(?:[a-z][a-z0-9._~-]*\s+)?[^\s,;|"']+["']?/gi,
    `$1${REDACTED}`,
  ],
  [/(\bbearer\s+)[a-z0-9._~+/=-]{8,}/gi, `$1${REDACTED}`],
  [
    /((?:x-api-key|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|password|secret|credential)\s*[:=]\s*)["']?[^\s,"'}]+["']?/gi,
    `$1${REDACTED}`,
  ],
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
    return {
      name: value.name,
      message: redactSecretText(value.message),
      ...(value.stack ? { stack: redactSecretText(value.stack) } : {}),
    };
  }

  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));
  if (value instanceof Date) return value.toISOString();

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
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
