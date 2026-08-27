/*
 * Owns consistent pre-migration snapshots and the application-version marker for release upgrades.
 */
import fs from 'node:fs';
import path from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import {
  getDatabaseDriverForMigration,
  getDatabaseFilename,
  type DatabaseConnection,
} from './database';

const DEFAULT_BACKUP_RETENTION = 3;
const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const BACKUP_FILE_PREFIX = 'megumi-before-upgrade-';

export interface DatabaseReleaseUpgradeOptions {
  readonly targetApplicationVersion: string;
  readonly now?: () => Date;
  readonly backupRetention?: number;
}

export interface PreparedDatabaseReleaseUpgrade {
  readonly backupFile?: string;
  readonly databaseFile: string;
  readonly sourceApplicationVersion: string;
  readonly targetApplicationVersion: string;
}

export class DatabaseReleaseUpgradeError extends Error {
  readonly databaseFile: string;
  readonly backupFile?: string;
  readonly reason:
    | 'invalid_target_version'
    | 'version_marker_invalid'
    | 'backup_creation_failed'
    | 'backup_integrity_failed'
    | 'version_marker_write_failed'
    | 'backup_retention_failed';

  constructor(request: {
    readonly databaseFile: string;
    readonly backupFile?: string;
    readonly reason: DatabaseReleaseUpgradeError['reason'];
  }) {
    super(`Database release upgrade preparation failed for ${request.databaseFile}: ${request.reason}.`);
    this.name = 'DatabaseReleaseUpgradeError';
    this.databaseFile = request.databaseFile;
    this.backupFile = request.backupFile;
    this.reason = request.reason;
  }
}

/** Creates a consistent snapshot before a release applies pending migrations. */
export function prepareDatabaseReleaseUpgrade(request: {
  readonly database: DatabaseConnection;
  readonly hasPendingMigrations: boolean;
  readonly options: DatabaseReleaseUpgradeOptions;
}): PreparedDatabaseReleaseUpgrade {
  const databaseFile = getDatabaseFilename(request.database);
  const targetApplicationVersion = validateTargetVersion(
    request.options.targetApplicationVersion,
    databaseFile,
  );
  if (databaseFile === ':memory:') {
    return { databaseFile, sourceApplicationVersion: 'unknown', targetApplicationVersion };
  }

  const sourceApplicationVersion = readApplicationVersionMarker(databaseFile);
  if (!request.hasPendingMigrations || !hasPersistentUserSchema(request.database)) {
    return { databaseFile, sourceApplicationVersion, targetApplicationVersion };
  }

  const backupFile = createConsistentBackup({
    database: request.database,
    databaseFile,
    sourceApplicationVersion,
    targetApplicationVersion,
    now: request.options.now?.() ?? new Date(),
  });
  return { databaseFile, backupFile, sourceApplicationVersion, targetApplicationVersion };
}

/** Records the running version and prunes old snapshots only after migrations succeed. */
export function completeDatabaseReleaseUpgrade(request: {
  readonly prepared: PreparedDatabaseReleaseUpgrade;
  readonly backupRetention?: number;
}): void {
  if (request.prepared.databaseFile === ':memory:') return;
  writeApplicationVersionMarker(
    request.prepared.databaseFile,
    request.prepared.targetApplicationVersion,
  );
  if (!request.prepared.backupFile) return;
  retainRecentBackups(
    request.prepared.databaseFile,
    request.backupRetention ?? DEFAULT_BACKUP_RETENTION,
  );
}

function validateTargetVersion(version: string, databaseFile: string): string {
  if (STABLE_VERSION_PATTERN.test(version)) return version;
  throw new DatabaseReleaseUpgradeError({ databaseFile, reason: 'invalid_target_version' });
}

function readApplicationVersionMarker(databaseFile: string): string {
  const markerFile = applicationVersionMarkerFile(databaseFile);
  if (!fs.existsSync(markerFile)) return 'unknown';
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
    if (
      typeof parsed === 'object'
      && parsed !== null
      && 'applicationVersion' in parsed
      && typeof parsed.applicationVersion === 'string'
      && STABLE_VERSION_PATTERN.test(parsed.applicationVersion)
    ) {
      return parsed.applicationVersion;
    }
  } catch {
    // The stable error below keeps malformed local metadata at the Database boundary.
  }
  throw new DatabaseReleaseUpgradeError({ databaseFile, reason: 'version_marker_invalid' });
}

function hasPersistentUserSchema(database: DatabaseConnection): boolean {
  const row = database.prepare<{ count: number }>({
    sql: `
      SELECT COUNT(*) AS count
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name <> '__drizzle_migrations'
    `,
  }).get();
  return (row?.count ?? 0) > 0;
}

function createConsistentBackup(request: {
  readonly database: DatabaseConnection;
  readonly databaseFile: string;
  readonly sourceApplicationVersion: string;
  readonly targetApplicationVersion: string;
  readonly now: Date;
}): string {
  const backupDirectory = path.join(path.dirname(request.databaseFile), 'backups');
  const backupFile = path.join(
    backupDirectory,
    `${BACKUP_FILE_PREFIX}${request.sourceApplicationVersion}-to-${request.targetApplicationVersion}-${utcFileTimestamp(request.now)}.sqlite`,
  );
  try {
    fs.mkdirSync(backupDirectory, { recursive: true });
    getDatabaseDriverForMigration(request.database).prepare('VACUUM INTO ?').run(backupFile);
  } catch {
    throw new DatabaseReleaseUpgradeError({
      databaseFile: request.databaseFile,
      backupFile,
      reason: 'backup_creation_failed',
    });
  }

  if (!backupIntegrityIsValid(backupFile)) {
    throw new DatabaseReleaseUpgradeError({
      databaseFile: request.databaseFile,
      backupFile,
      reason: 'backup_integrity_failed',
    });
  }
  return backupFile;
}

function backupIntegrityIsValid(backupFile: string): boolean {
  let backup: BetterSqlite3.Database | undefined;
  try {
    backup = new BetterSqlite3(backupFile, { readonly: true, fileMustExist: true });
    return backup.pragma('integrity_check', { simple: true }) === 'ok';
  } catch {
    return false;
  } finally {
    backup?.close();
  }
}

function writeApplicationVersionMarker(databaseFile: string, applicationVersion: string): void {
  const markerFile = applicationVersionMarkerFile(databaseFile);
  const temporaryFile = `${markerFile}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryFile, `${JSON.stringify({ applicationVersion }, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryFile, markerFile);
  } catch {
    try {
      fs.rmSync(temporaryFile, { force: true });
    } catch {
      // Preserve the stable marker failure even if temporary cleanup also fails.
    }
    throw new DatabaseReleaseUpgradeError({ databaseFile, reason: 'version_marker_write_failed' });
  }
}

function retainRecentBackups(databaseFile: string, retention: number): void {
  const backupDirectory = path.join(path.dirname(databaseFile), 'backups');
  try {
    const backups = fs.readdirSync(backupDirectory)
      .filter((name) => name.startsWith(BACKUP_FILE_PREFIX) && name.endsWith('.sqlite'))
      .sort((left, right) => right.localeCompare(left));
    for (const backup of backups.slice(Math.max(1, retention))) {
      fs.rmSync(path.join(backupDirectory, backup));
    }
  } catch {
    throw new DatabaseReleaseUpgradeError({ databaseFile, reason: 'backup_retention_failed' });
  }
}

function applicationVersionMarkerFile(databaseFile: string): string {
  return `${databaseFile}.application-version.json`;
}

function utcFileTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:.]/g, '');
}
