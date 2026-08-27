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
  const openReleasePage = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    checkNow.mockResolvedValue(developmentSnapshot());
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
          openReleasePage,
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
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeInTheDocument();
    expect(screen.queryByText('Connect your preferred AI providers, work with project files, and keep control of local data and tool permissions.')).not.toBeInTheDocument();
    expect(screen.queryByText('Check and download are separate. Megumi never restarts to install without your action.')).not.toBeInTheDocument();
    expect(screen.queryByText('Check once, 15 seconds after each normal application startup.')).not.toBeInTheDocument();
    expect(screen.queryByText('Download after a check finds a stable update. Restarting is always your choice.')).not.toBeInTheDocument();
    expect(screen.queryByText('Megumi is developed openly on GitHub.')).not.toBeInTheDocument();
  });

  it('uses the same update UI in development while disabling installation-only actions', async () => {
    const user = userEvent.setup();
    useApplicationUpdateStore.setState({ snapshot: developmentSnapshot() });
    const view = render(<AboutMegumiPanel />);

    expect(screen.getByText('Ready to check')).toBeInTheDocument();
    expect(screen.queryByText('This environment supports version checks only')).not.toBeInTheDocument();
    expect(screen.queryByText('Development mode cannot download or install updates in the app.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(checkNow).toHaveBeenCalledOnce();
    expect(screen.getByRole('switch', { name: 'Check for updates on startup' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Download available updates automatically' })).toBeDisabled();

    useApplicationUpdateStore.setState({ snapshot: unavailableInstallationSnapshot() });
    view.rerender(<AboutMegumiPanel />);
    expect(screen.getByRole('button', { name: 'Download update' })).toBeDisabled();
    expect(downloadUpdate).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'View release' }));
    expect(openReleasePage).toHaveBeenCalledOnce();
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
    installation: { supported: true as const },
  } as const;
}

function developmentCommon() {
  return {
    ...common(),
    installation: { supported: false as const, reason: 'development' as const },
  };
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

function developmentSnapshot(): ApplicationUpdateSnapshot {
  return { ...developmentCommon(), status: 'idle' };
}

function unavailableInstallationSnapshot(): ApplicationUpdateSnapshot {
  return {
    ...developmentCommon(),
    status: 'available',
    checkedAt: '2026-08-28T00:00:00.000Z',
    targetVersion: '0.2.0',
    releaseTitle: 'Megumi 0.2.0',
    releasePageUrl: 'https://github.com/anwen0724/megumi/releases/tag/v0.2.0',
  };
}
