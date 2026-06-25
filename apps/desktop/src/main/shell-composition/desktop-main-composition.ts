// Composes the Electron UI shell and connects it to the Coding Agent product runtime.
import { initializeElectronMegumiHomeSync } from '../services/workspace/megumi-home.service';
import { createRuntimeJsonlLoggerForMegumiHome } from '../services/agent-run/runtime-logger.service';
import { createPermissionSettingsService } from '../services/security/permission-settings.service';
import { createAppSettingsService } from '../services/settings/app-settings.service';
import { createWorkspaceFilesService } from '../services/workspace/workspace-files.service';
import {
  composeCodingAgentRuntime,
  type CodingAgentHomePaths,
} from '@megumi/coding-agent/composition';
import { createDesktopSessionService } from '../services/session/session.service';
import { createDesktopAgentRunService } from '../services/agent-run/agent-run.service';
import { createDesktopProviderStatusService } from '../services/provider/provider-status-facade';
import fs from 'fs-extra';
import type { SessionRunService } from '@megumi/coding-agent/run';
import { electronDialogHost } from '../shell/electron-dialog-host';
import { electronShellHost } from '../shell/electron-shell-host';
import { createChatStreamBroadcaster } from '../shell/chat-stream-broadcaster';

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
  // The broadcaster is built before the window exists; createWindow attaches the
  // live window via setWindow. The product runtime persists timeline history and
  // forwards chat stream events to this sink, which relays them to the renderer.
  const chatStreamBroadcaster = createChatStreamBroadcaster({ logger: runtimeLogger });
  const codingAgentRuntime = composeCodingAgentRuntime({
    homePaths: codingAgentHomePaths,
    runtimeLogger,
    appSettingsProvider: appSettingsService,
    memorySettingsProvider: {
      isMemoryEnabled() {
        return appSettingsService.getResolvedSettings().memory.enabled;
      },
    },
    permissionSettingsProvider: permissionSettingsService,
    chatStreamEventSink: chatStreamBroadcaster,
    directoryPicker: { chooseDirectory: () => electronDialogHost.chooseDirectory() },
  });

  const projectService = codingAgentRuntime.projectService;
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
    chatStreamBroadcaster,
    providerService: createDesktopProviderStatusService(codingAgentRuntime.providerSettingsService),
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
    dispose: () => codingAgentRuntime.dispose(),
  };
}
