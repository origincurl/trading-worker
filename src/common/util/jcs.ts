// RFC 8785 — JSON Canonicalization Scheme (JCS).
// Used to produce a deterministic byte representation of a JSON value
// before HMAC signing, so signer and verifier agree on the payload bytes
// regardless of key order or whitespace.

function canonicalNumber(n: number): string {
  if (!Number.isFinite(n)) {
    throw new Error('JCS: non-finite numbers are not allowed');
  }

  if (n === 0) return '0';

  // RFC 8785 references ECMAScript ToString for numbers, which JSON.stringify
  // already implements for finite numbers.
  return JSON.stringify(n);
}

function canonicalString(s: string): string {
  // JSON.stringify already escapes per RFC 8259; that matches JCS for strings.
  return JSON.stringify(s);
}

function canonicalize(value: unknown): string {
  if (value === null) return 'null';

  if (typeof value === 'boolean') return value ? 'true' : 'false';

  if (typeof value === 'number') return canonicalNumber(value);

  if (typeof value === 'string') return canonicalString(value);

  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();

    const members = keys.map((k) => canonicalString(k) + ':' + canonicalize(obj[k]));

    return '{' + members.join(',') + '}';
  }

  throw new Error(`JCS: unsupported value type: ${typeof value}`);
}

export function jcsStringify(value: unknown): string {
  return canonicalize(value);
}
