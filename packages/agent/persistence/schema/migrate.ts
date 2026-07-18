// Runs Drizzle-managed SQLite migrations for Agent persistence.
import fs from 'node:fs';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDatabase, type MegumiDatabase } from '../connection';
import { resolvePersistenceMigrationsFolder } from './migration-paths';
import { prepareLegacySessionHistoryBackfill } from './legacy-session-history-backfill';

export interface MigrateAgentDatabaseInput {
  sqliteDirectory: string;
  databaseFileName?: string;
  migrationsFolder?: string;
  migrationEnvironment?: Omit<import('./migration-paths').ResolvePersistenceMigrationsFolderInput, 'migrationsFolder'>;
}

export interface MigrateAgentDatabaseResult {
  database: MegumiDatabase;
  sqliteFile: string;
}

export class AgentDatabaseMigrationError extends Error {
  constructor(
    message: string,
    readonly sqliteFile: string,
    readonly migrationsFolder: string,
    readonly cause: unknown,
  ) {
    super(message);
    this.name = 'AgentDatabaseMigrationError';
  }
}

export function applyAgentDatabaseMigrations(
  database: MegumiDatabase,
  migrationsFolder = resolvePersistenceMigrationsFolder(),
): void {
  migrate(drizzle(database), {
    migrationsFolder: resolvePersistenceMigrationsFolder({ migrationsFolder }),
  });
}

export function migrateAgentDatabase(input: MigrateAgentDatabaseInput): MigrateAgentDatabaseResult {
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
    applyAgentDatabaseMigrations(database, migrationsFolder);
  } catch (error) {
    database.close();
    throw new AgentDatabaseMigrationError(
      `Failed to apply Agent database migrations for ${sqliteFile}`,
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
