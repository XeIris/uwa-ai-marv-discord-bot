import type { TableDefinition } from '../types';

export interface AiUsageRow {
  id: number;
  user_id: string;
  model: string;
  tokens_prompt: number;
  tokens_completion: number;
  cost: number;
  created_at: string;
}

const aiUsageTable: TableDefinition = {
  name: 'AiUsage',
  columns: [
    { name: 'id', type: 'INTEGER PRIMARY KEY AUTOINCREMENT' },
    { name: 'user_id', type: 'TEXT NOT NULL' },
    { name: 'model', type: 'TEXT NOT NULL' },
    { name: 'tokens_prompt', type: 'INTEGER NOT NULL' },
    { name: 'tokens_completion', type: 'INTEGER NOT NULL' },
    { name: 'cost', type: 'REAL NOT NULL DEFAULT 0' },
    { name: 'created_at', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
  ],
  primaryKey: ['id'],
  specialConstraints: [],
  constraints: [],
};

export default aiUsageTable;
