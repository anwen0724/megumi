// @vitest-environment node
/* Exercises orderly Desktop shutdown with real resources and the actual updater. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter, once } from 'node:events';
import net from 'node:net';
import syncFs from 'node:fs';
import { createDatabase, migrateDatabase, DatabaseMigrationError } from '@megumi/application/storage/index';
import { composeDesktopMain } from '@megumi/desktop/main/shell-composition/desktop-main-composition';
import { describeDesktopBootstrapFailure } from '@megumi/desktop/main/app/bootstrap-failure';
import { afterEach, expect, it, vi } from 'vitest';
import { registerAppLifecycle } from '@megumi/desktop/main/app/lifecycle';
import { createUpdateSession } from './fixtures/update-session';
import { electronBoundary } from './fixtures/electron-boundary';
import { createDesktopEnvironment } from './fixtures/desktop-environment';

vi.mock('electron', async () => {
  const { electronBoundary } = await import('./fixtures/electron-boundary');
  return electronBoundary;
});

it('keeps closed windows resident and reopens them on activation', async () => {
  const window = new WindowBoundary();
  registerAppLifecycle({ registerAllHandlers: () => undefined, createWindow: () => window });
  await electronBoundary.app.whenReady();
  let prevented = false;
  let exited = false;
  electronBoundary.app.on('quit', () => { exited = true; });
  window.emit('close', { preventDefault: () => { prevented = true; } });
  electronBoundary.app.emit('window-all-closed');
  expect(prevented).toBe(true);
  expect(window.visible).toBe(false);
  expect(exited).toBe(false);
  electronBoundary.app.emit('activate');
  expect(window.visible).toBe(true);
});

it('rejects a packaged Home inside the program directory before creating database files', async () => {
  const environment = await createDesktopEnvironment();
  const home = path.join(environment.root, 'installed', '用户 数据');
  vi.stubEnv('MEGUMI_HOME', home);
  let desktop: ReturnType<typeof composeDesktopMain> | undefined;
  try {
    expect(() => { desktop = composeDesktopMain(); }).toThrow(/Home.*程序目录/);
    await expect(fs.stat(home)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await desktop?.dispose();
    await environment.close();
  }
});

it.each([false, true])('starts through packaged migrations with recoverable data (I/O failure: %s)', async (failRead) => {
  const environment = await createDesktopEnvironment();
  const migrations = path.join(environment.resourcesPath, 'product/database/migrations');
  const previous = path.join(environment.root, 'previous-migrations');
  await fs.cp(migrations, previous, { recursive: true });
  const journalPath = path.join(previous, 'meta/_journal.json');
  const journal = JSON.parse(await fs.readFile(journalPath, 'utf8'));
  // Use the real preceding schema, before preference-learning control was added.
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 26);
  await fs.writeFile(journalPath, JSON.stringify(journal));
  const filename = path.join(environment.home, 'sqlite/megumi.sqlite');
  const old = createDatabase({ filename });
  migrateDatabase({ database: old, migrationsFolder: previous, releaseUpgrade: { targetApplicationVersion: '0.1.0' } });
  old.prepare({ sql: `INSERT INTO workspaces VALUES ('delivery-example','用户资料','C:/Example','c:/example','active','2026-01-01','2026-01-01','2026-01-01')` }).run();
  old.close();
  let desktop: ReturnType<typeof composeDesktopMain> | undefined;
  try {
    if (failRead) {
      const read = syncFs.readFileSync;
      vi.spyOn(syncFs, 'readFileSync').mockImplementation((...args: Parameters<typeof read>) => {
        if (path.resolve(String(args[0])) === path.join(migrations, '0026_preference_learning_control.sql')) {
          throw Object.assign(new Error('Disk I/O error'), { code: 'EIO' });
        }
        return read(...args);
      });
      let failure: unknown;
      try { desktop = composeDesktopMain(); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(DatabaseMigrationError);
      expect(describeDesktopBootstrapFailure(failure)).toMatchObject({ title: 'Megumi 数据升级失败' });
    } else {
      desktop = composeDesktopMain();
    }
    await desktop?.dispose(); desktop = undefined;
    const database = createDatabase({ filename });
    try {
      expect(database.prepare({ sql: "SELECT name FROM workspaces WHERE workspace_id='delivery-example'" }).get()).toEqual({ name: '用户资料' });
      const columns = database.prepare({ sql: 'PRAGMA table_info(discovery_preference_sets)' }).all().map(row => row.name);
      expect(columns.includes('policy_revision')).toBe(!failRead);
    } finally { database.close(); }
    const backups = await fs.readdir(path.join(environment.home, 'sqlite/backups'));
    expect(backups).toHaveLength(1);
    const backup = createDatabase({ filename: path.join(environment.home, 'sqlite/backups', backups[0]!) });
    try {
      expect(backup.prepare({ sql: "SELECT name FROM workspaces WHERE workspace_id='delivery-example'" }).get()).toEqual({ name: '用户资料' });
    } finally { backup.close(); }
    expect(JSON.parse(await fs.readFile(`${filename}.application-version.json`, 'utf8'))).toEqual({ applicationVersion: failRead ? '0.1.0' : '0.2.0' });
  } finally {
    await desktop?.dispose();
    vi.restoreAllMocks();
    await environment.close();
  }
});

class WindowBoundary extends EventEmitter {
  visible = true;
  show() { this.visible = true; }
  hide() { this.visible = false; }
  focus() { return undefined; }
  isDestroyed() { return false; }
}

afterEach(() => {
  electronBoundary.app.removeAllListeners();
  electronBoundary.app.isPackaged = false;
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it('waits for an active connection to close before completing an ordinary quit', async () => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as net.AddressInfo;
  const accepted = once(server, 'connection');
  const client = net.connect(address.port, '127.0.0.1');
  await accepted;
  const closed = once(server, 'close');
  registerAppLifecycle({
    registerAllHandlers: () => undefined, createWindow: () => new WindowBoundary(),
    dispose: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  });
  let exited = false;
  electronBoundary.app.on('quit', () => { exited = true; });
  try {
    electronBoundary.app.quit();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(exited).toBe(false);
    const quit = once(electronBoundary.app, 'quit');
    client.end();
    await closed;
    await quit;
    expect(exited).toBe(true);
  } finally {
    client.destroy();
    await closed;
  }
});

it('does not launch an installer when resource release fails and allows a successful retry', async () => {
  const session = await createUpdateSession(() => lifecycle.prepareToQuit());
  const file = await fs.open(path.join(session.home, 'runtime-resource'), 'w+');
  const lifecycle = registerAppLifecycle({
    registerAllHandlers: () => undefined, createWindow: () => new WindowBoundary(),
    dispose: async () => { await file.sync(); await file.close(); },
  });
  try {
    await session.controller.checkNow();
    await session.controller.downloadUpdate();
    vi.spyOn(file, 'sync').mockRejectedValueOnce(Object.assign(new Error('I/O error'), { code: 'EIO' }));
    await session.controller.restartAndInstall();
    expect(session.controller.getSnapshot()).toMatchObject({ status: 'error', error: {
      operation: 'install', code: 'restart_prepare_failed', retryable: true,
    } });
    expect(electronBoundary.processLaunches).toEqual([]);
    await session.controller.restartAndInstall();
    await expect(file.stat()).rejects.toMatchObject({ code: 'EBADF' });
    expect(electronBoundary.processLaunches).toHaveLength(1);
  } finally {
    await file.close(); await session.close();
  }
});

it('releases an open runtime file before handing a confirmed update to the installer', async () => {
  const session = await createUpdateSession(() => lifecycle.prepareToQuit());
  const file = await fs.open(path.join(session.home, 'runtime-resource'), 'w+');
  const lifecycle = registerAppLifecycle({
    registerAllHandlers: () => undefined, createWindow: () => new WindowBoundary(),
    dispose: () => file.close(),
  });
  try {
    await session.controller.checkNow();
    await session.controller.downloadUpdate();
    const quit = once(electronBoundary.app, 'quit');
    await session.controller.restartAndInstall();
    await quit;
    await expect(file.stat()).rejects.toMatchObject({ code: 'EBADF' });
    expect(electronBoundary.processLaunches).toEqual([{ file: expect.stringContaining('pending'),
      args: expect.arrayContaining(['--updated', '/S', '--force-run']) }]);
  } finally {
    await file.close(); await session.close();
  }
});

it('keeps installer startup failure visible and does not quit after the OS rejects the process', async () => {
  const session = await createUpdateSession(() => lifecycle.prepareToQuit());
  const file = await fs.open(path.join(session.home, 'runtime-resource'), 'w+');
  const lifecycle = registerAppLifecycle({
    registerAllHandlers: () => undefined, createWindow: () => new WindowBoundary(), dispose: () => file.close(),
  });
  let exited = false;
  electronBoundary.app.on('quit', () => { exited = true; });
  try {
    await session.controller.checkNow();
    await session.controller.downloadUpdate();
    electronBoundary.spawnError = Object.assign(new Error('OS rejected process creation'), { code: 'EIO' });
    await session.controller.restartAndInstall();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(session.controller.getSnapshot()).toMatchObject({ status: 'error', error: {
      operation: 'install', code: 'installer_launch_failed',
    } });
    expect(exited).toBe(false);
  } finally {
    await file.close(); await session.close();
  }
});
