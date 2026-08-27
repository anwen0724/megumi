/*
 * Owns the Desktop application update lifecycle and hides discovery, download, and install details.
 */
import type {
  ApplicationUpdateErrorCode,
  ApplicationUpdatePreferences,
  ApplicationUpdateRelease,
  ApplicationUpdateSnapshot,
} from '../../application-update/application-update-contract';
import type { DesktopRuntimeLogger } from '../runtime-logger';
import {
  ApplicationUpdateOperationError,
  type ApplicationReleaseCheckResult,
} from './github-release-metadata-adapter';
import type { UpdatePreferencesStore } from './update-preferences-store';

const STARTUP_CHECK_DELAY_MS = 15_000;
const RELEASES_PAGE_URL = 'https://github.com/anwen0724/megumi/releases';

export type ElectronAutoUpdaterEvent =
  | { readonly type: 'error'; readonly error: Error }
  | { readonly type: 'update-available' }
  | { readonly type: 'update-not-available' }
  | { readonly type: 'update-downloaded' };

export interface ElectronAutoUpdaterAdapter {
  /** Configures the fixed feed selected by Main. */
  setFeedUrl(url: string): void;
  /** Starts Squirrel's combined feed check and background download. */
  checkForUpdates(): void;
  /** Exits and installs an already downloaded update. */
  quitAndInstall(): void;
  /** Projects Electron events and returns their shared cleanup. */
  subscribe(listener: (event: ElectronAutoUpdaterEvent) => void): () => void;
}

export interface ApplicationUpdateControllerDependencies {
  readonly currentVersion: string;
  readonly platform: NodeJS.Platform | string;
  readonly arch: string;
  readonly isPackaged: boolean;
  readonly isSquirrelInstalled: boolean;
  readonly isSquirrelFirstRun: boolean;
  readonly preferences: UpdatePreferencesStore;
  readonly releaseMetadata: {
    /** Checks stable Release metadata without downloading application assets. */
    checkLatest(currentVersion: string): Promise<ApplicationReleaseCheckResult>;
  };
  readonly updater: ElectronAutoUpdaterAdapter;
  readonly prepareToQuit: () => Promise<void>;
  readonly openExternal: (url: string) => Promise<void>;
  readonly schedule: (callback: () => void, delayMs: number) => () => void;
  readonly now: () => Date;
  readonly logger: DesktopRuntimeLogger;
}

export interface ApplicationUpdateController {
  /** Registers platform listeners and schedules at most one startup check. */
  start(): void;
  /** Returns the current immutable user-facing projection. */
  getSnapshot(): ApplicationUpdateSnapshot;
  /** Runs an immediate metadata-only check through the shared concurrency gate. */
  checkNow(): Promise<ApplicationUpdateSnapshot>;
  /** Persists the startup-check preference and enforces its download dependency. */
  setAutomaticChecksEnabled(enabled: boolean): Promise<ApplicationUpdateSnapshot>;
  /** Persists future automatic-download behavior when automatic checks are enabled. */
  setAutomaticDownloadsEnabled(enabled: boolean): Promise<ApplicationUpdateSnapshot>;
  /** Starts Squirrel download only for the currently validated available Release. */
  downloadUpdate(): Promise<ApplicationUpdateSnapshot>;
  /** Awaits Desktop shutdown preparation before handing control to Squirrel. */
  restartAndInstall(): Promise<void>;
  /** Opens either the validated current Release page or the fixed repository Releases page. */
  openReleasePage(): Promise<void>;
  /** Observes future immutable Snapshots and returns an idempotent cancellation function. */
  subscribe(listener: (snapshot: ApplicationUpdateSnapshot) => void): () => void;
  /** Cancels pending startup work and removes platform listeners. */
  dispose(): void;
}

