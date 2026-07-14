// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SetupWizard, useSetupWizardStore } from '@megumi/desktop/renderer/features/setup-wizard';
import { useProviderStore } from '@megumi/desktop/renderer/entities/provider';
import { useThemeStore } from '@megumi/desktop/renderer/shared/theme';

const catalog = [
  {
    providerId: 'DeepSeek',
    displayName: 'DeepSeek',
    protocol: 'openai-compatible' as const,
    defaultBaseUrl: 'https://api.deepseek.com',
    models: [
      {
        modelId: 'deepseek-v4-flash',
        displayName: 'DeepSeek V4 Flash',
        contextWindowTokens: 1_000_000,
        capabilities: { streaming: true, toolCalls: true, thinking: true, imageInput: false },
      },
    ],
  },
  {
    providerId: 'OpenAI',
    displayName: 'OpenAI',
    protocol: 'openai-compatible' as const,
    defaultBaseUrl: 'https://api.openai.com/v1',
    models: [
      {
        modelId: 'gpt-5.6',
        displayName: 'GPT-5.6',
        contextWindowTokens: 1_050_000,
        capabilities: { streaming: true, toolCalls: true, thinking: true, imageInput: true },
      },
    ],
  },
];

describe('SetupWizard', () => {
  beforeEach(() => {
    useSetupWizardStore.setState(useSetupWizardStore.getInitialState(), true);
    useThemeStore.setState(useThemeStore.getInitialState(), true);
    useProviderStore.setState({
      ...useProviderStore.getInitialState(),
      status: 'ready',
      catalog,
      loadProviders: vi.fn().mockResolvedValue(undefined),
    }, true);
  });

  it('uses the catalog to complete a usable first-run setup', async () => {
    const user = userEvent.setup();
    const completeSetup = vi.fn().mockResolvedValue(undefined);
    useSetupWizardStore.setState({ status: 'ready', setupCompleted: false, completeSetup });

    render(<SetupWizard />);

    expect(screen.getByRole('heading', { name: 'Make Megumi yours' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /English/ })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('radio', { name: 'Graphite Dark' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await user.click(screen.getByRole('button', { name: /OpenAI/ }));
    await user.type(screen.getByLabelText('API key'), 'TEST_API_KEY_VALUE');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByText('GPT-5.6')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start using Megumi' }));

    expect(completeSetup).toHaveBeenCalledWith({
      language: 'en-US',
      theme: 'graphite-dark',
      providerId: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      modelIds: ['gpt-5.6'],
      apiKey: 'TEST_API_KEY_VALUE',
    });
  });

  it('allows provider configuration to be deferred', async () => {
    const user = userEvent.setup();
    const completeSetup = vi.fn().mockResolvedValue(undefined);
    useSetupWizardStore.setState({ status: 'ready', setupCompleted: false, completeSetup });

    render(<SetupWizard />);

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Set up later' }));

    expect(screen.getByText('Not configured')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start using Megumi' }));

    expect(completeSetup).toHaveBeenCalledWith({
      language: 'en-US',
      theme: 'midnight-blue',
      modelIds: [],
      skipProvider: true,
    });
  });

  it('previews theme changes immediately', async () => {
    const user = userEvent.setup();
    useSetupWizardStore.setState({ status: 'ready', setupCompleted: false });

    render(<SetupWizard />);
    await user.click(screen.getByRole('radio', { name: 'Sage Mist' }));

    expect(useThemeStore.getState().theme).toBe('sage-mist');
  });

  it('exposes the catalog base URL only as an advanced override', async () => {
    const user = userEvent.setup();
    useSetupWizardStore.setState({ status: 'ready', setupCompleted: false });

    render(<SetupWizard />);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.queryByLabelText('Base URL')).not.toBeVisible();

    await user.click(screen.getByText('Advanced settings'));
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://api.deepseek.com');
  });
});
