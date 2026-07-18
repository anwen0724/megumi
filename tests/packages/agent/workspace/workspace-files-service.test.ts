// @vitest-environment node
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createWorkspaceFilesService,
  createWorkspacePathPolicyService,
  DEFAULT_WORKSPACE_FILE_IGNORE_NAMES,
  type Workspace,
} from '@megumi/agent/workspace';

const workspace: Workspace = {
  workspace_id: 'workspace:megumi',
  name: 'megumi',
  root_path: path.resolve('C:/workspaces/megumi'),
  root_path_key: path.resolve('C:/workspaces/megumi'),
  status: 'available',
  created_at: '2026-05-18T00:00:00.000Z',
  updated_at: '2026-05-18T00:00:00.000Z',
  last_opened_at: '2026-05-18T00:00:00.000Z',
};

describe('WorkspaceFilesService', () => {
  it('resolves the canonical Workspace and lists stable, filtered metadata', async () => {
    const service = createService();
    const result = await service.listDirectory({
      workspace_id: workspace.workspace_id,
      directory_path: '',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.workspace_root).toBe(workspace.root_path);
    expect(result.entries.map((entry) => entry.name)).toEqual(['apps', 'README.md']);
    expect(result.entries[1]).toMatchObject({
      relative_path: 'README.md',
      type: 'file',
      depth: 0,
      hidden: false,
      size_bytes: 128,
      modified_at: '2026-05-18T00:00:00.000Z',
    });
  });

  it.each([
    ['traversal', '../outside'],
    ['Windows absolute', 'C:/outside'],
    ['Windows backslash absolute', 'C:\\outside'],
    ['POSIX absolute', '/outside'],
  ])('rejects %s paths', async (_label, directoryPath) => {
    const result = await createService().listDirectory({
      workspace_id: workspace.workspace_id,
      directory_path: directoryPath,
    });
    expect(result.status).toBe('path_rejected');
  });

  it('does not accept a Renderer-supplied root for an unknown Workspace', async () => {
    const result = await createService().listDirectory({
      workspace_id: 'workspace:missing',
      directory_path: '',
    });
    expect(result).toEqual({ status: 'workspace_not_found', workspace_id: 'workspace:missing' });
  });

  it('normalizes relative paths and resolves files for a Host opener', () => {
    const result = createService().resolveFile({
      workspace_id: workspace.workspace_id,
      file_path: 'apps\\desktop\\src\\app.ts',
    });
    expect(result).toMatchObject({
      status: 'ok',
      workspace_id: workspace.workspace_id,
      file_path: 'apps/desktop/src/app.ts',
      absolute_path: expect.stringMatching(/apps[\\/]desktop[\\/]src[\\/]app\.ts$/),
    });
  });

  it('keeps the product ignore policy explicit', () => {
    expect(DEFAULT_WORKSPACE_FILE_IGNORE_NAMES).toEqual(expect.arrayContaining([
      '.git', 'node_modules', 'dist', 'build', 'out', '.next', '.vite', 'coverage',
    ]));
  });
});

function createService() {
  return createWorkspaceFilesService({
    workspaceService: {
      getWorkspace: ({ workspace_id }) => workspace_id === workspace.workspace_id
        ? { status: 'found', workspace }
        : { status: 'not_found', workspace_id },
    },
    pathPolicy: createWorkspacePathPolicyService(),
    fileSystem: {
      async readdir() {
        return [
          { name: 'README.md', isDirectory: () => false, isFile: () => true },
          { name: 'node_modules', isDirectory: () => true, isFile: () => false },
          { name: 'apps', isDirectory: () => true, isFile: () => false },
          { name: '.git', isDirectory: () => true, isFile: () => false },
        ];
      },
      async stat() {
        return { size: 128, mtime: new Date('2026-05-18T00:00:00.000Z') };
      },
    },
  });
}
