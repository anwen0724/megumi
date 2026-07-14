// @vitest-environment jsdom
/* Verifies the product-facing Memory setting and its immediate save behavior. */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemorySettingsPanel } from '@megumi/desktop/renderer/features/memory-settings';

describe('MemorySettingsPanel', () => {
  const get = vi.fn();
  const update = vi.fn();

  beforeEach(() => {
    get.mockReset().mockResolvedValue(settingsResult(false));
    update.mockReset().mockResolvedValue(settingsResult(true, 'updated'));
    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: { settings: { get, update } },
    });
  });

  it('enables conversation memory without exposing runtime terminology', async () => {
    const user = userEvent.setup();
    render(<MemorySettingsPanel />);

    const toggle = await screen.findByRole('switch', { name: 'Conversation memory' });
    await waitFor(() => expect(toggle).not.toBeDisabled());
    await user.click(toggle);

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][0].payload).toEqual({ memory: { enabled: true } });
    expect(screen.queryByText(/memory runtime/i)).not.toBeInTheDocument();
  });
});

function settingsResult(enabled: boolean, status: 'ok' | 'updated' = 'ok') {
  return {
    ok: true,
    data: {
      status,
      settings: {
        language: 'zh-CN',
        theme: 'megumi-warm',
        setup: { completed: true },
        memory: { enabled },
        web: { search: { hasApiKey: false, credentialSource: 'missing' } },
        providers: {},
      },
    },
    meta: {},
  };
}
