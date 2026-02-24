export interface QueryResult {
  recordset: Record<string, unknown>[];
  rowsAffected: number[];
  recordsets: Record<string, unknown>[][];
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  maxLength: number | null;
  precision: number | null;
  scale: number | null;
  isNullable: boolean;
  defaultValue: string | null;
  ordinalPosition: number;
}

export interface ForeignKeyInfo {
  columnName: string;
  referencedSchema: string;
  referencedTable: string;
  referencedColumn: string;
  constraintName: string;
}

export interface ReferencedByInfo {
  referencingSchema: string;
  referencingTable: string;
  referencingColumn: string;
  referencedColumn: string;
  constraintName: string;
}

export interface IndexInfo {
  indexName: string;
  indexType: string;
  isUnique: boolean;
  isPrimaryKey: boolean;
  columns: string[];
}

export interface TableSchema {
  tableName: string;
  schema: string;
  columns: ColumnInfo[];
  primaryKeys: string[];
  foreignKeys: ForeignKeyInfo[];
  referencedBy: ReferencedByInfo[];
  indexes: IndexInfo[];
}