/** Creates the stateful update Module used by Main composition and IPC. */
export function createApplicationUpdateController(
  dependencies: ApplicationUpdateControllerDependencies,
): ApplicationUpdateController {
  let preferences = normalizePreferences(dependencies.preferences.read());
  const common = () => ({
    currentVersion: dependencies.currentVersion,
    platform: dependencies.platform,
    arch: dependencies.arch,
    automaticChecksEnabled: preferences.automaticChecksEnabled,
    automaticDownloadsEnabled: preferences.automaticDownloadsEnabled,
  });
  const unsupportedReason = resolveUnsupportedReason(dependencies);
  let snapshot: ApplicationUpdateSnapshot = unsupportedReason
    ? { ...common(), status: 'unsupported', reason: unsupportedReason }
    : { ...common(), status: 'idle' };
  let started = false;
  let disposed = false;
  let cancelStartupCheck: (() => void) | undefined;
  let unsubscribeUpdater: (() => void) | undefined;
  let activeCheck: Promise<ApplicationUpdateSnapshot> | undefined;
  let lastCheckedAt: string | undefined;
  const squirrelFirstRunUnlockAt = dependencies.now().getTime() + STARTUP_CHECK_DELAY_MS;
  const listeners = new Set<(value: ApplicationUpdateSnapshot) => void>();

  function publish(next: ApplicationUpdateSnapshot): ApplicationUpdateSnapshot {
    const previousStatus = snapshot.status;
    snapshot = Object.freeze(next);
    dependencies.logger.info?.('application_update_state_changed', {
      previousStatus,
      status: snapshot.status,
      currentVersion: dependencies.currentVersion,
      ...('targetVersion' in snapshot ? { targetVersion: snapshot.targetVersion } : {}),
    });
    for (const listener of listeners) listener(snapshot);
    return snapshot;
  }

  function publishWithCurrentPreferences(next: ApplicationUpdateSnapshot): ApplicationUpdateSnapshot {
    return publish({
      ...next,
      automaticChecksEnabled: preferences.automaticChecksEnabled,
      automaticDownloadsEnabled: preferences.automaticDownloadsEnabled,
    });
  }

  // One gate owns both check sources so entering About cannot create competing remote requests.
  async function check(source: 'automatic' | 'manual'): Promise<ApplicationUpdateSnapshot> {
    if (snapshot.status === 'unsupported' || disposed) return snapshot;
    if (activeCheck) return activeCheck;
    if (snapshot.status === 'downloading' || snapshot.status === 'ready' || snapshot.status === 'installing') {
      return snapshot;
    }
    if (
      source === 'manual'
      && dependencies.isSquirrelFirstRun
      && dependencies.now().getTime() < squirrelFirstRunUnlockAt
    ) {
      return publishError('installer_busy', true, 'check');
    }

    activeCheck = (async () => {
      publishWithCurrentPreferences({
        ...common(),
        status: 'checking',
        source,
        ...(lastCheckedAt ? { lastCheckedAt } : {}),
      });
      try {
        const result = await dependencies.releaseMetadata.checkLatest(dependencies.currentVersion);
        lastCheckedAt = dependencies.now().toISOString();
        if (result.status === 'up_to_date') {
          return publishWithCurrentPreferences({ ...common(), status: 'up_to_date', checkedAt: lastCheckedAt });
        }
        const available = publishAvailable(result.release, lastCheckedAt);
        if (preferences.automaticDownloadsEnabled) return beginDownload();
        return available;
      } catch (error) {
        return publishOperationError(error, 'check');
      } finally {
        activeCheck = undefined;
      }
    })();
    return activeCheck;
  }

  function publishAvailable(release: ApplicationUpdateRelease, checkedAt: string): ApplicationUpdateSnapshot {
    return publishWithCurrentPreferences({
      ...common(),
      status: 'available',
      checkedAt,
      ...releaseSnapshotFields(release),
    });
  }

  // Electron's check command is intentionally invoked only after metadata discovery and user policy allow download.
  async function beginDownload(): Promise<ApplicationUpdateSnapshot> {
    if (snapshot.status !== 'available') return snapshot;
    const release = releaseFromSnapshot(snapshot);
    publishWithCurrentPreferences({ ...common(), status: 'downloading', ...releaseSnapshotFields(release) });
    try {
      dependencies.updater.setFeedUrl(updateFeedUrl(dependencies.currentVersion));
      dependencies.updater.checkForUpdates();
      return snapshot;
    } catch (error) {
      return publishOperationError(error, 'download', release);
    }
  }

  // Platform events are meaningful only while the Controller owns an active download attempt.
  function handleUpdaterEvent(event: ElectronAutoUpdaterEvent): void {
    if (snapshot.status !== 'downloading' || disposed) return;
    const release = releaseFromSnapshot(snapshot);
    if (event.type === 'update-downloaded') {
      publishWithCurrentPreferences({ ...common(), status: 'ready', ...releaseSnapshotFields(release) });
      return;
    }
    if (event.type === 'update-not-available') {
      publishError('update_feed_not_ready', true, 'download', release);
      return;
    }
    if (event.type === 'error') {
      publishError('update_download_failed', true, 'download', release, event.error);
    }
  }

  function publishOperationError(
    error: unknown,
    operation: 'check' | 'download' | 'install',
    release?: ApplicationUpdateRelease,
  ): ApplicationUpdateSnapshot {
    if (error instanceof ApplicationUpdateOperationError) {
      return publishError(error.code, error.retryable, operation, release, error);
    }
    return publishError(
      operation === 'download' ? 'update_download_failed' : 'unknown_update_error',
      true,
      operation,
      release,
      error,
    );
  }

  // User state receives stable codes while technical details remain in Desktop runtime logs.
  function publishError(
    errorCode: ApplicationUpdateErrorCode,
    retryable: boolean,
    operation: 'check' | 'download' | 'install',
    release?: ApplicationUpdateRelease,
    technicalError?: unknown,
  ): ApplicationUpdateSnapshot {
    dependencies.logger.warn('application_update_failed', {
      errorCode,
      operation,
      currentVersion: dependencies.currentVersion,
      ...(release ? { targetVersion: release.version } : {}),
      ...(technicalError
        ? { errorMessage: technicalError instanceof Error ? technicalError.message : String(technicalError) }
        : {}),
    });
    return publishWithCurrentPreferences({
      ...common(),
      status: 'error',
      errorCode,
      retryable,
      operation,
      ...(lastCheckedAt ? { lastCheckedAt } : {}),
      ...(release ? { targetVersion: release.version, releasePageUrl: release.releasePageUrl } : {}),
    });
  }

  return {
    start() {
      if (started || disposed || snapshot.status === 'unsupported') return;
      started = true;
      unsubscribeUpdater = dependencies.updater.subscribe(handleUpdaterEvent);
      if (preferences.automaticChecksEnabled) {
        cancelStartupCheck = dependencies.schedule(() => {
          cancelStartupCheck = undefined;
          void check('automatic');
        }, STARTUP_CHECK_DELAY_MS);
      }
    },
    getSnapshot: () => snapshot,
    checkNow: () => check('manual'),
    async setAutomaticChecksEnabled(enabled) {
      preferences = enabled
        ? { ...preferences, automaticChecksEnabled: true }
        : { automaticChecksEnabled: false, automaticDownloadsEnabled: false };
      dependencies.preferences.write(preferences);
      return publishWithCurrentPreferences(snapshot);
    },
    async setAutomaticDownloadsEnabled(enabled) {
      preferences = {
        ...preferences,
        automaticDownloadsEnabled: preferences.automaticChecksEnabled && enabled,
      };
      dependencies.preferences.write(preferences);
      return publishWithCurrentPreferences(snapshot);
    },
    downloadUpdate: beginDownload,
    async restartAndInstall() {
      if (snapshot.status !== 'ready') {
        publishError('update_not_ready', false, 'install');
        return;
      }
      const release = releaseFromSnapshot(snapshot);
      const targetVersion = release.version;
      publishWithCurrentPreferences({ ...common(), status: 'installing', targetVersion });
      cancelStartupCheck?.();
      cancelStartupCheck = undefined;
      try {
        await dependencies.prepareToQuit();
      } catch (error) {
        publishError('restart_prepare_failed', true, 'install', release, error);
        return;
      }
      try {
        dependencies.updater.quitAndInstall();
      } catch (error) {
        publishError('unknown_update_error', true, 'install', release, error);
      }
    },
    async openReleasePage() {
      const url = 'releasePageUrl' in snapshot ? snapshot.releasePageUrl ?? RELEASES_PAGE_URL : RELEASES_PAGE_URL;
      await dependencies.openExternal(url);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelStartupCheck?.();
      cancelStartupCheck = undefined;
      unsubscribeUpdater?.();
      unsubscribeUpdater = undefined;
      listeners.clear();
    },
  };
}

