// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import { SettingsModal } from '@megumi/desktop/renderer/shell/SettingsModal';
import { ThemeProvider, useThemeStore } from '@megumi/desktop/renderer/shared/theme';

function renderSettingsModal(open: boolean, onClose = vi.fn()) {
  return {
    onClose,
    ...render(
      <ThemeProvider>
        <SettingsModal open={open} onClose={onClose} />
      </ThemeProvider>,
    ),
  };
}

describe('SettingsModal', () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: 'megumi-warm' });
    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: {
        provider: {
          list: vi.fn().mockResolvedValue({
            ok: true,
            data: { providers: [] },
            meta: {
              requestId: 'ipc-provider-list-1',
              channel: IPC_CHANNELS.provider.list,
              handledAt: '2026-05-12T00:00:00.100Z',
            },
          }),
          update: vi.fn().mockResolvedValue({ ok: true, data: {}, meta: {} }),
          setApiKey: vi.fn().mockResolvedValue({ ok: true, data: {}, meta: {} }),
          deleteApiKey: vi.fn().mockResolvedValue({ ok: true, data: {}, meta: {} }),
        },
        chat: {
          start: vi.fn(),
          cancel: vi.fn(),
        },
        runtime: {
          onEvent: vi.fn(),
        },
      },
    });
  });

  it('does not render when closed', () => {
    renderSettingsModal(false);

    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('renders the appearance section by default', () => {
    renderSettingsModal(true);

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Appearance' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Theme')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Megumi Warm/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /Graphite Dark/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Switch to .* theme/ })).not.toBeInTheDocument();
  });

  it('selects themes from settings appearance', async () => {
    renderSettingsModal(true);

    await userEvent.click(screen.getByRole('radio', { name: /Midnight Blue/ }));

    expect(useThemeStore.getState().theme).toBe('midnight-blue');
    expect(screen.getByTestId('megumi-theme-root')).toHaveAttribute('data-theme', 'midnight-blue');
  });

  it('switches between settings categories', async () => {
    renderSettingsModal(true);

    await userEvent.click(screen.getByRole('tab', { name: 'Models' }));

    expect(screen.getByRole('tab', { name: 'Models' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Provider settings')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Security' }));

    expect(screen.getByText('Secret storage')).toBeInTheDocument();
    expect(screen.getByText('Approval policies')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'About' }));

    expect(screen.getByText('AI provider chat runtime integration')).toBeInTheDocument();
    expect(screen.getByText('This build connects the desktop UI to provider-backed streaming chat.')).toBeInTheDocument();
  });

  it('keeps the same panel height after switching categories', async () => {
    renderSettingsModal(true);

    const panel = screen.getByTestId('settings-modal-panel');
    expect(panel).toHaveClass('h-[560px]');

    await userEvent.click(screen.getByRole('tab', { name: 'Models' }));
    expect(panel).toHaveClass('h-[560px]');

    await userEvent.click(screen.getByRole('tab', { name: 'Security' }));
    expect(panel).toHaveClass('h-[560px]');

    await userEvent.click(screen.getByRole('tab', { name: 'About' }));
    expect(panel).toHaveClass('h-[560px]');

    await userEvent.click(screen.getByRole('tab', { name: 'Appearance' }));
    expect(panel).toHaveClass('h-[560px]');
  });

  it('closes from the close button', async () => {
    const { onClose } = renderSettingsModal(true);

    await userEvent.click(screen.getByRole('button', { name: 'Close settings' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes from Escape', () => {
    const { onClose } = renderSettingsModal(true);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes from the overlay but not from inside the panel', () => {
    const { onClose } = renderSettingsModal(true);

    fireEvent.click(screen.getByTestId('settings-modal-panel'));

    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Close settings overlay'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
