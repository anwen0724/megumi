// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, ThemeSelector, useThemeStore } from '@megumi/desktop/renderer/shared/theme';

describe('ThemeSelector', () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: 'megumi-warm' });
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
  });
});
