// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createWorkspaceFilesService,
  DEFAULT_WORKSPACE_FILE_IGNORE_NAMES,
} from '@megumi/desktop/main/services/workspace-files.service';

describe('WorkspaceFilesService', () => {
  it('lists safe directory entries and hides noisy directories by default', async () => {
    const service = createWorkspaceFilesService({
      fileSystem: {
        async readdir() {
          return [
            { name: 'apps', isDirectory: () => true, isFile: () => false },
            { name: 'README.md', isDirectory: () => false, isFile: () => true },
            { name: 'node_modules', isDirectory: () => true, isFile: () => false },
            { name: '.git', isDirectory: () => true, isFile: () => false },
          ];
        },
        async stat() {
          return {
            size: 128,
            mtime: new Date('2026-05-18T00:00:00.000Z'),
          };
        },
      },
    });

    const result = await service.listDirectory({
      workspaceRoot: 'C:/all/work/study/megumi',
      directoryPath: '',
    });

    expect(result).toMatchObject({
      workspaceRoot: 'C:/all/work/study/megumi',
      directoryPath: '',
    });
    expect(result.entries.map((entry) => entry.name)).toEqual(['apps', 'README.md']);
    expect(result.entries[0]).toMatchObject({
      name: 'apps',
      relativePath: 'apps',
      kind: 'directory',
      depth: 0,
      hidden: false,
      ignored: false,
    });
    expect(result.entries[1]).toMatchObject({
      name: 'README.md',
      relativePath: 'README.md',
      kind: 'file',
      depth: 0,
      hidden: false,
      ignored: false,
      sizeBytes: 128,
      mtime: '2026-05-18T00:00:00.000Z',
    });
  });

  it('rejects traversal outside workspace root', async () => {
    const service = createWorkspaceFilesService({
      fileSystem: {
        async readdir() {
          return [];
        },
        async stat() {
          return { size: 0, mtime: new Date('2026-05-18T00:00:00.000Z') };
        },
      },
    });

    await expect(service.listDirectory({
      workspaceRoot: 'C:/all/work/study/megumi',
      directoryPath: '../outside',
    })).rejects.toThrow();
  });

  it('keeps the ignored name list explicit', () => {
    expect(DEFAULT_WORKSPACE_FILE_IGNORE_NAMES).toEqual(expect.arrayContaining([
      '.git',
      'node_modules',
      'dist',
      'build',
      'out',
      '.next',
      '.vite',
      'coverage',
    ]));
  });
});
