import type { TableDefinition } from '../types';

export interface AiConsentRow {
  user_id: string;
  policy_version: number;
  accepted_at: string;
}

/**
 * Per-user acknowledgement of the AI data notice (see utils/aiConsent.ts).
 *
 * One row per user, written the first time they accept and rewritten when the
 * notice's version is bumped — `policy_version` is what makes a reworded notice
 * re-prompt everyone instead of silently riding on an old acceptance. Absence of
 * a row is the default: no consent, no generation.
 *
 * Deliberately keyed by user and not by guild. The thing being consented to is
 * "your text leaves this bot and goes to a third-party model", which is true in
 * every guild and in DMs alike.
 */
const aiConsentTable: TableDefinition = {
  name: 'AiConsent',
  columns: [
    { name: 'user_id', type: 'TEXT PRIMARY KEY' },
    { name: 'policy_version', type: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'accepted_at', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
  ],
  primaryKey: ['user_id'],
  specialConstraints: [],
  constraints: [],
};

export default aiConsentTable;
