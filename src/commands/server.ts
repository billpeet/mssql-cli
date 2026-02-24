import { Command } from 'commander';
import chalk from 'chalk';
import { Config, ServerConfig, getConfig, saveConfig, getConfigFilePath, DEFAULT_MAX_ROWS } from '../config/store';
import { testConnection } from '../db/client';

export function registerServer(program: Command): void {
  const server = program
    .command('server')
    .description('Manage MSSQL server configurations');

  // server add
  server
    .command('add')
    .description('Add or update a server configuration (tests connection before saving)')
    .requiredOption('--name <name>', 'Alias for this server (used in --server flag)')
    .requiredOption('--server <host>', 'SQL Server hostname or IP address')
    .requiredOption('--database <database>', 'Default database name')
    .option('--user <user>', 'SQL Server login username (omit for Windows auth)')
    .option('--password <password>', 'SQL Server login password')
    .option('--port <port>', 'Port number', '1433')
    .option('--encrypt', 'Enable TLS encryption (default: true)')
    .option('--no-encrypt', 'Disable TLS encryption')
    .option('--trust-cert', 'Trust self-signed server certificate (useful for local dev)')
    .option('--windows-auth', 'Use Windows Integrated Authentication instead of SQL login')
    .option('--format <format>', 'Output format: json or text', 'json')
    .action(async (opts) => {
      const serverConfig: ServerConfig = {
        server: opts.server,
        database: opts.database,
        port: parseInt(opts.port, 10),
        user: opts.user,
        password: opts.password,
        encrypt: opts.encrypt !== false,
        trustServerCertificate: opts.trustCert ?? false,
        windowsAuth: opts.windowsAuth ?? false,
      };

      const test = await testConnection(serverConfig);
      if (!test.success) {
        process.stderr.write(
          JSON.stringify({ error: 'Connection failed', details: test.error }) + '\n'
        );
        process.exit(1);
      }

      const config = getConfig();
      const isNew = !config.servers[opts.name];
      config.servers[opts.name] = serverConfig;

      // Auto-set as default if it's the first server
      if (!config.defaultServer || (isNew && Object.keys(config.servers).length === 1)) {
        config.defaultServer = opts.name;
      }

      saveConfig(config);

      const isDefault = config.defaultServer === opts.name;

      if (opts.format === 'text') {
        console.log(chalk.green(`✓ Server "${opts.name}" saved (${serverConfig.server}:${serverConfig.port}/${serverConfig.database})`));
        console.log(chalk.gray(`  ${test.version}`));
        if (isDefault) console.log(chalk.green(`✓ Set as default server`));
        console.log(chalk.gray(`  Config: ${getConfigFilePath()}`));
      } else {
        console.log(JSON.stringify({
          ok: true,
          name: opts.name,
          server: serverConfig.server,
          port: serverConfig.port,
          database: serverConfig.database,
          isDefault,
          version: test.version,
          configFile: getConfigFilePath(),
        }, null, 2));
      }
    });

  // server list
  server
    .command('list')
    .description('List all configured servers')
    .option('--format <format>', 'Output format: json or text', 'json')
    .action((opts) => {
      const config = getConfig();
      const servers = Object.entries(config.servers).map(([name, s]) => ({
        name,
        server: s.server,
        port: s.port ?? 1433,
        database: s.database,
        user: s.windowsAuth ? '(windows auth)' : (s.user ?? '(not set)'),
        encrypt: s.encrypt ?? true,
        trustServerCertificate: s.trustServerCertificate ?? false,
        windowsAuth: s.windowsAuth ?? false,
        isDefault: name === config.defaultServer,
      }));

      if (opts.format === 'text') {
        if (servers.length === 0) {
          console.log('No servers configured. Use: mssql server add --name <alias> --server <host> --database <db>');
          return;
        }
        console.log(`Configured servers (default: ${config.defaultServer ?? 'none'}) | maxRows: ${config.maxRows ?? DEFAULT_MAX_ROWS}\n`);
        for (const s of servers) {
          const marker = s.isDefault ? chalk.green('* ') : '  ';
          const auth = s.windowsAuth ? 'windows auth' : `user: ${s.user}`;
          console.log(`${marker}${chalk.bold(s.name)}: ${s.server}:${s.port}/${s.database} (${auth})`);
        }
      } else {
        console.log(JSON.stringify({
          defaultServer: config.defaultServer ?? null,
          maxRows: config.maxRows ?? DEFAULT_MAX_ROWS,
          servers,
        }, null, 2));
      }
    });

  // server default
  server
    .command('default')
    .description('Set the default server used when --server is not specified')
    .requiredOption('--name <name>', 'Server alias to set as default')
    .option('--format <format>', 'Output format: json or text', 'json')
    .action((opts) => {
      const config = getConfig();
      if (!config.servers[opts.name]) {
        process.stderr.write(
          JSON.stringify({ error: `Server "${opts.name}" not found. Run 'mssql server list' to see configured servers.` }) + '\n'
        );
        process.exit(1);
      }
      config.defaultServer = opts.name;
      saveConfig(config);

      if (opts.format === 'text') {
        console.log(chalk.green(`✓ Default server set to "${opts.name}"`));
      } else {
        console.log(JSON.stringify({ ok: true, defaultServer: opts.name }, null, 2));
      }
    });

  // server remove
  server
    .command('remove')
    .description('Remove a server configuration')
    .requiredOption('--name <name>', 'Server alias to remove')
    .option('--format <format>', 'Output format: json or text', 'json')
    .action((opts) => {
      const config = getConfig();
      if (!config.servers[opts.name]) {
        process.stderr.write(
          JSON.stringify({ error: `Server "${opts.name}" not found.` }) + '\n'
        );
        process.exit(1);
      }

      delete config.servers[opts.name];

      // If the removed server was the default, auto-select another
      if (config.defaultServer === opts.name) {
        const remaining = Object.keys(config.servers);
        config.defaultServer = remaining.length > 0 ? remaining[0] : undefined;
      }

      saveConfig(config);

      if (opts.format === 'text') {
        console.log(chalk.green(`✓ Server "${opts.name}" removed`));
        if (config.defaultServer) {
          console.log(chalk.gray(`  Default server is now: ${config.defaultServer}`));
        }
      } else {
        console.log(JSON.stringify({
          ok: true,
          removed: opts.name,
          defaultServer: config.defaultServer ?? null,
        }, null, 2));
      }
    });

  // server test
  server
    .command('test')
    .description('Test connection to a server')
    .option('--name <name>', 'Server alias to test (default: use default server)')
    .option('--format <format>', 'Output format: json or text', 'json')
    .action(async (opts) => {
      const config = getConfig();
      const name = opts.name ?? config.defaultServer;

      if (!name) {
        process.stderr.write(
          JSON.stringify({ error: 'No server specified and no default server configured.' }) + '\n'
        );
        process.exit(1);
      }

      const serverConfig = config.servers[name];
      if (!serverConfig) {
        process.stderr.write(
          JSON.stringify({ error: `Server "${name}" not found.` }) + '\n'
        );
        process.exit(1);
      }

      const result = await testConnection(serverConfig);

      if (opts.format === 'text') {
        if (result.success) {
          console.log(chalk.green(`✓ Connected to "${name}" (${serverConfig.server}:${serverConfig.port ?? 1433}/${serverConfig.database})`));
          console.log(chalk.gray(`  ${result.version}`));
        } else {
          console.log(chalk.red(`✗ Connection failed to "${name}": ${result.error}`));
        }
      } else {
        console.log(JSON.stringify({
          ok: result.success,
          name,
          server: serverConfig.server,
          port: serverConfig.port ?? 1433,
          database: serverConfig.database,
          version: result.version ?? null,
          error: result.error ?? null,
        }, null, 2));
      }
    });

  // server config — set global options like maxRows
  server
    .command('config')
    .description('View or update global settings (e.g. maxRows limit)')
    .option('--max-rows <n>', 'Maximum rows returned per query before truncation')
    .option('--format <format>', 'Output format: json or text', 'json')
    .action((opts) => {
      const config: Config = getConfig();

      if (opts.maxRows !== undefined) {
        const n = parseInt(opts.maxRows, 10);
        if (isNaN(n) || n < 1) {
          process.stderr.write(
            JSON.stringify({ error: '--max-rows must be a positive integer' }) + '\n'
          );
          process.exit(1);
        }
        config.maxRows = n;
        saveConfig(config);
      }

      if (opts.format === 'text') {
        console.log(`maxRows:       ${config.maxRows ?? DEFAULT_MAX_ROWS}`);
        console.log(`defaultServer: ${config.defaultServer ?? '(none)'}`);
        console.log(`configFile:    ${getConfigFilePath()}`);
      } else {
        console.log(JSON.stringify({
          maxRows: config.maxRows ?? DEFAULT_MAX_ROWS,
          defaultServer: config.defaultServer ?? null,
          configFile: getConfigFilePath(),
        }, null, 2));
      }
    });
}
