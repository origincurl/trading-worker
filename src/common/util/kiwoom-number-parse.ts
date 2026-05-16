// Kiwoom realtime FID values arrive as sign-prefixed strings (`+72500`,
// `-1500`). Empty/whitespace strings are valid no-data markers.
// Realtime tables do not use thousands separators, but a few REST FIDs do —
// we accept commas only as strict thousands grouping. Anything that fails
// to coerce returns `null`; the caller decides whether the missing field is
// soft (drop into the event) or dead-letter material.

const PLAIN_NUMBER = /^[+-]?\d+(?:\.\d+)?$/;
const GROUPED_NUMBER = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;

export function parseSignedNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== 'string') return null;

  const trimmed = value.trim();

  if (trimmed.length === 0) return null;

  let normalized: string;

  if (trimmed.includes(',')) {
    if (!GROUPED_NUMBER.test(trimmed)) return null;

    normalized = trimmed.replace(/,/g, '');
  } else {
    if (!PLAIN_NUMBER.test(trimmed)) return null;

    normalized = trimmed;
  }

  const n = Number(normalized);

  return Number.isFinite(n) ? n : null;
}

export function parseSignedInteger(value: unknown): number | null {
  const n = parseSignedNumber(value);

  if (n === null) return null;

  if (!Number.isInteger(n)) return null;

  return n;
}
