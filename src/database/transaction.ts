// Provides the transaction primitive used by SQLite repository implementations.
import type { SqliteDatabase } from './connection';

export function runInTransaction<T>(database: SqliteDatabase, work: () => T): T {
  return database.transaction(work)();
}
