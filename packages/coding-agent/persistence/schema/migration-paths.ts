// Resolves and validates Drizzle migration folders without depending on a UI shell.
import fs from 'node:fs';
import path from 'node:path';

export interface ResolvePersistenceMigrationsFolderInput {
  migrationsFolder?: string;
  moduleDirectory?: string;
  cwd?: string;
  isPackaged?: boolean;
  resourcesPath?: string;
}

export const PERSISTENCE_MIGRATIONS_RESOURCE_PATH = 'product/persistence/migrations';

export class PersistenceMigrationsFolderError extends Error {
  constructor(message: string, readonly folder: string) {
    super(message);
    this.name = 'PersistenceMigrationsFolderError';
  }
}

export function resolvePersistenceMigrationsFolder(
  input: ResolvePersistenceMigrationsFolderInput = {},
): string {
  const candidates = input.isPackaged
    ? [
        input.migrationsFolder,
        input.resourcesPath
          ? path.resolve(input.resourcesPath, PERSISTENCE_MIGRATIONS_RESOURCE_PATH)
          : undefined,
      ]
    : [
        input.migrationsFolder,
        path.resolve(input.moduleDirectory ?? __dirname, '../migrations'),
        path.resolve(input.cwd ?? process.cwd(), 'packages/coding-agent/persistence/migrations'),
      ];
  const availableCandidates = candidates.filter((candidate): candidate is string => Boolean(candidate));

  const firstExisting = availableCandidates.find((candidate) => fs.existsSync(candidate));
  const resolved = firstExisting ?? availableCandidates[0] ?? '';
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
