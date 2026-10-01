/* Owns update commands, candidate lifetime and the Renderer-facing state for Desktop. */
import type { ApplicationUpdateSnapshot } from '../../application-update/application-update-contract';
import type { DesktopRuntimeLogger } from '../runtime-logger';
import type { UpdateSupportReason } from '../installation/installation-environment';
import { ApplicationUpdateFailure, type ElectronUpdaterAdapter } from './electron-updater-adapter';
import type { UpdatePreferencesStore } from './update-preferences-store';
import type { UpdateState, UpdateStateStore } from './update-state-store';

export interface ApplicationUpdateController {
  /** Restores a local download and schedules the optional startup metadata check. */
  start(): void;
  /** Reads the current user-facing projection. */
  getSnapshot(): ApplicationUpdateSnapshot;
  /** Checks metadata or retries local cache verification; never downloads. */
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
  preferences: UpdatePreferencesStore; stateStore: UpdateStateStore; updater?: ElectronUpdaterAdapter;
  prepareToQuit: () => Promise<void>; openExternal: (url: string) => Promise<void>;
  schedule: (callback: () => void, delayMs: number) => () => void;
  now: () => Date; logger: DesktopRuntimeLogger;
}): ApplicationUpdateController {
  let preferences = request.preferences.read();
  const saved = request.supportReason ? undefined : request.stateStore.read();
  let state = saved && saved.sourceKey === request.updater?.sourceKey
    && isNewer(saved.candidate.release.version, request.currentVersion) ? saved : undefined;
  if (saved && !state) {
    try { request.stateStore.write(undefined); }
    catch (error) { request.logger.warn('application_update_state_reset_failed', { error: String(error) }); }
  }
  let checkedAt = state?.checkedAt;
  let candidate = state?.candidate;
  const common = () => ({ currentVersion: request.currentVersion, platform: request.platform,
    arch: request.arch, automaticChecksEnabled: preferences.automaticChecksEnabled,
    ...(checkedAt ? { checkedAt } : {}) });
  let snapshot: ApplicationUpdateSnapshot = request.supportReason
    ? { ...common(), status: 'unsupported', supportReason: request.supportReason }
    : candidate ? { ...common(), status: state?.downloadRequested ? 'verifying' : 'available',
      release: candidate.release, ...(state?.downloadRequested ? {} : { lastKnown: true }) }
      : { ...common(), status: 'idle' };
  const listeners = new Set<(snapshot: ApplicationUpdateSnapshot) => void>();
  let activeCheck: Promise<ApplicationUpdateSnapshot> | undefined;
  let activeDownload: Promise<ApplicationUpdateSnapshot> | undefined;
  let activeInstall: Promise<void> | undefined;
  let activeRestore: Promise<ApplicationUpdateSnapshot> | undefined;
  let cancelStartup: (() => void) | undefined;
  let started = false;
  let disposed = false;

  function publish(next: ApplicationUpdateSnapshot): ApplicationUpdateSnapshot {
    if (disposed) return snapshot;
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener(snapshot);
    return snapshot;
  }

  function save(next: UpdateState | undefined): void {
    try { request.stateStore.write(next); }
    catch (error) { throw new ApplicationUpdateFailure('update_state_write_failed', error); }
    state = next;
  }

  function failure(operation: 'check' | 'download' | 'restore', error: unknown): ApplicationUpdateSnapshot {
    request.logger.warn(`application_update_${operation}_failed`, { error: String(error) });
    return publish({ ...common(), status: 'error', ...(candidate ? { release: candidate.release } : {}), error: {
      operation, code: error instanceof ApplicationUpdateFailure ? error.code : 'unknown_update_error',
      retryable: true, targetVersion: candidate?.release.version,
    } });
  }

  function restore(): Promise<ApplicationUpdateSnapshot> {
    if (activeRestore) return activeRestore;
    const pending = state;
    if (!request.updater || !pending?.downloadRequested || disposed) return Promise.resolve(snapshot);
    publish({ ...common(), status: 'verifying', release: pending.candidate.release });
    activeRestore = request.updater.restore(pending).then(() => {
      if (disposed) return snapshot;
      save({ ...pending, downloadedAt: pending.downloadedAt ?? request.now().toISOString() });
      return publish({ ...common(), status: 'ready', release: pending.candidate.release });
    }).catch(error => failure('restore', error)).finally(() => { activeRestore = undefined; });
    return activeRestore;
  }

  async function discover(): Promise<ApplicationUpdateSnapshot> {
    const updater = request.updater;
    if (!updater) return snapshot;
    const next = await updater.check();
    if (disposed) return snapshot;
    const nextCheckedAt = request.now().toISOString();
    if (next) {
      if (!updater.sourceKey) throw new ApplicationUpdateFailure('release_metadata_invalid', 'Missing source configuration');
      save({ schemaVersion: 1, sourceKey: updater.sourceKey, checkedAt: nextCheckedAt, candidate: next, downloadRequested: false });
    } else save(undefined);
    candidate = next;
    checkedAt = nextCheckedAt;
    return publish(next ? { ...common(), status: 'available', release: next.release }
      : { ...common(), status: 'up_to_date' });
  }

  function check(): Promise<ApplicationUpdateSnapshot> {
    if (disposed || !request.updater) return Promise.resolve(snapshot);
    if (activeDownload || activeInstall || snapshot.status === 'ready') {
      return Promise.resolve(snapshot);
    }
    if (state?.downloadRequested) return restore();
    if (activeCheck) return activeCheck;
    publish({ ...common(), status: 'checking', ...(candidate ? { release: candidate.release } : {}) });
    activeCheck = discover().catch(error => failure('check', error)).finally(() => { activeCheck = undefined; });
    return activeCheck;
  }

  return {
    start() {
      if (started || disposed || request.supportReason) return;
      started = true;
      if (state?.downloadRequested) void restore();
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
        return publish({ ...common(), status: 'error', ...(candidate ? { release: candidate.release } : {}), error: {
          operation: 'preferences', code: 'preferences_write_failed', retryable: true,
        } });
      }
      preferences = { automaticChecksEnabled: enabled };
      if (!enabled) cancelStartup?.();
      return publish({ ...snapshot, automaticChecksEnabled: enabled });
    },
    downloadUpdate() {
      if (activeDownload) return activeDownload;
      const canRetry = snapshot.status === 'error' && snapshot.error.retryable &&
        (snapshot.error.operation === 'download' || snapshot.error.operation === 'check' ||
          (snapshot.error.operation === 'restore' && ['update_cache_missing', 'update_verification_failed'].includes(snapshot.error.code)));
      const updater = request.updater;
      if (disposed || activeCheck || activeRestore || !updater || !candidate || (snapshot.status !== 'available' && !canRetry)) return Promise.resolve(snapshot);
      const selected = candidate;
      const release = selected.release;
      publish({ ...common(), status: 'checking', release });
      activeDownload = (async () => {
        // A user click authorizes only the displayed artifact. A changed release needs another click.
        await discover();
        if (disposed || !candidate || !state || candidate.release.version !== selected.release.version
          || candidate.artifact.sha512 !== selected.artifact.sha512 || candidate.artifact.fileName !== selected.artifact.fileName) return snapshot;
        save({ ...state, downloadRequested: true });
        publish({ ...common(), status: 'downloading', release });
        await updater.download(progress => { publish({ ...common(), status: 'downloading', release, progress }); });
        if (disposed) return snapshot;
        save({ ...state, downloadedAt: request.now().toISOString() });
        return publish({ ...common(), status: 'ready', release });
      })().catch(error => failure('download', error)).finally(() => { activeDownload = undefined; });
      return activeDownload;
    },
    restartAndInstall() {
      if (activeInstall) return activeInstall;
      const updater = request.updater;
      const canRetry = snapshot.status === 'error' && snapshot.error.code === 'restart_prepare_failed';
      if (disposed || !updater || !candidate || (snapshot.status !== 'ready' && !canRetry)) return Promise.resolve();
      const release = candidate.release;
      publish({ ...common(), status: 'preparing_install', release });
      cancelStartup?.();
      activeInstall = (async () => {
        try {
          await request.prepareToQuit();
        } catch (error) {
          request.logger.warn('application_update_prepare_failed', { error: String(error) });
          publish({ ...common(), status: 'error', release, error: {
            operation: 'install', code: 'restart_prepare_failed', retryable: true, targetVersion: release.version,
          } });
          return;
        }
        try {
          await updater.install();
        } catch (error) {
          request.logger.warn('application_update_install_failed', { error: String(error) });
          publish({ ...common(), status: 'error', release, error: {
            operation: 'install', code: 'installer_launch_failed', retryable: true, targetVersion: release.version,
          } });
        }
      })().finally(() => { activeInstall = undefined; });
      return activeInstall;
    },
    async openReleasePage() {
      await request.openExternal('release' in snapshot && snapshot.release ? snapshot.release.releasePageUrl
        : 'https://github.com/anwen0724/megumi/releases');
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { disposed = true; cancelStartup?.(); listeners.clear(); },
  };
}

function isNewer(target: string, current: string): boolean {
  const left = target.split('.').map(Number);
  const right = current.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}
