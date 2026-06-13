// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IPC_CHANNELS } from '@megumi/shared/ipc';
import { ThemeProvider, useThemeStore } from '@megumi/desktop/renderer/shared/theme';

describe('ThemeProvider', () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: useThemeStore.getInitialState().theme });
    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: {
        settings: {
          get: vi.fn().mockResolvedValue({
            ok: true,
            data: {
              settings: {
                theme: 'midnight-blue',
                memory: { enabled: false },
                compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
              },
            },
            meta: {},
          }),
          update: vi.fn(),
        },
      },
    });
  });

  it('renders children inside the default Midnight Blue theme root', () => {
    render(
      <ThemeProvider>
        <div>Workspace</div>
      </ThemeProvider>,
    );

    expect(useThemeStore.getInitialState().theme).toBe('midnight-blue');
    expect(screen.getByTestId('megumi-theme-root')).toHaveAttribute('data-theme', 'midnight-blue');
    expect(screen.getByText('Workspace')).toBeInTheDocument();
  });

  it('hydrates the theme from resolved app settings', async () => {
    vi.mocked(window.megumi.settings.get).mockResolvedValueOnce({
      ok: true,
      data: {
        settings: {
          theme: 'graphite-dark',
          memory: { enabled: false },
          compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
        },
      },
      meta: {} as any,
    });

    render(
      <ThemeProvider>
        <div>Workspace</div>
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('megumi-theme-root')).toHaveAttribute('data-theme', 'graphite-dark');
    });
    expect(window.megumi.settings.get).toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({ channel: IPC_CHANNELS.settings.get }),
      payload: {},
    }));
  });

  it('can switch to the neutral light theme', async () => {
    render(
      <ThemeProvider>
        <button type="button" onClick={() => useThemeStore.getState().setTheme('neutral-light')}>
          Switch theme
        </button>
      </ThemeProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Switch theme' }));

    expect(screen.getByTestId('megumi-theme-root')).toHaveAttribute('data-theme', 'neutral-light');
  });
});
