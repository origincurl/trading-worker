// Kiwoom realtime time fields carry wall-clock without a date — `0B` field
// 20 is HHMMSS in KST. To get a Date we combine that wall-clock with a
// caller-supplied reference instant interpreted in Asia/Seoul.
//
// Day rollover / session boundary detection is intentionally out of scope —
// callers in collector pass `receivedAt` and let same-day arithmetic hold.

const KST_OFFSET_MIN = 9 * 60;

export function parseHhmmssToDate(hhmmss: unknown, referenceDate: Date): Date | null {
  if (typeof hhmmss !== 'string') return null;

  const trimmed = hhmmss.trim();

  if (!/^\d{6}$/.test(trimmed)) return null;

  const hh = Number(trimmed.slice(0, 2));
  const mm = Number(trimmed.slice(2, 4));
  const ss = Number(trimmed.slice(4, 6));

  if (hh > 23 || mm > 59 || ss > 59) return null;

  const refUtcMs = referenceDate.getTime();

  if (!Number.isFinite(refUtcMs)) return null;

  const kstMs = refUtcMs + KST_OFFSET_MIN * 60_000;
  const kstYmd = new Date(kstMs);
  const y = kstYmd.getUTCFullYear();
  const m = kstYmd.getUTCMonth();
  const d = kstYmd.getUTCDate();
  const utcMs = Date.UTC(y, m, d, hh, mm, ss) - KST_OFFSET_MIN * 60_000;

  return new Date(utcMs);
}
