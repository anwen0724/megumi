// Composes the Electron UI shell and connects it to the Product Host Interface.
import { app, BrowserWindow } from 'electron';
import { createElectronMegumiHomeSyncOptions } from '../adapters/electron-home-adapter';
import { composeProduct, resolveMegumiHomePath } from '@megumi/product';
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
import { createElectronVoiceOptions } from '../adapters/electron-voice-resource-adapter';
import {
  createElectronVoiceInputAdapter,
  resolveVoiceInputWorkerEntryPath,
  type ElectronVoiceInputAdapter,
} from '../adapters/voice-input/electron-voice-input-adapter';
import { IPC_CHANNELS } from '../ipc/channels';

export function composeDesktopMain() {
  const home = createElectronMegumiHomeSyncOptions();
  const voiceResources = createElectronVoiceOptions(home);
  // The single Voice Input Adapter: injected into Product/Voice composition
  // AND connected to the dedicated PCM IPC; there is no second runtime.
  const voiceInputAdapter: ElectronVoiceInputAdapter = createElectronVoiceInputAdapter({
    resolveResourcePaths: voiceResources.speechInputPaths,
    workerEntryPath: resolveVoiceInputWorkerEntryPath({
      isPackaged: app.isPackaged,
      cwd: process.cwd(),
      mainBuildDirectory: __dirname,
    }),
  });
  const product = composeProduct({
    home,
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
    voice: { ...voiceResources.voiceOptions, speechInput: voiceInputAdapter },
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

  // Speech Input Events are projected straight from the Worker runtime to the
  // windows; the Voice package stays the owner of their type and semantics.
  const voiceInputEventSubscription = voiceInputAdapter.subscribe((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.voice.inputEvent, event);
    }
  });

  // Speech Output Events stream the same way: synthesis stays in Main, audio
  // chunks are projected to the windows for Web Audio playback.
  const speechOutputEventSubscription = product.subscribeSpeechOutputEvents((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.voice.speechOutputEvent, event);
    }
  });

  return {
    homePath: resolveMegumiHomePath(home),
    runtimeLogger,
    workspace: { host: productHost },
    session: { host: productHost },
    skill: { host: productHost },
    settings: { host: productHost },
    approval: { host: productHost },
    voice: { host: productHost },
    voiceInput: { adapter: voiceInputAdapter },
    observability: { host: productHost },
    dispose: async () => {
      uiEventSubscription.unsubscribe();
      voiceInputEventSubscription();
      speechOutputEventSubscription.unsubscribe();
      // Product ends the Voice Session (stopping speech input) before the
      // Adapter releases the Worker.
      await product.dispose();
      await voiceInputAdapter.dispose();
    },
  };
}
