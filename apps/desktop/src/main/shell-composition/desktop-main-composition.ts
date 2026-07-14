// Composes the Electron UI shell and connects it to the Product Host Interface.
import { createElectronMegumiHomeSyncOptions } from '../adapters/electron-home-adapter';
import { composeProduct } from '@megumi/product/composition';
import { electronDirectoryPickerAdapter } from '../adapters/electron-directory-picker-adapter';
import { electronFileOpenAdapter } from '../adapters/electron-file-open-adapter';
import { electronObservabilityStorageAdapter } from '../adapters/electron-observability-storage-adapter';
import { getElectronProductEnvironment } from '../adapters/electron-product-environment-adapter';
import { saveDiagnosticBundle } from '../adapters/electron-diagnostic-bundle-save-adapter';
import { electronImagePickerAdapter, electronInputFileReader } from '../adapters/electron-image-input-adapter';
import { electronSessionAttachmentFileSystem } from '../adapters/electron-session-attachment-file-system';

export function composeDesktopMain() {
  const product = composeProduct({
    home: createElectronMegumiHomeSyncOptions(),
    migrationEnvironment: getElectronProductEnvironment(),
    observabilityStorage: electronObservabilityStorageAdapter,
    productEnvironment: { appVersion: process.env.npm_package_version ?? 'unknown', platform: process.platform, arch: process.arch },
    diagnosticBundleSave: { save: saveDiagnosticBundle },
    directoryPicker: electronDirectoryPickerAdapter,
    fileOpen: electronFileOpenAdapter,
    imagePicker: electronImagePickerAdapter,
    inputFileReader: electronInputFileReader,
    sessionAttachmentFileSystem: electronSessionAttachmentFileSystem,
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
    observability: { host: productHost },
    dispose: product.dispose,
  };
}
