import { Command } from 'commander';
import { readFileSync } from 'fs';
import { getConfig, resolveServer, DEFAULT_MAX_ROWS } from '../config/store';
import { createClient } from '../db/client';

function printTable(rows: Record<string, unknown>[]): void {
  if (rows.length === 0) return;
  const keys = Object.keys(rows[0]);
  const widths = keys.map((k) =>
    Math.max(k.length, ...rows.map((r) => String(r[k] ?? 'NULL').length))
  );
  const header = keys.map((k, i) => k.padEnd(widths[i])).join(' | ');
  const divider = widths.map((w) => '-'.repeat(w)).join('-+-');
  console.log(header);
  console.log(divider);
  for (const row of rows) {
    console.log(keys.map((k, i) => String(row[k] ?? 'NULL').padEnd(widths[i])).join(' | '));
  }
}

export function registerSqlDangerous(program: Command): void {
  program
    .command('sql-dangerous')
    .description(
      'Run a SQL command that may modify data or schema (INSERT, UPDATE, DELETE, DROP, CREATE, etc.) — USE WITH CAUTION'
    )
    .option('--query <sql>', 'SQL query or statement to execute (inline)')
    .option('--file <path>', 'Path to a .sql file to execute')
    .option('--server <name>', 'Server alias to use (default: configured default server)')
    .option('--format <format>', 'Output format: json or text', 'json')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts) => {
      if (!opts.query && !opts.file) {
        process.stderr.write(JSON.stringify({ error: 'Either --query or --file is required.' }) + '\n');
        process.exit(1);
      }
      if (opts.query && opts.file) {
        process.stderr.write(JSON.stringify({ error: 'Specify either --query or --file, not both.' }) + '\n');
        process.exit(1);
      }

      let sql: string;
      if (opts.file) {
        try {
          sql = readFileSync(opts.file, 'utf8');
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          process.stderr.write(JSON.stringify({ error: 'Failed to read SQL file', details: message }) + '\n');
          process.exit(1);
        }
      } else {
        sql = opts.query;
      }

      const config = getConfig();
      const { name, serverConfig } = resolveServer(opts, config);
      const maxRows = config.maxRows ?? DEFAULT_MAX_ROWS;

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

      try {
        const result = await client.query(sql);
        const rows = result.recordset ?? [];
        const totalRows = rows.length;
        const truncated = totalRows > maxRows;
        const displayRows = truncated ? rows.slice(0, maxRows) : rows;
        const rowsAffected = result.rowsAffected.reduce((a, b) => a + b, 0);

        if (opts.format === 'text') {
          if (rowsAffected > 0) {
            console.log(`Rows affected: ${rowsAffected}`);
          }
          if (displayRows.length > 0) {
            console.log('');
            printTable(displayRows);
            console.log('');
            if (truncated) {
              console.log(
              `WARNING: Showing ${maxRows} of ${totalRows} rows (truncated). Refine your query with WHERE/TOP to reduce results.`
              );
            } else {
              console.log(`(${totalRows} row${totalRows !== 1 ? 's' : ''})`);
            }
          } else if (rowsAffected === 0) {
            console.log('(statement completed, 0 rows affected)');
          }
        } else {
          const output: Record<string, unknown> = {
            rowsAffected,
            rows: displayRows,
            rowCount: displayRows.length,
          };
          if (truncated) {
            output.truncated = true;
            output.totalRows = totalRows;
            output.message =
              `Results truncated: showing ${maxRows} of ${totalRows} rows. Refine your query with WHERE/TOP to reduce results.`;
          }
          console.log(JSON.stringify(output, null, opts.pretty ? 2 : undefined));
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(JSON.stringify({ error: 'Query failed', details: message }) + '\n');
        process.exit(1);
      } finally {
        await client.close();
      }
    });
}
