// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  WorkspaceDirectoryEntrySchema,
  WorkspaceFilesListDataSchema,
  WorkspaceFilesListPayloadSchema,
} from '@megumi/shared/workspace';

describe('workspace file contracts', () => {
  it('accepts directory and file entries without raw file content', () => {
    const directory = WorkspaceDirectoryEntrySchema.parse({
      name: 'src',
      relativePath: 'apps/desktop/src',
      kind: 'directory',
      depth: 2,
      hidden: false,
      ignored: false,
    });

    const file = WorkspaceDirectoryEntrySchema.parse({
      name: 'README.md',
      relativePath: 'README.md',
      kind: 'file',
      depth: 0,
      hidden: false,
      ignored: false,
      sizeBytes: 128,
      mtime: '2026-05-18T00:00:00.000Z',
    });

    expect(directory).toEqual({
      name: 'src',
      relativePath: 'apps/desktop/src',
      kind: 'directory',
      depth: 2,
      hidden: false,
      ignored: false,
    });
    expect(file.kind).toBe('file');
    expect(file).not.toHaveProperty('content');
  });

  it('rejects entries that try to include content', () => {
    const result = WorkspaceDirectoryEntrySchema.safeParse({
      name: 'README.md',
      relativePath: 'README.md',
      kind: 'file',
      depth: 0,
      content: 'raw file content',
    });

    expect(result.success).toBe(false);
  });

  it('accepts a workspace list payload', () => {
    expect(WorkspaceFilesListPayloadSchema.parse({
      workspaceRoot: 'C:/all/work/study/megumi',
      directoryPath: '',
    })).toEqual({
      workspaceRoot: 'C:/all/work/study/megumi',
      directoryPath: '',
    });
  });

  it('accepts workspace list data with directory entries', () => {
    expect(WorkspaceFilesListDataSchema.parse({
      workspaceRoot: 'C:/all/work/study/megumi',
      directoryPath: '',
      entries: [{
        name: 'README.md',
        relativePath: 'README.md',
        kind: 'file',
        depth: 0,
        hidden: false,
        ignored: false,
      }],
    }).entries).toHaveLength(1);
  });
});

