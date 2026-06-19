// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from '../../../src/ui/shell/SettingsPage';
import { ThemeProvider, useThemeStore } from '../../../src/ui/shared/theme';

function installMegumiBridge() {
  Object.defineProperty(window, 'megumi', {
    configurable: true,
    value: {
      settings: {
        get: vi.fn().mockResolvedValue({
          ok: true,
          data: {
            settings: {
              theme: 'megumi-warm',
              memory: { enabled: false },
              compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
              chat: { defaultProvider: 'deepseek' },
              providers: {},
              permissions: {},
            },
          },
        }),
        update: vi.fn().mockImplementation((payload: unknown) => Promise.resolve({
          ok: true,
          data: {
            settings: {
              theme: isRecord(payload) && typeof payload.theme === 'string' ? payload.theme : 'megumi-warm',
              memory: isRecord(payload) && isRecord(payload.memory)
                ? { enabled: payload.memory.enabled === true }
                : { enabled: false },
              compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
              chat: { defaultProvider: 'deepseek' },
              providers: {},
              permissions: {},
            },
          },
        })),
      },
      provider: {
        list: vi.fn().mockResolvedValue({
          ok: true,
          data: {
            providers: [{
              providerId: 'deepseek',
              displayName: 'DeepSeek',
              enabled: true,
              defaultModelId: 'deepseek-v4-flash',
              hasApiKey: false,
              credentialSource: 'missing',
              envOverrideActive: false,
            }],
          },
        }),
        update: vi.fn().mockResolvedValue({ ok: true, data: {} }),
        setApiKey: vi.fn().mockResolvedValue({ ok: true, data: {} }),
        deleteApiKey: vi.fn().mockResolvedValue({ ok: true, data: {} }),
      },
    },
  });
}

function renderSettingsPage() {
  return render(
    <ThemeProvider>
      <SettingsPage onDone={() => undefined} />
    </ThemeProvider>,
  );
}

describe('src SettingsPage interactions', () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: 'megumi-warm' });
    installMegumiBridge();
  });

  it('sends raw settings payloads through the new renderer bridge', async () => {
    renderSettingsPage();

    await userEvent.click(screen.getByRole('radio', { name: /Sage Mist/ }));

    expect(window.megumi.settings.update).toHaveBeenCalledWith({ theme: 'sage-mist' });
    expect(window.megumi.settings.update).not.toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.anything(),
      meta: expect.anything(),
    }));
    expect(screen.getByTestId('megumi-theme-root')).toHaveAttribute('data-theme', 'sage-mist');
  });

  it('sends raw memory settings payloads through the new renderer bridge', async () => {
    renderSettingsPage();

    await userEvent.click(screen.getByRole('tab', { name: 'Memory' }));
    await waitFor(() => expect(window.megumi.settings.get).toHaveBeenCalled());
    await userEvent.click(await screen.findByRole('switch', { name: 'Long-term memory' }));

    expect(window.megumi.settings.update).toHaveBeenCalledWith({
      memory: { enabled: true },
    });
  });

  it('sends raw provider payloads through the new renderer bridge', async () => {
    renderSettingsPage();

    await userEvent.click(screen.getByRole('tab', { name: 'Models' }));
    await screen.findByText('DeepSeek');
    await userEvent.click(screen.getByLabelText('Enabled'));

    expect(window.megumi.provider.update).toHaveBeenCalledWith({
      providerId: 'deepseek',
      enabled: false,
    });
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
