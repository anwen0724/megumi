// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProviderStore } from '@megumi/desktop/renderer/entities/provider/store';
import { SettingsModal } from '@megumi/desktop/renderer/shell/SettingsModal';

describe('SettingsModal provider settings', () => {
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
      ],
      status: 'ready',
      error: null,
      loadProviders: vi.fn(),
      updateProvider: vi.fn(),
      setApiKey: vi.fn(),
      deleteApiKey: vi.fn(),
    });
  });

  it('opens the Models tab with provider settings', async () => {
    const user = userEvent.setup();

    render(<SettingsModal open onClose={vi.fn()} />);

    await user.click(screen.getByRole('tab', { name: 'Models' }));

    expect(screen.getByText('Provider settings')).toBeInTheDocument();
    expect(screen.getByText('DeepSeek')).toBeInTheDocument();
  });
});
