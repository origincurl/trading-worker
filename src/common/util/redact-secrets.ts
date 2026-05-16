const SECRET_KEY_PATTERN =
  /(token|secret|password|passwd|api[_-]?key|app[_-]?key|app[_-]?secret|authorization|hmac|bearer|access[_-]?token|refresh[_-]?token|credential|signature|sig|lease)/i;

const REDACTED = '***REDACTED***';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
  );
}

export function redactSecrets(input: unknown, depth = 0): unknown {
  if (depth > 10) return REDACTED;

  if (Array.isArray(input)) {
    return input.map((item) => redactSecrets(item, depth + 1));
  }

  if (isPlainObject(input)) {
    const out: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(input)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        out[key] = REDACTED;
      } else {
        out[key] = redactSecrets(value, depth + 1);
      }
    }

    return out;
  }

  return input;
}
