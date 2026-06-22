// Composes the Desktop Main SQLite connection and repository adapters.
import path from 'node:path';
import { createDatabase } from './connection';
import { SessionRunRepository } from './repos/session-run.repo';
import { SessionActivePathRepository } from './repos/session-active-path.repo';
import { RecoveryRepository } from './repos/recovery.repo';
import { PermissionSnapshotRepository } from './repos/permission-snapshot.repo';
import { ToolRepository } from './repos/tool.repo';
import { ArtifactRepository } from './repos/artifact.repo';
import { MemoryRepository } from './repos/memory.repo';
import { TimelineMessageRepository } from './repos/timeline-message.repo';
import { WorkspaceChangeRepository } from './repos/workspace-change.repo';
import { ProjectRepository } from './repos/project.repo';
import { RunContextRepository } from './repos/run-context.repo';
import { migrateDatabase } from './schema/migrations';
import type { MegumiHomePaths } from '../services/project/megumi-home.service';

export function composeDesktopPersistence(megumiHomePaths: MegumiHomePaths) {
  const database = createDatabase(path.join(megumiHomePaths.sqlitePath, 'megumi.sqlite3'));
  migrateDatabase(database);

  return {
    database,
    sessionRunRepository: new SessionRunRepository(database),
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

export type DesktopPersistence = ReturnType<typeof composeDesktopPersistence>;
