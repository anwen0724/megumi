/*
 * Verifies the Main-owned update state machine through its small public Interface.
 */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  createApplicationUpdateController,
  type ApplicationUpdateControllerDependencies,
  type ElectronAutoUpdaterEvent,
} from '@megumi/desktop/main/application-update/application-update-controller';
import type { ApplicationUpdateRelease } from '@megumi/desktop/application-update/application-update-contract';

const release: ApplicationUpdateRelease = {
  version: '0.2.0',
  title: 'Megumi 0.2.0',
  notesSummary: 'A safer update flow.',
  releasePageUrl: 'https://github.com/anwen0724/megumi/releases/tag/v0.2.0',
};

describe('ApplicationUpdateController', () => {
  it('starts at the persisted defaults and schedules one startup check only', async () => {
    const fixture = createFixture();
    fixture.controller.start();
    fixture.controller.start();

    expect(fixture.schedule).toHaveBeenCalledOnce();
    expect(fixture.schedule).toHaveBeenCalledWith(expect.any(Function), 15_000);
    expect(fixture.controller.getSnapshot()).toMatchObject({
      status: 'idle',
      automaticChecksEnabled: true,
      automaticDownloadsEnabled: false,
    });

    await fixture.runScheduledCheck();
    expect(fixture.metadata.checkLatest).toHaveBeenCalledOnce();
    expect(fixture.controller.getSnapshot()).toMatchObject({ status: 'available', targetVersion: '0.2.0' });
    expect(fixture.updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('deduplicates automatic and manual checks and stops at available by default', async () => {
    let resolveCheck: ((value: { status: 'available'; release: ApplicationUpdateRelease }) => void) | undefined;
    const check = new Promise<{ status: 'available'; release: ApplicationUpdateRelease }>((resolve) => {
      resolveCheck = resolve;
    });
    const fixture = createFixture({ checkLatest: vi.fn(() => check) });

    const first = fixture.controller.checkNow();
    const second = fixture.controller.checkNow();
    expect(fixture.metadata.checkLatest).toHaveBeenCalledOnce();
    expect(fixture.controller.getSnapshot()).toMatchObject({ status: 'checking', source: 'manual' });

    resolveCheck?.({ status: 'available', release });
    await Promise.all([first, second]);
    expect(fixture.controller.getSnapshot()).toMatchObject({ status: 'available', targetVersion: '0.2.0' });
    expect(fixture.updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('projects an up-to-date result without touching the download Adapter', async () => {
    const fixture = createFixture({
      checkLatest: vi.fn(async () => ({ status: 'up_to_date' as const })),
    });
    await fixture.controller.checkNow();
    expect(fixture.controller.getSnapshot()).toMatchObject({
      status: 'up_to_date',
      checkedAt: '2026-08-28T00:00:00.000Z',
    });
    expect(fixture.updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('reports the Squirrel first-run lock as retryable for an immediate manual check', async () => {
    const fixture = createFixture({ isSquirrelFirstRun: true });
    await expect(fixture.controller.checkNow()).resolves.toMatchObject({
      status: 'error',
      errorCode: 'installer_busy',
      retryable: true,
    });
    expect(fixture.metadata.checkLatest).not.toHaveBeenCalled();
  });

  it('downloads only after a user command when automatic downloads are disabled', async () => {
    const fixture = createFixture();
    await fixture.controller.checkNow();
    await fixture.controller.downloadUpdate();

    expect(fixture.updater.setFeedUrl).toHaveBeenCalledWith(
      'https://update.electronjs.org/anwen0724/megumi/win32-x64/0.1.0',
    );
    expect(fixture.updater.checkForUpdates).toHaveBeenCalledOnce();
    expect(fixture.controller.getSnapshot()).toMatchObject({ status: 'downloading', targetVersion: '0.2.0' });

    fixture.emitUpdaterEvent({ type: 'update-downloaded' });
    expect(fixture.controller.getSnapshot()).toMatchObject({ status: 'ready', targetVersion: '0.2.0' });
  });

  it('automatically downloads a discovered update only when that preference is enabled', async () => {
    const fixture = createFixture();
    await fixture.controller.setAutomaticDownloadsEnabled(true);
    await fixture.controller.checkNow();

    expect(fixture.updater.checkForUpdates).toHaveBeenCalledOnce();
    expect(fixture.controller.getSnapshot().status).toBe('downloading');
    expect(fixture.updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('turns off automatic downloads when automatic checks are disabled', async () => {
    const fixture = createFixture();
    await fixture.controller.setAutomaticDownloadsEnabled(true);
    const snapshot = await fixture.controller.setAutomaticChecksEnabled(false);

    expect(snapshot).toMatchObject({
      automaticChecksEnabled: false,
      automaticDownloadsEnabled: false,
    });
    expect(fixture.preferences.write).toHaveBeenLastCalledWith({
      automaticChecksEnabled: false,
      automaticDownloadsEnabled: false,
    });
    await expect(fixture.controller.setAutomaticDownloadsEnabled(true)).resolves.toMatchObject({
      automaticDownloadsEnabled: false,
    });
  });

  it('waits for lifecycle preparation before handing a ready update to Squirrel', async () => {
    let finishPreparation: (() => void) | undefined;
    const preparation = new Promise<void>((resolve) => { finishPreparation = resolve; });
    const prepareToQuit = vi.fn(() => preparation);
    const fixture = createFixture({ prepareToQuit });
    await fixture.controller.checkNow();
    await fixture.controller.downloadUpdate();
    fixture.emitUpdaterEvent({ type: 'update-downloaded' });

    const installing = fixture.controller.restartAndInstall();
    expect(fixture.controller.getSnapshot()).toMatchObject({ status: 'installing', targetVersion: '0.2.0' });
    expect(fixture.updater.quitAndInstall).not.toHaveBeenCalled();
    finishPreparation?.();
    await installing;
    expect(fixture.updater.quitAndInstall).toHaveBeenCalledOnce();
  });

  it('never registers or checks the production updater in unsupported environments', async () => {
    const fixture = createFixture({ isPackaged: false });
    fixture.controller.start();

    expect(fixture.controller.getSnapshot()).toMatchObject({ status: 'unsupported', reason: 'development' });
    expect(fixture.updater.subscribe).not.toHaveBeenCalled();
    expect(fixture.schedule).not.toHaveBeenCalled();
    await expect(fixture.controller.checkNow()).resolves.toMatchObject({ status: 'unsupported' });
  });
});

function createFixture(overrides: Partial<ApplicationUpdateControllerDependencies> & {
  checkLatest?: ApplicationUpdateControllerDependencies['releaseMetadata']['checkLatest'];
} = {}) {
  const { checkLatest, ...dependencyOverrides } = overrides;
  let scheduled: (() => void) | undefined;
  let updaterListener: ((event: ElectronAutoUpdaterEvent) => void) | undefined;
  const preferences = {
    read: vi.fn(() => ({ automaticChecksEnabled: true, automaticDownloadsEnabled: false })),
    write: vi.fn(),
  };
  const metadata = {
    checkLatest: checkLatest ?? vi.fn(async () => ({ status: 'available' as const, release })),
  };
  const updater = {
    setFeedUrl: vi.fn(),
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
    subscribe: vi.fn((listener: (event: ElectronAutoUpdaterEvent) => void) => {
      updaterListener = listener;
      return () => { updaterListener = undefined; };
    }),
  };
  const schedule = vi.fn((callback: () => void) => {
    scheduled = callback;
    return vi.fn();
  });
  const dependencies: ApplicationUpdateControllerDependencies = {
    currentVersion: '0.1.0',
    platform: 'win32',
    arch: 'x64',
    isPackaged: true,
    isSquirrelInstalled: true,
    isSquirrelFirstRun: false,
    preferences,
    releaseMetadata: metadata,
    updater,
    prepareToQuit: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined),
    schedule,
    now: () => new Date('2026-08-28T00:00:00.000Z'),
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    ...dependencyOverrides,
  };
  const controller = createApplicationUpdateController(dependencies);
  controller.start();
  return {
    controller,
    metadata,
    updater,
    preferences,
    schedule,
    emitUpdaterEvent(event: ElectronAutoUpdaterEvent) { updaterListener?.(event); },
    async runScheduledCheck() {
      scheduled?.();
      await vi.waitFor(() => expect(metadata.checkLatest).toHaveBeenCalled());
      await vi.waitFor(() => expect(controller.getSnapshot().status).not.toBe('checking'));
    },
  };
}
