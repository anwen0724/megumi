// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProviderStore } from '@megumi/desktop/renderer/entities/provider/store';
import { ProviderSettingsPanel } from '@megumi/desktop/renderer/features/provider-settings';

describe('ProviderSettingsPanel', () => {
  beforeEach(() => {
    useProviderStore.setState({
      providers: [
        {
          providerId: 'deepseek',
          displayName: 'DeepSeek',
          enabled: true,
          baseUrl: 'https://api.deepseek.com',
          defaultModelId: 'deepseek-v4-flash',
          hasSecret: false,
          credentialSource: 'missing',
          envOverrideActive: false,
        },
        {
          providerId: 'openai',
          displayName: 'OpenAI',
          enabled: true,
          baseUrl: 'https://api.openai.com/v1',
          defaultModelId: 'gpt-5.5',
          hasSecret: true,
          credentialSource: 'environment',
          envOverrideActive: true,
        },
      ],
      status: 'ready',
      error: null,
      loadProviders: vi.fn(),
      updateProvider: vi.fn(),
      setApiKey: vi.fn(),
      deleteApiKey: vi.fn(),
    });
  });

  it('renders provider status without plaintext keys', () => {
    render(<ProviderSettingsPanel />);

    expect(screen.getByText('DeepSeek')).toBeInTheDocument();
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.getByText('Missing key')).toBeInTheDocument();
    expect(screen.getByText('Environment key')).toBeInTheDocument();
    expect(screen.queryByText(/sk-/i)).not.toBeInTheDocument();
  });

  it('updates provider settings', async () => {
    const user = userEvent.setup();
    const updateProvider = vi.fn();
    useProviderStore.setState({ updateProvider });

    render(<ProviderSettingsPanel />);

    await user.clear(screen.getByLabelText('DeepSeek base URL'));
    await user.type(screen.getByLabelText('DeepSeek base URL'), 'https://proxy.local/deepseek');
    await user.selectOptions(screen.getByLabelText('DeepSeek default model'), 'deepseek-v4-pro');
    await user.click(screen.getByRole('button', { name: 'Save DeepSeek settings' }));

    expect(updateProvider).toHaveBeenCalledWith({
      providerId: 'deepseek',
      enabled: true,
      baseUrl: 'https://proxy.local/deepseek',
      defaultModelId: 'deepseek-v4-pro',
    });
  });

  it('sets and deletes API keys without keeping the typed key visible after submit', async () => {
    const user = userEvent.setup();
    const setApiKey = vi.fn();
    const deleteApiKey = vi.fn();
    useProviderStore.setState({ setApiKey, deleteApiKey });

    render(<ProviderSettingsPanel />);

    await user.type(screen.getByLabelText('DeepSeek API key'), 'sk-new-key');
    await user.click(screen.getByRole('button', { name: 'Save DeepSeek API key' }));

    expect(setApiKey).toHaveBeenCalledWith({ providerId: 'deepseek', apiKey: 'sk-new-key' });
    await waitFor(() => expect(screen.getByLabelText('DeepSeek API key')).toHaveValue(''));

    await user.click(screen.getByRole('button', { name: 'Delete DeepSeek API key' }));
    expect(deleteApiKey).toHaveBeenCalledWith({ providerId: 'deepseek' });
  });
});
