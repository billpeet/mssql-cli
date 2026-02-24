import { config as SqlConfig, ConnectionPool, NVarChar } from 'mssql';
import { ServerConfig } from '../config/store';
import { QueryResult } from './types';

export interface MssqlClient {
  query(sqlStr: string): Promise<QueryResult>;
  queryWithParams(sqlStr: string, params: Record<string, string | number | boolean | null>): Promise<QueryResult>;
  close(): Promise<void>;
}

function buildConnectionConfig(serverConfig: ServerConfig): SqlConfig {
  const config: SqlConfig = {
    server: serverConfig.server,
    port: serverConfig.port ?? 1433,
    database: serverConfig.database,
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
    options: {
      encrypt: serverConfig.encrypt ?? true,
      trustServerCertificate: serverConfig.trustServerCertificate ?? false,
      trustedConnection: serverConfig.windowsAuth ?? false,
    },
    requestTimeout: 30000,
    connectionTimeout: 15000,
  };

  if (!serverConfig.windowsAuth) {
    config.user = serverConfig.user;
    config.password = serverConfig.password;
  }

  return config;
}

export async function createClient(serverConfig: ServerConfig): Promise<MssqlClient> {
  const config = buildConnectionConfig(serverConfig);
  const pool = new ConnectionPool(config);
  await pool.connect();

  return {
    async query(sqlStr: string): Promise<QueryResult> {
      const result = await pool.request().query(sqlStr);
      return {
        recordset: result.recordset ?? [],
        rowsAffected: result.rowsAffected ?? [],
        recordsets: result.recordsets ?? [],
      };
    },

    async queryWithParams(
      sqlStr: string,
      params: Record<string, string | number | boolean | null>
    ): Promise<QueryResult> {
      const request = pool.request();
      for (const [key, value] of Object.entries(params)) {
        if (typeof value === 'string') {
          request.input(key, NVarChar(500), value);
        } else {
          request.input(key, value);
        }
      }
      const result = await request.query(sqlStr);
      return {
        recordset: result.recordset ?? [],
        rowsAffected: result.rowsAffected ?? [],
        recordsets: result.recordsets ?? [],
      };
    },

    async close(): Promise<void> {
      await pool.close();
    },
  };
}

export async function testConnection(
  serverConfig: ServerConfig
): Promise<{ success: boolean; version?: string; error?: string }> {
  let pool: ConnectionPool | null = null;
  try {
    const config = buildConnectionConfig(serverConfig);
    pool = new ConnectionPool(config);
    await pool.connect();
    const result = await pool.request().query('SELECT @@VERSION AS version, DB_NAME() AS dbName');
    const version = result.recordset[0]?.version as string ?? 'Unknown';
    const dbName = result.recordset[0]?.dbName as string ?? '';
    // Extract just the first line of @@VERSION
    const shortVersion = version.split('\n')[0].trim();
    return { success: true, version: `${shortVersion} | DB: ${dbName}` };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  } finally {
    if (pool) await pool.close().catch(() => undefined);
  }
}
