import type { TableDefinition } from '../types';

export interface GlobalConfigRow {
  id: number;
  key: string;
  value: string;
}

const globalConfigTable: TableDefinition = {
  name: 'GlobalConfig',
  columns: [
    { name: 'id', type: 'INTEGER PRIMARY KEY AUTOINCREMENT' },
    { name: 'key', type: 'TEXT NOT NULL' },
    { name: 'value', type: 'TEXT NOT NULL' },
  ],
  primaryKey: ['id'],
  specialConstraints: [],
  constraints: [
    'UNIQUE (key)',
  ],
};

export default globalConfigTable;
