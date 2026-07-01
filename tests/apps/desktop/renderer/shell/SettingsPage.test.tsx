// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc';
import { DEFAULT_APP_SETTINGS } from '@megumi/coding-agent/settings';
import { SettingsPage } from '@megumi/desktop/renderer/shell/SettingsPage';
import { ThemeProvider, useThemeStore } from '@megumi/desktop/renderer/shared/theme';

function renderSettingsPage(onDone = vi.fn()) {
  return {
    onDone,
    ...render(
      <ThemeProvider>
        <SettingsPage onDone={onDone} />
      </ThemeProvider>,
    ),
  };
}

describe('SettingsPage', () => {
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
        settings: {
          get: vi.fn().mockResolvedValue({
            ok: true,
            data: {
              settings: {
                ...DEFAULT_APP_SETTINGS,
                theme: 'megumi-warm',
                memory: { enabled: false },
                compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
              },
            },
            meta: {},
          }),
          update: vi.fn().mockResolvedValue({
            ok: true,
            data: {
              settings: {
                ...DEFAULT_APP_SETTINGS,
                theme: 'midnight-blue',
                memory: { enabled: true },
                compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
              },
            },
            meta: {},
          }),
        },
      },
    });
  });

  it('renders as a main-area page without its own page header or Done action', () => {
    renderSettingsPage();

    expect(screen.getByTestId('settings-page')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Close settings ' + 'overlay')).not.toBeInTheDocument();
    expect(screen.getByTestId('settings-page')).not.toHaveClass('fixed');
    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.queryByText('Local desktop preferences')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to chat' })).toBeInTheDocument();
  });

  it('renders the appearance section by default with visual theme picker', () => {
    renderSettingsPage();

    expect(screen.getByRole('tab', { name: 'Appearance' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Theme')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Megumi Warm/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /Graphite Dark/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Switch to .* theme/ })).not.toBeInTheDocument();
  });

  it('selects themes from settings appearance without changing theme persistence semantics', async () => {
    renderSettingsPage();

    await userEvent.click(screen.getByRole('radio', { name: /Midnight Blue/ }));

    expect(useThemeStore.getState().theme).toBe('midnight-blue');
    expect(screen.getByTestId('megumi-theme-root')).toHaveAttribute('data-theme', 'midnight-blue');
  });

  it('switches between available settings categories without exposing unclosed product areas', async () => {
    renderSettingsPage();

    const categories = screen.getByRole('tablist', { name: 'Settings categories' });
    expect(within(categories).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Appearance',
      'Models',
      'Memory',
      'Security',
      'About',
    ]);
    expect(screen.queryByRole('tab', { name: 'Context' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Run dashboard' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Checkpoint' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Models' }));
    expect(screen.getByRole('tab', { name: 'Models' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Provider settings')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Memory' }));
    expect(screen.getByText('Long-term memory')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Security' }));
    expect(screen.getByText('Secret storage')).toBeInTheDocument();
    expect(screen.getByText('Approval policies')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'About' }));
    expect(screen.getByText('AI provider chat runtime integration')).toBeInTheDocument();
    expect(screen.getByText('This build connects the desktop UI to provider-backed streaming chat.')).toBeInTheDocument();
  });

  it('uses a stable two-pane page layout across categories', async () => {
    renderSettingsPage();

    const page = screen.getByTestId('settings-page');
    const content = screen.getByTestId('settings-page-content');
    expect(page).toHaveClass('min-w-[42rem]');
    expect(page).toHaveClass('overflow-hidden');
    expect(content).toHaveClass('grid');
    expect(content).toHaveClass('grid-cols-[13rem_minmax(0,1fr)]');

    await userEvent.click(screen.getByRole('tab', { name: 'Models' }));
    expect(content).toHaveClass('grid-cols-[13rem_minmax(0,1fr)]');

    await userEvent.click(screen.getByRole('tab', { name: 'Appearance' }));
    expect(content).toHaveClass('grid-cols-[13rem_minmax(0,1fr)]');
  });

  it('updates the global memory runtime setting without a workspace payload', async () => {
    renderSettingsPage();

    await userEvent.click(screen.getByRole('tab', { name: 'Memory' }));

    await waitFor(() => {
      expect(window.megumi.settings.get).toHaveBeenCalledWith(expect.objectContaining({
        payload: {},
      }));
    });

    const toggle = await screen.findByRole('switch', { name: 'Long-term memory' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    await userEvent.click(toggle);

    expect(window.megumi.settings.update).toHaveBeenCalledWith(expect.objectContaining({
      payload: {
        memory: {
          enabled: true,
        },
      },
    }));
    expect(JSON.stringify(vi.mocked(window.megumi.settings.update).mock.calls)).not.toContain('workspaceId');
  });

  it('calls onDone from Escape without rendering a visible Done button', () => {
    const { onDone } = renderSettingsPage();

    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('returns to chat from the sidebar back button', async () => {
    const { onDone } = renderSettingsPage();

    await userEvent.click(screen.getByRole('button', { name: 'Back to chat' }));

    expect(onDone).toHaveBeenCalledTimes(1);
  });
});


