// @vitest-environment node
/* Exercises user-visible update behavior with real preferences, updater and local HTTP fixtures. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFileUpdatePreferencesStore } from '@megumi/desktop/main/application-update/update-preferences-store';
import { composeApplicationUpdate } from '@megumi/desktop/main/application-update/application-update-composition';
import { electronBoundary } from './fixtures/electron-boundary';
import { createUpdateSession } from './fixtures/update-session';
import { createUpdateSource } from './fixtures/update-source';

vi.mock('electron', async () => {
  const { electronBoundary } = await import('./fixtures/electron-boundary');
  return electronBoundary;
});



const directories: string[] = [];
const cleanups: Array<() => Promise<void>> = [];
beforeEach(() => { vi.stubGlobal('MEGUMI_APP_ID', 'com.megumi.desktop'); });
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  electronBoundary.app.isPackaged = false;
  electronBoundary.app.removeAllListeners();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});

async function createSession() {
  const session = await createUpdateSession();
  cleanups.push(session.close);
  return session;
}
it('discovers a stable release through the updater without downloading its installer', async () => {
  const { controller, requests } = await createSession();
  controller.start();
  expect(await controller.checkNow()).toMatchObject({ status: 'available',
    release: { version: '0.3.0', title: 'Stable release' } });
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatch(/^\/latest\.yml/);
});

it('reports missing channel metadata as incomplete release assets', async () => {
  const session = await createSession();
  session.source.statusCode = 404;
  expect(await session.controller.checkNow()).toMatchObject({ status: 'error', error: { code: 'release_assets_incomplete' } });
});

it('keeps a discovered release across restart and a failed recheck without enabling automatic checks', async () => {
  const { controller, home, source, requests } = await createSession();
  await controller.setAutomaticChecksEnabled(false);
  const discovered = await controller.checkNow();
  controller.dispose();
  const restarted = composeApplicationUpdate({ megumiHomePath: home, logger: console, prepareToQuit: async () => undefined });
  cleanups.push(async () => restarted.dispose());
  expect(restarted.getSnapshot()).toMatchObject({ status: 'available', lastKnown: true,
    checkedAt: discovered.checkedAt, release: { version: '0.3.0', title: 'Stable release' } });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  restarted.start();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(requests).toHaveLength(1);
  source.statusCode = 503;
  expect(await restarted.checkNow()).toMatchObject({ status: 'error', release: { version: '0.3.0' },
    checkedAt: discovered.checkedAt, error: { operation: 'check', code: 'update_service_unavailable' } });
});

it('limits a manually selected validation feed to that process without changing preferences', async () => {
  const session = await createSession();
  const validation = await createUpdateSource();
  cleanups.push(validation.close);
  validation.source.version = '0.4.0';
  const argv = process.argv;
  let validating: ReturnType<typeof composeApplicationUpdate> | undefined;
  try {
    process.argv = [...argv, '--megumi-delivery-validation', `--megumi-validation-url=${validation.url}`];
    validating = composeApplicationUpdate({ megumiHomePath: session.home, logger: console, prepareToQuit: async () => undefined });
    expect(await validating.checkNow()).toMatchObject({ status: 'available', release: { version: '0.4.0' } });
  } finally { process.argv = argv; validating?.dispose(); }
  expect(validation.requests.length).toBeGreaterThan(0);
  expect(await session.controller.checkNow()).toMatchObject({ status: 'available', release: { version: '0.3.0' } });
  const files = await fs.readdir(path.join(session.home, 'desktop')).catch(() => []);
  expect(files).toEqual(['application-update-state.json']);
  const restarted = composeApplicationUpdate({ megumiHomePath: session.home, logger: console, prepareToQuit: async () => undefined });
  cleanups.push(async () => restarted.dispose());
  expect(restarted.getSnapshot()).toMatchObject({ release: { version: '0.3.0' } });
});

it('downloads the user-selected release and exposes ready only after the real file passes verification', async () => {
  const { controller, home, installer, requests } = await createSession();
  await controller.checkNow();
  expect(await controller.downloadUpdate()).toMatchObject({ status: 'ready', release: { version: '0.3.0' } });
  const download = requests.filter(url => url.endsWith('.exe'));
  expect(download).toEqual(['/Megumi-0.3.0.exe']);
  const files = await fs.readdir(path.join(home, 'cache/fixture-updater/pending'));
  const filename = files.find(name => name.endsWith('.exe'));
  expect(filename).toBeDefined();
  expect(await fs.readFile(path.join(home, 'cache/fixture-updater/pending', filename!))).toEqual(installer);
});

it('verifies a completed download locally after restart and installs only on explicit confirmation', async () => {
  const { controller, home, requests, source } = await createSession();
  await controller.checkNow();
  await controller.downloadUpdate();
  electronBoundary.app.quit();
  expect(electronBoundary.processLaunches).toEqual([]);
  controller.dispose();
  const restarted = composeApplicationUpdate({ megumiHomePath: home, logger: console, prepareToQuit: async () => undefined });
  cleanups.push(async () => restarted.dispose());
  expect(restarted.getSnapshot().status).toBe('verifying');
  source.statusCode = 503;
  const before = [...requests];
  restarted.start();
  expect((await restarted.checkNow()).status).toBe('ready');
  expect(requests).toEqual(before);
  expect(electronBoundary.processLaunches).toEqual([]);
  await restarted.restartAndInstall();
  expect(electronBoundary.processLaunches).toHaveLength(1);
});
it('reports development mode as unsupported without starting an update operation', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'megumi-update-'));
  directories.push(home);
  const controller = composeApplicationUpdate({
    megumiHomePath: home, logger: console, prepareToQuit: async () => undefined,
  });
  try {
    controller.start();
    expect(controller.getSnapshot()).toMatchObject({ status: 'unsupported', supportReason: 'development' });
    expect(await controller.checkNow()).toMatchObject({ status: 'unsupported', supportReason: 'development' });
    expect(await controller.downloadUpdate()).toMatchObject({ status: 'unsupported', supportReason: 'development' });
  } finally {
    controller.dispose();
  }
});

it.each(['missing', 'corrupt'] as const)('requires an explicit redownload when the restarted cache is %s', async damage => {
  const { controller, home, requests } = await createSession();
  await controller.checkNow();
  await controller.downloadUpdate();
  controller.dispose();
  const cachedFile = path.join(home, 'cache/fixture-updater/pending/Megumi-0.3.0.exe');
  if (damage === 'missing') await fs.unlink(cachedFile);
  else await fs.writeFile(cachedFile, 'damaged bytes');
  const restarted = composeApplicationUpdate({ megumiHomePath: home, logger: console, prepareToQuit: async () => undefined });
  cleanups.push(async () => restarted.dispose());
  const before = [...requests];
  expect(await restarted.checkNow()).toMatchObject({ status: 'error', error: { operation: 'restore',
    code: damage === 'missing' ? 'update_cache_missing' : 'update_verification_failed' } });
  await restarted.restartAndInstall();
  expect(electronBoundary.processLaunches).toEqual([]);
  expect(requests).toEqual(before);
  expect((await restarted.downloadUpdate()).status).toBe('ready');
  expect(requests.filter(url => url.endsWith('.exe'))).toHaveLength(2);
});

it('keeps a completed target when a newer release appears before restarting', async () => {
  const { controller, home, source, requests } = await createSession();
  await controller.checkNow();
  await controller.downloadUpdate();
  controller.dispose();
  source.version = '0.4.0';
  const restarted = composeApplicationUpdate({ megumiHomePath: home, logger: console, prepareToQuit: async () => undefined });
  cleanups.push(async () => restarted.dispose());
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const before = [...requests];
  restarted.start();
  expect(await restarted.checkNow()).toMatchObject({ status: 'ready', release: { version: '0.3.0' } });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(requests).toEqual(before);
  expect(restarted.getSnapshot()).toMatchObject({ status: 'ready', release: { version: '0.3.0' } });
});

it('keeps a temporarily unreadable cache pending and allows a local verification retry', async () => {
  const { controller, home, requests } = await createSession();
  await controller.checkNow();
  await controller.downloadUpdate();
  controller.dispose();
  const restarted = composeApplicationUpdate({ megumiHomePath: home, logger: console, prepareToQuit: async () => undefined });
  cleanups.push(async () => restarted.dispose());
  const before = [...requests];
  vi.spyOn(fs, 'stat').mockRejectedValueOnce(Object.assign(new Error('File busy'), { code: 'EACCES' }));
  expect(await restarted.checkNow()).toMatchObject({ status: 'error', error: { code: 'update_cache_unreadable' } });
  await restarted.restartAndInstall();
  expect(electronBoundary.processLaunches).toHaveLength(0);
  expect((await restarted.checkNow()).status).toBe('ready');
  expect(requests).toEqual(before);
});

it('refuses to download if the selected update cannot be saved for recovery', async () => {
  const { controller, home, requests } = await createSession();
  await controller.checkNow();
  const record = path.join(home, 'desktop/application-update-state.json');
  await fs.unlink(record);
  await fs.mkdir(record);
  expect(await controller.downloadUpdate()).toMatchObject({ status: 'error', release: { version: '0.3.0' },
    error: { code: 'update_state_write_failed' } });
  expect(requests.filter(url => url.endsWith('.exe'))).toHaveLength(0);
});

it('asks the user to download again when revalidation finds a different version', async () => {
  const { controller, home, source, requests } = await createSession();
  await controller.checkNow();
  controller.dispose();
  const restarted = composeApplicationUpdate({ megumiHomePath: home, logger: console, prepareToQuit: async () => undefined });
  cleanups.push(async () => restarted.dispose());
  source.version = '0.4.0';
  expect(await restarted.downloadUpdate()).toMatchObject({ status: 'available', release: { version: '0.4.0' } });
  expect(requests.filter(url => url.endsWith('.exe'))).toHaveLength(0);
  expect(await restarted.downloadUpdate()).toMatchObject({ status: 'ready', release: { version: '0.4.0' } });
});

it('discards obsolete update records after upgrading without deleting the installer cache', async () => {
  const { controller, home } = await createSession();
  await controller.checkNow();
  await controller.downloadUpdate();
  controller.dispose();
  vi.spyOn(electronBoundary.app, 'getVersion').mockReturnValue('0.3.0');
  const restarted = composeApplicationUpdate({ megumiHomePath: home, logger: console, prepareToQuit: async () => undefined });
  cleanups.push(async () => restarted.dispose());
  expect(restarted.getSnapshot().status).toBe('idle');
  await expect(fs.stat(path.join(home, 'desktop/application-update-state.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await fs.stat(path.join(home, 'cache/fixture-updater/pending/Megumi-0.3.0.exe'))).isFile()).toBe(true);
});

it('rejects a damaged installer and lets the user retry the same candidate', async () => {
  const { controller, source } = await createSession();
  source.corrupt = true;
  await controller.checkNow();
  expect(await controller.downloadUpdate()).toMatchObject({ status: 'error', error: {
    operation: 'download', code: 'update_verification_failed', retryable: true, targetVersion: '0.3.0',
  } });
  source.corrupt = false;
  expect(await controller.downloadUpdate()).toMatchObject({ status: 'ready', release: { version: '0.3.0' } });
});

it('reports malformed update metadata as an error instead of claiming the current version is latest', async () => {
  const { controller, source } = await createSession();
  source.metadata = 'version: [';
  expect(await controller.checkNow()).toMatchObject({ status: 'error', error: {
    operation: 'check', code: 'release_metadata_invalid', retryable: true,
  } });
});

it('reports an unavailable update service and recovers when the user checks again', async () => {
  const { controller, source } = await createSession();
  source.statusCode = 503;
  expect(await controller.checkNow()).toMatchObject({ status: 'error', error: {
    operation: 'check', code: 'update_service_unavailable', retryable: true,
  } });
  source.statusCode = 200;
  expect((await controller.checkNow()).status).toBe('available');
});

it('reports an OS network failure distinctly from an up-to-date result', async () => {
  const { controller } = await createSession();
  vi.spyOn(electronBoundary.net, 'request').mockImplementationOnce(() => {
    throw Object.assign(new Error('DNS unavailable'), { code: 'ENOTFOUND' });
  });
  expect(await controller.checkNow()).toMatchObject({ status: 'error', error: {
    operation: 'check', code: 'network_unavailable', retryable: true,
  } });
});

it('leaves the saved preference unchanged and reports an error when saving fails', async () => {
  const { controller, home } = await createSession();
  await fs.mkdir(path.join(home, 'desktop/application-update.json'), { recursive: true });
  expect(await controller.setAutomaticChecksEnabled(false)).toMatchObject({
    automaticChecksEnabled: true, status: 'error', error: { operation: 'preferences', code: 'preferences_write_failed' },
  });
});

it('performs its startup check after thirty seconds without downloading', async () => {
  const { controller, requests } = await createSession();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const checked = Promise.withResolvers<void>();
  controller.subscribe(snapshot => { if (snapshot.status === 'available') checked.resolve(); });
  controller.start();
  await vi.advanceTimersByTimeAsync(29_999);
  expect(requests).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);
  await checked.promise;
  expect(requests).toHaveLength(1);
  expect(controller.getSnapshot()).toMatchObject({ status: 'available' });
});

it('cancels a pending startup check, preserves that choice on restart and still allows manual checks', async () => {
  const { controller, home, requests } = await createSession();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  controller.start();
  await controller.setAutomaticChecksEnabled(false);
  await vi.advanceTimersByTimeAsync(30_000);
  controller.dispose();
  const restarted = composeApplicationUpdate({ megumiHomePath: home, logger: console, prepareToQuit: async () => undefined });
  cleanups.push(async () => restarted.dispose());
  restarted.start();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(requests).toHaveLength(0);
  expect(await restarted.checkNow()).toMatchObject({ status: 'available', automaticChecksEnabled: false });
  expect(requests).toHaveLength(1);
});

it('keeps one download and its original target when another release appears during transfer', async () => {
  const { controller, source, requests } = await createSession();
  const arrived = Promise.withResolvers<void>();
  const continueDownload = Promise.withResolvers<void>();
  source.beforeInstaller = async () => { arrived.resolve(); await continueDownload.promise; };
  await controller.checkNow();
  const first = controller.downloadUpdate();
  await arrived.promise;
  try {
    source.version = '0.4.0';
    const duplicate = controller.downloadUpdate();
    expect(await controller.checkNow()).toMatchObject({ status: 'downloading', release: { version: '0.3.0' } });
    continueDownload.resolve();
    const results = await Promise.all([first, duplicate]);
    expect(results).toEqual([expect.objectContaining({ status: 'ready', release: expect.objectContaining({ version: '0.3.0' }) }),
      expect.objectContaining({ status: 'ready', release: expect.objectContaining({ version: '0.3.0' }) })]);
    expect(requests.filter(url => url.endsWith('.exe'))).toEqual(['/Megumi-0.3.0.exe']);
    expect(requests.filter(url => url.startsWith('/latest.yml'))).toHaveLength(2);
  } finally {
    continueDownload.resolve();
    await first;
  }
});

it('persists only the automatic-check choice and reads it on the next launch', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'megumi-update-'));
  directories.push(home);
  const request = { megumiHomePath: home, logger: console };
  createFileUpdatePreferencesStore(request).write({ automaticChecksEnabled: false });
  expect(createFileUpdatePreferencesStore(request).read()).toEqual({ automaticChecksEnabled: false });
  expect(JSON.parse(await fs.readFile(path.join(home, 'desktop/application-update.json'), 'utf8')))
    .toEqual({ automaticChecksEnabled: false });
});
