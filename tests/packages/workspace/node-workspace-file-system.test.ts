/*
 * Verifies the Node adapter produces stable content-based file fingerprints.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNodeWorkspaceFileSystem } from '../../../packages/agent/workspace/src/node-workspace-file-system';

describe('NodeWorkspaceFileSystem', () => {
  it('keeps the same hash for equal content and changes it for a real modification', async () => {
    const root = await mkdtemp(join(tmpdir(), 'megumi-workspace-test-'));
    const target = join(root, 'file.txt');
    const fileSystem = createNodeWorkspaceFileSystem();
    try {
      await writeFile(target, 'same', 'utf8');
      const first = await fileSystem.fingerprint(target);
      await writeFile(target, 'same', 'utf8');
      const noOp = await fileSystem.fingerprint(target);
      await writeFile(target, 'changed', 'utf8');
      const changed = await fileSystem.fingerprint(target);

      expect(first).toMatchObject({ exists: true });
      expect(noOp).toMatchObject({ exists: true });
      expect(changed).toMatchObject({ exists: true });
      if (!first.exists || !noOp.exists || !changed.exists) return;
      expect(noOp.content_hash).toBe(first.content_hash);
      expect(changed.content_hash).not.toBe(first.content_hash);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
