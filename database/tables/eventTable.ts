import type { TableDefinition } from '../types';

export interface EventRow {
  id: number;
  server_id: string;
  name: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  url: string | null;
  created_by: string | null;
  created_at: string;
}

// starts_at / ends_at are ISO-8601 UTC strings. Operators enter Perth local time;
// conversion happens at the command boundary (utils/clubInfo.parsePerthDateTime).
const eventTable: TableDefinition = {
  name: 'Event',
  columns: [
    { name: 'id', type: 'INTEGER PRIMARY KEY AUTOINCREMENT' },
    { name: 'server_id', type: 'TEXT NOT NULL' },
    { name: 'name', type: 'TEXT NOT NULL' },
    { name: 'description', type: 'TEXT' },
    { name: 'starts_at', type: 'TEXT NOT NULL' },
    { name: 'ends_at', type: 'TEXT' },
    { name: 'location', type: 'TEXT' },
    { name: 'url', type: 'TEXT' },
    { name: 'created_by', type: 'TEXT' },
    { name: 'created_at', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
  ],
  primaryKey: ['id'],
  specialConstraints: [],
  constraints: [],
};

export default eventTable;
