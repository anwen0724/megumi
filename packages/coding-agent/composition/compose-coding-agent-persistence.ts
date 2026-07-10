// Composes Coding Agent database infrastructure plus temporary legacy repositories.
import path from 'node:path';
import { ArtifactRepository } from '../persistence/repos/artifact.repo';
import { MemoryRepository } from '../persistence/repos/memory.repo';
import { migrateCodingAgentDatabase } from '../persistence/schema';

export interface ComposeCodingAgentPersistenceInput {
  sqlitePath: string;
  migrationsFolder?: string;
  migrationEnvironment?: Parameters<typeof migrateCodingAgentDatabase>[0]['migrationEnvironment'];
}

export function composeCodingAgentPersistence(input: ComposeCodingAgentPersistenceInput) {
  const { database } = migrateCodingAgentDatabase({
    sqliteDirectory: path.resolve(input.sqlitePath),
    migrationsFolder: input.migrationsFolder,
    migrationEnvironment: input.migrationEnvironment,
  });

  return {
    database,
    // Memory and Artifacts have not been rebuilt into the target module shape yet.
    // Keep their legacy repositories here until those modules own their DB access.
    artifactRepository: new ArtifactRepository(database),
    memoryRepository: new MemoryRepository(database),
  };
}

export type CodingAgentPersistence = ReturnType<typeof composeCodingAgentPersistence>;
