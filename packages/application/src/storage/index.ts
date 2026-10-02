/* Exposes the stable Database contract without exporting driver or Drizzle types. */
export {
  DatabaseCloseError,
  DatabaseConnectionClosedError,
  DatabaseOpenError,
  DatabaseStatementError,
  DatabaseTransactionError,
  createDatabase,
} from './database';
export {
  DatabaseReleaseUpgradeError,
} from './database-release-upgrade';
export type {
  DatabaseReleaseUpgradeOptions,
  PreparedDatabaseReleaseUpgrade,
} from './database-release-upgrade';
export type {
  CreateDatabaseRequest,
  DatabaseConnection,
  DatabaseParameters,
  DatabaseRow,
  DatabaseRunResult,
  DatabaseStatement,
  DatabaseTransactionRequest,
  DatabaseValue,
  PrepareDatabaseStatementRequest,
} from './database';
export {
  DatabaseDowngradeUnsupportedError,
  DatabaseMigrationError,
  migrateDatabase,
} from './database-migrations';
export type {
  MigrateDatabaseRequest,
  MigrateDatabaseResult,
} from './database-migrations';
export {
  databaseTableOwnership,
  databaseTables,
} from './database-tables';
export type {
  DatabaseTable,
  DatabaseTableOwner,
  DatabaseTableOwnership,
} from './database-tables';
export {
  DATABASE_MIGRATIONS_RESOURCE_PATH,
  DatabaseMigrationResourceError,
  assertDatabaseMigrationsFolder,
  resolveDatabaseMigrationsFolder,
} from './migration-resources';
export type {
  ResolveDatabaseMigrationsFolderRequest,
} from './migration-resources';
