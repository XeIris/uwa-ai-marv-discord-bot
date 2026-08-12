/**
 * Perth (AWST) time helpers. Operators type Perth local time; storage is UTC.
 *
 * These live in their own module rather than in utils/clubInfo.ts so that both
 * clubInfo and utils/referenceSheets.ts can use them without an import cycle.
 * clubInfo re-exports everything here, so existing `from './clubInfo'` imports
 * keep working.
 */

/** Australia/Perth is AWST, UTC+8 year-round — no DST, so a fixed offset is correct. */
export const PERTH_UTC_OFFSET_MINUTES = 8 * 60;

export const TIME_FORMAT_HINT = 'Times are Perth local time in `YYYY-MM-DD HH:MM` format (24-hour), '
  + 'e.g. `2026-08-20 18:00`.';

/**
 * Parses `YYYY-MM-DD HH:MM` (or `YYYY-MM-DDTHH:MM`) as Perth local time and returns
 * the equivalent UTC Date. Returns null for anything malformed or out of range —
 * callers must reject rather than coerce.
 */
export function parsePerthDateTime(input: string): Date | null {
  if (typeof input !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(input.trim());
  if (!match) return null;

  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number);
  if (![year, month, day, hour, minute].every(Number.isInteger)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59) return null;

  const utcMs = Date.UTC(year, month - 1, day, hour, minute) - PERTH_UTC_OFFSET_MINUTES * 60_000;
  const date = new Date(utcMs);
  if (Number.isNaN(date.getTime())) return null;

  // Date.UTC rolls 2026-02-30 over into March — reject instead of silently shifting.
  const roundTrip = new Date(utcMs + PERTH_UTC_OFFSET_MINUTES * 60_000);
  if (roundTrip.getUTCFullYear() !== year
    || roundTrip.getUTCMonth() !== month - 1
    || roundTrip.getUTCDate() !== day) {
    return null;
  }

  return date;
}

/** Today's date in Perth as `YYYY-MM-DD`. */
export function perthDateString(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + PERTH_UTC_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** The current calendar year in Perth. */
export function perthYear(now: Date = new Date()): number {
  const shifted = new Date(now.getTime() + PERTH_UTC_OFFSET_MINUTES * 60_000);
  return shifted.getUTCFullYear();
}

/** Perth local `YYYY-MM-DD HH:MM` for an ISO-8601 UTC string (used in autocomplete labels). */
export function formatPerthDateTime(isoUtc: string): string {
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return isoUtc;
  const shifted = new Date(date.getTime() + PERTH_UTC_OFFSET_MINUTES * 60_000);
  return `${shifted.toISOString().slice(0, 10)} ${shifted.toISOString().slice(11, 16)}`;
}

/** Discord timestamp markup, so every reader sees the time in their own timezone. */
export function discordTimestamp(isoUtc: string, style: 'F' | 'R' = 'F'): string {
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return isoUtc;
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}
