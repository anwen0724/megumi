/* Test-only adapters exercise the Tools public interface without Product or old Agent composition. */

import fs from 'fs-extra';
import path from 'node:path';
import type {
  ToolProcessAdapter,
  ToolProcessOptions,
  ToolProcessRequest,
  ToolProcessResult,
  WorkspaceFileAccess,
} from '../../../packages/tools/src';

export function createLocalWorkspaceFileAccess(root: string): WorkspaceFileAccess {
  const resolve = (target: string) => path.isAbsolute(target) ? target : path.resolve(root, target);
  const relative = (target: string) => normalizeSlash(path.relative(root, target)) || '.';

  return {
    async readBinaryFile(request) {
      request.signal?.throwIfAborted();
      const absolutePath = resolve(request.path);
      const bytes = await fs.readFile(absolutePath);
      return { path: path.isAbsolute(request.path) ? request.path : relative(absolutePath), bytes, sizeBytes: bytes.byteLength };
    },
    async readFile(request) {
      request.signal?.throwIfAborted();
      const absolutePath = resolve(request.path);
      const content = await fs.readFile(absolutePath, 'utf8');
      return {
        path: path.isAbsolute(request.path) ? request.path : relative(absolutePath),
        content,
        sizeBytes: Buffer.byteLength(content, 'utf8'),
      };
    },
    async listDirectory(request) {
      request.signal?.throwIfAborted();
      const start = resolve(request.path);
      const entries: Array<{ name: string; kind: 'file' | 'directory'; path: string }> = [];
      async function walk(directory: string, depth: number): Promise<void> {
        const children = await fs.readdir(directory, { withFileTypes: true });
        children.sort((left, right) => left.name.localeCompare(right.name));
        for (const child of children) {
          if (!request.includeHidden && child.name.startsWith('.')) continue;
          const absolutePath = path.join(directory, child.name);
          if (child.isDirectory()) {
            entries.push({ name: child.name, kind: 'directory', path: relative(absolutePath) });
            if (depth < request.maxDepth) await walk(absolutePath, depth + 1);
          } else if (child.isFile()) {
            entries.push({ name: child.name, kind: 'file', path: relative(absolutePath) });
          }
        }
      }
      await walk(start, 1);
      return { path: request.path, entries };
    },
    async walkFiles(request) {
      request.signal?.throwIfAborted();
      const start = resolve(request.path);
      const stat = await fs.stat(start);
      if (stat.isFile()) return [path.isAbsolute(request.path) ? request.path : relative(start)];
      const files: string[] = [];
      async function walk(directory: string): Promise<void> {
        const children = await fs.readdir(directory, { withFileTypes: true });
        for (const child of children) {
          if (!request.includeHidden && child.name.startsWith('.')) continue;
          const absolutePath = path.join(directory, child.name);
          if (child.isDirectory()) await walk(absolutePath);
          if (child.isFile()) files.push(relative(absolutePath));
        }
      }
      await walk(start);
      return files.sort();
    },
    async replaceText(request) {
      request.signal?.throwIfAborted();
      const absolutePath = resolve(request.path);
      const source = await fs.readFile(absolutePath, 'utf8');
      const occurrences = source.split(request.oldText).length - 1;
      if (occurrences === 0) throw new Error('Exact text was not found.');
      const replacements = request.replaceAll ? occurrences : 1;
      const content = request.replaceAll
        ? source.split(request.oldText).join(request.newText)
        : source.replace(request.oldText, request.newText);
      await fs.writeFile(absolutePath, content, 'utf8');
      return { path: relative(absolutePath), replacements, changed: source !== content };
    },
    async writeFile(request) {
      request.signal?.throwIfAborted();
      const absolutePath = resolve(request.path);
      const exists = await fs.pathExists(absolutePath);
      if (exists && !request.overwrite) {
        const error = Object.assign(new Error('File exists.'), { code: 'EEXIST' });
        throw error;
      }
      await fs.ensureDir(path.dirname(absolutePath));
      await fs.writeFile(absolutePath, request.content, 'utf8');
      return {
        path: relative(absolutePath),
        bytesWritten: Buffer.byteLength(request.content, 'utf8'),
        created: !exists,
        overwritten: exists,
      };
    },
    async resolveCommandCwd(request) {
      request.signal?.throwIfAborted();
      return resolve(request.path);
    },
  };
}

export function createProcessAdapter(input: {
  readonly shellKind?: ToolProcessAdapter['shellKind'];
  readonly run?: (
    request: ToolProcessRequest,
    options: ToolProcessOptions,
  ) => Promise<ToolProcessResult>;
} = {}): ToolProcessAdapter {
  return {
    shellKind: input.shellKind ?? 'powershell',
    executionMethod: 'shell',
    run: input.run ?? (async (_request, options) => {
      options.onStdout('ok');
      return { exitCode: 0 };
    }),
  };
}

export function parsedToolContent(result: {
  readonly type: string;
  readonly normalizedResult: { readonly content: string };
}): unknown {
  return JSON.parse(result.normalizedResult.content);
}

function normalizeSlash(value: string): string {
  return value.replace(/\\/g, '/');
}
