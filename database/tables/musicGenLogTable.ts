import type { TableDefinition } from '../types';

export interface MusicGenLogRow {
  id: number;
  user_id: string;
  title: string;
  success: number;
  created_at: string;
}

const musicGenLogTable: TableDefinition = {
  name: 'MusicGenLog',
  columns: [
    { name: 'id', type: 'INTEGER PRIMARY KEY AUTOINCREMENT' },
    { name: 'user_id', type: 'TEXT NOT NULL' },
    { name: 'title', type: 'TEXT NOT NULL' },
    { name: 'success', type: 'INTEGER NOT NULL DEFAULT 1' },
    { name: 'created_at', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
  ],
  primaryKey: ['id'],
  specialConstraints: [],
  constraints: [],
};

export default musicGenLogTable;
