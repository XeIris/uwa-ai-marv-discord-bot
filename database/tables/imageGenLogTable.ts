import type { TableDefinition } from '../types';

export interface ImageGenLogRow {
  id: number;
  user_id: string;
  prompt: string;
  model: string | null;
  success: number;
  created_at: string;
}

const imageGenLogTable: TableDefinition = {
  name: 'ImageGenLog',
  columns: [
    { name: 'id', type: 'INTEGER PRIMARY KEY AUTOINCREMENT' },
    { name: 'user_id', type: 'TEXT NOT NULL' },
    { name: 'prompt', type: 'TEXT NOT NULL' },
    { name: 'model', type: 'TEXT' },
    { name: 'success', type: 'INTEGER NOT NULL DEFAULT 1' },
    { name: 'created_at', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
  ],
  primaryKey: ['id'],
  specialConstraints: [],
  constraints: [],
};

export default imageGenLogTable;
