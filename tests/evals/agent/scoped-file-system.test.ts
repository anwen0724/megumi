/* Verifies the Evaluation Workspace Adapter rejects lexical and symbolic-link escapes. */
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createEvaluationWorkspaceFileSystem } from '../../../evals/agent/adapters/scoped-workspace-file-system';

const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('scoped workspace file system', () => {
  it('provides Product Workspace metadata operations inside the owned workspace', async () => {
    const root = await createRoot();
    const directoryPath = path.join(root, 'docs');
    const filePath = path.join(directoryPath, 'answer.md');
    await mkdir(directoryPath, { recursive: true });
    await writeFile(filePath, 'answer', 'utf8');
    const fileSystem = await createEvaluationWorkspaceFileSystem(root);

    expect((await fileSystem.stat(filePath)).isFile()).toBe(true);
    expect(await fileSystem.readdir(directoryPath)).toEqual(['answer.md']);
    expect(await fileSystem.realpath(filePath)).toBe(filePath);
  });

  it('rejects paths outside the owned workspace before metadata I/O', async () => {
    const root = await createRoot();
    const outside = await createRoot();
    const outsideFile = path.join(outside, 'secret.txt');
    await writeFile(outsideFile, 'secret', 'utf8');
    const fileSystem = await createEvaluationWorkspaceFileSystem(root);

    await expect(fileSystem.stat(outsideFile)).rejects.toThrow(/outside/i);
    await expect(fileSystem.readdir(outside)).rejects.toThrow(/outside/i);
    await expect(fileSystem.realpath(outsideFile)).rejects.toThrow(/outside/i);
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

    const fileSystem = await createEvaluationWorkspaceFileSystem(root);
    await expect(fileSystem.stat(path.join(link, 'secret.txt'))).rejects.toThrow(/outside/i);
    expect(await readFile(path.join(outside, 'secret.txt'), 'utf8')).toBe('secret');
  });
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'megumi-eval-scope-'));
  roots.push(root);
  await mkdir(root, { recursive: true });
  return root;
}
