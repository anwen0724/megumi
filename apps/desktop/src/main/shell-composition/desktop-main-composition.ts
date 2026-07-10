// Composes the Electron UI shell and connects it to the Product Host Interface.
import { createElectronMegumiHomeSyncOptions } from '../adapters/electron-home-adapter';
import { composeProduct } from '@megumi/product/composition';
import { electronDirectoryPickerAdapter } from '../adapters/electron-directory-picker-adapter';
import { electronFileOpenAdapter } from '../adapters/electron-file-open-adapter';
import { electronRuntimeLogWriterAdapter } from '../adapters/electron-runtime-log-writer-adapter';
import { getElectronProductEnvironment } from '../adapters/electron-product-environment-adapter';

export function composeDesktopMain() {
  const product = composeProduct({
    home: createElectronMegumiHomeSyncOptions(),
    migrationEnvironment: getElectronProductEnvironment(),
    logWriter: electronRuntimeLogWriterAdapter,
    directoryPicker: electronDirectoryPickerAdapter,
    fileOpen: electronFileOpenAdapter,
  });
  const runtimeLogger = product.logger;
  const productHost = product.host;

  return {
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
