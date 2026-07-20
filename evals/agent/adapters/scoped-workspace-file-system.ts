/* Restricts actual Evaluation file I/O to one owned workspace, including symlinks. */
import { mkdir, open, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { ProductToolFileSystem } from '@megumi/product/composition';

export async function createScopedWorkspaceFileSystem(workspaceRoot: string): Promise<ProductToolFileSystem> {
  const lexicalRoot = path.resolve(workspaceRoot);
  const canonicalRoot = await realpath(lexicalRoot);
  const assertOwnedPath = createOwnedPathResolver(lexicalRoot, canonicalRoot);

  return {
    async readFile(filePath, encoding) {
      return readFile(await assertOwnedPath(filePath), encoding);
    },
    async writeFile(filePath, content, encoding) {
      await writeFile(await assertOwnedPath(filePath), content, encoding);
    },
    async mkdir(directoryPath, options) {
      return mkdir(await assertOwnedPath(directoryPath), options);
    },
    async stat(targetPath) {
      return stat(await assertOwnedPath(targetPath));
    },
    async readdir(directoryPath, options) {
      return readdir(await assertOwnedPath(directoryPath), options);
    },
  };
}

export async function resolveOwnedWorkspacePath(workspaceRoot: string, candidate: string): Promise<string> {
  const lexicalRoot = path.resolve(workspaceRoot);
  const canonicalRoot = await realpath(lexicalRoot);
  return createOwnedPathResolver(lexicalRoot, canonicalRoot)(candidate);
}

export async function readBoundedOwnedText(
  workspaceRoot: string,
  relativePath: string,
  maximumBytes: number,
): Promise<{ content: string; sizeBytes: number; truncated: boolean }> {
  const resolved = await resolveOwnedWorkspacePath(workspaceRoot, path.join(workspaceRoot, relativePath));
  const handle = await open(resolved, 'r');
  try {
    const details = await handle.stat();
    const bytesToRead = Math.min(details.size, Math.max(0, maximumBytes));
    const buffer = Buffer.alloc(bytesToRead);
    const read = bytesToRead > 0 ? await handle.read(buffer, 0, bytesToRead, 0) : { bytesRead: 0 };
    return {
      content: buffer.subarray(0, read.bytesRead).toString('utf8'),
      sizeBytes: details.size,
      truncated: details.size > bytesToRead,
    };
  } finally {
    await handle.close();
  }
}

export async function digestOwnedFile(workspaceRoot: string, relativePath: string): Promise<string> {
  const resolved = await resolveOwnedWorkspacePath(workspaceRoot, path.join(workspaceRoot, relativePath));
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(resolved);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

function createOwnedPathResolver(lexicalRoot: string, canonicalRoot: string) {
  return async (candidate: string): Promise<string> => {
    const resolved = path.resolve(candidate);
    if (!isWithin(lexicalRoot, resolved)) {
      throw new Error(`Evaluation file access is outside the owned workspace: ${candidate}`);
    }

    let existing = resolved;
    while (true) {
      try {
        const canonicalExisting = await realpath(existing);
        const remaining = path.relative(existing, resolved);
        const canonicalCandidate = path.resolve(canonicalExisting, remaining);
        if (!isWithin(canonicalRoot, canonicalCandidate)) {
          throw new Error(`Evaluation file access resolves outside the owned workspace: ${candidate}`);
        }
        return resolved;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const parent = path.dirname(existing);
        if (parent === existing) throw error;
        existing = parent;
      }
    }
  };
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
