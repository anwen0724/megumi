// Runs Drizzle-managed SQLite migrations for Coding Agent persistence.
import fs from 'node:fs';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDatabase, type MegumiDatabase } from '../connection';
import { resolvePersistenceMigrationsFolder } from './migration-paths';
import { prepareLegacySessionHistoryBackfill } from './legacy-session-history-backfill';

export interface MigrateCodingAgentDatabaseInput {
  sqliteDirectory: string;
  databaseFileName?: string;
  migrationsFolder?: string;
  migrationEnvironment?: Omit<import('./migration-paths').ResolvePersistenceMigrationsFolderInput, 'migrationsFolder'>;
}

export interface MigrateCodingAgentDatabaseResult {
  database: MegumiDatabase;
  sqliteFile: string;
}

export class CodingAgentDatabaseMigrationError extends Error {
  constructor(
    message: string,
    readonly sqliteFile: string,
    readonly migrationsFolder: string,
    readonly cause: unknown,
  ) {
    super(message);
    this.name = 'CodingAgentDatabaseMigrationError';
  }
}

export function applyCodingAgentDatabaseMigrations(
  database: MegumiDatabase,
  migrationsFolder = resolvePersistenceMigrationsFolder(),
): void {
  migrate(drizzle(database), {
    migrationsFolder: resolvePersistenceMigrationsFolder({ migrationsFolder }),
  });
}

export function migrateCodingAgentDatabase(input: MigrateCodingAgentDatabaseInput): MigrateCodingAgentDatabaseResult {
  const databaseFileName = input.databaseFileName ?? 'megumi.sqlite3';
  const sqliteFile = databaseFileName === ':memory:'
    ? ':memory:'
    : path.join(input.sqliteDirectory, databaseFileName);

  if (sqliteFile !== ':memory:') {
    fs.mkdirSync(input.sqliteDirectory, { recursive: true });
  }

  const migrationsFolder = resolvePersistenceMigrationsFolder({
    migrationsFolder: input.migrationsFolder,
    ...input.migrationEnvironment,
  });
  const database = createDatabase(sqliteFile);
  try {
    prepareLegacySessionHistoryBackfill(database);
    applyCodingAgentDatabaseMigrations(database, migrationsFolder);
  } catch (error) {
    database.close();
    throw new CodingAgentDatabaseMigrationError(
      `Failed to apply Coding Agent database migrations for ${sqliteFile}`,
      sqliteFile,
      migrationsFolder,
      error,
    );
  }

  return {
    database,
    sqliteFile,
  };
}
