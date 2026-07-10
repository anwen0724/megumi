// Composes the Electron UI shell and connects it to the Product Host Interface.
import { createElectronMegumiHomeSyncOptions } from '../services/workspace/megumi-home.service';
import { createRuntimeJsonlLoggerForMegumiHome } from '../services/agent-run/runtime-logger.service';
import { createWorkspaceFilesService } from '../services/workspace/workspace-files.service';
import { composeProduct } from '@megumi/product/composition';
import fs from 'fs-extra';
import { electronDialogHost } from '../shell/electron-dialog-host';
import { electronShellHost } from '../shell/electron-shell-host';
import { resolveElectronPersistenceMigrationsFolder } from '../shell/electron-persistence-migrations-host';

export function composeDesktopMain() {
  const migrationsFolder = resolveElectronPersistenceMigrationsFolder();
  const product = composeProduct({
    home: createElectronMegumiHomeSyncOptions(),
    migrationsFolder,
    runtimeLoggerFactory: createRuntimeJsonlLoggerForMegumiHome,
    directoryPicker: { chooseDirectory: () => electronDialogHost.chooseDirectory() },
  });
  const megumiHomePaths = product.homePaths;
  const runtimeLogger = product.logger;
  const productHost = product.host;

  const workspaceFilesService = createWorkspaceFilesService({
    fileSystem: fs,
    isWorkspaceRootAllowed: (root) => productHost.workspace.listAuthorizedWorkspaceRoots().includes(root),
    openPath: (absolutePath) => electronShellHost.openPath(absolutePath),
  });

  return {
    megumiHomePaths,
    runtimeLogger,
    workspace: { host: productHost, workspaceFilesService },
    chat: { host: productHost },
    skill: { host: productHost },
    settings: { host: productHost },
    approval: { host: productHost },
    artifact: productHost.artifacts,
    dispose: product.dispose,
  };
}
