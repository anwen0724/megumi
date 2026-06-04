// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import { RightWorkspacePanel } from '@megumi/desktop/renderer/shell/RightWorkspacePanel';
import { useProjectStore } from '@megumi/desktop/renderer/entities/project/store';
import { useWorkspaceFilesStore } from '@megumi/desktop/renderer/entities/workspace-files/store';

function installWorkspaceFilesMock() {
  Object.defineProperty(window, 'megumi', {
    configurable: true,
    value: {
      workspace: {
        files: {
          list: vi.fn(async (request: { payload: { workspaceRoot: string; directoryPath: string } }) => ({
            ok: true,
            data: {
              workspaceRoot: request.payload.workspaceRoot,
              directoryPath: request.payload.directoryPath,
              entries: [],
            },
            meta: {
              requestId: 'ipc-workspace-files-list-1',
              channel: IPC_CHANNELS.workspace.files.list,
              handledAt: '2026-05-18T00:00:00.000Z',
            },
          })),
        },
      },
    },
  });
}

describe('RightWorkspacePanel', () => {
  beforeEach(() => {
    useWorkspaceFilesStore.getState().reset();
    installWorkspaceFilesMock();
    useProjectStore.setState({
      projects: [
        {
          id: 'project-1',
          name: 'Megumi',
          repoPath: 'C:/all/work/study/megumi',
          createdAt: '2026-05-09T00:00:00.000Z',
          projectId: 'project-1',
          repoPathKey: 'c:/all/work/study/megumi',
          lastOpenedAt: '2026-05-19T00:00:00.000Z',
          status: 'available' as const,
        },
      ],
      currentProjectId: 'project-1',
      loading: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when the workspace sidebar is closed', () => {
    render(<RightWorkspacePanel open={false} onClose={() => undefined} />);

    expect(screen.queryByTestId('right-workspace-panel')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Expand workspace panel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open workspace sidebar' })).not.toBeInTheDocument();
  });

  it('mounts before entering the expanded open state', () => {
    vi.useFakeTimers();
    const { rerender } = render(<RightWorkspacePanel open={false} onClose={() => undefined} />);

    expect(screen.queryByTestId('right-workspace-panel')).not.toBeInTheDocument();

    rerender(<RightWorkspacePanel open onClose={() => undefined} />);

    const enteringPanel = screen.getByTestId('right-workspace-panel');
    expect(enteringPanel).toHaveClass('w-0');
    expect(enteringPanel).toHaveClass('opacity-0');
    expect(enteringPanel).toHaveClass('translate-x-6');

    act(() => {
      vi.runOnlyPendingTimers();
    });

    const expandedPanel = screen.getByTestId('right-workspace-panel');
    expect(expandedPanel).toHaveClass('w-80');
    expect(expandedPanel).toHaveClass('opacity-100');
    expect(expandedPanel).toHaveClass('translate-x-0');
  });

  it('opens to the Workspace chooser without exposing a Tools label', () => {
    render(<RightWorkspacePanel open onClose={() => undefined} />);

    expect(screen.getByTestId('right-workspace-panel')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Workspace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Files workspace view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Artifacts workspace view' })).toBeInTheDocument();
    expect(screen.queryByText('Tools')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Files' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Artifacts' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Context' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Memory' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Run' })).not.toBeInTheDocument();
  });

  it('shows Files inside the full workspace sidebar and can return to Workspace', async () => {
    render(<RightWorkspacePanel open onClose={() => undefined} />);

    await userEvent.click(screen.getByRole('button', { name: 'Open Files workspace view' }));

    expect(screen.getByRole('heading', { name: 'Files' })).toBeInTheDocument();
    expect(screen.getByText('Megumi')).toBeInTheDocument();
    expect(screen.getByText('C:/all/work/study/megumi')).toHaveAttribute('title', 'C:/all/work/study/megumi');
    expect(await screen.findByText('No files found')).toBeInTheDocument();
    expect(screen.queryByText('Tools')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Back to Workspace' }));

    expect(screen.getByRole('heading', { name: 'Workspace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Files workspace view' })).toBeInTheDocument();
  });

  it('shows Artifacts inside the full workspace sidebar', async () => {
    render(<RightWorkspacePanel open onClose={() => undefined} />);

    await userEvent.click(screen.getByRole('button', { name: 'Open Artifacts workspace view' }));

    expect(screen.getByRole('heading', { name: 'Artifacts' })).toBeInTheDocument();
    expect(screen.getByText('No artifacts yet')).toBeInTheDocument();
    expect(screen.queryByText('Tools')).not.toBeInTheDocument();
  });

  it('calls onClose from the full sidebar close button', async () => {
    const onClose = vi.fn();

    render(<RightWorkspacePanel open onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: 'Close workspace sidebar' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('uses an occupied sidebar surface instead of a floating card or collapsed rail', () => {
    render(<RightWorkspacePanel open onClose={() => undefined} />);

    const panel = screen.getByTestId('right-workspace-panel');
    const content = screen.getByTestId('right-workspace-panel-content');

    expect(panel).toHaveAttribute('id', 'right-workspace-sidebar');
    expect(panel).toHaveClass('w-80');
    expect(panel).toHaveClass('border-l');
    expect(panel).toHaveClass('transition-[width,opacity,transform]');
    expect(panel).not.toHaveClass('fixed');
    expect(panel).not.toHaveClass('absolute');
    expect(content).toHaveClass('overflow-y-auto');
    expect(panel.querySelector('[data-testid="right-workspace-panel-card"]')).toBeNull();
  });

  it('keeps the sidebar mounted during the closing transition before unmounting', () => {
    vi.useFakeTimers();
    const { rerender } = render(<RightWorkspacePanel open onClose={() => undefined} />);

    expect(screen.getByTestId('right-workspace-panel')).toHaveClass('w-80');

    rerender(<RightWorkspacePanel open={false} onClose={() => undefined} />);

    const closingPanel = screen.getByTestId('right-workspace-panel');
    expect(closingPanel).toHaveClass('w-0');
    expect(closingPanel).toHaveClass('opacity-0');
    expect(closingPanel).toHaveClass('translate-x-6');
    expect(closingPanel).toHaveClass('pointer-events-none');
    expect(closingPanel).not.toHaveClass('w-80');

    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(screen.getByTestId('right-workspace-panel')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId('right-workspace-panel')).not.toBeInTheDocument();
  });
});
