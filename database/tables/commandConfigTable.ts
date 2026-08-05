import type { TableDefinition } from '../types';

export interface CommandConfigRow {
  id: number;
  command_name: string;
  server_id: string;
  disabled_date: string;
  reason: string | null;
}

const commandConfigTable: TableDefinition = {
  name: 'CommandConfig',
  columns: [
    { name: 'id', type: 'INTEGER PRIMARY KEY AUTOINCREMENT' },
    { name: 'command_name', type: 'TEXT NOT NULL' },
    { name: 'server_id', type: 'VARCHAR NOT NULL' },
    { name: 'disabled_date', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
    { name: 'reason', type: 'TEXT' },
  ],
  primaryKey: ['id'],
  specialConstraints: [],
  constraints: [
    'UNIQUE (command_name, server_id)',
  ],
};

export default commandConfigTable;
