// Composes the Coding Agent product SQLite persistence repositories.
import path from 'node:path';
import { createDatabase } from '../persistence/connection';
import { SessionRunRepository } from '../persistence/repos/session-run.repo';
import { SessionMessageRepository } from '../persistence/repos/session-message.repo';
import { ModelStepRepository } from '../persistence/repos/model-step.repo';
import { RunExecutionFactRepository } from '../persistence/repos/run-execution-fact.repo';
import { RuntimeEventRepository } from '../persistence/repos/runtime-event.repo';
import { SessionActivePathRepository } from '../persistence/repos/session-active-path.repo';
import { RecoveryRepository } from '../persistence/repos/recovery.repo';
import { PermissionSnapshotRepository } from '../persistence/repos/permission-snapshot.repo';
import { ToolRepository } from '../persistence/repos/tool.repo';
import { ArtifactRepository } from '../persistence/repos/artifact.repo';
import { MemoryRepository } from '../persistence/repos/memory.repo';
import { TimelineMessageRepository } from '../persistence/repos/timeline-message.repo';
import { WorkspaceChangeRepository } from '../persistence/repos/workspace-change.repo';
import { ProjectRepository } from '../persistence/repos/project.repo';
import { RunContextRepository } from '../persistence/repos/run-context.repo';
import { migrateDatabase } from '../persistence/schema/migrations';

export interface ComposeCodingAgentPersistenceInput {
  sqlitePath: string;
}

export function composeCodingAgentPersistence(input: ComposeCodingAgentPersistenceInput) {
  const database = createDatabase(path.join(input.sqlitePath, 'megumi.sqlite3'));
  migrateDatabase(database);

  return {
    database,
    sessionRunRepository: new SessionRunRepository(database),
    sessionMessageRepository: new SessionMessageRepository(database),
    modelStepRepository: new ModelStepRepository(database),
    runExecutionFactRepository: new RunExecutionFactRepository(database),
    runtimeEventRepository: new RuntimeEventRepository(database),
    activePathRepository: new SessionActivePathRepository(database),
    recoveryRepository: new RecoveryRepository(database),
    permissionSnapshotRepository: new PermissionSnapshotRepository(database),
    toolRepository: new ToolRepository(database),
    artifactRepository: new ArtifactRepository(database),
    memoryRepository: new MemoryRepository(database),
    timelineMessageRepository: new TimelineMessageRepository(database),
    workspaceChangeRepository: new WorkspaceChangeRepository(database),
    projectRepository: new ProjectRepository(database),
    runContextRepository: new RunContextRepository(database),
  };
}

export type CodingAgentPersistence = ReturnType<typeof composeCodingAgentPersistence>;
