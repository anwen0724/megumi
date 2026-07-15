// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LanguageSelector,
  getRendererLanguage,
  initializeRendererI18n,
} from '@megumi/desktop/renderer/shared/i18n';

function settingsResult(language: 'zh-CN' | 'en-US') {
  return {
    ok: true,
    data: {
      status: 'updated',
      settings: {
        language,
        theme: 'midnight-blue',
        setup: { completed: true },
        memory: { enabled: false },
        web: { search: { enabled: false, providerId: 'tavily', maxResults: 5, timeoutMs: 10_000 } },
        providers: {},
      },
    },
    meta: {},
  };
}

describe('LanguageSelector', () => {
  const update = vi.fn();

  beforeEach(async () => {
    await initializeRendererI18n('en-US');
    update.mockReset();
    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: { settings: { update } },
    });
  });

  it('previews and persists a language change', async () => {
    update.mockResolvedValue(settingsResult('zh-CN'));
    render(<LanguageSelector />);

    await userEvent.click(screen.getByRole('radio', { name: /简体中文/ }));

    await waitFor(() => expect(getRendererLanguage()).toBe('zh-CN'));
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('rolls back the preview when persistence fails', async () => {
    update.mockResolvedValue({
      ok: false,
      data: { code: 'settings_update_failed', message: 'private detail' },
      meta: {},
    });
    render(<LanguageSelector />);

    await userEvent.click(screen.getByRole('radio', { name: /简体中文/ }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Settings could not be saved.'));
    expect(getRendererLanguage()).toBe('en-US');
    expect(document.documentElement.lang).toBe('en-US');
  });
});
