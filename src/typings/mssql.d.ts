declare module 'mssql' {
  export interface config {
    user?: string;
    password?: string;
    server: string;
    port?: number;
    database?: string;
    authentication?: {
      type: string;
      options?: {
        domain?: string;
        userName?: string;
        password?: string;
      };
    };
    pool?: {
      max?: number;
      min?: number;
      idleTimeoutMillis?: number;
    };
    options?: {
      encrypt?: boolean;
      trustServerCertificate?: boolean;
      trustedConnection?: boolean;
      enableArithAbort?: boolean;
      instanceName?: string;
    };
    requestTimeout?: number;
    connectionTimeout?: number;
  }

  export interface IResult<T> {
    recordset: T[];
    recordsets: T[][];
    rowsAffected: number[];
    output: Record<string, unknown>;
  }

  export interface IRecordSet<T> extends Array<T> {
    columns: Record<string, unknown>;
    toTable: (name?: string) => ITable;
  }

  export interface ITable {
    name: string;
    schema?: string;
    columns: IColumnMetadata;
    rows: unknown[][];
  }

  export interface IColumnMetadata {
    [key: string]: {
      index: number;
      name: string;
      length: number | undefined;
      type: ISqlType;
      nullable: boolean;
    };
  }

  export interface ISqlType {
    type: string;
  }

  export interface IRequest {
    input(name: string, value: unknown): IRequest;
    input(name: string, type: ISqlType, value: unknown): IRequest;
    query<T = Record<string, unknown>>(command: string): Promise<IResult<T>>;
    execute<T = Record<string, unknown>>(procedure: string): Promise<IResult<T>>;
  }

  export class ConnectionPool {
    constructor(config: config | string);
    connected: boolean;
    connecting: boolean;
    healthy: boolean;
    connect(): Promise<ConnectionPool>;
    close(): Promise<void>;
    request(): IRequest;
    query<T = Record<string, unknown>>(command: string): Promise<IResult<T>>;
  }

  // Data types
  export interface ISqlTypeFactory {
    (...args: unknown[]): ISqlType;
  }

  export const NVarChar: ISqlTypeFactory;
  export const VarChar: ISqlTypeFactory;
  export const NChar: ISqlTypeFactory;
  export const Char: ISqlTypeFactory;
  export const NText: ISqlTypeFactory;
  export const Text: ISqlTypeFactory;
  export const Int: ISqlType;
  export const BigInt: ISqlType;
  export const SmallInt: ISqlType;
  export const TinyInt: ISqlType;
  export const Bit: ISqlType;
  export const Float: ISqlType;
  export const Real: ISqlType;
  export const DateTime: ISqlType;
  export const DateTime2: ISqlTypeFactory;
  export const Date: ISqlType;
  export const Time: ISqlTypeFactory;
  export const UniqueIdentifier: ISqlType;
  export const Numeric: ISqlTypeFactory;
  export const Decimal: ISqlTypeFactory;
  export const Money: ISqlType;
  export const SmallMoney: ISqlType;
  export const Boolean: ISqlType;
  export const Binary: ISqlTypeFactory;
  export const VarBinary: ISqlTypeFactory;
  export const Image: ISqlType;
  export const Xml: ISqlType;
  export const Json: ISqlType;

  export function connect(config: config | string): Promise<ConnectionPool>;
  export function close(): Promise<void>;
  export function query<T = Record<string, unknown>>(command: string): Promise<IResult<T>>;

  export class MSSQLError extends Error {
    code?: string;
    number?: number;
    lineNumber?: number;
    state?: string | null;
    class?: number;
    serverName?: string | null;
    procName?: string | null;
  }

  export class ConnectionError extends MSSQLError {}
  export class TransactionError extends MSSQLError {}
  export class RequestError extends MSSQLError {}
  export class PreparedStatementError extends MSSQLError {}

  const sql: {
    config: config;
    ConnectionPool: typeof ConnectionPool;
    NVarChar: ISqlTypeFactory;
    VarChar: ISqlTypeFactory;
    Int: ISqlType;
    BigInt: ISqlType;
    SmallInt: ISqlType;
    TinyInt: ISqlType;
    Bit: ISqlType;
    Float: ISqlType;
    DateTime: ISqlType;
    Date: ISqlType;
    UniqueIdentifier: ISqlType;
    connect: typeof connect;
    close: typeof close;
    query: typeof query;
    MSSQLError: typeof MSSQLError;
    ConnectionError: typeof ConnectionError;
    RequestError: typeof RequestError;
  };

  export default sql;
}
