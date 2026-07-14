// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, ThemeSelector, useThemeStore } from '@megumi/desktop/renderer/shared/theme';
import { IPC_CHANNELS } from '@megumi/desktop/main/ipc/channels';

describe('ThemeSelector', () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: 'megumi-warm' });
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
              },
            },
            meta: {},
          }),
          update: vi.fn().mockResolvedValue({
            ok: true,
            data: {
              settings: {
                theme: 'graphite-dark',
                memory: { enabled: false },
              },
            },
            meta: {},
          }),
        },
      },
    });
  });

  it('renders every built-in theme as a selectable option', () => {
    render(
      <ThemeProvider>
        <ThemeSelector />
      </ThemeProvider>,
    );

    expect(screen.getByRole('radio', { name: /Megumi Warm/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /Neutral Light/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Graphite Dark/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Sage Mist/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Midnight Blue/ })).toBeInTheDocument();
    expect(screen.queryByText('megumi-warm')).not.toBeInTheDocument();
  });

  it('selects a theme directly instead of cycling through a toggle', async () => {
    render(
      <ThemeProvider>
        <ThemeSelector />
      </ThemeProvider>,
    );

    await userEvent.click(screen.getByRole('radio', { name: /Graphite Dark/ }));

    expect(useThemeStore.getState().theme).toBe('graphite-dark');
    expect(screen.getByTestId('megumi-theme-root')).toHaveAttribute('data-theme', 'graphite-dark');
    expect(screen.getByRole('radio', { name: /Graphite Dark/ })).toHaveAttribute('aria-checked', 'true');
    expect(window.megumi.settings.update).toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({ channel: IPC_CHANNELS.settings.update }),
      payload: {
        theme: 'graphite-dark',
      },
    }));
  });
});
