// Composes the SQLite connection and repositories used by Desktop Main services.
import path from 'node:path';
import { createDatabase } from '@megumi/db/connection';
import { SessionRunRepository } from '@megumi/db/repos/session-run.repo';
import { SessionActivePathRepository } from '@megumi/db/repos/session-active-path.repo';
import { RecoveryRepository } from '@megumi/db/repos/recovery.repo';
import { PermissionSnapshotRepository } from '@megumi/db/repos/permission-snapshot.repo';
import { ToolRepository } from '@megumi/db/repos/tool.repo';
import { ArtifactRepository } from '@megumi/db/repos/artifact.repo';
import { MemoryRepository } from '@megumi/db/repos/memory.repo';
import { TimelineMessageRepository } from '@megumi/db/repos/timeline-message.repo';
import { WorkspaceChangeRepository } from '@megumi/db/repos/workspace-change.repo';
import { ProjectRepository } from '@megumi/db/repos/project.repo';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import type { MegumiHomePaths } from '../services/project/megumi-home.service';

export function composeDatabase(megumiHomePaths: MegumiHomePaths) {
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
  };
}
