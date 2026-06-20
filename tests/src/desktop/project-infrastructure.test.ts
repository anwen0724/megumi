// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { DesktopIpcContext } from '../../../src/desktop/ipc/ipc-context';
import { handleProjectOperation } from '../../../src/desktop/ipc/handlers/project.handler';

function createContext(): DesktopIpcContext {
  const project = {
    id: 'project-1',
    name: 'megumi',
    path: 'C:/all/work/study/megumi',
    status: 'available' as const,
    createdAt: '2026-06-19T00:00:00.000Z',
    updatedAt: '2026-06-19T00:00:00.000Z',
    lastOpenedAt: '2026-06-19T00:00:00.000Z',
  };
  const repository = {
    listProjects: vi.fn(() => []),
    getProject: vi.fn(() => project),
    upsertFromPath: vi.fn((input) => ({
      id: 'project-2',
      name: input.name,
      path: input.path,
      status: input.status,
      createdAt: input.now,
      updatedAt: input.now,
      lastOpenedAt: input.now,
    })),
    touchProject: vi.fn(() => project),
    updateStatus: vi.fn(),
    removeProject: vi.fn(() => true),
  };
  return {
    appApi: {} as DesktopIpcContext['appApi'],
    hosts: {
      dialogHost: { openProjectDirectory: vi.fn(async () => 'C:/all/work/study/megumi') },
      shellHost: { openPath: vi.fn() },
      processHost: {} as never,
      fileHost: {
        stat: vi.fn(async () => ({ isDirectory: () => true })),
      } as never,
      secureStorageHost: {} as never,
      clipboardHost: {} as never,
      environmentHost: {} as never,
      megumiHomeHost: {} as never,
    },
    runtime: {
      projectRepository: repository,
    } as never,
    getMainWindow: () => undefined,
  };
}

describe('project IPC infrastructure', () => {
  it('opens an existing project and returns only the project payload', async () => {
    const context = createContext();

    await expect(handleProjectOperation('project.open', { projectId: 'project-1' }, context)).resolves.toEqual({
      project: {
        projectId: 'project-1',
        name: 'megumi',
        repoPath: 'C:/all/work/study/megumi',
        repoPathKey: 'c:/all/work/study/megumi',
        status: 'available',
        createdAt: '2026-06-19T00:00:00.000Z',
        lastOpenedAt: '2026-06-19T00:00:00.000Z',
      },
    });
    expect(context.runtime?.projectRepository.getProject).toHaveBeenCalledWith('project-1');
    expect(context.runtime?.projectRepository.touchProject).toHaveBeenCalledWith('project-1', expect.any(String));
  });

  it('uses a selected project directory and persists it', async () => {
    const context = createContext();

    await expect(handleProjectOperation('project.useExisting', {}, context)).resolves.toEqual({
      cancelled: false,
      project: {
        projectId: 'project-2',
        name: 'megumi',
        repoPath: 'C:/all/work/study/megumi',
        repoPathKey: 'c:/all/work/study/megumi',
        status: 'available',
        createdAt: expect.any(String),
        lastOpenedAt: expect.any(String),
      },
    });
    expect(context.runtime?.projectRepository.upsertFromPath).toHaveBeenCalled();
  });

  it('lists projects using the renderer project record contract', async () => {
    const context = createContext();
    vi.mocked(context.runtime!.projectRepository.listProjects).mockReturnValueOnce([
      {
        id: 'project-1',
        name: 'test',
        path: 'C:/all/work/study/test',
        status: 'available',
        createdAt: '2026-06-19T00:00:00.000Z',
        updatedAt: '2026-06-19T00:00:00.000Z',
        lastOpenedAt: '2026-06-20T00:00:00.000Z',
      },
    ]);

    await expect(handleProjectOperation('project.list', {}, context)).resolves.toEqual({
      projects: [
        {
          projectId: 'project-1',
          name: 'test',
          repoPath: 'C:/all/work/study/test',
          repoPathKey: 'c:/all/work/study/test',
          status: 'available',
          createdAt: '2026-06-19T00:00:00.000Z',
          lastOpenedAt: '2026-06-20T00:00:00.000Z',
        },
      ],
    });
  });
});
