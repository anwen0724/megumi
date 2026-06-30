// Resolves and validates Drizzle migration folders without depending on a UI shell.
import fs from 'node:fs';
import path from 'node:path';

export interface ResolvePersistenceMigrationsFolderInput {
  migrationsFolder?: string;
  moduleDirectory?: string;
  cwd?: string;
}

export class PersistenceMigrationsFolderError extends Error {
  constructor(message: string, readonly folder: string) {
    super(message);
    this.name = 'PersistenceMigrationsFolderError';
  }
}

export function resolvePersistenceMigrationsFolder(
  input: ResolvePersistenceMigrationsFolderInput = {},
): string {
  const candidates = [
    input.migrationsFolder,
    path.resolve(input.moduleDirectory ?? __dirname, '../migrations'),
    path.resolve(input.cwd ?? process.cwd(), 'packages/coding-agent/persistence/migrations'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  const firstExisting = candidates.find((candidate) => fs.existsSync(candidate));
  const resolved = firstExisting ?? candidates[0];
  assertPersistenceMigrationsFolder(resolved);
  return resolved;
}

export function assertPersistenceMigrationsFolder(folder: string): void {
  if (!fs.existsSync(folder)) {
    throw new PersistenceMigrationsFolderError(
      `Persistence migrations folder is missing: ${folder}`,
      folder,
    );
  }

  const journalPath = path.join(folder, 'meta', '_journal.json');
  if (!fs.existsSync(journalPath)) {
    throw new PersistenceMigrationsFolderError(
      `Drizzle migration journal is missing: ${journalPath}`,
      folder,
    );
  }
}
