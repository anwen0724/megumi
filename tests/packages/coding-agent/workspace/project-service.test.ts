// @vitest-environment node
// Verifies the product workspace project service (moved out of the desktop shell):
// it is port-driven (directory picker + file system), exposes
// ProjectPathValidationError, and drives project lifecycle over a real SQLite
// project repository. Proves project lifecycle is product behavior, not desktop
// behavior.
import { describe, expect, it, vi } from 'vitest';
import { createDatabase } from '@megumi/coding-agent/persistence/connection';
import { ProjectRepository } from '@megumi/coding-agent/persistence/repos/project.repo';
import { migrateDatabase } from '@megumi/coding-agent/persistence/schema/migrations';
import {
  ProjectPathValidationError,
  createProjectService,
} from '@megumi/coding-agent/workspace';

function createRepo() {
  const database = createDatabase(':memory:');
  migrateDatabase(database);
  return new ProjectRepository(database);
}

function createDirectoryStat() {
  return {
    isDirectory: () => true,
  };
}

function createFileStat() {
  return {
    isDirectory: () => false,
  };
}

describe('product project service', () => {
  it('returns cancelled when the user cancels directory selection', async () => {
    const service = createProjectService({
      repository: createRepo(),
      now: () => '2026-05-19T00:00:00.000Z',
      directoryPicker: { chooseDirectory: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
      fileSystem: {
        stat: vi.fn(),
      },
    });

    await expect(service.useExistingProject()).resolves.toEqual({ cancelled: true });
  });

  it('returns cancelled with the default no-op picker (standalone product, no UI shell)', async () => {
    const service = createProjectService({
      repository: createRepo(),
      now: () => '2026-05-19T00:00:00.000Z',
      fileSystem: { stat: vi.fn() },
    });

    await expect(service.useExistingProject()).resolves.toEqual({ cancelled: true });
  });

  it('creates or reuses a project from a selected directory', async () => {
    const chooseDirectory = vi
      .fn()
      .mockResolvedValueOnce({ canceled: false, filePaths: ['C:/Work/Megumi'] })
      .mockResolvedValueOnce({ canceled: false, filePaths: ['c:/work/megumi'] });
    const service = createProjectService({
      repository: createRepo(),
      now: vi
        .fn()
        .mockReturnValueOnce('2026-05-19T00:00:00.000Z')
        .mockReturnValueOnce('2026-05-19T00:00:10.000Z'),
      directoryPicker: { chooseDirectory },
      platform: 'win32',
      fileSystem: {
        stat: vi.fn(async () => createDirectoryStat()),
      },
    });

    const first = await service.useExistingProject();
    const second = await service.useExistingProject();

    expect(first.cancelled).toBe(false);
    expect(second.cancelled).toBe(false);
    if (!first.cancelled && !second.cancelled) {
      expect(second.project.projectId).toBe(first.project.projectId);
      expect(second.project.lastOpenedAt).toBe('2026-05-19T00:00:10.000Z');
    }
  });

  it('rejects selected paths that are not directories', async () => {
    const service = createProjectService({
      repository: createRepo(),
      now: () => '2026-05-19T00:00:00.000Z',
      directoryPicker: { chooseDirectory: vi.fn(async () => ({ canceled: false, filePaths: ['C:/Work/readme.md'] })) },
      fileSystem: {
        stat: vi.fn(async () => createFileStat()),
      },
    });

    await expect(service.useExistingProject()).rejects.toBeInstanceOf(ProjectPathValidationError);
  });

  it('marks missing projects when listProjects refreshes status', async () => {
    const repo = createRepo();
    const project = repo.upsertFromRepoPath({
      repoPath: 'C:/Work/Megumi',
      now: '2026-05-19T00:00:00.000Z',
      platform: 'win32',
    });
    const service = createProjectService({
      repository: repo,
      now: () => '2026-05-19T00:00:10.000Z',
      platform: 'win32',
      fileSystem: {
        stat: vi.fn(async () => {
          throw new Error('missing');
        }),
      },
    });

    await expect(service.listProjects()).resolves.toEqual([
      expect.objectContaining({
        projectId: project.projectId,
        status: 'missing',
      }),
    ]);
  });

  it('opens an existing available project and returns authorized workspace roots', async () => {
    const repo = createRepo();
    const project = repo.upsertFromRepoPath({
      repoPath: 'C:/Work/Megumi',
      now: '2026-05-19T00:00:00.000Z',
      platform: 'win32',
    });
    const service = createProjectService({
      repository: repo,
      now: () => '2026-05-19T00:00:10.000Z',
      platform: 'win32',
      fileSystem: {
        stat: vi.fn(async () => createDirectoryStat()),
      },
    });

    await expect(service.openProject({ projectId: project.projectId })).resolves.toMatchObject({
      projectId: project.projectId,
      status: 'available',
      lastOpenedAt: '2026-05-19T00:00:10.000Z',
    });
    expect(service.listAuthorizedWorkspaceRoots()).toEqual([project.repoPath]);
  });

  it('removes projects from Megumi without deleting the disk folder', () => {
    const repo = createRepo();
    const project = repo.upsertFromRepoPath({
      repoPath: 'C:/Work/Megumi',
      now: '2026-05-19T00:00:00.000Z',
      platform: 'win32',
    });
    const remove = vi.fn();
    const service = createProjectService({
      repository: repo,
      now: () => '2026-05-19T00:00:10.000Z',
      platform: 'win32',
      fileSystem: {
        stat: vi.fn(async () => createDirectoryStat()),
        remove,
      },
    });

    expect(service.removeProject({ projectId: project.projectId })).toEqual({
      projectId: project.projectId,
      removed: true,
    });
    expect(remove).not.toHaveBeenCalled();
    expect(repo.getProject(project.projectId)).toBeUndefined();
  });
});
