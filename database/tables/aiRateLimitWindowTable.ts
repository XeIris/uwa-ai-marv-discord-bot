import type { TableDefinition } from '../types';

export interface AiRateLimitWindowRow {
  id: number;
  user_id: string;
  /** 'daily' | 'weekly' — one fixed window per type per user. */
  window_type: string;
  /** SQLite datetime (UTC) when the current window opened (its first message). */
  window_start: string;
  /** Credits accumulated in the current window (see utils/aiPricing.ts). */
  tokens: number;
}

/**
 * Backs the fixed-window (Claude-style) AI rate limit: a window opens on the
 * first message after the previous one lapsed and resets wholesale one interval
 * later, so a stored counter — not a trailing sum of the AiUsage log — drives
 * enforcement. One row per (user, window_type); the AiUsage table remains the
 * immutable per-call audit log.
 */
const aiRateLimitWindowTable: TableDefinition = {
  name: 'AiRateLimitWindow',
  columns: [
    { name: 'id', type: 'INTEGER PRIMARY KEY AUTOINCREMENT' },
    { name: 'user_id', type: 'TEXT NOT NULL' },
    { name: 'window_type', type: 'TEXT NOT NULL' },
    { name: 'window_start', type: 'TIMESTAMP NOT NULL' },
    // Column name predates credit metering (issue #211) — it now holds CREDITS,
    // not raw tokens. Left as-is to avoid a table rebuild.
    { name: 'tokens', type: 'INTEGER NOT NULL DEFAULT 0' },
  ],
  primaryKey: ['id'],
  specialConstraints: [],
  constraints: [
    // Enables the ON CONFLICT upsert in UPSERT_WINDOW.
    'UNIQUE (user_id, window_type)',
  ],
};

export default aiRateLimitWindowTable;
