// Composes the Electron UI shell and connects it to the Coding Agent product runtime.
import { initializeElectronMegumiHomeSync } from '../services/workspace/megumi-home.service';
import { createRuntimeJsonlLoggerForMegumiHome } from '../services/agent-run/runtime-logger.service';
import { createPermissionSettingsService } from '../services/security/permission-settings.service';
import { createAppSettingsService } from '../services/settings/app-settings.service';
import { createWorkspaceFilesService } from '../services/workspace/workspace-files.service';
import {
  composeCodingAgentRuntime,
  type CodingAgentHomePaths,
  composeCodingAgentPersistence,
} from '@megumi/coding-agent/composition';
import { createProjectService } from '@megumi/coding-agent/workspace';
import { createDesktopSessionService } from '../services/session/session.service';
import { createDesktopAgentRunService } from '../services/agent-run/agent-run.service';
import fs from 'fs-extra';
import type { ModelStepCompletionResult } from '@megumi/agent';
import type { SessionRunService } from '@megumi/coding-agent/run';
import { electronDialogHost } from '../shell/electron-dialog-host';
import { electronShellHost } from '../shell/electron-shell-host';

export function composeDesktopMain() {
  const megumiHomePaths = initializeElectronMegumiHomeSync();
  const appSettingsService = createAppSettingsService({
    settingsPath: megumiHomePaths.settingsPath,
  });
  const runtimeLogger = createRuntimeJsonlLoggerForMegumiHome(megumiHomePaths);
  const permissionSettingsService = createPermissionSettingsService({
    userSettingsPath: megumiHomePaths.settingsPath,
    fileSystem: fs,
  });
  const codingAgentHomePaths: CodingAgentHomePaths = {
    homePath: megumiHomePaths.homePath,
    sqlitePath: megumiHomePaths.sqlitePath,
    settingsPath: megumiHomePaths.settingsPath,
  };
  const codingAgentPersistence = composeCodingAgentPersistence({
    sqlitePath: codingAgentHomePaths.sqlitePath,
  });
  const codingAgentRuntime = composeCodingAgentRuntime({
    homePaths: codingAgentHomePaths,
    runtimeLogger,
    modelStepProviderService: {
      streamModelStep: async function* () { return; },
      completeModelStep: async (): Promise<ModelStepCompletionResult> => ({ ok: true, text: '' }),
      cancelModelStep: () => false,
    },
    appSettingsProvider: appSettingsService,
    memorySettingsProvider: {
      isMemoryEnabled() {
        return appSettingsService.getResolvedSettings().memory.enabled;
      },
    },
    permissionSettingsProvider: permissionSettingsService,
  });

  const projectService = createProjectService({
    repository: codingAgentPersistence.projectRepository,
    directoryPicker: { chooseDirectory: () => electronDialogHost.chooseDirectory() },
    fileSystem: fs,
  });
  const workspaceFilesService = createWorkspaceFilesService({
    fileSystem: fs,
    isWorkspaceRootAllowed: (root) => projectService.listAuthorizedWorkspaceRoots().includes(root),
    openPath: (absolutePath) => electronShellHost.openPath(absolutePath),
  });

  const sessionRunService = codingAgentRuntime.sessionRunService as SessionRunService;
  const desktopSessionService = createDesktopSessionService(sessionRunService);
  const desktopAgentRunService = createDesktopAgentRunService(sessionRunService);

  return {
    megumiHomePaths,
    runtimeLogger,
    appSettingsService,
    providerService: codingAgentRuntime.providerSettingsService,
    sessionRunService: desktopSessionService,
    agentRunService: desktopAgentRunService,
    runContextService: codingAgentRuntime.runContextService,
    planService: sessionRunService,
    toolService: codingAgentRuntime.toolService,
    recoveryService: codingAgentRuntime.recoveryService,
    artifactService: codingAgentRuntime.artifactService,
    memoryService: codingAgentRuntime.memoryService,
    projectService,
    workspaceFilesService,
  };
}
