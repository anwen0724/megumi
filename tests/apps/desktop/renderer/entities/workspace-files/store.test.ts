// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc';
import { useWorkspaceFilesStore } from '@megumi/desktop/renderer/entities/workspace-files/store';

function createDeferred<T>() {
  let resolve: (value: T) => void;
  let reject: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return {
    promise,
    resolve: resolve!,
    reject: reject!,
  };
}

function createWorkspaceFilesResult({
  workspaceRoot,
  directoryPath,
  entryName,
}: {
  workspaceRoot: string;
  directoryPath: string;
  entryName: string;
}) {
  return {
    ok: true,
    data: {
      workspaceRoot,
      directoryPath,
      entries: [
        {
          name: entryName,
          relativePath: entryName,
          kind: 'directory',
          depth: 0,
          hidden: false,
          ignored: false,
        },
      ],
    },
    meta: {
      requestId: 'ipc-workspace-files-list-1',
      channel: IPC_CHANNELS.workspace.files.list,
      handledAt: '2026-05-18T00:00:00.100Z',
    },
  } as const;
}

function installWorkspaceFilesMock() {
  const files = {
    list: vi.fn(async () => ({
      ok: true,
      data: {
        workspaceRoot: 'C:/all/work/study/megumi',
        directoryPath: '',
        entries: [
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
        ],
      },
      meta: {
        requestId: 'ipc-workspace-files-list-1',
        channel: IPC_CHANNELS.workspace.files.list,
        handledAt: '2026-05-18T00:00:00.100Z',
      },
    })),
  };

  Object.defineProperty(window, 'megumi', {
    configurable: true,
    value: {
      workspace: {
        files,
      },
    },
  });

  return files;
}

