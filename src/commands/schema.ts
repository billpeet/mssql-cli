import { Command } from 'commander';
import { getConfig, resolveServer } from '../config/store';
import { createClient, MssqlClient } from '../db/client';
import {
  TableSchema,
  ColumnInfo,
  ForeignKeyInfo,
  ReferencedByInfo,
  IndexInfo,
} from '../db/types';

function parseTableRef(tableRef: string): { schema: string; table: string } {
  // Support "schema.table" notation; default schema is dbo
  const dotIndex = tableRef.indexOf('.');
  if (dotIndex !== -1) {
    return {
      schema: tableRef.slice(0, dotIndex),
      table: tableRef.slice(dotIndex + 1),
    };
  }
  return { schema: 'dbo', table: tableRef };
}

async function getTableSchema(
  client: MssqlClient,
  schema: string,
  tableName: string
): Promise<TableSchema> {
  const params = { schema, tableName };

  // Columns
  const colResult = await client.queryWithParams(
    `SELECT
       COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION,
       NUMERIC_SCALE, IS_NULLABLE, COLUMN_DEFAULT, ORDINAL_POSITION
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @tableName
     ORDER BY ORDINAL_POSITION`,
    params
  );

  if (colResult.recordset.length === 0) {
    throw new Error(`Table "${schema}.${tableName}" not found or has no columns.`);
  }

  const columns: ColumnInfo[] = colResult.recordset.map((r) => ({
    name: r['COLUMN_NAME'] as string,
    dataType: r['DATA_TYPE'] as string,
    maxLength: r['CHARACTER_MAXIMUM_LENGTH'] as number | null,
    precision: r['NUMERIC_PRECISION'] as number | null,
    scale: r['NUMERIC_SCALE'] as number | null,
    isNullable: r['IS_NULLABLE'] === 'YES',
    defaultValue: r['COLUMN_DEFAULT'] as string | null,
    ordinalPosition: r['ORDINAL_POSITION'] as number,
  }));

  // Primary keys
  const pkResult = await client.queryWithParams(
    `SELECT kcu.COLUMN_NAME
     FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
     JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
       ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
       AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
     WHERE tc.TABLE_SCHEMA = @schema AND tc.TABLE_NAME = @tableName
       AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
     ORDER BY kcu.ORDINAL_POSITION`,
    params
  );
  const primaryKeys: string[] = pkResult.recordset.map((r) => r['COLUMN_NAME'] as string);

  // Foreign keys — outgoing (this table → other tables)
  const fkResult = await client.queryWithParams(
    `SELECT
       kcu.COLUMN_NAME,
       kcu2.TABLE_SCHEMA AS REFERENCED_SCHEMA,
       kcu2.TABLE_NAME   AS REFERENCED_TABLE,
       kcu2.COLUMN_NAME  AS REFERENCED_COLUMN,
       rc.CONSTRAINT_NAME
     FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
     JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
       ON rc.CONSTRAINT_NAME   = kcu.CONSTRAINT_NAME
       AND kcu.TABLE_SCHEMA    = rc.CONSTRAINT_SCHEMA
     JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu2
       ON rc.UNIQUE_CONSTRAINT_NAME = kcu2.CONSTRAINT_NAME
       AND kcu2.TABLE_SCHEMA        = rc.UNIQUE_CONSTRAINT_SCHEMA
     WHERE kcu.TABLE_SCHEMA = @schema AND kcu.TABLE_NAME = @tableName
     ORDER BY kcu.COLUMN_NAME`,
    params
  );
  const foreignKeys: ForeignKeyInfo[] = fkResult.recordset.map((r) => ({
    columnName: r['COLUMN_NAME'] as string,
    referencedSchema: r['REFERENCED_SCHEMA'] as string,
    referencedTable: r['REFERENCED_TABLE'] as string,
    referencedColumn: r['REFERENCED_COLUMN'] as string,
    constraintName: r['CONSTRAINT_NAME'] as string,
  }));

  // Referenced by — incoming (other tables → this table)
  const refByResult = await client.queryWithParams(
    `SELECT
       kcu.TABLE_SCHEMA  AS REFERENCING_SCHEMA,
       kcu.TABLE_NAME    AS REFERENCING_TABLE,
       kcu.COLUMN_NAME   AS REFERENCING_COLUMN,
       kcu2.COLUMN_NAME  AS REFERENCED_COLUMN,
       rc.CONSTRAINT_NAME
     FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
     JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
       ON rc.CONSTRAINT_NAME   = kcu.CONSTRAINT_NAME
       AND kcu.TABLE_SCHEMA    = rc.CONSTRAINT_SCHEMA
     JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu2
       ON rc.UNIQUE_CONSTRAINT_NAME = kcu2.CONSTRAINT_NAME
       AND kcu2.TABLE_SCHEMA        = rc.UNIQUE_CONSTRAINT_SCHEMA
     WHERE kcu2.TABLE_SCHEMA = @schema AND kcu2.TABLE_NAME = @tableName
     ORDER BY kcu.TABLE_NAME, kcu.COLUMN_NAME`,
    params
  );
  const referencedBy: ReferencedByInfo[] = refByResult.recordset.map((r) => ({
    referencingSchema: r['REFERENCING_SCHEMA'] as string,
    referencingTable: r['REFERENCING_TABLE'] as string,
    referencingColumn: r['REFERENCING_COLUMN'] as string,
    referencedColumn: r['REFERENCED_COLUMN'] as string,
    constraintName: r['CONSTRAINT_NAME'] as string,
  }));

  // Indexes (sys catalog views give richer detail than INFORMATION_SCHEMA)
  const idxResult = await client.queryWithParams(
    `SELECT
       i.name                                      AS INDEX_NAME,
       i.type_desc                                 AS INDEX_TYPE,
       CAST(i.is_unique      AS INT)               AS IS_UNIQUE,
       CAST(i.is_primary_key AS INT)               AS IS_PRIMARY_KEY,
       COL_NAME(ic.object_id, ic.column_id)        AS COLUMN_NAME,
       ic.key_ordinal                              AS KEY_ORDINAL
     FROM sys.indexes       i
     JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
     JOIN sys.tables        t  ON i.object_id = t.object_id
     JOIN sys.schemas       s  ON t.schema_id = s.schema_id
     WHERE t.name = @tableName AND s.name = @schema
       AND ic.is_included_column = 0
     ORDER BY i.name, ic.key_ordinal`,
    params
  );

  // Group columns by index name
  const indexMap = new Map<string, IndexInfo>();
  for (const r of idxResult.recordset) {
    const indexName = r['INDEX_NAME'] as string;
    if (!indexMap.has(indexName)) {
      indexMap.set(indexName, {
        indexName,
        indexType: r['INDEX_TYPE'] as string,
        isUnique: Boolean(r['IS_UNIQUE']),
        isPrimaryKey: Boolean(r['IS_PRIMARY_KEY']),
        columns: [],
      });
    }
    indexMap.get(indexName)!.columns.push(r['COLUMN_NAME'] as string);
  }
  const indexes: IndexInfo[] = Array.from(indexMap.values());

  return { tableName, schema, columns, primaryKeys, foreignKeys, referencedBy, indexes };
}

