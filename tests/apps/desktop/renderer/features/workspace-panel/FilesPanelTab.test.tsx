// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import { FilesPanelTab } from '@megumi/desktop/renderer/features/workspace-panel';
import { useProjectStore } from '@megumi/desktop/renderer/entities/project/store';
import { useWorkspaceFilesStore } from '@megumi/desktop/renderer/entities/workspace-files/store';

function installWorkspaceFilesMock() {
  const list = vi.fn(async (request: { payload: { workspaceRoot: string; directoryPath: string } }) => {
    const entries = request.payload.directoryPath === 'apps'
      ? [
          {
            name: 'desktop',
            relativePath: 'apps/desktop',
            kind: 'directory',
            depth: 1,
            hidden: false,
            ignored: false,
          },
        ]
      : [
          {
            name: 'apps',
            relativePath: 'apps',
            kind: 'directory',
            depth: 0,
            hidden: false,
            ignored: false,
          },
          {
            name: 'README.md',
            relativePath: 'README.md',
            kind: 'file',
            depth: 0,
            hidden: false,
            ignored: false,
          },
        ];

    return {
      ok: true,
      data: {
        workspaceRoot: request.payload.workspaceRoot,
        directoryPath: request.payload.directoryPath,
        entries,
      },
      meta: {
        requestId: 'ipc-workspace-files-list-1',
        channel: IPC_CHANNELS.workspace.files.list,
        handledAt: '2026-05-18T00:00:00.100Z',
      },
    };
  });

  Object.defineProperty(window, 'megumi', {
    configurable: true,
    value: {
      workspace: {
        files: {
          list,
        },
      },
    },
  });

  return list;
}

function selectMegumiProject() {
  useProjectStore.setState({
    projects: [
      {
        id: 'project-1',
        name: 'Megumi',
        description: 'Warm agent desktop companion',
        repoPath: 'C:/all/work/study/megumi',
        type: 'existing_feature',
        createdAt: '2026-05-18T00:00:00.000Z',
        context: {},
        projectId: 'project-1',
        repoPathKey: 'c:/all/work/study/megumi',
        lastOpenedAt: '2026-05-19T00:00:00.000Z',
        status: 'available' as const,
      },
    ],
    currentProjectId: 'project-1',
    loading: false,
  });
}

describe('FilesPanelTab', () => {
  beforeEach(() => {
    useProjectStore.setState({
      projects: [],
      currentProjectId: null,
      loading: false,
    });
    useWorkspaceFilesStore.getState().reset();
    vi.restoreAllMocks();
  });

  it('renders an empty state when no workspace is selected', () => {
    render(<FilesPanelTab />);

    expect(screen.getByText('No workspace selected')).toBeInTheDocument();
  });

  it('loads the selected project root and renders workspace entries', async () => {
    const list = installWorkspaceFilesMock();
    selectMegumiProject();

    render(<FilesPanelTab />);

    expect(await screen.findByText('apps')).toBeInTheDocument();
    expect(screen.getByText('README.md')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Workspace files' })).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith(expect.objectContaining({
      payload: {
        workspaceRoot: 'C:/all/work/study/megumi',
        directoryPath: '',
      },
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.workspace.files.list,
      }),
    }));
  });

  it('expands a directory and lazy-loads child entries through preload', async () => {
    const list = installWorkspaceFilesMock();
    selectMegumiProject();

    render(<FilesPanelTab />);

    const appsRow = await screen.findByRole('button', { name: 'apps' });
    expect(appsRow).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'README.md' })).not.toHaveAttribute('aria-expanded');

    await userEvent.click(appsRow);

    expect(appsRow).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('desktop')).toBeInTheDocument();
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(list).toHaveBeenNthCalledWith(2, expect.objectContaining({
      payload: {
        workspaceRoot: 'C:/all/work/study/megumi',
        directoryPath: 'apps',
      },
    }));
  });
});
