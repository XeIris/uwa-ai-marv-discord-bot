import type { TableDefinition } from '../types';

export interface AiToolPreferenceRow {
  user_id: string;
  tool: string;
  enabled: number;
  updated_at: string;
}

/**
 * Per-user on/off switches for the optional AI tools (see utils/aiTools.ts).
 *
 * The table stores **exceptions only**: every tool is on by default, so a
 * missing row means "on" and the only rows that exist are the ones a member has
 * deliberately turned off (or turned back on after turning off). That is the
 * inverse of the upstream project, which defaults everything off — here Marv's
 * usefulness to a club member is the point, and a tool nobody knows to enable
 * is a tool nobody uses.
 *
 * Deliberately keyed by user and not by guild: it is a personal preference about
 * how Marv behaves for you, and members move between the club's servers and DMs.
 *
 * `tool` is whitelisted against AI_TOOL_KEYS before it ever reaches SQL — the
 * column is free text so a retired tool's rows survive harmlessly, but nothing
 * outside that list can be written.
 */
const aiToolPreferenceTable: TableDefinition = {
  name: 'AiToolPreference',
  columns: [
    { name: 'user_id', type: 'TEXT NOT NULL' },
    { name: 'tool', type: 'TEXT NOT NULL' },
    { name: 'enabled', type: 'INTEGER NOT NULL DEFAULT 1' },
    { name: 'updated_at', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
  ],
  primaryKey: ['user_id', 'tool'],
  specialConstraints: ['PRIMARY KEY (user_id, tool)'],
  constraints: [],
};

export default aiToolPreferenceTable;
