// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProviderStore } from '@megumi/desktop/renderer/entities/provider/store';
import { ProviderSettingsPanel } from '@megumi/desktop/renderer/features/provider-settings';

const capabilities = { streaming: true, toolCalls: true, thinking: true, imageInput: true } as const;

describe('ProviderSettingsPanel', () => {
  beforeEach(() => {
    useProviderStore.setState({
      catalog: [{
        providerId: 'DeepSeek',
        displayName: 'DeepSeek',
        protocol: 'openai-completions',
        defaultBaseUrl: 'https://api.deepseek.com',
        models: [
          { modelId: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash', contextWindowTokens: 1_000_000, capabilities },
          { modelId: 'deepseek-v4-pro', displayName: 'DeepSeek V4 Pro', contextWindowTokens: 1_000_000, capabilities },
        ],
      }, {
        providerId: 'OpenAI',
        displayName: 'OpenAI',
        protocol: 'openai-completions',
        defaultBaseUrl: 'https://api.openai.com/v1',
        models: [
          { modelId: 'gpt-5.6', displayName: 'GPT-5.6', contextWindowTokens: 1_050_000, capabilities },
          { modelId: 'gpt-5.6-terra', displayName: 'GPT-5.6 Terra', contextWindowTokens: 1_050_000, capabilities },
          { modelId: 'gpt-5.6-luna', displayName: 'GPT-5.6 Luna', contextWindowTokens: 1_050_000, capabilities },
          { modelId: 'gpt-5.5', displayName: 'GPT-5.5', contextWindowTokens: 1_050_000, capabilities },
          { modelId: 'gpt-5.5-pro', displayName: 'GPT-5.5 Pro', contextWindowTokens: 1_050_000, capabilities },
        ],
      }],
      providers: [
        {
          providerId: 'DeepSeek',
          displayName: 'DeepSeek',
          protocol: 'openai-completions',
          enabled: true,
          baseUrl: 'https://api.deepseek.com',
          modelIds: ['deepseek-v4-flash'],
          apiKey: 'sk-existing-key',
          hasApiKey: false,
          credentialSource: 'missing',
          envOverrideActive: false,
          apiKeyEnv: 'DEEPSEEK_API_KEY',
          apiKeyEnvCustomized: false,
        },
        {
          providerId: 'openai',
          displayName: 'OpenAI',
          protocol: 'openai-completions',
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

  it('renders a two-pane provider configuration surface with compact model rows', () => {
    render(<ProviderSettingsPanel />);

    expect(screen.getByRole('heading', { name: 'Models' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Providers' })).toBeInTheDocument();
    expect(screen.getAllByText('DeepSeek').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /^OpenAI/ })).toBeInTheDocument();
    expect(screen.queryByText('Missing key')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Display name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('API Key env')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit DeepSeek V4 Flash' })).toBeInTheDocument();
    expect(screen.queryByText('deepseek-v4-flash')).not.toBeInTheDocument();
    expect(screen.queryByText('Models configured here appear in the chat composer model picker.')).not.toBeInTheDocument();
  });

  it('prefills an unsaved provider from the AI Catalog', () => {
    useProviderStore.setState({ providers: [] });

    render(<ProviderSettingsPanel />);

    expect(screen.getByLabelText('Provider')).toHaveValue('DeepSeek');
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://api.deepseek.com');
    expect(screen.getByRole('button', { name: 'Edit DeepSeek V4 Flash' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit DeepSeek V4 Pro' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^DeepSeek/ })).toHaveClass('opacity-75');
    expect(screen.getByRole('button', { name: /^OpenAI/ })).toHaveClass('opacity-55');
  });

  it('updates the selected provider settings from the detail pane', async () => {
    const user = userEvent.setup();
    const updateProvider = vi.fn();
    useProviderStore.setState({ updateProvider });

    render(<ProviderSettingsPanel />);

    await user.clear(screen.getByLabelText('Base URL'));
    await user.type(screen.getByLabelText('Base URL'), 'https://proxy.local/deepseek');
    await user.click(screen.getByRole('button', { name: 'Edit DeepSeek V4 Flash' }));
    await user.click(screen.getByRole('button', { name: 'Open context window presets' }));
    const presets = screen.getByRole('listbox', { name: 'Context window presets' });
    expect(within(presets).getAllByRole('option')).toHaveLength(5);
    await user.click(within(presets).getByRole('option', { name: /128K/ }));
    expect(screen.getByLabelText('Context window')).toHaveValue(131072);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Done' }));
    await user.selectOptions(screen.getByLabelText('Protocol'), 'anthropic-messages');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(updateProvider).toHaveBeenCalledWith({
      providerId: 'DeepSeek',
      displayName: 'DeepSeek',
      enabled: true,
      protocol: 'anthropic-messages',
      baseUrl: 'https://proxy.local/deepseek',
      models: [{
        modelId: 'deepseek-v4-flash',
        displayName: 'DeepSeek V4 Flash',
        contextWindowTokens: 131072,
      }],
    });
  });

  it('saves the image input switch as the only exposed capability override', async () => {
    const user = userEvent.setup();
    const updateProvider = vi.fn();
    useProviderStore.setState({ updateProvider });

    render(<ProviderSettingsPanel />);

    await user.click(screen.getByRole('button', { name: 'Edit DeepSeek V4 Flash' }));
    await user.click(screen.getByRole('switch', { name: 'Image input' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(updateProvider).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'DeepSeek',
      models: [{
        modelId: 'deepseek-v4-flash',
        displayName: 'DeepSeek V4 Flash',
        contextWindowTokens: 1_000_000,
        imageInput: false,
      }],
    }));
  });

  it('selects providers from the left list', async () => {
    const user = userEvent.setup();

    render(<ProviderSettingsPanel />);

    await user.click(screen.getByRole('button', { name: /^OpenAI/ }));

    expect(screen.getByLabelText('Provider')).toHaveValue('openai');
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://api.openai.com/v1');
    expect(screen.queryByText('Using an environment variable')).not.toBeInTheDocument();
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
    await user.selectOptions(screen.getByLabelText('Protocol'), 'anthropic-messages');
    await user.type(screen.getByLabelText('Base URL'), 'https://api.deepseek.com/v1');
    await user.click(screen.getByRole('button', { name: 'Add model' }));
    expect(screen.queryByRole('switch', { name: 'Image input' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Model ID'), 'deepseek-chat');
    await user.type(screen.getByLabelText('Display name'), 'DeepSeek Chat');
    await user.clear(screen.getByLabelText('Context window'));
    await user.type(screen.getByLabelText('Context window'), '200000');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(updateProvider).toHaveBeenCalledWith({
      providerId: 'Local Proxy',
      displayName: 'Local Proxy',
      enabled: true,
      protocol: 'anthropic-messages',
      baseUrl: 'https://api.deepseek.com/v1',
      models: [{
        modelId: 'deepseek-chat',
        displayName: 'DeepSeek Chat',
        contextWindowTokens: 200000,
      }],
    });
  });

  it('reveals and updates the locally stored API key', async () => {
    const user = userEvent.setup();
    const updateProvider = vi.fn();
    const setApiKey = vi.fn();
    useProviderStore.setState({ updateProvider, setApiKey });

    render(<ProviderSettingsPanel />);

    expect(screen.getByLabelText('API Key')).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Show API key' }));
    expect(screen.getByLabelText('API Key')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('API Key')).toHaveValue('sk-existing-key');
    await user.clear(screen.getByLabelText('API Key'));
    await user.type(screen.getByLabelText('API Key'), 'sk-new-key');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(updateProvider).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'DeepSeek' }));
    expect(setApiKey).toHaveBeenCalledWith({ providerId: 'DeepSeek', apiKey: 'sk-new-key' });
    expect(screen.getByLabelText('API Key')).toHaveValue('sk-new-key');
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

    expect(screen.getByRole('button', { name: /^OpenAI/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^DeepSeek\s/ })).not.toBeInTheDocument();
  });
});
