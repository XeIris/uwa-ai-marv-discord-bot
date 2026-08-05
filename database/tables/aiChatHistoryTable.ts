import type { TableDefinition } from '../types';

export interface AiChatHistoryRow {
  id: number;
  session_id: number;
  role: 'user' | 'model' | 'assistant' | 'tool';
  message: string;
  timestamp: string;
}

const aiChatHistoryTable: TableDefinition = {
  name: 'AiChatHistory',
  columns: [
    { name: 'id', type: 'INTEGER PRIMARY KEY AUTOINCREMENT' },
    { name: 'session_id', type: 'INTEGER NOT NULL' },
    { name: 'role', type: "TEXT CHECK(role IN ('user', 'model', 'assistant', 'tool')) NOT NULL" },
    { name: 'message', type: 'TEXT NOT NULL' },
    { name: 'timestamp', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
  ],
  primaryKey: ['id'],
  specialConstraints: [],
  constraints: [
    'FOREIGN KEY (session_id) REFERENCES AiChatSession(session_id)',
  ],
};

export default aiChatHistoryTable;
