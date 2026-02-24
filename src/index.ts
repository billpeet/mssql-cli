import { Command } from 'commander';
import { registerServer } from './commands/server';
import { registerSql } from './commands/sql';
import { registerSqlDangerous } from './commands/sql-dangerous';
import { registerSchema } from './commands/schema';

const program = new Command();

program
  .name('mssql')
  .description('MSSQL CLI — AI-friendly interface for Microsoft SQL Server')
  .version('0.1.0');

registerServer(program);
registerSql(program);
registerSqlDangerous(program);
registerSchema(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(JSON.stringify({ error: message }) + '\n');
  process.exit(1);
});
