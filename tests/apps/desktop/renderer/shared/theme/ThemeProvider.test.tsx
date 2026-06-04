// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, useThemeStore } from '@megumi/desktop/renderer/shared/theme';

describe('ThemeProvider', () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: useThemeStore.getInitialState().theme });
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