function normalizePreferences(preferences: ApplicationUpdatePreferences): ApplicationUpdatePreferences {
  return preferences.automaticChecksEnabled
    ? preferences
    : { automaticChecksEnabled: false, automaticDownloadsEnabled: false };
}

function resolveUnsupportedReason(
  dependencies: ApplicationUpdateControllerDependencies,
): 'development' | 'platform' | 'not_installed' | undefined {
  if (!dependencies.isPackaged) return 'development';
  if (dependencies.platform !== 'win32' || dependencies.arch !== 'x64') return 'platform';
  if (!dependencies.isSquirrelInstalled) return 'not_installed';
  return undefined;
}

function updateFeedUrl(currentVersion: string): string {
  return `https://update.electronjs.org/anwen0724/megumi/win32-x64/${currentVersion}`;
}

function releaseSnapshotFields(release: ApplicationUpdateRelease) {
  return {
    targetVersion: release.version,
    releaseTitle: release.title,
    ...(release.notesSummary ? { notesSummary: release.notesSummary } : {}),
    releasePageUrl: release.releasePageUrl,
  };
}

function releaseFromSnapshot(snapshot: Extract<
  ApplicationUpdateSnapshot,
  { status: 'available' | 'downloading' | 'ready' }
>): ApplicationUpdateRelease {
  return {
    version: snapshot.targetVersion,
    title: snapshot.releaseTitle,
    ...(snapshot.notesSummary ? { notesSummary: snapshot.notesSummary } : {}),
    releasePageUrl: snapshot.releasePageUrl,
  };
}
