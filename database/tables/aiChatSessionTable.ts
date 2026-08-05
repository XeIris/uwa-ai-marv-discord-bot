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
  ],
  primaryKey: ['session_id'],
  specialConstraints: [],
  constraints: [
    'FOREIGN KEY (user_id) REFERENCES User(id)',
  ],
};

export default aiChatSessionTable;
