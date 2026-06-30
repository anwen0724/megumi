// Composes the Coding Agent product SQLite persistence repositories.
import path from 'node:path';
import { AgentLoopRepository } from '../persistence/repos/agent-loop.repo';
import { ArtifactRepository } from '../persistence/repos/artifact.repo';
import { MemoryRepository } from '../persistence/repos/memory.repo';
import { SessionRepository } from '../persistence/repos/session.repo';
import { ToolCallRepository } from '../persistence/repos/tool-call.repo';
import { WorkspaceChangeRepository } from '../persistence/repos/workspace-change.repo';
import { WorkspaceRepository } from '../persistence/repos/workspace.repo';
import { migrateCodingAgentDatabase } from '../persistence/schema';

export interface ComposeCodingAgentPersistenceInput {
  sqlitePath: string;
  migrationsFolder?: string;
}

export function composeCodingAgentPersistence(input: ComposeCodingAgentPersistenceInput) {
  const { database } = migrateCodingAgentDatabase({
    sqliteDirectory: path.resolve(input.sqlitePath),
    migrationsFolder: input.migrationsFolder,
  });

  return {
    database,
    workspaceRepository: new WorkspaceRepository(database),
    sessionRepository: new SessionRepository(database),
    agentLoopRepository: new AgentLoopRepository(database),
    toolCallRepository: new ToolCallRepository(database),
    workspaceChangeRepository: new WorkspaceChangeRepository(database),
    artifactRepository: new ArtifactRepository(database),
    memoryRepository: new MemoryRepository(database),
  };
}

export type CodingAgentPersistence = ReturnType<typeof composeCodingAgentPersistence>;
