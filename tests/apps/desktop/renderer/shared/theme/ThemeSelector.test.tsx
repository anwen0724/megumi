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
          readSettings: vi.fn().mockResolvedValue({
            ok: true,
            data: {
              config: { general: { theme: 'megumi-warm' } },
              revision: 'revision',
            },
            meta: {},
          }),
          updateSettings: vi.fn().mockResolvedValue({
            ok: true,
            data: {
              settings: {
                config: { general: { theme: 'rose-moon' } },
                revision: 'next',
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

    expect(screen.getByRole('radio', { name: /Megumi Warm/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: /Neutral Light/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Sunlit Sky/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Rose Moon/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Verdant Cloud/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Cangming Blue/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Frost Cyan/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Cyan Tide/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Midnight Blue/ })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Graphite Dark/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Sage Mist/ })).not.toBeInTheDocument();
    expect(screen.queryByText('megumi-warm')).not.toBeInTheDocument();
  });

  it('selects a theme directly instead of cycling through a toggle', async () => {
    render(
      <ThemeProvider>
        <ThemeSelector />
      </ThemeProvider>,
    );

    await userEvent.click(screen.getByRole('radio', { name: /Rose Moon/ }));

    expect(useThemeStore.getState().theme).toBe('rose-moon');
    expect(screen.getByTestId('megumi-theme-root')).toHaveAttribute('data-theme', 'rose-moon');
    expect(screen.getByRole('radio', { name: /Rose Moon/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(window.megumi.settings.updateSettings).toHaveBeenCalledWith({
      patch: { general: { theme: 'rose-moon' } },
      expectedRevision: 'revision',
    });
  });
});
