// Composes the Electron UI shell and connects it to the Product Host Interface.
import { BrowserWindow } from 'electron';
import { createElectronMegumiHomeSyncOptions } from '../adapters/electron-home-adapter';
import { composeProduct } from '@megumi/product';
import { forwardRuntimeEvent } from '../ipc/event-forwarders';
import { electronDirectoryPickerAdapter } from '../adapters/electron-directory-picker-adapter';
import { electronFileOpenAdapter } from '../adapters/electron-file-open-adapter';
import { electronObservabilityStorageAdapter } from '../adapters/electron-observability-storage-adapter';
import { getElectronProductEnvironment } from '../adapters/electron-product-environment-adapter';
import { getElectronMigrationEnvironment } from '../adapters/electron-migration-environment-adapter';
import { createDesktopSettingsEnvironment } from '../adapters/desktop-settings-environment-adapter';
import { saveDiagnosticBundle } from '../adapters/electron-diagnostic-bundle-save-adapter';
import {
  electronInputAttachmentPickerAdapter,
  electronInputSourceAccess,
  electronLocalFileAvailability,
} from '../adapters/electron-input-attachment-adapter';
import { electronSessionAttachmentFileSystem } from '../adapters/electron-session-attachment-file-system';
import { createDesktopWorkspaceFileSystem } from '../adapters/desktop-workspace-file-system-adapter';

export function composeDesktopMain() {
  const product = composeProduct({
    home: createElectronMegumiHomeSyncOptions(),
    migrationEnvironment: getElectronMigrationEnvironment(),
    observabilityStorage: electronObservabilityStorageAdapter,
    productEnvironment: getElectronProductEnvironment(),
    diagnosticBundleSave: { save: saveDiagnosticBundle },
    workspaceFileSystem: createDesktopWorkspaceFileSystem(),
    settingsEnvironment: createDesktopSettingsEnvironment(),
    directoryPicker: electronDirectoryPickerAdapter,
    fileOpen: electronFileOpenAdapter,
    attachmentPicker: electronInputAttachmentPickerAdapter,
    localFileAvailability: electronLocalFileAvailability,
    inputSourceAccess: electronInputSourceAccess,
    sessionAttachmentFileSystem: electronSessionAttachmentFileSystem,
  });
  const runtimeLogger = product.logger;
  const productHost = product.host;

  // Runtime event bridge: the bus is the single event source; every renderer
  // window receives the stream over IPC and filters by its active session.
  const uiEventSubscription = product.subscribeRuntimeEvents({}, (event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      forwardRuntimeEvent(
        { send: (channel, payload) => window.webContents.send(channel, payload) },
        event,
        { logger: runtimeLogger },
      );
    }
  });

  return {
    runtimeLogger,
    workspace: { host: productHost },
    chat: { host: productHost },
    skill: { host: productHost },
    settings: { host: productHost },
    approval: { host: productHost },
    artifact: productHost.artifacts,
    observability: { host: productHost },
    dispose: async () => {
      uiEventSubscription.unsubscribe();
      await product.dispose();
    },
  };
}
