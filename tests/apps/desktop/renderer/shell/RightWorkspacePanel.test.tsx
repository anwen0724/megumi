// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('renders Files tab by default and shows workspace path in the header', async () => {
    render(<RightWorkspacePanel collapsed={false} onToggleCollapsed={() => undefined} />);

    expect(screen.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('C:/all/work/study/megumi')).toHaveAttribute('title', 'C:/all/work/study/megumi');
    expect(await screen.findByText('No files found')).toBeInTheDocument();
  });

  it('uses Files and Artifacts tabs and does not expose Context Memory Tasks or Run tabs', () => {
    render(<RightWorkspacePanel collapsed={false} onToggleCollapsed={() => undefined} />);

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Files',
      'Artifacts',
    ]);
    expect(screen.queryByRole('tab', { name: 'Context' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Memory' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Tasks' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Run' })).not.toBeInTheDocument();
  });

  it('switches to Artifacts tab', async () => {
    render(<RightWorkspacePanel collapsed={false} onToggleCollapsed={() => undefined} />);

    await userEvent.click(screen.getByRole('tab', { name: 'Artifacts' }));

    expect(screen.getByRole('tab', { name: 'Artifacts' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('No artifacts yet')).toBeInTheDocument();
  });

  it('renders collapsed rail and calls toggle', async () => {
    const onToggleCollapsed = vi.fn();

    render(<RightWorkspacePanel collapsed onToggleCollapsed={onToggleCollapsed} />);

    await userEvent.click(screen.getByRole('button', { name: 'Expand workspace panel' }));

    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it('renders the workspace panel as an integrated workbench surface instead of a floating card', async () => {
    render(<RightWorkspacePanel collapsed={false} onToggleCollapsed={() => undefined} />);

    const panel = screen.getByTestId('right-workspace-panel');
    const header = screen.getByTestId('right-workspace-panel-header');
    const content = screen.getByTestId('right-workspace-panel-content');

    expect(panel).toHaveClass('bg-[var(--color-surface)]');
    expect(panel).not.toHaveClass('bg-[var(--color-app-bg)]');
    expect(header).toHaveClass('border-b');
    expect(content).toHaveClass('overflow-y-auto');
    expect(panel.querySelector('[data-testid="right-workspace-panel-card"]')).toBeNull();
    expect(await screen.findByText('No files found')).toBeInTheDocument();
  });
});
