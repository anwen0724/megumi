// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, ThemeToggle, useThemeStore } from '@megumi/desktop/renderer/shared/theme';

describe('ThemeToggle', () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: 'megumi-warm' });
  });

  it('shows the current theme label', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    expect(screen.getByText('Megumi Warm')).toBeInTheDocument();
  });

  it('switches to the next theme when clicked', async () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Switch to Neutral Light theme' }));

    expect(useThemeStore.getState().theme).toBe('neutral-light');
    expect(screen.getByText('Neutral Light')).toBeInTheDocument();
  });
});
