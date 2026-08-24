/* Resolves and validates the single authoritative Database migration chain. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ResolveDatabaseMigrationsFolderRequest {
  readonly migrationsFolder?: string;
  readonly moduleDirectory?: string;
  readonly cwd?: string;
  readonly isPackaged?: boolean;
  readonly resourcesPath?: string;
}

export interface DatabaseMigrationJournalEntry {
  readonly idx: number;
  readonly when: number;
  readonly tag: string;
}

export interface DatabaseMigrationJournal {
  readonly entries: readonly DatabaseMigrationJournalEntry[];
}

export const DATABASE_MIGRATIONS_RESOURCE_PATH = 'product/database/migrations';

export class DatabaseMigrationResourceError extends Error {
  readonly folder: string;

  constructor(message: string, folder: string) {
    super(message);
    this.name = 'DatabaseMigrationResourceError';
    this.folder = folder;
  }
}

export function resolveDatabaseMigrationsFolder(
  request: ResolveDatabaseMigrationsFolderRequest = {},
): string {
  const moduleDirectory = request.moduleDirectory
    ?? path.dirname(fileURLToPath(import.meta.url));
  const candidates = request.isPackaged
    ? [
        request.migrationsFolder,
        request.resourcesPath
          ? path.resolve(request.resourcesPath, DATABASE_MIGRATIONS_RESOURCE_PATH)
          : undefined,
      ]
    : [
        request.migrationsFolder,
        path.resolve(moduleDirectory, '../migrations'),
        path.resolve(request.cwd ?? process.cwd(), 'packages/agent/database/migrations'),
      ];
  const availableCandidates = candidates.filter((candidate): candidate is string => Boolean(candidate));
  const resolved = availableCandidates.find((candidate) => fs.existsSync(candidate))
    ?? availableCandidates[0]
    ?? '';
  assertDatabaseMigrationsFolder(resolved);
  return resolved;
}

export function assertDatabaseMigrationsFolder(folder: string): void {
  if (!fs.existsSync(folder)) {
    throw new DatabaseMigrationResourceError(
      `Database migrations folder is missing: ${folder}`,
      folder,
    );
  }
  readDatabaseMigrationJournal(folder);
}

export function readDatabaseMigrationJournal(folder: string): DatabaseMigrationJournal {
  const journalPath = path.join(folder, 'meta', '_journal.json');
  if (!fs.existsSync(journalPath)) {
    throw new DatabaseMigrationResourceError(
      `Database migration journal is missing: ${journalPath}`,
      folder,
    );
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as {
      entries?: Array<{ idx?: unknown; when?: unknown; tag?: unknown }>;
    };
    if (!Array.isArray(parsed.entries)) throw new Error('entries');
    const entries = parsed.entries.map((entry) => {
      if (
        typeof entry.idx !== 'number'
        || typeof entry.when !== 'number'
        || typeof entry.tag !== 'string'
        || entry.tag.length === 0
      ) {
        throw new Error('entry');
      }
      return { idx: entry.idx, when: entry.when, tag: entry.tag };
    });
    return { entries };
  } catch {
    throw new DatabaseMigrationResourceError(
      `Database migration journal is invalid: ${journalPath}`,
      folder,
    );
  }
}
