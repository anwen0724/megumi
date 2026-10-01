// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/desktop/main/ipc/channels';
import { RightSidebar } from '@megumi/desktop/renderer/shell/RightSidebar';
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
              channel: IPC_CHANNELS.workspace.filesList,
              handledAt: '2026-05-18T00:00:00.000Z',
            },
          })),
        },
      },
    },
  });
}

describe('RightSidebar', () => {
  beforeEach(() => {
    useWorkspaceFilesStore.getState().reset();
    installWorkspaceFilesMock();
    useProjectStore.setState({
      projects: [
        {
          id: 'project-1',
          name: 'Megumi',
          repoPath: 'C:/workspaces/megumi',
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
    render(<RightSidebar open={false} onClose={() => undefined} />);

    expect(screen.queryByTestId('right-sidebar')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Expand workspace panel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open project sidebar' })).not.toBeInTheDocument();
  });

  it('opens to the Workspace chooser without exposing a Tools label', () => {
    render(<RightSidebar open onClose={() => undefined} />);

    expect(screen.getByTestId('right-sidebar')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Project' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Files project view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Artifacts project view' })).toBeInTheDocument();
    expect(screen.queryByText('Tools')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Files' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Artifacts' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Context' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Memory' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Run' })).not.toBeInTheDocument();
  });

  it('shows Files inside the full workspace sidebar and can return to Workspace', async () => {
    render(<RightSidebar open onClose={() => undefined} />);

    await userEvent.click(screen.getByRole('button', { name: 'Open Files project view' }));

    expect(screen.getByRole('heading', { name: 'Files' })).toBeInTheDocument();
    expect(screen.getByText('Megumi')).toBeInTheDocument();
    expect(screen.getByText('C:/workspaces/megumi')).toHaveAttribute('title', 'C:/workspaces/megumi');
    expect(await screen.findByText('No files found')).toBeInTheDocument();
    expect(screen.queryByText('Tools')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Back to Project' }));

    expect(screen.getByRole('heading', { name: 'Project' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Files project view' })).toBeInTheDocument();
  });

  it('shows Artifacts inside the full workspace sidebar', async () => {
    render(<RightSidebar open onClose={() => undefined} />);

    await userEvent.click(screen.getByRole('button', { name: 'Open Artifacts project view' }));

    expect(screen.getByRole('heading', { name: 'Artifacts' })).toBeInTheDocument();
    expect(screen.getByText('No artifacts yet')).toBeInTheDocument();
    expect(screen.queryByText('Tools')).not.toBeInTheDocument();
  });

  it('calls onClose from the full sidebar close button', async () => {
    const onClose = vi.fn();

    render(<RightSidebar open onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: 'Close project sidebar' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hides the workspace sidebar when it is closed', async () => {
    const { rerender } = render(<RightSidebar open onClose={() => undefined} />);

    rerender(<RightSidebar open={false} onClose={() => undefined} />);

    await waitFor(() => expect(screen.queryByTestId('right-sidebar')).not.toBeInTheDocument());
  });
});

