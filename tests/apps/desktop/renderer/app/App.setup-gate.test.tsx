// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@megumi/desktop/renderer/app/App';
import { useSetupWizardStore } from '@megumi/desktop/renderer/features/setup-wizard';
import { useProviderStore } from '@megumi/desktop/renderer/entities/provider';
import { rendererError } from '@megumi/desktop/renderer/shared/i18n';

let requestSettings: (() => void) | undefined;

function installMegumiMock() {
  Object.defineProperty(window, 'megumi', {
    configurable: true,
    value: {
      windowControls: {
        minimize: vi.fn(),
        toggleMaximize: vi.fn(),
        close: vi.fn(),
      },
      settings: {
        get: vi.fn(),
        update: vi.fn(),
      },
      settingsRecovery: {
        get: vi.fn().mockResolvedValue({ ok: true, data: { settingsPath: 'C:/test/settings.json' } }),
        openDirectory: vi.fn().mockResolvedValue({ ok: true, data: {} }),
        restart: vi.fn().mockResolvedValue({ ok: true, data: {} }),
      },
      provider: {
        list: vi.fn().mockResolvedValue({ ok: true, data: { status: 'ok', providers: [], catalog: [] } }),
        update: vi.fn(),
        setApiKey: vi.fn(),
        deleteApiKey: vi.fn(),
      },
      project: {
        list: vi.fn().mockResolvedValue({ ok: true, data: { projects: [] } }),
        useExisting: vi.fn().mockResolvedValue({ ok: true, data: { cancelled: true } }),
        open: vi.fn(),
        remove: vi.fn(),
      },
      session: {
        list: vi.fn().mockResolvedValue({ ok: true, data: { sessions: [] } }),
        message: {
          list: vi.fn().mockResolvedValue({ ok: true, data: { messages: [] } }),
          send: vi.fn(),
          cancel: vi.fn(),
        },
        timeline: {
          list: vi.fn().mockResolvedValue({ ok: true, data: { messages: [], diagnostics: [] } }),
        },
      },
      runtime: {
        onEvent: vi.fn(() => () => undefined),
      },
      character: {
        selectSession: vi.fn(),
        onOpenSettingsRequested: vi.fn((callback: () => void) => {
          requestSettings = callback;
          return vi.fn();
        }),
      },
    },
  });
}

describe('App setup gate', () => {
  it('shows a recovery page, not setup or product UI, after settings load failure', async () => {
    installMegumiMock();
    useSetupWizardStore.getState().applyBootstrapFailure(rendererError('settings_load_failed'));
    render(<App />);
    expect(screen.queryByTestId('setup-wizard')).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-body')).not.toBeInTheDocument();
    expect(await screen.findByText('C:/test/settings.json')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open configuration folder' }));
    expect(window.megumi.settingsRecovery.openDirectory).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Restart Megumi' }));
    expect(window.megumi.settingsRecovery.restart).toHaveBeenCalledOnce();
    expect(window.megumi.character.selectSession).not.toHaveBeenCalled();
    expect(window.megumi.settings.update).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.restoreAllMocks();
    useSetupWizardStore.setState(useSetupWizardStore.getInitialState(), true);
    useProviderStore.setState(useProviderStore.getInitialState(), true);
    requestSettings = undefined;
  });

  it('shows setup wizard before setup is completed', async () => {
    installMegumiMock();
    useSetupWizardStore.getState().applyBootstrapSettings({ language: 'zh-CN', setupCompleted: false });

    render(<App />);

    expect(screen.getByTestId('setup-wizard')).toBeInTheDocument();
    expect(screen.queryByTestId('app-body')).not.toBeInTheDocument();
    expect(window.megumi.settings.get).not.toHaveBeenCalled();
  });

  it('shows main app after setup is completed', async () => {
    installMegumiMock();
    useSetupWizardStore.getState().applyBootstrapSettings({ language: 'en-US', setupCompleted: true });

    render(<App />);

    expect(screen.getByTestId('app-body')).toBeInTheDocument();
    expect(screen.queryByTestId('setup-wizard')).not.toBeInTheDocument();
    expect(window.megumi.settings.get).not.toHaveBeenCalled();
  });

  it('opens the main Settings page when requested by the character menu', () => {
    installMegumiMock();
    useSetupWizardStore.getState().applyBootstrapSettings({ language: 'en-US', setupCompleted: true });
    render(<App />);

    act(() => requestSettings?.());

    expect(screen.getByTestId('settings-page')).toBeInTheDocument();
  });

  it('opens the first Settings category from the sidebar Settings button', async () => {
    installMegumiMock();
    useSetupWizardStore.getState().applyBootstrapSettings({ language: 'en-US', setupCompleted: true });
    render(<App />);

    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(screen.getByRole('tab', { name: 'Appearance' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('radiogroup', { name: 'Language' })).toBeInTheDocument();
  });
});
