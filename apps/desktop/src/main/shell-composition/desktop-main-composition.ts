// Composes the Electron UI shell and connects it to the Coding Agent host interface.
import { initializeElectronMegumiHomeSync } from '../services/workspace/megumi-home.service';
import { createRuntimeJsonlLoggerForMegumiHome } from '../services/agent-run/runtime-logger.service';
import { createPermissionSettingsService } from '../services/security/permission-settings.service';
import { createWorkspaceFilesService } from '../services/workspace/workspace-files.service';
import {
  composeCodingAgentHostInterface,
  type CodingAgentHomePaths,
} from '@megumi/coding-agent/composition';
import fs from 'fs-extra';
import { electronDialogHost } from '../shell/electron-dialog-host';
import { electronShellHost } from '../shell/electron-shell-host';
import { createChatStreamBroadcaster } from '../shell/chat-stream-broadcaster';
import { resolveElectronPersistenceMigrationsFolder } from '../shell/electron-persistence-migrations-host';

export function composeDesktopMain() {
  const megumiHomePaths = initializeElectronMegumiHomeSync();
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
  const migrationsFolder = resolveElectronPersistenceMigrationsFolder();
  // The broadcaster is built before the window exists; createWindow attaches the
  // live window via setWindow. The host interface persists timeline history and
  // forwards chat stream events to this sink, which relays them to the renderer.
  const chatStreamBroadcaster = createChatStreamBroadcaster({ logger: runtimeLogger });
  const codingAgentHost = composeCodingAgentHostInterface({
    homePaths: codingAgentHomePaths,
    migrationsFolder,
    runtimeLogger,
    permissionSettingsProvider: permissionSettingsService,
    chatStreamEventSink: chatStreamBroadcaster,
    directoryPicker: { chooseDirectory: () => electronDialogHost.chooseDirectory() },
  });

  const workspaceFilesService = createWorkspaceFilesService({
    fileSystem: fs,
    isWorkspaceRootAllowed: (root) => codingAgentHost.workspace.listAuthorizedWorkspaceRoots().includes(root),
    openPath: (absolutePath) => electronShellHost.openPath(absolutePath),
  });

  return {
    megumiHomePaths,
    runtimeLogger,
    chatStreamBroadcaster,
    providerService: codingAgentHost.settings.provider,
    settingsService: codingAgentHost.settings,
    sessionHandlers: { host: codingAgentHost },
    planService: codingAgentHost.artifacts.plan,
    permissionsService: codingAgentHost.permissions,
    artifactService: codingAgentHost.artifacts,
    projectService: codingAgentHost.workspace,
    workspaceFilesService,
    dispose: () => codingAgentHost.dispose(),
  };
}
