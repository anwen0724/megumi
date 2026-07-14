// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSettingsPanel } from '@megumi/desktop/renderer/features/web-settings';

describe('WebSettingsPanel', () => {
  const get = vi.fn();
  const update = vi.fn();

  beforeEach(() => {
    get.mockReset().mockResolvedValue(success('ok'));
    update.mockReset().mockResolvedValue(success('updated', {
      provider: 'custom',
      baseUrl: 'https://search.example.com/query',
      hasApiKey: true,
      credentialSource: 'settings',
    }));
    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: { settings: { get, update } },
    });
  });

  it('starts without a default provider and saves custom protocol settings', async () => {
    const user = userEvent.setup();
    render(<WebSettingsPanel />);
    const provider = await screen.findByRole('combobox', { name: 'Search provider' });
    expect(provider).toHaveValue('');

    await user.selectOptions(provider, 'custom');
    await user.type(screen.getByRole('textbox', { name: 'Search Base URL' }), 'https://search.example.com/query');
    await user.type(screen.getByLabelText('Search API key'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][0].payload).toMatchObject({
      web: { search: { provider: 'custom', baseUrl: 'https://search.example.com/query', apiKey: 'secret' } },
    });
    expect(screen.getByLabelText('Search API key')).toHaveValue('');
    expect(screen.queryByText('Page access')).not.toBeInTheDocument();
    expect(screen.queryByText('Web page reading')).not.toBeInTheDocument();
  });
});

function success(status: 'ok' | 'updated', search: {
  provider?: 'brave' | 'tavily' | 'exa' | 'custom';
  baseUrl?: string;
  hasApiKey: boolean;
  credentialSource: 'settings' | 'environment' | 'missing';
} = {
  hasApiKey: false,
  credentialSource: 'missing',
}) {
  return {
    ok: true,
    data: {
      status,
      settings: {
        language: 'zh-CN',
        theme: 'midnight-blue',
        setup: { completed: true },
        memory: { enabled: false },
        web: { search },
        providers: {},
      },
    },
    meta: {},
  };
}