describe('useWorkspaceFilesStore', () => {
  beforeEach(() => {
    useWorkspaceFilesStore.getState().reset();
    vi.restoreAllMocks();
  });

  it('loads a directory through the preload workspace files API', async () => {
    const files = installWorkspaceFilesMock();

    await useWorkspaceFilesStore.getState().loadDirectory({
      workspaceRoot: 'C:/all/work/study/megumi',
      directoryPath: '',
    });

    expect(files.list).toHaveBeenCalledWith(expect.objectContaining({
      payload: {
        workspaceRoot: 'C:/all/work/study/megumi',
        directoryPath: '',
      },
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.workspace.files.list,
        source: 'renderer',
      }),
      context: expect.objectContaining({
        operationName: 'workspace.files.list',
        source: 'renderer',
      }),
    }));
    expect(useWorkspaceFilesStore.getState().entriesByDirectory['']).toEqual([
      expect.objectContaining({ name: 'apps', relativePath: 'apps', kind: 'directory' }),
      expect.objectContaining({ name: 'README.md', relativePath: 'README.md', kind: 'file' }),
    ]);
    expect(useWorkspaceFilesStore.getState().loadingDirectories).not.toContain('');
  });

  it('clears previous workspace file state before loading a new workspace root', async () => {
    const newWorkspaceLoad = createDeferred<ReturnType<typeof createWorkspaceFilesResult>>();
    const files = {
      list: vi
        .fn()
        .mockResolvedValueOnce(createWorkspaceFilesResult({
          workspaceRoot: 'C:/work/project-a',
          directoryPath: '',
          entryName: 'project-a-apps',
        }))
        .mockReturnValueOnce(newWorkspaceLoad.promise),
    };
    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: {
        workspace: {
          files,
        },
      },
    });

    await useWorkspaceFilesStore.getState().loadDirectory({
      workspaceRoot: 'C:/work/project-a',
      directoryPath: '',
    });
    useWorkspaceFilesStore.getState().toggleDirectory('project-a-apps');
    useWorkspaceFilesStore.getState().setSelectedPath('project-a-apps');
    useWorkspaceFilesStore.setState({
      error: 'Previous workspace error',
      loadingDirectories: ['project-a-apps'],
    });

    const loadProjectB = useWorkspaceFilesStore.getState().loadDirectory({
      workspaceRoot: 'C:/work/project-b',
      directoryPath: '',
    });

    expect(useWorkspaceFilesStore.getState()).toMatchObject({
      workspaceRoot: 'C:/work/project-b',
      entriesByDirectory: {},
      expandedDirectoryPaths: [],
      selectedPath: null,
      loadingDirectories: [''],
      error: null,
    });

    newWorkspaceLoad.resolve(createWorkspaceFilesResult({
      workspaceRoot: 'C:/work/project-b',
      directoryPath: '',
      entryName: 'project-b-apps',
    }));
    await loadProjectB;

    expect(useWorkspaceFilesStore.getState().entriesByDirectory['']).toEqual([
      expect.objectContaining({ name: 'project-b-apps' }),
    ]);
  });

  it('ignores stale workspace file responses after the active workspace changes', async () => {
    const projectALoad = createDeferred<ReturnType<typeof createWorkspaceFilesResult>>();
    const projectBLoad = createDeferred<ReturnType<typeof createWorkspaceFilesResult>>();
    const files = {
      list: vi
        .fn()
        .mockReturnValueOnce(projectALoad.promise)
        .mockReturnValueOnce(projectBLoad.promise),
    };
    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: {
        workspace: {
          files,
        },
      },
    });

    const loadProjectA = useWorkspaceFilesStore.getState().loadDirectory({
      workspaceRoot: 'C:/work/project-a',
      directoryPath: '',
    });
    const loadProjectB = useWorkspaceFilesStore.getState().loadDirectory({
      workspaceRoot: 'C:/work/project-b',
      directoryPath: '',
    });

    projectALoad.resolve(createWorkspaceFilesResult({
      workspaceRoot: 'C:/work/project-a',
      directoryPath: '',
      entryName: 'project-a-apps',
    }));
    await loadProjectA;

    expect(useWorkspaceFilesStore.getState()).toMatchObject({
      workspaceRoot: 'C:/work/project-b',
      entriesByDirectory: {},
      loadingDirectories: [''],
      error: null,
    });

    projectBLoad.resolve(createWorkspaceFilesResult({
      workspaceRoot: 'C:/work/project-b',
      directoryPath: '',
      entryName: 'project-b-apps',
    }));
    await loadProjectB;

    expect(useWorkspaceFilesStore.getState()).toMatchObject({
      workspaceRoot: 'C:/work/project-b',
      loadingDirectories: [],
      error: null,
    });
    expect(useWorkspaceFilesStore.getState().entriesByDirectory['']).toEqual([
      expect.objectContaining({ name: 'project-b-apps' }),
    ]);
  });

  it('tracks expanded directories and selected paths', () => {
    useWorkspaceFilesStore.getState().toggleDirectory('apps');
    useWorkspaceFilesStore.getState().setSelectedPath('apps/desktop');

    expect(useWorkspaceFilesStore.getState().expandedDirectoryPaths).toEqual(['apps']);
    expect(useWorkspaceFilesStore.getState().selectedPath).toBe('apps/desktop');

    useWorkspaceFilesStore.getState().toggleDirectory('apps');

    expect(useWorkspaceFilesStore.getState().expandedDirectoryPaths).toEqual([]);
  });

  it('stores readable errors and clears loading state when directory loading fails', async () => {
    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: {
        workspace: {
          files: {
            list: vi.fn(async () => ({
              ok: false,
              error: {
                code: 'workspace_files_list_failed',
                message: 'Megumi could not list workspace files.',
                severity: 'error',
                retryable: true,
                source: 'main',
                debugId: 'debug-workspace-files-1',
              },
              meta: {
                requestId: 'ipc-workspace-files-list-1',
                channel: IPC_CHANNELS.workspace.files.list,
                handledAt: '2026-05-18T00:00:00.100Z',
              },
            })),
          },
        },
      },
    });

    await useWorkspaceFilesStore.getState().loadDirectory({
      workspaceRoot: 'C:/all/work/study/megumi',
      directoryPath: 'apps',
    });

    expect(useWorkspaceFilesStore.getState().error).toBe('Megumi could not list workspace files.');
    expect(useWorkspaceFilesStore.getState().loadingDirectories).not.toContain('apps');
  });
});

