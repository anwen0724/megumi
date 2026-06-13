// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
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
          hasApiKey: false,
          credentialSource: 'missing',
          envOverrideActive: false,
          apiKeyEnv: 'DEEPSEEK_API_KEY',
          apiKeyEnvCustomized: false,
        },
        {
          providerId: 'openai',
          displayName: 'OpenAI',
          enabled: true,
          baseUrl: 'https://api.openai.com/v1',
          defaultModelId: 'gpt-5.5',
          hasApiKey: true,
          credentialSource: 'environment',
          envOverrideActive: true,
          apiKeyEnv: 'OPENAI_API_KEY',
          apiKeyEnvCustomized: false,
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
    expect(screen.getByText('Environment key active')).toBeInTheDocument();
    expect(screen.queryByText(/sk-/i)).not.toBeInTheDocument();
  });

  it('updates provider settings', async () => {
    const user = userEvent.setup();
    const updateProvider = vi.fn();
    useProviderStore.setState({ updateProvider });

    render(<ProviderSettingsPanel />);

    await user.clear(screen.getByLabelText('DeepSeek base URL'));
    await user.type(screen.getByLabelText('DeepSeek base URL'), 'https://proxy.local/deepseek');
    await user.selectOptions(screen.getByLabelText('DeepSeek known model'), 'deepseek-v4-pro');
    await user.click(screen.getByRole('button', { name: 'Save DeepSeek settings' }));

    expect(updateProvider).toHaveBeenCalledWith({
      providerId: 'deepseek',
      baseUrl: 'https://proxy.local/deepseek',
      defaultModelId: 'deepseek-v4-pro',
    });
  });

  it('saves provider enabled changes immediately', async () => {
    const user = userEvent.setup();
    const updateProvider = vi.fn();
    useProviderStore.setState({ updateProvider });

    render(<ProviderSettingsPanel />);

    const openAiSection = screen.getByText('OpenAI').closest('section');
    expect(openAiSection).not.toBeNull();

    await user.click(within(openAiSection as HTMLElement).getByRole('checkbox', { name: 'Enabled' }));

    expect(updateProvider).toHaveBeenCalledWith({
      providerId: 'openai',
      enabled: false,
    });
  });

  it('sets and deletes API keys without keeping the typed key visible after submit', async () => {
    const user = userEvent.setup();
    const setApiKey = vi.fn();
    const deleteApiKey = vi.fn();
    useProviderStore.setState((state) => ({
      ...state,
      setApiKey,
      deleteApiKey,
      providers: state.providers.map((provider) => provider.providerId === 'deepseek'
        ? {
            ...provider,
            hasApiKey: true,
            credentialSource: 'settings',
          }
        : provider),
    }));

    render(<ProviderSettingsPanel />);

    await user.type(screen.getByLabelText('DeepSeek API key'), 'sk-new-key');
    await user.click(screen.getByRole('button', { name: 'Save DeepSeek API key' }));

    expect(setApiKey).toHaveBeenCalledWith({ providerId: 'deepseek', apiKey: 'sk-new-key' });
    await waitFor(() => expect(screen.getByLabelText('DeepSeek API key')).toHaveValue(''));

    await user.click(screen.getByRole('button', { name: 'Delete DeepSeek API key' }));
    expect(deleteApiKey).toHaveBeenCalledWith({ providerId: 'deepseek' });
  });

  it('updates API key environment variable names', async () => {
    const user = userEvent.setup();
    const updateProvider = vi.fn();
    useProviderStore.setState({ updateProvider });

    render(<ProviderSettingsPanel />);

    await user.clear(screen.getByLabelText('OpenAI API key environment variable'));
    await user.type(screen.getByLabelText('OpenAI API key environment variable'), 'CUSTOM_OPENAI_KEY');
    await user.click(screen.getByRole('button', { name: 'Save OpenAI environment variable' }));

    expect(updateProvider).toHaveBeenCalledWith({
      providerId: 'openai',
      apiKeyEnv: 'CUSTOM_OPENAI_KEY',
    });
  });

  it('clears custom API key environment variable names', async () => {
    const user = userEvent.setup();
    const updateProvider = vi.fn();
    useProviderStore.setState((state) => ({
      ...state,
      updateProvider,
      providers: state.providers.map((provider) => provider.providerId === 'openai'
        ? {
            ...provider,
            apiKeyEnv: 'CUSTOM_OPENAI_KEY',
            apiKeyEnvCustomized: true,
          }
        : provider),
    }));

    render(<ProviderSettingsPanel />);

    const clearButton = screen.getByRole('button', { name: 'Clear OpenAI environment variable' });

    expect(clearButton).toBeEnabled();
    await user.click(clearButton);
    expect(updateProvider).toHaveBeenCalledWith({
      providerId: 'openai',
      apiKeyEnv: null,
    });
  });

  it('disables delete actions when the matching settings value is missing', () => {
    render(<ProviderSettingsPanel />);

    expect(screen.getByRole('button', { name: 'Delete DeepSeek API key' })).toBeDisabled();
  });

  it('keeps custom default model ids editable when they are not in the known model list', async () => {
    const user = userEvent.setup();
    const updateProvider = vi.fn();
    useProviderStore.setState((state) => ({
      ...state,
      updateProvider,
      providers: state.providers.map((provider) => provider.providerId === 'deepseek'
        ? {
            ...provider,
            defaultModelId: 'deepseek-custom-model',
          }
        : provider),
    }));

    render(<ProviderSettingsPanel />);

    expect(screen.getByLabelText('DeepSeek default model ID')).toHaveValue('deepseek-custom-model');

    await user.clear(screen.getByLabelText('DeepSeek default model ID'));
    await user.type(screen.getByLabelText('DeepSeek default model ID'), 'deepseek-next');
    await user.click(screen.getByRole('button', { name: 'Save DeepSeek settings' }));

    expect(updateProvider).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'deepseek',
      defaultModelId: 'deepseek-next',
    }));
  });
});
