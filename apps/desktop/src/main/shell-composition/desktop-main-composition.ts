// Composes the Electron UI shell and connects it to the Product Host Interface.
import { createElectronMegumiHomeSyncOptions } from '../services/workspace/megumi-home.service';
import { createRuntimeJsonlLoggerForMegumiHome } from '../services/agent-run/runtime-logger.service';
import { composeProduct } from '@megumi/product/composition';
import { electronDialogHost } from '../shell/electron-dialog-host';
import { electronFileOpenAdapter } from '../adapters/electron-file-open-adapter';
import { resolveElectronPersistenceMigrationsFolder } from '../shell/electron-persistence-migrations-host';

export function composeDesktopMain() {
  const migrationsFolder = resolveElectronPersistenceMigrationsFolder();
  const product = composeProduct({
    home: createElectronMegumiHomeSyncOptions(),
    migrationsFolder,
    runtimeLoggerFactory: createRuntimeJsonlLoggerForMegumiHome,
    directoryPicker: { chooseDirectory: () => electronDialogHost.chooseDirectory() },
    fileOpen: electronFileOpenAdapter,
  });
  const megumiHomePaths = product.homePaths;
  const runtimeLogger = product.logger;
  const productHost = product.host;

  return {
    megumiHomePaths,
    runtimeLogger,
    workspace: { host: productHost },
    chat: { host: productHost },
    skill: { host: productHost },
    settings: { host: productHost },
    approval: { host: productHost },
    artifact: productHost.artifacts,
    dispose: product.dispose,
  };
}
