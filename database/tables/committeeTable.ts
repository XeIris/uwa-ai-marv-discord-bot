import type { TableDefinition } from '../types';

export interface CommitteeRow {
  id: number;
  server_id: string;
  user_id: string;
  title: string;
  display_name: string | null;
  is_executive: number;
  sort_order: number;
  updated_at: string;
}

// Uniqueness is on (server, user, title) rather than (server, user): one title can
// be held by two people (Tech Leads) and one person can hold two titles.
const committeeTable: TableDefinition = {
  name: 'Committee',
  columns: [
    { name: 'id', type: 'INTEGER PRIMARY KEY AUTOINCREMENT' },
    { name: 'server_id', type: 'TEXT NOT NULL' },
    { name: 'user_id', type: 'TEXT NOT NULL' },
    { name: 'title', type: 'TEXT NOT NULL' },
    { name: 'display_name', type: 'TEXT' },
    { name: 'is_executive', type: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'sort_order', type: 'INTEGER NOT NULL DEFAULT 100' },
    { name: 'updated_at', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
  ],
  primaryKey: ['id'],
  specialConstraints: [],
  constraints: ['UNIQUE (server_id, user_id, title)'],
};

export default committeeTable;
