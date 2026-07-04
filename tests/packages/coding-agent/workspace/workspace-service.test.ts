import { describe, expect, it, vi } from 'vitest';

import { createDatabase } from '@megumi/coding-agent/persistence/connection';
import { applyCodingAgentDatabaseMigrations } from '@megumi/coding-agent/persistence/schema/migrate';
import { WorkspaceRepository } from '@megumi/coding-agent/workspace/repositories/workspace-repository';
import { createWorkspaceService } from '@megumi/coding-agent/workspace/services/workspace-service';

function createRepository() {
  const database = createDatabase(':memory:');
  applyCodingAgentDatabaseMigrations(database);
  return new WorkspaceRepository(database);
}

function directoryStat() {
  return { isDirectory: () => true };
}

function fileStat() {
  return { isDirectory: () => false };
}

describe('WorkspaceService', () => {
  it('opens a workspace after validating directory existence', async () => {
    const service = createWorkspaceService({
      repository: createRepository(),
      file_system: { stat: vi.fn(async () => directoryStat()) },
      platform: 'win32',
    });

    await expect(service.openWorkspace({
      root_path: 'C:/Work/Megumi',
      opened_at: '2026-05-19T00:00:00.000Z',
    })).resolves.toMatchObject({
      status: 'opened',
      workspace: {
        name: 'Megumi',
        root_path: 'C:\\Work\\Megumi',
        root_path_key: 'c:\\work\\megumi',
        status: 'available',
      },
    });
  });

  it('returns failures for missing and non-directory paths', async () => {
    const missing = createWorkspaceService({
      repository: createRepository(),
      file_system: {
        stat: vi.fn(async () => {
          throw new Error('missing');
        }),
      },
    });
    const file = createWorkspaceService({
      repository: createRepository(),
      file_system: { stat: vi.fn(async () => fileStat()) },
    });

    await expect(missing.openWorkspace({
      root_path: 'C:/missing',
      opened_at: '2026-05-19T00:00:00.000Z',
    })).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'workspace_path_missing' },
    });
    await expect(file.openWorkspace({
      root_path: 'C:/file.txt',
      opened_at: '2026-05-19T00:00:00.000Z',
    })).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'workspace_path_not_directory' },
    });
  });

  it('reuses the same normalized Windows root path case-insensitively', async () => {
    const repository = createRepository();
    const service = createWorkspaceService({
      repository,
      file_system: { stat: vi.fn(async () => directoryStat()) },
      platform: 'win32',
    });

    const first = await service.openWorkspace({
      root_path: 'C:/Work/Megumi',
      opened_at: '2026-05-19T00:00:00.000Z',
    });
    const second = await service.openWorkspace({
      root_path: 'c:/work/megumi',
      opened_at: '2026-05-19T00:00:10.000Z',
    });

    expect(first.status).toBe('opened');
    expect(second.status).toBe('opened');
    if (first.status === 'opened' && second.status === 'opened') {
      expect(second.workspace.workspace_id).toBe(first.workspace.workspace_id);
      expect(second.workspace.last_opened_at).toBe('2026-05-19T00:00:10.000Z');
    }
    expect(repository.listWorkspaces()).toHaveLength(1);
  });

  it('gets, lists with refreshed status, removes records, and lists authorized roots', async () => {
    const repository = createRepository();
    const stat = vi
      .fn()
      .mockResolvedValueOnce(directoryStat())
      .mockRejectedValue(new Error('missing'));
    const service = createWorkspaceService({
      repository,
      file_system: { stat },
      platform: 'win32',
      now: () => '2026-05-19T00:00:10.000Z',
    });

    const opened = await service.openWorkspace({
      root_path: 'C:/Work/Megumi',
      opened_at: '2026-05-19T00:00:00.000Z',
    });
    if (opened.status !== 'opened') {
      throw new Error('workspace should open');
    }

    expect(service.getWorkspace({ workspace_id: opened.workspace.workspace_id })).toEqual({
      status: 'found',
      workspace: opened.workspace,
    });
    expect(service.getWorkspace({ workspace_id: 'workspace:missing' })).toEqual({
      status: 'not_found',
      workspace_id: 'workspace:missing',
    });
    await expect(service.listWorkspaces({ refresh_status: true })).resolves.toEqual({
      workspaces: [
        expect.objectContaining({
          workspace_id: opened.workspace.workspace_id,
          status: 'missing',
        }),
      ],
    });
    expect(service.listAuthorizedWorkspaceRoots()).toEqual({ roots: [] });
    expect(service.removeWorkspace({ workspace_id: 'workspace:missing' })).toEqual({
      status: 'not_found',
      workspace_id: 'workspace:missing',
    });
    expect(service.removeWorkspace({ workspace_id: opened.workspace.workspace_id })).toEqual({
      status: 'removed',
      workspace_id: opened.workspace.workspace_id,
    });
  });

  it('returns blocked when an existing workspace has business facts', () => {
    const database = createDatabase(':memory:');
    applyCodingAgentDatabaseMigrations(database);
    try {
      const repository = new WorkspaceRepository(database);
      const service = createWorkspaceService({
        repository,
        file_system: { stat: vi.fn(async () => directoryStat()) },
      });
      repository.insertOrUpdateWorkspace({
        workspace_id: 'workspace:one',
        name: 'One',
        root_path: 'C:/work/one',
        root_path_key: 'c:/work/one',
        status: 'available',
        created_at: '2026-05-16T00:00:00.000Z',
        updated_at: '2026-05-16T00:00:00.000Z',
        last_opened_at: '2026-05-16T00:00:00.000Z',
      });
      database.prepare(`
        INSERT INTO sessions (
          session_id, workspace_id, title, status, active_entry_id,
          created_at, updated_at, archived_at
        ) VALUES (
          'session:one', 'workspace:one', 'Session', 'active', NULL,
          '2026-05-16T00:00:00.000Z', '2026-05-16T00:00:00.000Z', NULL
        )
      `).run();

      expect(service.removeWorkspace({ workspace_id: 'workspace:one' })).toEqual({
        status: 'blocked',
        workspace_id: 'workspace:one',
        reason: 'workspace_has_business_facts',
      });
    } finally {
      database.close();
    }
  });
});
