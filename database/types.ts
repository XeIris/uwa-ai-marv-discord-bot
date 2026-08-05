export interface ColumnDefinition {
  name: string;
  type: string;
}

export interface TableDefinition {
  name: string;
  columns: ColumnDefinition[];
  primaryKey: string[];
  specialConstraints: string[];
  constraints: string[];
}

export interface QueryResult {
  changes: number;
  lastID: number | null;
}
