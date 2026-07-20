/* Verifies workspace-only file I/O rejects lexical and symbolic-link escapes. */
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createScopedWorkspaceFileSystem } from '../../../evals/agent/adapters/scoped-workspace-file-system';

const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('scoped workspace file system', () => {
  it('allows file operations inside the owned workspace', async () => {
    const root = await createRoot();
    const fileSystem = await createScopedWorkspaceFileSystem(root);
    const filePath = path.join(root, 'docs', 'answer.md');

    await fileSystem.mkdir(path.dirname(filePath), { recursive: true });
    await fileSystem.writeFile(filePath, 'answer', 'utf8');

    expect(await fileSystem.readFile(filePath, 'utf8')).toBe('answer');
  });

  it('rejects paths outside the owned workspace before I/O', async () => {
    const root = await createRoot();
    const outside = await createRoot();
    const fileSystem = await createScopedWorkspaceFileSystem(root);

    await expect(fileSystem.readFile(path.join(outside, 'secret.txt'), 'utf8')).rejects.toThrow(/outside/i);
    await expect(fileSystem.writeFile(path.join(outside, 'created.txt'), 'no', 'utf8')).rejects.toThrow(/outside/i);
  });

  it('rejects a symlink that escapes the owned workspace', async () => {
    const root = await createRoot();
    const outside = await createRoot();
    await writeFile(path.join(outside, 'secret.txt'), 'secret', 'utf8');
    const link = path.join(root, 'external');
    try {
      await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
      throw error;
    }

    const fileSystem = await createScopedWorkspaceFileSystem(root);
    await expect(fileSystem.readFile(path.join(link, 'secret.txt'), 'utf8')).rejects.toThrow(/outside/i);
    expect(await readFile(path.join(outside, 'secret.txt'), 'utf8')).toBe('secret');
  });
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'megumi-eval-scope-'));
  roots.push(root);
  await mkdir(root, { recursive: true });
  return root;
}
