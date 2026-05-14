// @vitest-environment node
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveSafePath } from '@megumi/security/sandbox-policy';

describe('resolveSafePath', () => {
  it('resolves a relative path inside the workspace root', () => {
    const root = path.resolve('workspace');

    expect(resolveSafePath(root, 'src/index.ts')).toBe(path.join(root, 'src', 'index.ts'));
  });

  it('rejects path traversal outside the workspace root', () => {
    const root = path.resolve('workspace');

    expect(() => resolveSafePath(root, '../outside.txt')).toThrow('Path escapes workspace root');
  });

  it('rejects absolute paths outside the workspace root', () => {
    const root = path.resolve('workspace');
    const outside = path.resolve('outside.txt');

    expect(() => resolveSafePath(root, outside)).toThrow('Path escapes workspace root');
  });
});
