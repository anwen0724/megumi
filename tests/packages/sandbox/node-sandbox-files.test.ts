/* Exercises canonical workspace file actions through the real Node adapter. */
// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createNodeSandboxFileAccess } from '../../../packages/agent/sandbox/src';

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

  it('rejects copying or moving a directory into itself without leaving staging files', async () => {
    const { root, files } = await workspace();
    await files.createDirectory({ path: 'source', recursive: false });
    await files.writeFile({ path: 'source/a.txt', content: 'safe', overwrite: false });
    await expect(files.copyPath({ source: 'source', destination: 'source/copy', overwrite: false })).rejects.toMatchObject({ code: 'path_conflict' });
    await expect(files.movePath({ source: 'source', destination: 'source/moved', overwrite: false })).rejects.toMatchObject({ code: 'path_conflict' });
    await expect(fs.readFile(path.join(root, 'source/a.txt'), 'utf8')).resolves.toBe('safe');
    expect((await fs.readdir(root)).filter((name) => name.includes('megumi-copy') || name.includes('megumi-backup'))).toEqual([]);
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
  it('allows only the approved external path and its descendants', async () => {
    const { root } = await workspace();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'megumi-approved-external-'));
    roots.push(outside);
    const approved = path.join(outside, 'approved.txt');
    const sibling = path.join(outside, 'sibling.txt');
    await fs.writeFile(approved, 'approved', 'utf8');
    await fs.writeFile(sibling, 'sibling', 'utf8');
    const files = createNodeSandboxFileAccess({
      workspaceRoot: root,
      access: {
        mode: 'workspace_and_paths',
        readablePaths: [approved],
        writablePaths: [],
      },
    });

    await expect(files.readFile({ path: approved })).resolves.toMatchObject({
      path: path.resolve(approved),
      content: 'approved',
    });
    await expect(files.readFile({ path: sibling })).rejects.toMatchObject({
      code: 'path_outside_workspace',
    });
  });

  it('allows an approved external write but not a sibling write', async () => {
    const { root } = await workspace();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'megumi-approved-write-'));
    roots.push(outside);
    const approved = path.join(outside, 'approved.txt');
    const sibling = path.join(outside, 'sibling.txt');
    const files = createNodeSandboxFileAccess({
      workspaceRoot: root,
      access: {
        mode: 'workspace_and_paths',
        readablePaths: [],
        writablePaths: [approved],
      },
    });

    await expect(files.writeFile({ path: approved, content: 'approved', overwrite: false }))
      .resolves.toMatchObject({ path: path.resolve(approved), created: true });
    await expect(files.writeFile({ path: sibling, content: 'sibling', overwrite: false }))
      .rejects.toMatchObject({ code: 'path_outside_workspace' });
  });

  it('allows unrestricted external access while retaining recoverable delete', async () => {
    const { root } = await workspace();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'megumi-unrestricted-files-'));
    roots.push(outside);
    const target = path.join(outside, 'target.txt');
    await fs.writeFile(target, 'delete me', 'utf8');
    const files = createNodeSandboxFileAccess({
      workspaceRoot: root,
      access: { mode: 'unrestricted' },
    });

    const removed = await files.deletePath({ path: target, recursive: false });
    expect(removed).toMatchObject({ path: path.resolve(target), recoverable: true });
    expect(path.isAbsolute(removed.recoveryPath)).toBe(true);
    await expect(fs.readFile(removed.recoveryPath, 'utf8')).resolves.toBe('delete me');
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});