import type { TableDefinition } from '../types';

export interface AiChatSessionRow {
  session_id: number;
  user_id: string;
  persona_name: string;
  active: number;
  created_at: string;
  title: string | null;
  // 'discord' for sessions started by the bot, 'web' for sessions started by
  // the /games/ai-slop UI. Keeps the two surfaces from clobbering each other
  // (web never sets active=1, so it can't collide with the bot's per-persona
  // active-session unique index).
  source: string;
  // 1 once the content-safety screen (utils/aiModeration.ts) rejected a turn in
  // this session. Permanently pauses it — the session stays active/visible so
  // the user still sees their history, but no further turns are generated.
  moderation_flagged: number;
  /** Comma-separated safety categories from the screen, when it reported any. */
  moderation_categories: string | null;
}

const aiChatSessionTable: TableDefinition = {
  name: 'AiChatSession',
  columns: [
    { name: 'session_id', type: 'INTEGER PRIMARY KEY AUTOINCREMENT' },
    { name: 'user_id', type: 'VARCHAR NOT NULL' },
    { name: 'persona_name', type: 'VARCHAR NOT NULL' },
    { name: 'active', type: 'INTEGER DEFAULT 1' },
    { name: 'created_at', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
    { name: 'title', type: 'TEXT DEFAULT NULL' },
    { name: 'source', type: "TEXT NOT NULL DEFAULT 'discord'" },
    { name: 'moderation_flagged', type: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'moderation_categories', type: 'TEXT DEFAULT NULL' },
  ],
  primaryKey: ['session_id'],
  specialConstraints: [],
  // No FK on user_id: this fork has no User table (it was stripped with the
  // games/economy system). The inherited `REFERENCES User(id)` made every
  // INSERT fail at prepare time with "no such table: main.User" once
  // PRAGMA foreign_keys = ON. Database.init() rebuilds older tables that
  // still carry it.
  constraints: [],
};

export default aiChatSessionTable;
