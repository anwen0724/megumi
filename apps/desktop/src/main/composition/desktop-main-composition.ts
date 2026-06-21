// Composes Desktop Main services and adapters for the local Electron application.
import path from 'node:path';
import { initializeElectronMegumiHomeSync } from '../services/project/megumi-home.service';
import { createRuntimeJsonlLoggerForMegumiHome } from '../services/runtime/runtime-logger.service';
import { createPermissionSettingsService } from '../services/security/permission-settings.service';
import { createAppSettingsService } from '../services/settings/app-settings.service';
import { ArtifactContentStore } from '../services/artifact/artifact-content-store.service';
import { ArtifactService } from '../services/artifact/artifact.service';
import { composeDatabase } from './compose-database';
import { composeMemoryRuntime } from './compose-memory-runtime';
import { composeProjectService, composeWorkspaceFilesService } from './compose-project-workspace';
import { composeProviderRuntime } from './compose-provider-runtime';
import { composeRecoveryRuntime } from './compose-recovery-runtime';
import { composeSessionRuntime } from './compose-session-runtime';
import {
  composeToolRegistry,
  composeToolRuntimeFactory,
  composeToolService,
} from './compose-tool-runtime';
import fs from 'fs-extra';

export function composeDesktopMain() {
  const megumiHomePaths = initializeElectronMegumiHomeSync();
  const appSettingsService = createAppSettingsService({
    settingsPath: megumiHomePaths.settingsPath,
  });
  const runtimeLogger = createRuntimeJsonlLoggerForMegumiHome(megumiHomePaths);
  const database = composeDatabase(megumiHomePaths);
  const toolRegistry = composeToolRegistry();
  const permissionSettingsService = createPermissionSettingsService({
    userSettingsPath: megumiHomePaths.settingsPath,
    fileSystem: fs,
  });
  const projectService = composeProjectService(database.projectRepository);
  const providerRuntime = composeProviderRuntime(appSettingsService);
  const memory = composeMemoryRuntime({
    repository: database.memoryRepository,
    modelStepProvider: providerRuntime.modelStepProviderService,
    appSettingsService,
    runtimeLogger,
    megumiHomePath: megumiHomePaths.homePath,
  });
  const toolRuntimeFactory = composeToolRuntimeFactory({
    toolRepository: database.toolRepository,
    toolRegistry,
    workspaceChangeRepository: database.workspaceChangeRepository,
    sessionRunRepository: database.sessionRunRepository,
    permissionSettingsService,
  });
  const sessionRuntime = composeSessionRuntime({
    megumiHomePaths,
    runtimeLogger,
    appSettingsService,
    artifactRepository: database.artifactRepository,
    permissionSnapshotRepository: database.permissionSnapshotRepository,
    sessionRunRepository: database.sessionRunRepository,
    activePathRepository: database.activePathRepository,
    toolRepository: database.toolRepository,
    workspaceChangeRepository: database.workspaceChangeRepository,
    timelineMessageRepository: database.timelineMessageRepository,
    toolRegistry,
    modelStepProviderService: providerRuntime.modelStepProviderService,
    toolRuntimeFactory,
    memoryRuntime: memory.memoryRuntime,
  });
  const toolService = composeToolService({
    toolRepository: database.toolRepository,
    toolRegistry,
    sessionRunService: sessionRuntime.sessionRunService,
  });
  const workspaceFilesService = composeWorkspaceFilesService({
    sessionRunService: sessionRuntime.sessionRunService,
    projectService,
  });
  const artifactContentStore = new ArtifactContentStore({
    artifactRoot: path.join(megumiHomePaths.homePath, 'artifacts'),
  });
  const artifactService = new ArtifactService({
    repository: database.artifactRepository,
    contentStore: artifactContentStore,
  });
  const recoveryService = composeRecoveryRuntime({
    recoveryRepository: database.recoveryRepository,
    sessionRunRepository: database.sessionRunRepository,
    workspaceChangeRepository: database.workspaceChangeRepository,
    workspaceChangeFooterProjector: sessionRuntime.workspaceChangeFooterProjector,
    chatStreamSink: sessionRuntime.chatStreamSink,
  });

  return {
    megumiHomePaths,
    runtimeLogger,
    appSettingsService,
    providerService: providerRuntime.providerSettingsService,
    sessionRunService: sessionRuntime.sessionRunService,
    runContextService: sessionRuntime.runContextService,
    toolService,
    recoveryService,
    artifactService,
    memoryService: memory.memoryService,
    projectService,
    workspaceFilesService,
  };
}
