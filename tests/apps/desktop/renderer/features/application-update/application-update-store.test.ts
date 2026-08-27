/*
 * Verifies the Renderer keeps one process-wide update projection and one notification per version.
 */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplicationUpdateSnapshot } from '@megumi/desktop/application-update/application-update-contract';
import {
  disposeApplicationUpdateStore,
  initializeApplicationUpdateStore,
  useApplicationUpdateStore,
} from '@megumi/desktop/renderer/features/application-update/application-update-store';
import { useToastStore } from '@megumi/desktop/renderer/shared/ui/toast-store';

describe('Application update Renderer store', () => {
  let publishSnapshot: ((snapshot: ApplicationUpdateSnapshot) => void) | undefined;
  const getSnapshot = vi.fn();
  const checkNow = vi.fn();
  const downloadUpdate = vi.fn();

  beforeEach(() => {
    disposeApplicationUpdateStore();
    useApplicationUpdateStore.setState({ snapshot: undefined, loadError: false, aboutRequestId: 0 });
    useToastStore.setState({ toasts: [] });
    publishSnapshot = undefined;
    getSnapshot.mockReset().mockResolvedValue(idleSnapshot());
    checkNow.mockReset().mockResolvedValue(upToDateSnapshot());
    downloadUpdate.mockReset().mockResolvedValue(downloadingSnapshot());
    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: {
        applicationUpdate: {
          getSnapshot,
          checkNow,
          downloadUpdate,
          setAutomaticChecksEnabled: vi.fn(),
          setAutomaticDownloadsEnabled: vi.fn(),
          restartAndInstall: vi.fn(),
          openReleasePage: vi.fn(),
          onSnapshot: vi.fn((listener: (snapshot: ApplicationUpdateSnapshot) => void) => {
            publishSnapshot = listener;
            return vi.fn();
          }),
        },
      },
    });
  });

  it('subscribes before loading the initial snapshot and does so only once', async () => {
    await Promise.all([initializeApplicationUpdateStore(), initializeApplicationUpdateStore()]);
    expect(window.megumi.applicationUpdate.onSnapshot).toHaveBeenCalledOnce();
    expect(getSnapshot).toHaveBeenCalledOnce();
    expect(useApplicationUpdateStore.getState().snapshot?.status).toBe('idle');
  });

  it('deduplicates available and ready notifications for the same target version', async () => {
    await initializeApplicationUpdateStore();
    publishSnapshot?.(availableSnapshot());
    publishSnapshot?.(availableSnapshot());
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].durationMs).toBe(0);

    publishSnapshot?.(readySnapshot());
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].title).toMatch(/ready/i);
    useToastStore.getState().toasts[0].action?.onClick();
    expect(useApplicationUpdateStore.getState().aboutRequestId).toBe(1);
  });

  it('applies command responses through the same snapshot projection', async () => {
    await initializeApplicationUpdateStore();
    await useApplicationUpdateStore.getState().checkNow();
    expect(checkNow).toHaveBeenCalledOnce();
    expect(useApplicationUpdateStore.getState().snapshot?.status).toBe('up_to_date');
    useApplicationUpdateStore.setState({ snapshot: availableSnapshot() });
    await useApplicationUpdateStore.getState().downloadUpdate();
    expect(downloadUpdate).toHaveBeenCalledOnce();
    expect(useApplicationUpdateStore.getState().snapshot?.status).toBe('downloading');
  });
});

function common() {
  return {
    currentVersion: '0.1.0',
    platform: 'win32',
    arch: 'x64',
    automaticChecksEnabled: true,
    automaticDownloadsEnabled: false,
  } as const;
}

function idleSnapshot(): ApplicationUpdateSnapshot {
  return { ...common(), status: 'idle' };
}

function upToDateSnapshot(): ApplicationUpdateSnapshot {
  return { ...common(), status: 'up_to_date', checkedAt: '2026-08-28T00:00:00.000Z' };
}

function availableSnapshot(): ApplicationUpdateSnapshot {
  return {
    ...common(),
    status: 'available',
    checkedAt: '2026-08-28T00:00:00.000Z',
    targetVersion: '0.2.0',
    releaseTitle: 'Megumi 0.2.0',
    notesSummary: 'Safer updates.',
    releasePageUrl: 'https://github.com/anwen0724/megumi/releases/tag/v0.2.0',
  };
}

function downloadingSnapshot(): ApplicationUpdateSnapshot {
  return { ...availableSnapshot(), status: 'downloading' };
}

function readySnapshot(): ApplicationUpdateSnapshot {
  return { ...availableSnapshot(), status: 'ready' };
}
