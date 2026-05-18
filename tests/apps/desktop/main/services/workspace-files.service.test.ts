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

  it('rejects workspace roots outside the configured allow-list', async () => {
    const service = createWorkspaceFilesService({
      allowedWorkspaceRoots: ['C:/all/work/study/megumi'],
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
      workspaceRoot: 'C:/',
      directoryPath: '',
    })).rejects.toThrow();
  });

  it.each([
    ['Windows drive path', 'C:/outside'],
    ['Windows backslash drive path', 'C:\\outside'],
    ['leading slash path', '/outside'],
  ])('rejects absolute directoryPath inputs before normalization: %s', async (_label, directoryPath) => {
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
      directoryPath,
    })).rejects.toThrow();
  });

  it('returns canonical relative directory and entry paths', async () => {
    const service = createWorkspaceFilesService({
      fileSystem: {
        async readdir() {
          return [
            { name: 'main.ts', isDirectory: () => false, isFile: () => true },
          ];
        },
        async stat() {
          return { size: 128, mtime: new Date('2026-05-18T00:00:00.000Z') };
        },
      },
    });

    const result = await service.listDirectory({
      workspaceRoot: 'C:/all/work/study/megumi',
      directoryPath: 'apps\\desktop\\src\\',
    });

    expect(result.directoryPath).toBe('apps/desktop/src');
    expect(result.entries[0]?.relativePath).toBe('apps/desktop/src/main.ts');
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
