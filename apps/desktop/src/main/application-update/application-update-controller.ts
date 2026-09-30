/* Owns update commands, candidate lifetime and the Renderer-facing state for Desktop. */
import type { ApplicationUpdateSnapshot, ApplicationUpdateRelease } from '../../application-update/application-update-contract';
import type { DesktopRuntimeLogger } from '../runtime-logger';
import type { UpdateSupportReason } from '../installation/installation-environment';
import { ApplicationUpdateFailure, type ElectronUpdaterAdapter } from './electron-updater-adapter';
import type { UpdatePreferencesStore } from './update-preferences-store';

export interface ApplicationUpdateController {
  /** Schedules the single startup check after successful application startup. */
  start(): void;
  /** Reads the current user-facing projection. */
  getSnapshot(): ApplicationUpdateSnapshot;
  /** Checks metadata without downloading; concurrent checks share the operation. */
  checkNow(): Promise<ApplicationUpdateSnapshot>;
  /** Saves the automatic-check preference. */
  setAutomaticChecksEnabled(enabled: boolean): Promise<ApplicationUpdateSnapshot>;
  /** Downloads the current candidate after an explicit user request. */
  downloadUpdate(): Promise<ApplicationUpdateSnapshot>;
  /** Prepares normal shutdown before installing the verified candidate. */
  restartAndInstall(): Promise<void>;
  /** Opens the fixed project release page or the current validated release. */
  openReleasePage(): Promise<void>;
  /** Observes future snapshots and returns an unsubscribe function. */
  subscribe(listener: (snapshot: ApplicationUpdateSnapshot) => void): () => void;
  /** Releases the startup timer and update observers. */
  dispose(): void;
}

/** Creates the sole command owner used by Main and IPC. */
export function createApplicationUpdateController(request: {
  currentVersion: string; platform: string; arch: string; supportReason?: UpdateSupportReason;
  preferences: UpdatePreferencesStore; updater?: ElectronUpdaterAdapter;
  prepareToQuit: () => Promise<void>; openExternal: (url: string) => Promise<void>;
  schedule: (callback: () => void, delayMs: number) => () => void;
  now: () => Date; logger: DesktopRuntimeLogger;
}): ApplicationUpdateController {
  let preferences = request.preferences.read();
  let checkedAt: string | undefined;
  let candidate: ApplicationUpdateRelease | undefined;
  const common = () => ({ currentVersion: request.currentVersion, platform: request.platform,
    arch: request.arch, automaticChecksEnabled: preferences.automaticChecksEnabled,
    ...(checkedAt ? { checkedAt } : {}) });
  let snapshot: ApplicationUpdateSnapshot = request.supportReason
    ? { ...common(), status: 'unsupported', supportReason: request.supportReason }
    : { ...common(), status: 'idle' };
  const listeners = new Set<(snapshot: ApplicationUpdateSnapshot) => void>();
  let activeCheck: Promise<ApplicationUpdateSnapshot> | undefined;
  let activeDownload: Promise<ApplicationUpdateSnapshot> | undefined;
  let activeInstall: Promise<void> | undefined;
  let cancelStartup: (() => void) | undefined;
  let started = false;
  let disposed = false;

  function publish(next: ApplicationUpdateSnapshot): ApplicationUpdateSnapshot {
    if (disposed) return snapshot;
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener(snapshot);
    return snapshot;
  }

  function check(): Promise<ApplicationUpdateSnapshot> {
    if (disposed || !request.updater) return Promise.resolve(snapshot);
    if (activeDownload || activeInstall || snapshot.status === 'ready') {
      return Promise.resolve(snapshot);
    }
    if (activeCheck) return activeCheck;
    publish({ ...common(), status: 'checking' });
    candidate = undefined;
    activeCheck = request.updater.check().then(release => {
      candidate = release;
      checkedAt = request.now().toISOString();
      return publish(release ? { ...common(), status: 'available', release }
        : { ...common(), status: 'up_to_date' });
    }).catch(error => {
      request.logger.warn('application_update_check_failed', { error: String(error) });
      return publish({ ...common(), status: 'error', error: {
        operation: 'check', code: error instanceof ApplicationUpdateFailure ? error.code : 'unknown_update_error', retryable: true,
      } });
    }).finally(() => { activeCheck = undefined; });
    return activeCheck;
  }

  return {
    start() {
      if (started || disposed || request.supportReason) return;
      started = true;
      if (preferences.automaticChecksEnabled) cancelStartup = request.schedule(() => { void check(); }, 30_000);
    },
    getSnapshot: () => snapshot,
    checkNow: check,
    async setAutomaticChecksEnabled(enabled) {
      if (disposed || request.supportReason || snapshot.status === 'preparing_install') return snapshot;
      try {
        request.preferences.write({ automaticChecksEnabled: enabled });
      } catch (error) {
        request.logger.warn('application_update_preferences_write_failed', { error: String(error) });
        return publish({ ...common(), status: 'error', error: {
          operation: 'preferences', code: 'preferences_write_failed', retryable: true,
        } });
      }
      preferences = { automaticChecksEnabled: enabled };
      if (!enabled) cancelStartup?.();
      return publish({ ...snapshot, automaticChecksEnabled: enabled });
    },
    downloadUpdate() {
      if (activeDownload) return activeDownload;
      const canRetry = snapshot.status === 'error' && snapshot.error.operation === 'download' && snapshot.error.retryable;
      if (disposed || !request.updater || !candidate || (snapshot.status !== 'available' && !canRetry)) return Promise.resolve(snapshot);
      const release = candidate;
      publish({ ...common(), status: 'downloading', release });
      activeDownload = request.updater.download(progress => {
        publish({ ...common(), status: 'downloading', release, progress });
      }).then(() => publish({ ...common(), status: 'ready', release }))
        .catch(error => {
          request.logger.warn('application_update_download_failed', { error: String(error) });
          return publish({ ...common(), status: 'error', error: {
            operation: 'download', code: error instanceof ApplicationUpdateFailure ? error.code : 'update_download_failed',
            retryable: true, targetVersion: release.version,
          } });
        }).finally(() => { activeDownload = undefined; });
      return activeDownload;
    },
    restartAndInstall() {
      if (activeInstall) return activeInstall;
      const updater = request.updater;
      const canRetry = snapshot.status === 'error' && snapshot.error.code === 'restart_prepare_failed';
      if (disposed || !updater || !candidate || (snapshot.status !== 'ready' && !canRetry)) return Promise.resolve();
      const release = candidate;
      publish({ ...common(), status: 'preparing_install', release });
      cancelStartup?.();
      activeInstall = (async () => {
        try {
          await request.prepareToQuit();
        } catch (error) {
          request.logger.warn('application_update_prepare_failed', { error: String(error) });
          publish({ ...common(), status: 'error', error: {
            operation: 'install', code: 'restart_prepare_failed', retryable: true, targetVersion: release.version,
          } });
          return;
        }
        try {
          await updater.install();
        } catch (error) {
          request.logger.warn('application_update_install_failed', { error: String(error) });
          publish({ ...common(), status: 'error', error: {
            operation: 'install', code: 'installer_launch_failed', retryable: true, targetVersion: release.version,
          } });
        }
      })().finally(() => { activeInstall = undefined; });
      return activeInstall;
    },
    async openReleasePage() {
      await request.openExternal('release' in snapshot ? snapshot.release.releasePageUrl
        : 'https://github.com/anwen0724/megumi/releases');
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { disposed = true; cancelStartup?.(); listeners.clear(); },
  };
}
