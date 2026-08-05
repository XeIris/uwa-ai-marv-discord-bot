import type { TableDefinition } from '../types';

export interface ServerConfigRow {
  id: number;
  server_id: string;
  key: string;
  value: string;
}

const serverConfigTable: TableDefinition = {
  name: 'ServerConfig',
  columns: [
    { name: 'id', type: 'INTEGER PRIMARY KEY AUTOINCREMENT' },
    { name: 'server_id', type: 'VARCHAR NOT NULL' },
    { name: 'key', type: 'TEXT NOT NULL' },
    { name: 'value', type: 'TEXT NOT NULL' },
  ],
  primaryKey: ['id'],
  specialConstraints: [],
  constraints: [
    'UNIQUE (server_id, key)',
  ],
};

export default serverConfigTable;
