/* Applies the append-only Database migration chain to an owned connection. */
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import {
  getDatabaseDriverForMigration,
  getDatabaseFilename,
  type DatabaseConnection,
} from './database';
import { prepareLegacySessionHistoryMigration } from './legacy-session-history-migration';
import {
  readDatabaseMigrationJournal,
  resolveDatabaseMigrationsFolder,
  type ResolveDatabaseMigrationsFolderRequest,
} from './migration-resources';
import {
  completeDatabaseReleaseUpgrade,
  prepareDatabaseReleaseUpgrade,
  type DatabaseReleaseUpgradeOptions,
} from './database-release-upgrade';

export interface MigrateDatabaseRequest {
  readonly database: DatabaseConnection;
  readonly migrationsFolder?: string;
  readonly migrationEnvironment?: Omit<ResolveDatabaseMigrationsFolderRequest, 'migrationsFolder'>;
  readonly releaseUpgrade?: DatabaseReleaseUpgradeOptions;
}

export interface MigrateDatabaseResult {
  readonly appliedMigrations: number;
  readonly currentMigration?: string;
  readonly migrationsFolder: string;
  readonly backupFile?: string;
}

export class DatabaseDowngradeUnsupportedError extends Error {
  readonly databaseFile: string;
  readonly databaseMigrationCount: number;
  readonly supportedMigrationCount: number;

  constructor(request: {
    readonly databaseFile: string;
    readonly databaseMigrationCount: number;
    readonly supportedMigrationCount: number;
  }) {
    super(`Database migration history is newer than this application for ${request.databaseFile}.`);
    this.name = 'DatabaseDowngradeUnsupportedError';
    this.databaseFile = request.databaseFile;
    this.databaseMigrationCount = request.databaseMigrationCount;
    this.supportedMigrationCount = request.supportedMigrationCount;
  }
}

export class DatabaseMigrationError extends Error {
  readonly databaseFile: string;
  readonly migrationsFolder: string;
  readonly migration: string;
  readonly backupFile?: string;
  readonly reason: 'legacy_history_migration_failed' | 'sql_migration_failed';

  constructor(request: {
    databaseFile: string;
    migrationsFolder: string;
    migration: string;
    backupFile?: string;
    reason: 'legacy_history_migration_failed' | 'sql_migration_failed';
  }) {
    super(`Failed to apply Database migration ${request.migration} for ${request.databaseFile}.`);
    this.name = 'DatabaseMigrationError';
    this.databaseFile = request.databaseFile;
    this.migrationsFolder = request.migrationsFolder;
    this.migration = request.migration;
    this.backupFile = request.backupFile;
    this.reason = request.reason;
  }
}

export function migrateDatabase(request: MigrateDatabaseRequest): MigrateDatabaseResult {
  const migrationsFolder = resolveDatabaseMigrationsFolder({
    migrationsFolder: request.migrationsFolder,
    ...request.migrationEnvironment,
  });
  const journal = readDatabaseMigrationJournal(migrationsFolder);
  const beforeCount = migrationCount(request.database);
  const databaseFile = getDatabaseFilename(request.database);
  if (beforeCount > journal.entries.length) {
    throw new DatabaseDowngradeUnsupportedError({
      databaseFile,
      databaseMigrationCount: beforeCount,
      supportedMigrationCount: journal.entries.length,
    });
  }
  const pendingMigration = journal.entries[beforeCount]?.tag ?? 'unknown';
  const preparedUpgrade = request.releaseUpgrade
    ? prepareDatabaseReleaseUpgrade({
        database: request.database,
        hasPendingMigrations: beforeCount < journal.entries.length,
        options: request.releaseUpgrade,
      })
    : undefined;

  try {
    prepareLegacySessionHistoryMigration(request.database);
  } catch {
    throw new DatabaseMigrationError({
      databaseFile,
      migrationsFolder,
      migration: 'legacy_session_history_migration',
      ...(preparedUpgrade?.backupFile ? { backupFile: preparedUpgrade.backupFile } : {}),
      reason: 'legacy_history_migration_failed',
    });
  }

  try {
    migrate(drizzle(getDatabaseDriverForMigration(request.database)), { migrationsFolder });
  } catch {
    throw new DatabaseMigrationError({
      databaseFile,
      migrationsFolder,
      migration: pendingMigration,
      ...(preparedUpgrade?.backupFile ? { backupFile: preparedUpgrade.backupFile } : {}),
      reason: 'sql_migration_failed',
    });
  }

  const afterCount = migrationCount(request.database);
  if (preparedUpgrade) {
    completeDatabaseReleaseUpgrade({
      prepared: preparedUpgrade,
      backupRetention: request.releaseUpgrade?.backupRetention,
    });
  }
  return {
    appliedMigrations: afterCount - beforeCount,
    currentMigration: journal.entries[Math.min(afterCount, journal.entries.length) - 1]?.tag,
    migrationsFolder,
    ...(preparedUpgrade?.backupFile ? { backupFile: preparedUpgrade.backupFile } : {}),
  };
}

function migrationCount(database: DatabaseConnection): number {
  const table = database.prepare<{ name: string }>({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
  }).get();
  if (!table) return 0;
  return database.prepare<{ count: number }>({
    sql: 'SELECT COUNT(*) AS count FROM __drizzle_migrations',
  }).get()?.count ?? 0;
}
