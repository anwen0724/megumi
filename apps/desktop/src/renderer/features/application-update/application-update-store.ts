/*
 * Owns the process-wide Renderer projection, commands, and deduplicated update notification.
 */
import { create } from 'zustand';
import type { ApplicationUpdateSnapshot } from '../../../application-update/application-update-contract';
import { rendererI18n } from '../../shared/i18n';
import { showToast, useToastStore } from '../../shared/ui/toast-store';

interface ApplicationUpdateStore {
  readonly snapshot?: ApplicationUpdateSnapshot;
  readonly loadError: boolean;
  readonly aboutRequestId: number;
  checkNow(): Promise<void>;
  setAutomaticChecksEnabled(enabled: boolean): Promise<void>;
  setAutomaticDownloadsEnabled(enabled: boolean): Promise<void>;
  downloadUpdate(): Promise<void>;
  restartAndInstall(): Promise<void>;
  openReleasePage(): Promise<void>;
  requestAboutOpen(): void;
}

let unsubscribeSnapshot: (() => void) | undefined;
let initialization: Promise<void> | undefined;
let announcedVersion: string | undefined;

export const useApplicationUpdateStore = create<ApplicationUpdateStore>((set) => ({
  snapshot: undefined,
  loadError: false,
  aboutRequestId: 0,
  checkNow: () => runSnapshotCommand(() => window.megumi.applicationUpdate.checkNow()),
  setAutomaticChecksEnabled: (enabled) => runSnapshotCommand(
    () => window.megumi.applicationUpdate.setAutomaticChecksEnabled(enabled),
  ),
  setAutomaticDownloadsEnabled: (enabled) => runSnapshotCommand(
    () => window.megumi.applicationUpdate.setAutomaticDownloadsEnabled(enabled),
  ),
  downloadUpdate: () => runSnapshotCommand(() => window.megumi.applicationUpdate.downloadUpdate()),
  async restartAndInstall() {
    try {
      await window.megumi.applicationUpdate.restartAndInstall();
    } catch {
      set({ loadError: true });
    }
  },
  async openReleasePage() {
    try {
      await window.megumi.applicationUpdate.openReleasePage();
    } catch {
      set({ loadError: true });
    }
  },
  requestAboutOpen() {
    set((state) => ({ aboutRequestId: state.aboutRequestId + 1 }));
  },
}));

/** Registers the update event before reading the initial Snapshot and remains idempotent. */
export function initializeApplicationUpdateStore(): Promise<void> {
  if (initialization) return initialization;
  initialization = (async () => {
    const updateApi = window.megumi.applicationUpdate;
    if (!updateApi) {
      useApplicationUpdateStore.setState({ loadError: true });
      return;
    }
    unsubscribeSnapshot = updateApi.onSnapshot(applySnapshot);
    try {
      applySnapshot(await updateApi.getSnapshot());
    } catch {
      useApplicationUpdateStore.setState({ loadError: true });
    }
  })();
  return initialization;
}

/** Removes the process event listener; subsequent initialization may attach a new Preload listener. */
export function disposeApplicationUpdateStore(): void {
  unsubscribeSnapshot?.();
  unsubscribeSnapshot = undefined;
  initialization = undefined;
}

async function runSnapshotCommand(command: () => Promise<ApplicationUpdateSnapshot>): Promise<void> {
  try {
    applySnapshot(await command());
  } catch {
    useApplicationUpdateStore.setState({ loadError: true });
  }
}

function applySnapshot(snapshot: ApplicationUpdateSnapshot): void {
  useApplicationUpdateStore.setState({ snapshot, loadError: false });
  if (!isPendingUpdate(snapshot)) return;
  showUpdateToast(snapshot);
}

function isPendingUpdate(snapshot: ApplicationUpdateSnapshot): snapshot is Extract<
  ApplicationUpdateSnapshot,
  { status: 'available' | 'downloading' | 'ready' }
> {
  return snapshot.status === 'available' || snapshot.status === 'downloading' || snapshot.status === 'ready';
}

// The same stable id updates an existing toast; a manually dismissed toast stays dismissed for that version.
function showUpdateToast(snapshot: Extract<
  ApplicationUpdateSnapshot,
  { status: 'available' | 'downloading' | 'ready' }
>): void {
  const id = `application-update:${snapshot.targetVersion}`;
  const existing = useToastStore.getState().toasts.some((toast) => toast.id === id);
  if (announcedVersion === snapshot.targetVersion && !existing) return;
  announcedVersion = snapshot.targetVersion;
  showToast({
    id,
    tone: snapshot.status === 'ready' ? 'success' : 'info',
    title: rendererI18n.t(
      snapshot.status === 'ready' ? 'about.updateToastReady' : 'about.updateToastAvailable',
      { ns: 'settings', version: snapshot.targetVersion },
    ),
    message: rendererI18n.t('about.updateToastDescription', { ns: 'settings' }),
    durationMs: 0,
    action: {
      label: rendererI18n.t('about.viewUpdate', { ns: 'settings' }),
      onClick: () => useApplicationUpdateStore.getState().requestAboutOpen(),
    },
  });
}
