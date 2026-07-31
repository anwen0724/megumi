/*
 * Protects canonical Workspace lookup, filtered directory reads, and safe file references.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKSPACE_FILE_IGNORE_NAMES,
  createWorkspaceFiles,
  createWorkspacePathPolicy,
  type Workspace,
} from '../../../packages/workspace/src/index';

const workspace: Workspace = {
  workspace_id: 'workspace:one',
  name: 'One',
  root_path: '/workspace',
  root_path_key: '/workspace',
  status: 'available',
  created_at: '2026-05-18T00:00:00.000Z',
  updated_at: '2026-05-18T00:00:00.000Z',
  last_opened_at: '2026-05-18T00:00:00.000Z',
};

describe('WorkspaceFiles', () => {
  it('lists stable, filtered file metadata from a canonical Workspace', async () => {
    const files = createFiles();
    const result = await files.listDirectory({ workspace_id: workspace.workspace_id, directory_path: '' });

    expect(result).toMatchObject({
      status: 'ok',
      workspace_id: workspace.workspace_id,
      workspace_root: '/workspace',
      directory_path: '',
    });
    if (result.status !== 'ok') return;
    expect(result.entries.map((entry) => entry.name)).toEqual(['apps', 'README.md']);
    expect(result.entries[1]).toMatchObject({
      relative_path: 'README.md', type: 'file', size_bytes: 128, hidden: false,
      modified_at: '2026-05-18T00:00:00.000Z',
    });
  });

  it.each(['../outside', 'C:/outside', 'C:\\outside', '/outside'])(
    'rejects absolute or traversing path %s',
    async (directoryPath) => {
      const result = await createFiles().listDirectory({
        workspace_id: workspace.workspace_id,
        directory_path: directoryPath,
      });
      expect(result.status).toBe('path_rejected');
    },
  );

  it('does not accept a caller-supplied root for an unknown Workspace', async () => {
    await expect(createFiles().resolveFile({
      workspace_id: 'workspace:missing', file_path: 'README.md',
    })).resolves.toEqual({ status: 'workspace_not_found', workspace_id: 'workspace:missing' });
  });

  it('resolves a safe file reference and rejects symlink escape', async () => {
    await expect(createFiles().resolveFile({
      workspace_id: workspace.workspace_id, file_path: 'apps/main.ts',
    })).resolves.toMatchObject({ status: 'ok', file_path: 'apps/main.ts', absolute_path: '/workspace/apps/main.ts' });

    await expect(createFiles({
      realpath: async (target) => target.endsWith('linked.txt') ? '/outside/secret.txt' : target,
    }).resolveFile({
      workspace_id: workspace.workspace_id, file_path: 'linked.txt',
    })).resolves.toEqual({ status: 'path_rejected', reason: 'outside_workspace' });
  });

  it('keeps the ignore policy explicit', () => {
    expect(DEFAULT_WORKSPACE_FILE_IGNORE_NAMES).toEqual(expect.arrayContaining(['.git', 'node_modules', 'dist', 'coverage']));
  });
});

function createFiles(overrides: { realpath?: (target: string) => Promise<string> } = {}) {
  return createWorkspaceFiles({
    catalog: {
      getWorkspace: ({ workspace_id }) => workspace_id === workspace.workspace_id
        ? { status: 'found', workspace }
        : { status: 'not_found', workspace_id },
    },
    path_policy: createWorkspacePathPolicy(),
    platform: 'linux',
    file_system: {
      async realpath(target) { return overrides.realpath?.(target) ?? target; },
      async readdir() {
        return [
          { name: 'README.md', isDirectory: () => false, isFile: () => true },
          { name: 'node_modules', isDirectory: () => true, isFile: () => false },
          { name: 'apps', isDirectory: () => true, isFile: () => false },
          { name: '.git', isDirectory: () => true, isFile: () => false },
        ];
      },
      async stat() { return { size: 128, mtime: new Date('2026-05-18T00:00:00.000Z') }; },
    },
  });
}
