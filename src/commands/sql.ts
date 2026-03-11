import { Command } from 'commander';
import { readFileSync } from 'fs';
import { getConfig, resolveServer, DEFAULT_MAX_ROWS } from '../config/store';
import { createClient } from '../db/client';

// Keywords that indicate a data-modifying or DDL statement.
// Checked after stripping comments and string/identifier literals.
const READONLY_BLOCKLIST: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bINSERT\b/i, label: 'INSERT' },
  { pattern: /\bUPDATE\b/i, label: 'UPDATE' },
  { pattern: /\bDELETE\b/i, label: 'DELETE' },
  { pattern: /\bDROP\b/i, label: 'DROP' },
  { pattern: /\bCREATE\b/i, label: 'CREATE' },
  { pattern: /\bALTER\b/i, label: 'ALTER' },
  { pattern: /\bTRUNCATE\b/i, label: 'TRUNCATE' },
  { pattern: /\bMERGE\b/i, label: 'MERGE' },
  { pattern: /\bEXEC(?:UTE)?\b/i, label: 'EXEC/EXECUTE' },
  { pattern: /\bGRANT\b/i, label: 'GRANT' },
  { pattern: /\bREVOKE\b/i, label: 'REVOKE' },
  { pattern: /\bDENY\b/i, label: 'DENY' },
  { pattern: /\bBULK\s+INSERT\b/i, label: 'BULK INSERT' },
  { pattern: /\bXP_\w+\b/i, label: 'extended stored procedure (xp_)' },
  { pattern: /\bSP_EXECUTESQL\b/i, label: 'sp_executesql' },
];

/**
 * Strip comments and quoted literals so that keyword detection
 * doesn't false-positive on identifiers or string values.
 */
function stripForSafetyCheck(sqlStr: string): string {
  let s = sqlStr;
  // Remove line comments (-- ...)
  s = s.replace(/--[^\n]*/g, ' ');
  // Remove block comments (/* ... */)
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ');
  // Remove single-quoted string literals, including unicode N'...' and escaped quotes ('')
  s = s.replace(/N?'(?:[^']|'')*'/g, "''");
  // Remove bracket-quoted identifiers e.g. [DELETE], [UPDATE]
  s = s.replace(/\[[^\]]*\]/g, 'identifier');
  // Remove double-quoted identifiers e.g. "DELETE"
  s = s.replace(/"[^"]*"/g, 'identifier');
  return s;
}

export function checkReadOnly(sqlStr: string): { safe: boolean; reason?: string } {
  const stripped = stripForSafetyCheck(sqlStr);
  for (const { pattern, label } of READONLY_BLOCKLIST) {
    if (pattern.test(stripped)) {
      return {
        safe: false,
        reason: `Detected potentially modifying keyword: ${label}. Use 'mssql sql-dangerous' to run data-modifying or DDL queries.`,
      };
    }
  }
  return { safe: true };
}

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

export function registerSql(program: Command): void {
  program
    .command('sql')
    .description('Run a read-only SQL query (SELECT, CTEs, etc.) — modifying statements are blocked')
    .option('--query <sql>', 'SQL query to execute (inline)')
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

      const check = checkReadOnly(sql);
      if (!check.safe) {
        process.stderr.write(JSON.stringify({ error: check.reason }) + '\n');
        process.exit(1);
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
        const rows = result.recordset;
        const totalRows = rows.length;
        const truncated = totalRows > maxRows;
        const displayRows = truncated ? rows.slice(0, maxRows) : rows;

        if (opts.format === 'text') {
          if (displayRows.length === 0) {
            console.log('(0 rows returned)');
          } else {
            printTable(displayRows);
            console.log('');
            if (truncated) {
              console.log(
                `WARNING: Showing ${maxRows} of ${totalRows} rows (truncated). Refine your query with WHERE/TOP to reduce results.`
              );
            } else {
              console.log(`(${totalRows} row${totalRows !== 1 ? 's' : ''})`);
            }
          }
        } else {
          const output: Record<string, unknown> = {
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
