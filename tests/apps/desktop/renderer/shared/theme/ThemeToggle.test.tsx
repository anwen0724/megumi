// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, ThemeToggle, useThemeStore } from '@megumi/desktop/renderer/shared/theme';

describe('ThemeToggle', () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: 'megumi-warm' });
  });

  it('renders as an icon-only button with an accessible next-theme label', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    expect(screen.getByRole('button', { name: 'Switch to Neutral Light theme' })).toBeInTheDocument();
    expect(screen.queryByText('Megumi Warm')).not.toBeInTheDocument();
  });

  it('switches to the next theme when clicked without rendering theme text', async () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Switch to Neutral Light theme' }));

    expect(useThemeStore.getState().theme).toBe('neutral-light');
    expect(screen.getByRole('button', { name: 'Switch to Megumi Warm theme' })).toBeInTheDocument();
    expect(screen.queryByText('Neutral Light')).not.toBeInTheDocument();
  });
});
