// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@megumi/desktop/renderer/app/App';
import { useSetupWizardStore } from '@megumi/desktop/renderer/features/setup-wizard';
import { useProviderStore } from '@megumi/desktop/renderer/entities/provider';

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
    },
  });
}

describe('App setup gate', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSetupWizardStore.setState(useSetupWizardStore.getInitialState(), true);
    useProviderStore.setState(useProviderStore.getInitialState(), true);
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
});