function formatDataType(col: ColumnInfo): string {
  if (col.maxLength !== null) return `${col.dataType}(${col.maxLength === -1 ? 'MAX' : col.maxLength})`;
  if (col.precision !== null && col.scale !== null) return `${col.dataType}(${col.precision},${col.scale})`;
  return col.dataType;
}

function printTableSchema(ts: TableSchema): void {
  console.log(`\n## ${ts.schema}.${ts.tableName}\n`);

  // Columns table
  const colHeaders = ['Column', 'Type', 'Nullable', 'Default', 'PK'];
  const colRows = ts.columns.map((c) => [
    c.name,
    formatDataType(c),
    c.isNullable ? 'YES' : 'NO',
    c.defaultValue ?? '',
    ts.primaryKeys.includes(c.name) ? 'PK' : '',
  ]);

  const widths = colHeaders.map((h, i) =>
    Math.max(h.length, ...colRows.map((r) => r[i].length))
  );
  console.log(colHeaders.map((h, i) => h.padEnd(widths[i])).join(' | '));
  console.log(widths.map((w) => '-'.repeat(w)).join('-+-'));
  for (const row of colRows) {
    console.log(row.map((v, i) => v.padEnd(widths[i])).join(' | '));
  }

  if (ts.foreignKeys.length > 0) {
    console.log('\n### Foreign Keys (this table → other tables)\n');
    for (const fk of ts.foreignKeys) {
      console.log(
        `  ${fk.columnName} → ${fk.referencedSchema}.${fk.referencedTable}.${fk.referencedColumn}` +
        `  [${fk.constraintName}]`
      );
    }
  }

  if (ts.referencedBy.length > 0) {
    console.log('\n### Referenced By (other tables → this table)\n');
    for (const ref of ts.referencedBy) {
      console.log(
        `  ${ref.referencingSchema}.${ref.referencingTable}.${ref.referencingColumn}` +
        ` → ${ref.referencedColumn}  [${ref.constraintName}]`
      );
    }
  }

  if (ts.indexes.length > 0) {
    console.log('\n### Indexes\n');
    for (const idx of ts.indexes) {
      const flags = [
        idx.isPrimaryKey ? 'PK' : null,
        idx.isUnique && !idx.isPrimaryKey ? 'UNIQUE' : null,
        idx.indexType,
      ]
        .filter(Boolean)
        .join(', ');
      console.log(`  ${idx.indexName}: [${idx.columns.join(', ')}]  (${flags})`);
    }
  }
}

export function registerSchema(program: Command): void {
  program
    .command('schema')
    .description(
      'Get full schema for one or more tables: columns, types, PKs, foreign keys, indexes'
    )
    .argument('<tables...>', 'Table name(s) to inspect — e.g. Users  dbo.Orders  hr.Employees')
    .option('--server <name>', 'Server alias to use (default: configured default server)')
    .option('--format <format>', 'Output format: json or text', 'json')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (tables: string[], opts) => {
      const config = getConfig();
      const { name, serverConfig } = resolveServer(opts, config);

      let client;
      try {
        client = await createClient(serverConfig);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          JSON.stringify({ error: 'Connection failed', server: name, details: message }) + '\n'
        );
        process.exit(1);
      }

      const results: TableSchema[] = [];
      const errors: Array<{ table: string; error: string }> = [];

      try {
        for (const tableRef of tables) {
          const { schema, table } = parseTableRef(tableRef);
          try {
            const tableSchema = await getTableSchema(client, schema, table);
            results.push(tableSchema);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            errors.push({ table: tableRef, error: message });
          }
        }
      } finally {
        await client.close();
      }

      if (opts.format === 'text') {
        for (const ts of results) {
          printTableSchema(ts);
        }
        if (errors.length > 0) {
          console.log('\n### Errors\n');
          for (const e of errors) {
            console.log(`  ${e.table}: ${e.error}`);
          }
        }
      } else {
        console.log(
          JSON.stringify(
            { tables: results, errors: errors.length > 0 ? errors : undefined },
            null,
            opts.pretty ? 2 : undefined
          )
        );
      }
    });
}
