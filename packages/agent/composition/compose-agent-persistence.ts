// Composes Agent database infrastructure.
import path from 'node:path';
import { migrateAgentDatabase } from '../persistence/schema';

export interface ComposeAgentPersistenceInput {
  sqlitePath: string;
  migrationsFolder?: string;
  migrationEnvironment?: Parameters<typeof migrateAgentDatabase>[0]['migrationEnvironment'];
}

export function composeAgentPersistence(input: ComposeAgentPersistenceInput) {
  const { database } = migrateAgentDatabase({
    sqliteDirectory: path.resolve(input.sqlitePath),
    migrationsFolder: input.migrationsFolder,
    migrationEnvironment: input.migrationEnvironment,
  });

  return { database };
}

export type AgentPersistence = ReturnType<typeof composeAgentPersistence>;
