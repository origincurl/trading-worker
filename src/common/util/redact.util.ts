const MAX_REDACTED_LENGTH = 500;
const OPAQUE_TOKEN_PATTERN = /(?<![A-Za-z0-9])[A-Za-z0-9+/=._-]{20,}(?![A-Za-z0-9])/g;
const SECRET_PATTERNS = [
  /(app[_-]?key|app[_-]?secret|access[_-]?token|refresh[_-]?token|authorization)(["'=:\s]+)([^"',\s}]+)/gi,
  /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi,
  OPAQUE_TOKEN_PATTERN,
];

export function redactPotentialSecrets(value: string | null | undefined): string | null {
  if (!value) return null;

  const redacted = SECRET_PATTERNS.reduce(
    (acc, pattern) =>
      acc.replace(pattern, (_match, prefix?: string, sep?: string) =>
        prefix ? `${prefix}${sep ?? ''}[REDACTED]` : '[REDACTED]',
      ),
    value,
  );

  return redacted.length > MAX_REDACTED_LENGTH
    ? `${redacted.slice(0, MAX_REDACTED_LENGTH)}...[TRUNCATED]`
    : redacted;
}
