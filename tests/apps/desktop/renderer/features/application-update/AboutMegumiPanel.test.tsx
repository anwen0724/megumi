/*
 * Verifies About presents one truthful primary action for every update state.
 */
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplicationUpdateSnapshot } from '@megumi/desktop/application-update/application-update-contract';
import { AboutMegumiPanel } from '@megumi/desktop/renderer/features/application-update/AboutMegumiPanel';
import { useApplicationUpdateStore } from '@megumi/desktop/renderer/features/application-update/application-update-store';
import { SettingsPage } from '@megumi/desktop/renderer/shell/SettingsPage';

describe('AboutMegumiPanel', () => {
  const checkNow = vi.fn();
  const downloadUpdate = vi.fn();
  const restartAndInstall = vi.fn();
  const setAutomaticChecksEnabled = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: {
        applicationUpdate: {
          getSnapshot: vi.fn(),
          checkNow,
          downloadUpdate,
          setAutomaticChecksEnabled,
          setAutomaticDownloadsEnabled: vi.fn(),
          restartAndInstall,
          openReleasePage: vi.fn(),
          onSnapshot: vi.fn(() => vi.fn()),
        },
      },
    });
    useApplicationUpdateStore.setState({ snapshot: idleSnapshot(), loadError: false, aboutRequestId: 0 });
  });

  it('shows real application identity and separate automatic check/download controls', () => {
    render(<AboutMegumiPanel />);
    expect(screen.getByRole('img', { name: 'Megumi' })).toBeInTheDocument();
    expect(screen.getByText('Version 0.1.0')).toBeInTheDocument();
    expect(screen.getByText('Windows x64')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Check for updates on startup' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Download available updates automatically' })).not.toBeChecked();
  });

  it('shows Download update for available and Restart and update only for ready', async () => {
    const user = userEvent.setup();
    useApplicationUpdateStore.setState({ snapshot: availableSnapshot() });
    const view = render(<AboutMegumiPanel />);
    await user.click(screen.getByRole('button', { name: 'Download update' }));
    expect(downloadUpdate).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Restart and update' })).not.toBeInTheDocument();

    useApplicationUpdateStore.setState({ snapshot: readySnapshot() });
    view.rerender(<AboutMegumiPanel />);
    await user.click(screen.getByRole('button', { name: 'Restart and update' }));
    expect(restartAndInstall).toHaveBeenCalledOnce();
  });

  it('uses a genuinely disabled progress action while a check is running', () => {
    useApplicationUpdateStore.setState({ snapshot: { ...common(), status: 'checking', source: 'manual' } });
    render(<AboutMegumiPanel />);
    expect(screen.getByRole('button', { name: 'Checking for updates…' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Download update' })).not.toBeInTheDocument();
  });

  it('disables automatic download when startup checks are turned off', async () => {
    const user = userEvent.setup();
    render(<AboutMegumiPanel />);
    await user.click(screen.getByRole('switch', { name: 'Check for updates on startup' }));
    expect(setAutomaticChecksEnabled).toHaveBeenCalledWith(false);
  });

  it('keeps the About sidebar marker visible independently from a Toast', () => {
    useApplicationUpdateStore.setState({ snapshot: availableSnapshot() });
    render(<SettingsPage onDone={vi.fn()} initialCategory="about" />);
    expect(screen.getByRole('tab', { name: /About Megumi.*Update available/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download update' })).toBeInTheDocument();
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

function readySnapshot(): ApplicationUpdateSnapshot {
  return { ...availableSnapshot(), status: 'ready' };
}
