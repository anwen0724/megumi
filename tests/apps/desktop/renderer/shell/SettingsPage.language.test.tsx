// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsPage } from '@megumi/desktop/renderer/shell/SettingsPage';

describe('SettingsPage language settings', () => {
  it('shows language and theme controls in Appearance', () => {
    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: { settings: { update: vi.fn() } },
    });

    render(<SettingsPage onDone={vi.fn()} />);

    expect(screen.getByRole('radiogroup', { name: 'Language' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
  });
});
