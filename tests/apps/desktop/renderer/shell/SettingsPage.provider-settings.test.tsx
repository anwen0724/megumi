// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProviderStore } from '@megumi/desktop/renderer/entities/provider/store';
import { SettingsPage } from '@megumi/desktop/renderer/shell/SettingsPage';

describe('SettingsPage provider settings', () => {
  beforeEach(() => {
    useProviderStore.setState({
      providers: [
        {
          providerId: 'deepseek',
          displayName: 'DeepSeek',
          protocol: 'openai-compatible',
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

  it('opens the Models tab with provider settings', async () => {
    const user = userEvent.setup();

    render(<SettingsPage onDone={vi.fn()} />);

    await user.click(screen.getByRole('tab', { name: 'Models' }));

    expect(screen.getByRole('heading', { name: 'Providers' })).toBeInTheDocument();
    expect(screen.getAllByText('DeepSeek').length).toBeGreaterThan(0);
    expect(screen.queryByText('Provider and model runtime settings')).not.toBeInTheDocument();
  });
});
