// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProviderStore } from '@megumi/desktop/renderer/entities/provider/store';
import { SettingsPage } from '@megumi/desktop/renderer/shell/SettingsPage';

describe('SettingsPage provider settings', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: {
        voice: {
          getModelStatus: vi.fn().mockResolvedValue({
            ok: true,
            data: { status: 'not_prepared', bundleVersion: 'voice-v1', downloadedBytes: 0, totalBytes: 1 },
          }),
          checkModelUpdates: vi.fn().mockResolvedValue({ ok: true, data: { status: 'unavailable' } }),
          prepareModels: vi.fn().mockResolvedValue({ ok: true, data: { status: 'ok' } }),
          cancelModelPreparation: vi.fn().mockResolvedValue({ ok: true, data: { status: 'ok' } }),
        },
        settings: {
          get: vi.fn().mockResolvedValue({
            ok: true,
            data: {
              status: 'ok',
              settings: {
                voice: { inputDeviceId: 'default', outputDeviceId: 'default', recognitionLanguage: 'auto', readAloudEnabled: false, tts: { provider: 'minimax', voiceId: 'female-shaonv', hasApiKey: false, credentialSource: 'missing' } },
                permissions: { mode: 'ask', rules: [], catalog: { operations: [], tools: [] } },
              },
            },
          }),
          update: vi.fn().mockResolvedValue({
            ok: true,
            data: {
              status: 'updated',
              settings: { voice: { inputDeviceId: 'default', outputDeviceId: 'default', recognitionLanguage: 'auto', readAloudEnabled: false, tts: { provider: 'minimax', voiceId: 'female-shaonv', hasApiKey: false, credentialSource: 'missing' } } },
            },
          }),
        },
      },
    });
    useProviderStore.setState({
      providers: [
        {
          providerId: 'deepseek',
          displayName: 'DeepSeek',
          protocol: 'openai-completions',
          enabled: true,
          baseUrl: 'https://api.deepseek.com',
          modelIds: ['deepseek-v4-flash'],
          hasApiKey: false,
          credentialSource: 'missing',
          envOverrideActive: false,
        },
      ],
      status: 'ready',
      error: null,
      loadProviders: vi.fn(),
      updateProvider: vi.fn(),
      deleteProvider: vi.fn(),
      setApiKey: vi.fn(),
      deleteApiKey: vi.fn(),
    });
  });

  it('opens the Models & Providers pane with provider settings', async () => {
    const user = userEvent.setup();

    render(<SettingsPage onDone={vi.fn()} />);

    await user.click(screen.getByRole('tab', { name: 'Models & Providers' }));

    expect(screen.getByRole('heading', { name: 'Models & Providers' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Providers' })).toBeInTheDocument();
    expect(screen.getAllByText('DeepSeek').length).toBeGreaterThan(0);
    expect(screen.queryByText('Provider and model runtime settings')).not.toBeInTheDocument();
  });

  it('uses product-facing names for every settings category', async () => {
    const user = userEvent.setup();
    render(<SettingsPage onDone={vi.fn()} />);

    expect(screen.getByRole('tab', { name: 'Models & Providers' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Skills' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Web Access' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Privacy & Permissions' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Activity & Diagnostics' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'About Megumi' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Voice' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Privacy & Permissions' }));
    expect(screen.getByRole('heading', { name: 'Privacy & Permissions' })).toBeInTheDocument();
    expect(screen.queryByText(/runtime phase/i)).not.toBeInTheDocument();
  });

  it('keeps voice configuration in Settings without voice profile creation', async () => {
    const user = userEvent.setup();
    render(<SettingsPage onDone={vi.fn()} />);

    await user.click(screen.getByRole('tab', { name: 'Voice' }));

    expect(screen.getByRole('heading', { name: 'Voice' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Input device' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add voice' })).not.toBeInTheDocument();
  });
});
