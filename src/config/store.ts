import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ServerConfig {
  server: string;
  port?: number;
  database: string;
  user?: string;
  password?: string;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
  windowsAuth?: boolean;
}

export interface Config {
  servers: Record<string, ServerConfig>;
  defaultServer?: string;
  maxRows?: number;
}

const CONFIG_DIR = path.join(os.homedir(), '.config', 'mssql-cli');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export const DEFAULT_MAX_ROWS = 100;

export function getConfig(): Config {
  let fileConfig: Partial<Config> = { servers: {} };

  if (fs.existsSync(CONFIG_FILE)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    } catch {
      // ignore parse errors, will use defaults
    }
  }

  // Environment variables can define a transient server named "env"
  const envServer = process.env.MSSQL_SERVER;
  const envDatabase = process.env.MSSQL_DATABASE;

  if (envServer && envDatabase) {
    const envServerConfig: ServerConfig = {
      server: envServer,
      database: envDatabase,
      user: process.env.MSSQL_USER,
      password: process.env.MSSQL_PASSWORD,
      port: process.env.MSSQL_PORT ? parseInt(process.env.MSSQL_PORT, 10) : undefined,
      encrypt: process.env.MSSQL_ENCRYPT === 'true',
      trustServerCertificate: process.env.MSSQL_TRUST_CERT === 'true',
      windowsAuth: process.env.MSSQL_WINDOWS_AUTH === 'true',
    };
    return {
      servers: { ...fileConfig.servers, env: envServerConfig },
      defaultServer: 'env',
      maxRows: fileConfig.maxRows ?? DEFAULT_MAX_ROWS,
    };
  }

  return {
    servers: fileConfig.servers ?? {},
    defaultServer: fileConfig.defaultServer,
    maxRows: fileConfig.maxRows ?? DEFAULT_MAX_ROWS,
  };
}

export function saveConfig(config: Config): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export function getConfigFilePath(): string {
  return CONFIG_FILE;
}

export function resolveServer(
  opts: { server?: string },
  config: Config
): { name: string; serverConfig: ServerConfig } {
  const name = opts.server ?? config.defaultServer;
  if (!name) {
    throw new Error(
      "No server specified and no default configured. Use --server <name> or set a default with: mssql server default --name <name>"
    );
  }
  const serverConfig = config.servers[name];
  if (!serverConfig) {
    throw new Error(
      `Server "${name}" not found. Run 'mssql server list' to see configured servers.`
    );
  }
  return { name, serverConfig };
}
