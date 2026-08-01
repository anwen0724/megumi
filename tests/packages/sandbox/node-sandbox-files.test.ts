/* Exercises canonical workspace file actions through the real Node adapter. */
// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createNodeSandboxFileAccess } from '../../../packages/sandbox/src';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function workspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'megumi-sandbox-files-'));
  roots.push(root);
  return { root, files: createNodeSandboxFileAccess({ workspaceRoot: root }) };
}

describe('Node Sandbox file access', () => {
  it('rejects an existing symbolic-link escape and a missing target below it', async () => {
    const { root, files } = await workspace();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'megumi-sandbox-outside-'));
    roots.push(outside);
    await fs.symlink(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');

    await expect(files.readFile({ path: 'escape/secret.txt' })).rejects.toMatchObject({
      code: 'path_outside_workspace',
    });
    await expect(files.writeFile({ path: 'escape/new.txt', content: 'no', overwrite: false })).rejects.toMatchObject({
      code: 'path_outside_workspace',
    });
  });

  it('creates, copies, moves, and recoverably deletes workspace paths', async () => {
    const { root, files } = await workspace();
    await files.createDirectory({ path: 'notes', recursive: false });
    await files.writeFile({ path: 'notes/a.md', content: 'alpha', overwrite: false });
    const copied = await files.copyPath({ source: 'notes/a.md', destination: 'notes/b.md', overwrite: false });
    const moved = await files.movePath({ source: 'notes/b.md', destination: 'archive/b.md', overwrite: false });
    const removed = await files.deletePath({ path: 'archive/b.md', recursive: false });

    expect(copied).toMatchObject({ source: 'notes/a.md', destination: 'notes/b.md', pathType: 'file' });
    expect(moved).toMatchObject({ source: 'notes/b.md', destination: 'archive/b.md', pathType: 'file' });
    expect(removed).toMatchObject({ path: 'archive/b.md', recoverable: true });
    await expect(fs.readFile(path.join(root, 'notes/a.md'), 'utf8')).resolves.toBe('alpha');
    await expect(fs.stat(path.join(root, removed.recoveryPath))).resolves.toBeDefined();
    await expect(fs.stat(path.join(root, 'archive/b.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('applies ordered edits atomically and rejects a stale fingerprint', async () => {
    const { root, files } = await workspace();
    await fs.writeFile(path.join(root, 'paper.md'), 'alpha beta gamma', 'utf8');
    const before = await files.readFile({ path: 'paper.md' });
    const edited = await files.editFile({
      path: 'paper.md',
      expectedFingerprint: before.fingerprint,
      edits: [
        { oldText: 'alpha', newText: 'A' },
        { oldText: 'gamma', newText: 'G' },
      ],
    });
    expect(edited).toMatchObject({ path: 'paper.md', replacements: 2, changed: true });
    await fs.writeFile(path.join(root, 'paper.md'), 'external change', 'utf8');
    await expect(files.editFile({
      path: 'paper.md',
      expectedFingerprint: edited.previousFingerprint,
      edits: [{ oldText: 'external', newText: 'lost' }],
    })).rejects.toMatchObject({ code: 'content_conflict' });
    await expect(fs.readFile(path.join(root, 'paper.md'), 'utf8')).resolves.toBe('external change');
  });
});