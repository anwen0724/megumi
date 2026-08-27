// @vitest-environment jsdom
/* Verifies the product-facing Memory setting and its immediate save behavior. */
import { render, screen } from '@testing-library/react';
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

  it('keeps conversation memory unavailable while the feature is in development', async () => {
    render(<MemorySettingsPanel />);

    const toggle = await screen.findByRole('switch', { name: 'Conversation memory' });
    expect(toggle).toBeDisabled();
    expect(screen.getByText('In development...')).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
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
