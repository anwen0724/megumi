// Owns SQLite connection creation and pragmas for the new src persistence layer.
import Database from 'better-sqlite3';

export type SqliteDatabase = Database.Database;

export interface OpenSqliteDatabaseOptions {
  readonly?: boolean;
  fileMustExist?: boolean;
  busyTimeoutMs?: number;
}

export function openSqliteDatabase(path: string, options: OpenSqliteDatabaseOptions = {}): SqliteDatabase {
  const databaseOptions: Database.Options = {};
  if (options.readonly !== undefined) {
    databaseOptions.readonly = options.readonly;
  }
  if (options.fileMustExist !== undefined) {
    databaseOptions.fileMustExist = options.fileMustExist;
  }

  const database = new Database(path, databaseOptions);

  database.pragma('foreign_keys = ON');
  database.pragma(`busy_timeout = ${options.busyTimeoutMs ?? 5000}`);

  if (!options.readonly) {
    database.pragma('journal_mode = WAL');
  }

  return database;
}
