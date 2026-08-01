/* Implements canonical Workspace file actions with conflict-safe Node filesystem operations. */

import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createWorkspacePathPolicy } from '@megumi/workspace';
import type { SandboxFileAccess, SandboxTextEdit } from './sandbox-files';

const MAX_EDIT_COUNT = 100;
const MAX_EDIT_BYTES = 1_000_000;
const DEFAULT_IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage']);

export class SandboxFileError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'SandboxFileError';
  }
}

export function createNodeSandboxFileAccess(input: { readonly workspaceRoot: string }): SandboxFileAccess {
  const pathPolicy = createWorkspacePathPolicy();
  const canonicalRootPromise = fs.realpath(path.resolve(input.workspaceRoot));

  const resolve = async (candidate: string) => {
    const canonicalRoot = await canonicalRootPromise;
    const resolved = await pathPolicy.resolveCanonicalPath({
      workspace_root: canonicalRoot,
      target_path: candidate,
      file_system: { realpath: fs.realpath },
    });
    if (resolved.status !== 'resolved') {
      throw new SandboxFileError('path_outside_workspace', 'Path is outside the active Workspace.');
    }
    return { absolutePath: resolved.absolute_path, workspacePath: resolved.workspace_path || '.' };
  };

  const ensureSignal = (signal?: AbortSignal) => signal?.throwIfAborted();

  const readBytes = async (candidate: string, signal?: AbortSignal) => {
    ensureSignal(signal);
    const resolved = await resolve(candidate);
    const value = await fs.readFile(resolved.absolutePath, { signal });
    return { ...resolved, value, fingerprint: fingerprint(value) };
  };

  const atomicReplace = async (absolutePath: string, content: string, signal?: AbortSignal) => {
    ensureSignal(signal);
    const temporaryPath = path.join(path.dirname(absolutePath), `.${path.basename(absolutePath)}.${randomUUID()}.megumi-tmp`);
    try {
      await fs.writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx', signal });
      ensureSignal(signal);
      await fs.rename(temporaryPath, absolutePath);
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  };

  const applyEdits = (content: string, edits: readonly SandboxTextEdit[]) => {
    if (edits.length === 0 || edits.length > MAX_EDIT_COUNT) {
      throw new SandboxFileError('invalid_tool_input', `edit_file requires between 1 and ${MAX_EDIT_COUNT} edits.`);
    }
    const totalBytes = edits.reduce((total, edit) => total + Buffer.byteLength(edit.oldText) + Buffer.byteLength(edit.newText), 0);
    if (totalBytes > MAX_EDIT_BYTES) throw new SandboxFileError('output_limit', 'Edit content exceeds the configured limit.');
    const located = edits.map((edit) => {
      if (edit.oldText.length === 0) throw new SandboxFileError('invalid_tool_input', 'oldText cannot be empty.');
      const first = content.indexOf(edit.oldText);
      if (first < 0) throw new SandboxFileError('content_conflict', 'An edit target was not found.');
      if (content.indexOf(edit.oldText, first + edit.oldText.length) >= 0) {
        throw new SandboxFileError('content_conflict', 'An edit target is not unique.');
      }
      return { ...edit, start: first, end: first + edit.oldText.length };
    }).sort((left, right) => left.start - right.start);
    for (let index = 1; index < located.length; index += 1) {
      if (located[index].start < located[index - 1].end) throw new SandboxFileError('content_conflict', 'Edits overlap.');
    }
    let output = '';
    let cursor = 0;
    for (const edit of located) {
      output += content.slice(cursor, edit.start) + edit.newText;
      cursor = edit.end;
    }
    return output + content.slice(cursor);
  };

  const copy = async (source: string, destination: string, overwrite: boolean, signal?: AbortSignal) => {
    ensureSignal(signal);
    const from = await resolve(source);
    const to = await resolve(destination);
    if (from.absolutePath === to.absolutePath) throw new SandboxFileError('path_conflict', 'Source and destination are the same path.');
    const sourceStat = await fs.stat(from.absolutePath);
    if (await exists(to.absolutePath) && !overwrite) throw new SandboxFileError('path_conflict', 'Destination already exists.');
    await fs.mkdir(path.dirname(to.absolutePath), { recursive: true });
    ensureSignal(signal);
    if (sourceStat.isDirectory()) await fs.cp(from.absolutePath, to.absolutePath, { recursive: true, force: overwrite, errorOnExist: !overwrite });
    else if (sourceStat.isFile()) await fs.copyFile(from.absolutePath, to.absolutePath, overwrite ? 0 : fsConstantsCopyExcl());
    else throw new SandboxFileError('path_type_mismatch', 'Only files and directories can be copied.');
    return { source: from.workspacePath, destination: to.workspacePath, pathType: sourceStat.isDirectory() ? 'directory' as const : 'file' as const };
  };

  return {
    async readBinaryFile(request) {
      const result = await readBytes(request.path, request.signal);
      return { path: result.workspacePath, bytes: new Uint8Array(result.value), sizeBytes: result.value.byteLength, fingerprint: result.fingerprint };
    },
    async readFile(request) {
      const result = await readBytes(request.path, request.signal);
      return { path: result.workspacePath, content: result.value.toString('utf8'), sizeBytes: result.value.byteLength, fingerprint: result.fingerprint };
    },
    async listDirectory(request) {
      const root = await resolve(request.path);
      const entries: Array<{ name: string; kind: 'file' | 'directory'; path: string }> = [];
      const collect = async (absoluteDirectory: string, relativeDirectory: string, depth: number) => {
        ensureSignal(request.signal);
        for (const entry of await fs.readdir(absoluteDirectory, { withFileTypes: true })) {
          ensureSignal(request.signal);
          if ((!entry.isFile() && !entry.isDirectory()) || shouldIgnore(entry.name, request.includeHidden)) continue;
          const relative = normalizeSlash(relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name);
          entries.push({ name: entry.name, kind: entry.isDirectory() ? 'directory' : 'file', path: relative });
          if (entry.isDirectory() && depth < request.maxDepth) await collect(path.join(absoluteDirectory, entry.name), relative, depth + 1);
        }
      };
      await collect(root.absolutePath, root.workspacePath === '.' ? '' : root.workspacePath, 1);
      return { path: root.workspacePath, entries: entries.sort((a, b) => a.path.localeCompare(b.path)) };
    },
    async walkFiles(request) {
      const root = await resolve(request.path);
      const stat = await fs.stat(root.absolutePath);
      if (stat.isFile()) return [root.workspacePath];
      if (!stat.isDirectory()) throw new SandboxFileError('path_type_mismatch', 'The requested path is not a directory.');
      const files: string[] = [];
      const walk = async (absoluteDirectory: string, relativeDirectory: string) => {
        ensureSignal(request.signal);
        for (const entry of await fs.readdir(absoluteDirectory, { withFileTypes: true })) {
          ensureSignal(request.signal);
          if (shouldIgnore(entry.name, request.includeHidden ?? false)) continue;
          const relative = normalizeSlash(relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name);
          if (entry.isFile()) files.push(relative);
          else if (entry.isDirectory()) await walk(path.join(absoluteDirectory, entry.name), relative);
        }
      };
      await walk(root.absolutePath, root.workspacePath === '.' ? '' : root.workspacePath);
      return files.sort();
    },
    async editFile(request) {
      const before = await readBytes(request.path, request.signal);
      if (request.expectedFingerprint && request.expectedFingerprint !== before.fingerprint) throw new SandboxFileError('content_conflict', 'The file changed after it was read.');
      const content = before.value.toString('utf8');
      const updated = applyEdits(content, request.edits);
      if (updated === content) return { path: before.workspacePath, replacements: request.edits.length, changed: false, previousFingerprint: before.fingerprint, fingerprint: before.fingerprint };
      const current = await readBytes(request.path, request.signal);
      if (current.fingerprint !== before.fingerprint) throw new SandboxFileError('content_conflict', 'The file changed before the edit was committed.');
      await atomicReplace(before.absolutePath, updated, request.signal);
      return { path: before.workspacePath, replacements: request.edits.length, changed: true, previousFingerprint: before.fingerprint, fingerprint: fingerprint(Buffer.from(updated)) };
    },
    async replaceText(request) {
      const before = await readBytes(request.path, request.signal);
      const content = before.value.toString('utf8');
      const occurrences = content.split(request.oldText).length - 1;
      if (occurrences === 0) throw new SandboxFileError('content_conflict', 'Text was not found in the file.');
      if (!request.replaceAll && occurrences > 1) throw new SandboxFileError('content_conflict', 'Text occurs more than once in the file.');
      const edits = request.replaceAll
        ? Array.from({ length: occurrences }, () => ({ oldText: request.oldText, newText: request.newText }))
        : [{ oldText: request.oldText, newText: request.newText }];
      const updated = request.replaceAll ? content.split(request.oldText).join(request.newText) : content.replace(request.oldText, request.newText);
      if (updated !== content) {
        const current = await readBytes(request.path, request.signal);
        if (current.fingerprint !== before.fingerprint) throw new SandboxFileError('content_conflict', 'The file changed before the edit was committed.');
        await atomicReplace(before.absolutePath, updated, request.signal);
      }
      return { path: before.workspacePath, replacements: edits.length, changed: updated !== content };
    },
    async writeFile(request) {
      ensureSignal(request.signal);
      const target = await resolve(request.path);
      await fs.mkdir(path.dirname(target.absolutePath), { recursive: true });
      const existing = await readOptional(target.absolutePath);
      if (existing && !request.overwrite) throw new SandboxFileError('path_conflict', 'Destination already exists.');
      if (request.expectedFingerprint && (!existing || fingerprint(existing) !== request.expectedFingerprint)) throw new SandboxFileError('content_conflict', 'The file changed after it was read.');
      if (existing) await atomicReplace(target.absolutePath, request.content, request.signal);
      else await fs.writeFile(target.absolutePath, request.content, { encoding: 'utf8', flag: 'wx', signal: request.signal });
      return { path: target.workspacePath, bytesWritten: Buffer.byteLength(request.content), created: !existing, overwritten: Boolean(existing), fingerprint: fingerprint(Buffer.from(request.content)) };
    },
    async createDirectory(request) {
      ensureSignal(request.signal);
      const target = await resolve(request.path);
      const existed = await exists(target.absolutePath);
      await fs.mkdir(target.absolutePath, { recursive: request.recursive });
      return { path: target.workspacePath, created: !existed };
    },
    copyPath: (request) => copy(request.source, request.destination, request.overwrite, request.signal),
    async movePath(request) {
      const copied = await copy(request.source, request.destination, request.overwrite, request.signal);
      const source = await resolve(request.source);
      ensureSignal(request.signal);
      await fs.rm(source.absolutePath, { recursive: copied.pathType === 'directory', force: false });
      return copied;
    },
    async deletePath(request) {
      ensureSignal(request.signal);
      const target = await resolve(request.path);
      if (target.workspacePath === '.') throw new SandboxFileError('sandbox_denied', 'The Workspace root cannot be deleted.');
      const stat = await fs.stat(target.absolutePath);
      if (stat.isDirectory() && !request.recursive && (await fs.readdir(target.absolutePath)).length > 0) throw new SandboxFileError('sandbox_denied', 'Deleting a non-empty directory requires recursive=true.');
      const recoveryDirectory = path.join(await canonicalRootPromise, '.megumi-trash', randomUUID());
      const recoveryTarget = path.join(recoveryDirectory, path.basename(target.absolutePath));
      await fs.mkdir(recoveryDirectory, { recursive: true });
      await fs.rename(target.absolutePath, recoveryTarget);
      return { path: target.workspacePath, pathType: stat.isDirectory() ? 'directory' : 'file', recoverable: true, recoveryPath: normalizeSlash(path.relative(await canonicalRootPromise, recoveryTarget)) };
    },
    async resolveCommandCwd(request) {
      ensureSignal(request.signal);
      const target = await resolve(request.path);
      const stat = await fs.stat(target.absolutePath);
      if (!stat.isDirectory()) throw new SandboxFileError('path_type_mismatch', 'Command cwd must be a directory.');
      return target.absolutePath;
    },
  };
}

function fingerprint(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

async function exists(target: string): Promise<boolean> {
  try { await fs.lstat(target); return true; } catch (error) { if (nodeCode(error) === 'ENOENT') return false; throw error; }
}

async function readOptional(target: string): Promise<Buffer | undefined> {
  try { return await fs.readFile(target); } catch (error) { if (nodeCode(error) === 'ENOENT') return undefined; throw error; }
}

function nodeCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;
}

function normalizeSlash(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\/+/, '') || '.';
}

function shouldIgnore(name: string, includeHidden: boolean): boolean {
  if (DEFAULT_IGNORED_DIRECTORIES.has(name)) return true;
  return !includeHidden && name.startsWith('.');
}

function fsConstantsCopyExcl(): number {
  return 1;
}