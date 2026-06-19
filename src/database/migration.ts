// Owns schema migration bookkeeping for the new src SQLite database.
import type { SqliteDatabase } from './connection';
import { DATABASE_MIGRATIONS } from './schema';

export interface Migration {
  version: number;
  name: string;
  up: string;
}

export interface RunDatabaseMigrationsOptions {
  migrations?: Migration[];
  now?: () => string;
}

export function runDatabaseMigrations(
  database: SqliteDatabase,
  options: RunDatabaseMigrationsOptions = {},
): void {
  const migrations = options.migrations ?? DATABASE_MIGRATIONS;
  const now = options.now ?? (() => new Date().toISOString());

  database.pragma('foreign_keys = ON');

  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedVersions = new Set(
    database
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row) => (row as { version: number }).version),
  );

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    const apply = database.transaction(() => {
      database.exec(migration.up);
      database
        .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, now());
    });

    apply();
  }
}
