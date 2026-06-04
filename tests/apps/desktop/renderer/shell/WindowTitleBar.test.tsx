// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@megumi/desktop/renderer/shared/theme';
import { WindowTitleBar } from '@megumi/desktop/renderer/shell/WindowTitleBar';

const { minimize, toggleMaximize, close } = vi.hoisted(() => ({
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
  close: vi.fn(),
}));

vi.mock('@megumi/desktop/renderer/shared/ipc/client', () => ({
  windowControls: {
    minimize,
    toggleMaximize,
    close,
  },
}));

function renderTitleBar() {
  return render(
    <ThemeProvider>
      <WindowTitleBar title="Planning the UI" />
    </ThemeProvider>,
  );
}

describe('WindowTitleBar', () => {
  beforeEach(() => {
    minimize.mockReset();
    toggleMaximize.mockReset();
    close.mockReset();
  });

  it('renders only the current session title and window controls', () => {
    renderTitleBar();

    expect(screen.getByText('Planning the UI')).toBeInTheDocument();
    expect(screen.queryByText('Warm agent workspace')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Switch to .* theme/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Minimize window' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Maximize or restore window' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close window' })).toBeInTheDocument();
  });

  it('calls window control APIs from the titlebar buttons', async () => {
    renderTitleBar();

    await userEvent.click(screen.getByRole('button', { name: 'Minimize window' }));
    await userEvent.click(screen.getByRole('button', { name: 'Maximize or restore window' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close window' }));

    expect(minimize).toHaveBeenCalledTimes(1);
    expect(toggleMaximize).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('marks the titlebar as draggable and controls as non-draggable', () => {
    renderTitleBar();

    expect(screen.getByTestId('window-titlebar')).toHaveClass('app-drag-region');
    expect(screen.getByTestId('window-titlebar-controls')).toHaveClass('app-no-drag');
  });

  it('renders a workspace sidebar toggle when shell handlers are provided', async () => {
    const onToggleWorkspaceSidebar = vi.fn();
    render(
      <ThemeProvider>
        <WindowTitleBar
          title="Planning the UI"
          workspaceSidebarOpen={false}
          onToggleWorkspaceSidebar={onToggleWorkspaceSidebar}
        />
      </ThemeProvider>,
    );

    const toggle = screen.getByRole('button', { name: 'Open workspace sidebar' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(toggle);

    expect(onToggleWorkspaceSidebar).toHaveBeenCalledTimes(1);
  });

  it('updates the workspace sidebar toggle state when open', () => {
    render(
      <ThemeProvider>
        <WindowTitleBar
          title="Planning the UI"
          workspaceSidebarOpen
          onToggleWorkspaceSidebar={() => undefined}
        />
      </ThemeProvider>,
    );

    const toggle = screen.getByRole('button', { name: 'Close workspace sidebar' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });
});
