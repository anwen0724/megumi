/* Exercises About through the real Store, Preload, IPC handlers and update composition. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { composeApplicationUpdate } from '@megumi/desktop/main/application-update/application-update-composition';
import { registerApplicationUpdateHandlers } from '@megumi/desktop/main/ipc/handlers/application-update.handler';
import { api } from '@megumi/desktop/preload/api';
import { AboutMegumiPanel } from '@megumi/desktop/renderer/features/application-update/AboutMegumiPanel';
import { initializeApplicationUpdateStore, disposeApplicationUpdateStore } from '@megumi/desktop/renderer/features/application-update/application-update-store';
import { rendererI18n } from '@megumi/desktop/renderer/shared/i18n';
import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '@megumi/desktop/main/ipc/channels';
import { electronBoundary, installElectronModuleBoundary } from './fixtures/electron-boundary';
import { createUpdateSource } from './fixtures/update-source';

vi.mock('electron', async () => {
  const { electronBoundary } = await import('./fixtures/electron-boundary');
  const { EventEmitter } = await import('node:events');
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcRenderer = Object.assign(new EventEmitter(), {
    async invoke(channel: string, ...args: unknown[]) {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`No Electron handler for ${channel}`);
      return handler({}, ...args);
    },
  });
  return { ...electronBoundary, ipcRenderer,
    ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler) },
  };
});



afterEach(() => {
  cleanup(); disposeApplicationUpdateStore();
  electronBoundary.app.isPackaged = false;
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

it('shows the unsupported development environment and exposes no automatic-download option', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'megumi-update-ui-'));
  vi.stubGlobal('MEGUMI_APP_ID', 'com.megumi.desktop');
  Object.defineProperty(window, 'megumi', { configurable: true, value: api });
  const controller = composeApplicationUpdate({ megumiHomePath: home, logger: console,
    prepareToQuit: async () => undefined });
  try {
    registerApplicationUpdateHandlers({ controller });
    await initializeApplicationUpdateStore();
    await rendererI18n.changeLanguage('zh-CN');
    render(<I18nextProvider i18n={rendererI18n}><AboutMegumiPanel /></I18nextProvider>);
    expect(screen.getByRole('button', { name: '检查更新' })).toBeDisabled();
    expect(screen.queryByRole('switch', { name: '自动下载可用更新' })).not.toBeInTheDocument();
    expect(screen.getByText(/开发模式/)).toBeInTheDocument();
  } finally {
    controller.dispose();
    await fs.rm(home, { recursive: true, force: true });
  }
});

it('checks and downloads through IPC, shows transfer progress, then offers explicit installation', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'megumi-update-ui-'));
  const source = await createUpdateSource();
  const downloadGate = Promise.withResolvers<void>();
  source.source.beforeInstaller = async () => downloadGate.promise;
  vi.stubGlobal('MEGUMI_APP_ID', 'com.megumi.desktop');
  vi.stubEnv('LOCALAPPDATA', path.join(home, 'cache'));
  electronBoundary.app.isPackaged = true;
  electronBoundary.app.root = home;
  const resourcesBefore = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
  Object.defineProperty(process, 'resourcesPath', { value: home, configurable: true });
  const restoreElectron = installElectronModuleBoundary();
  await fs.writeFile(path.join(home, 'app-update.yml'), `provider: generic\nurl: ${source.url}\nupdaterCacheDirName: fixture-updater\n`);
  Object.defineProperty(window, 'megumi', { configurable: true, value: api });
  const controller = composeApplicationUpdate({ megumiHomePath: home, logger: console,
    prepareToQuit: async () => undefined });
  const unsubscribe = controller.subscribe(snapshot => ipcRenderer.emit(IPC_CHANNELS.applicationUpdate.snapshotChanged, {}, snapshot));
  try {
    registerApplicationUpdateHandlers({ controller });
    await initializeApplicationUpdateStore();
    await rendererI18n.changeLanguage('zh-CN');
    render(<I18nextProvider i18n={rendererI18n}><AboutMegumiPanel /></I18nextProvider>);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '检查更新' }));
    await user.click(await screen.findByRole('button', { name: '下载更新' }));
    expect(await screen.findByRole('progressbar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '检查更新' })).toBeDisabled();
    downloadGate.resolve();
    expect(await screen.findByRole('button', { name: '重启并更新' })).toBeEnabled();
    expect(screen.getByText(/退出应用都不会安装更新/)).toBeInTheDocument();
    expect(source.requests.filter(url => url.endsWith('.exe'))).toHaveLength(1);
  } finally {
    downloadGate.resolve();
    unsubscribe(); controller.dispose();
    await source.close(); restoreElectron();
    if (resourcesBefore) Object.defineProperty(process, 'resourcesPath', resourcesBefore);
    else Reflect.deleteProperty(process, 'resourcesPath');
    await fs.rm(home, { recursive: true, force: true });
  }
});
