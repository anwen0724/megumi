/* Owns the driver-neutral Database connection and SQLite adapter boundary. */
import fs from 'node:fs';
import path from 'node:path';
import BetterSqlite3 from 'better-sqlite3';

export type DatabaseValue = string | number | bigint | Uint8Array | null;
export type DatabaseRow = Readonly<Record<string, DatabaseValue>>;
export type DatabaseParameters =
  | readonly DatabaseValue[]
  | Readonly<Record<string, DatabaseValue>>;

export interface PrepareDatabaseStatementRequest {
  readonly sql: string;
}

export interface DatabaseRunResult {
  readonly changes: number;
  readonly lastInsertRowId?: number | bigint;
}

export interface DatabaseStatement<TRow extends DatabaseRow = DatabaseRow> {
  run(parameters?: DatabaseParameters): DatabaseRunResult;
  get(parameters?: DatabaseParameters): TRow | undefined;
  all(parameters?: DatabaseParameters): readonly TRow[];
}

export interface DatabaseTransactionRequest<T> {
  readonly operation: () => T;
}

export interface DatabaseConnection {
  prepare<TRow extends DatabaseRow = DatabaseRow>(
    request: PrepareDatabaseStatementRequest,
  ): DatabaseStatement<TRow>;
  transaction<T>(request: DatabaseTransactionRequest<T>): T;
  close(): void;
}

export interface CreateDatabaseRequest {
  readonly filename: string;
}

export class DatabaseOpenError extends Error {
  readonly filename: string;

  constructor(filename: string) {
    super(`Failed to open Database connection for ${filename}.`);
    this.name = 'DatabaseOpenError';
    this.filename = filename;
  }
}

export class DatabaseCloseError extends Error {
  readonly filename: string;

  constructor(filename: string) {
    super(`Failed to close Database connection for ${filename}.`);
    this.name = 'DatabaseCloseError';
    this.filename = filename;
  }
}

export class DatabaseConnectionClosedError extends Error {
  constructor() {
    super('Database connection is closed.');
    this.name = 'DatabaseConnectionClosedError';
  }
}

export class DatabaseStatementError extends Error {
  readonly operation: 'prepare' | 'run' | 'get' | 'all';

  constructor(operation: 'prepare' | 'run' | 'get' | 'all') {
    super(`Database statement ${operation} failed.`);
    this.name = 'DatabaseStatementError';
    this.operation = operation;
  }
}

export class DatabaseTransactionError extends Error {
  constructor() {
    super('Database transaction failed.');
    this.name = 'DatabaseTransactionError';
  }
}

class SqliteDatabaseStatement<TRow extends DatabaseRow> implements DatabaseStatement<TRow> {
  constructor(
    private readonly statement: BetterSqlite3.Statement<unknown[], unknown>,
    private readonly assertOpen: () => void,
  ) {}

  run(parameters?: DatabaseParameters): DatabaseRunResult {
    this.assertOpen();
    try {
      const result = executeWithParameters(
        parameters,
        (...values) => this.statement.run(...values),
      );
      return {
        changes: result.changes,
        lastInsertRowId: result.lastInsertRowid,
      };
    } catch {
      throw new DatabaseStatementError('run');
    }
  }

  get(parameters?: DatabaseParameters): TRow | undefined {
    this.assertOpen();
    try {
      return executeWithParameters(
        parameters,
        (...values) => this.statement.get(...values),
      ) as TRow | undefined;
    } catch {
      throw new DatabaseStatementError('get');
    }
  }

  all(parameters?: DatabaseParameters): readonly TRow[] {
    this.assertOpen();
    try {
      return executeWithParameters(
        parameters,
        (...values) => this.statement.all(...values),
      ) as TRow[];
    } catch {
      throw new DatabaseStatementError('all');
    }
  }
}

class SqliteDatabaseConnection implements DatabaseConnection {
  private closed = false;

  constructor(
    readonly filename: string,
    readonly driver: BetterSqlite3.Database,
  ) {}

  prepare<TRow extends DatabaseRow = DatabaseRow>(
    request: PrepareDatabaseStatementRequest,
  ): DatabaseStatement<TRow> {
    this.assertOpen();
    try {
      const statement = this.driver.prepare(request.sql) as BetterSqlite3.Statement<unknown[], unknown>;
      return new SqliteDatabaseStatement<TRow>(statement, () => this.assertOpen());
    } catch {
      throw new DatabaseStatementError('prepare');
    }
  }

  transaction<T>(request: DatabaseTransactionRequest<T>): T {
    this.assertOpen();
    const noOperationError = Symbol('no-operation-error');
    let operationError: unknown = noOperationError;
    const transaction = this.driver.transaction(() => {
      try {
        return request.operation();
      } catch (error) {
        operationError = error;
        throw error;
      }
    });
    try {
      return transaction();
    } catch {
      if (operationError !== noOperationError) throw operationError;
      throw new DatabaseTransactionError();
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.driver.close();
    } catch {
      throw new DatabaseCloseError(this.filename);
    }
  }

  private assertOpen(): void {
    if (this.closed || !this.driver.open) throw new DatabaseConnectionClosedError();
  }
}

export function createDatabase(request: CreateDatabaseRequest): DatabaseConnection {
  let driver: BetterSqlite3.Database | undefined;
  try {
    if (request.filename !== ':memory:') {
      fs.mkdirSync(path.dirname(path.resolve(request.filename)), { recursive: true });
    }
    driver = new BetterSqlite3(request.filename);
    driver.pragma('foreign_keys = ON');
    return new SqliteDatabaseConnection(request.filename, driver);
  } catch {
    try {
      driver?.close();
    } catch {
      // Opening already failed; preserve the stable open diagnostic.
    }
    throw new DatabaseOpenError(request.filename);
  }
}

// These helpers stay outside the Package entrypoint. Only Database-owned
// migration infrastructure may cross from the stable contract to the driver.
export function getDatabaseDriverForMigration(connection: DatabaseConnection): BetterSqlite3.Database {
  if (!(connection instanceof SqliteDatabaseConnection)) {
    throw new TypeError('Database migrations require a Database-owned connection.');
  }
  return connection.driver;
}

export function getDatabaseFilename(connection: DatabaseConnection): string {
  if (!(connection instanceof SqliteDatabaseConnection)) {
    throw new TypeError('Database filename is unavailable for an external connection.');
  }
  return connection.filename;
}

function executeWithParameters<TResult>(
  parameters: DatabaseParameters | undefined,
  execute: (...parameters: unknown[]) => TResult,
): TResult {
  if (parameters === undefined) return execute();
  if (Array.isArray(parameters)) return execute(...parameters.map(toDriverValue));
  return execute(Object.fromEntries(
    Object.entries(parameters).map(([key, value]) => [key, toDriverValue(value)]),
  ));
}

function toDriverValue(value: DatabaseValue): DatabaseValue | Buffer {
  return value instanceof Uint8Array ? Buffer.from(value) : value;
}
