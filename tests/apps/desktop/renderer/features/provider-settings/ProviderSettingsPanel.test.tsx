// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProviderStore } from '@megumi/desktop/renderer/entities/provider/store';
import { ProviderSettingsPanel } from '@megumi/desktop/renderer/features/provider-settings';

describe('ProviderSettingsPanel', () => {
  beforeEach(() => {
    useProviderStore.setState({
      catalog: [{
        providerId: 'DeepSeek',
        displayName: 'DeepSeek',
        protocol: 'openai-compatible',
        defaultBaseUrl: 'https://api.deepseek.com',
        models: [
          { modelId: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash', contextWindowTokens: 1_000_000 },
          { modelId: 'deepseek-v4-pro', displayName: 'DeepSeek V4 Pro', contextWindowTokens: 1_000_000 },
        ],
      }],
      providers: [
        {
          providerId: 'DeepSeek',
          displayName: 'DeepSeek',
          protocol: 'openai-compatible',
          enabled: true,
          baseUrl: 'https://api.deepseek.com',
          modelIds: ['deepseek-v4-flash'],
          hasApiKey: false,
          credentialSource: 'missing',
          envOverrideActive: false,
          apiKeyEnv: 'DEEPSEEK_API_KEY',
          apiKeyEnvCustomized: false,
        },
        {
          providerId: 'openai',
          displayName: 'OpenAI',
          protocol: 'openai-compatible',
          enabled: true,
          baseUrl: 'https://api.openai.com/v1',
          modelIds: ['gpt-5.5'],
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
      deleteProvider: vi.fn(),
      setApiKey: vi.fn(),
      deleteApiKey: vi.fn(),
    });
  });

  it('renders a two-pane provider configuration surface without plaintext keys', () => {
    render(<ProviderSettingsPanel />);

    expect(screen.getByRole('heading', { name: 'Models' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Providers' })).toBeInTheDocument();
    expect(screen.getAllByText('DeepSeek').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /OpenAI/ })).toBeInTheDocument();
    expect(screen.getByText('Missing key')).toBeInTheDocument();
    expect(screen.queryByLabelText('Display name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('API Key env')).not.toBeInTheDocument();
    expect(screen.queryByText(/sk-/i)).not.toBeInTheDocument();
  });

  it('prefills an unsaved provider from the AI Catalog', () => {
    useProviderStore.setState({ providers: [] });

    render(<ProviderSettingsPanel />);

    expect(screen.getByLabelText('Provider')).toHaveValue('DeepSeek');
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://api.deepseek.com');
    expect(screen.getByLabelText('Models')).toHaveValue('deepseek-v4-flash\ndeepseek-v4-pro');
  });

  it('updates the selected provider settings from the detail pane', async () => {
    const user = userEvent.setup();
    const updateProvider = vi.fn();
    useProviderStore.setState({ updateProvider });

    render(<ProviderSettingsPanel />);

    await user.clear(screen.getByLabelText('Base URL'));
    await user.type(screen.getByLabelText('Base URL'), 'https://proxy.local/deepseek');
    await user.clear(screen.getByLabelText('Models'));
    await user.type(screen.getByLabelText('Models'), 'deepseek-v4-flash{enter}deepseek-v4-pro');
    await user.selectOptions(screen.getByLabelText('Protocol'), 'anthropic');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(updateProvider).toHaveBeenCalledWith({
      providerId: 'DeepSeek',
      displayName: 'DeepSeek',
      enabled: true,
      protocol: 'anthropic',
      baseUrl: 'https://proxy.local/deepseek',
      modelIds: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    });
  });

  it('selects providers from the left list', async () => {
    const user = userEvent.setup();

    render(<ProviderSettingsPanel />);

    await user.click(screen.getByRole('button', { name: /OpenAI/ }));

    expect(screen.getByLabelText('Provider')).toHaveValue('openai');
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://api.openai.com/v1');
    expect(screen.getByText('Environment key active')).toBeInTheDocument();
  });

  it('creates a provider from an empty settings state', async () => {
    const user = userEvent.setup();
    const updateProvider = vi.fn();
    useProviderStore.setState({
      providers: [],
      updateProvider,
    });

    render(<ProviderSettingsPanel />);

    await user.click(screen.getAllByRole('button', { name: 'Add provider' })[0]);
    await user.type(screen.getByLabelText('Provider'), 'Local Proxy');
    await user.selectOptions(screen.getByLabelText('Protocol'), 'anthropic');
    await user.type(screen.getByLabelText('Base URL'), 'https://api.deepseek.com/v1');
    await user.type(screen.getByLabelText('Models'), 'deepseek-chat{enter}deepseek-reasoner');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(updateProvider).toHaveBeenCalledWith({
      providerId: 'Local Proxy',
      displayName: 'Local Proxy',
      enabled: true,
      protocol: 'anthropic',
      baseUrl: 'https://api.deepseek.com/v1',
      modelIds: ['deepseek-chat', 'deepseek-reasoner'],
    });
  });

  it('saves API keys through the main Save action without keeping the typed key visible', async () => {
    const user = userEvent.setup();
    const updateProvider = vi.fn();
    const setApiKey = vi.fn();
    useProviderStore.setState({ updateProvider, setApiKey });

    render(<ProviderSettingsPanel />);

    await user.type(screen.getByLabelText('API Key'), 'sk-new-key');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(updateProvider).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'DeepSeek' }));
    expect(setApiKey).toHaveBeenCalledWith({ providerId: 'DeepSeek', apiKey: 'sk-new-key' });
    await waitFor(() => expect(screen.getByLabelText('API Key')).toHaveValue(''));
  });

  it('deletes the selected provider configuration', async () => {
    const user = userEvent.setup();
    const deleteProvider = vi.fn();
    useProviderStore.setState({ deleteProvider });

    render(<ProviderSettingsPanel />);

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(deleteProvider).toHaveBeenCalledWith({ providerId: 'DeepSeek' });
  });

  it('filters the provider list by search query', async () => {
    const user = userEvent.setup();

    render(<ProviderSettingsPanel />);

    await user.type(screen.getByLabelText('Search providers'), 'open');

    expect(screen.getByRole('button', { name: /OpenAI/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /DeepSeek/ })).not.toBeInTheDocument();
  });
});
