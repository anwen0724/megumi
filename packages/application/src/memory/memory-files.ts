/* Binds artifact inspection to the application-owned memory root. */
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export interface MemoryFiles {
  hasArtifacts(): boolean;
  list(): readonly MemoryDocument[];
  paths(): readonly string[];
  readLines(path: string, startLine?: number, lineCount?: number): MemoryDocumentSlice | undefined;
  read(path: string): MemoryDocument | undefined;
  writeFinal(input: { path: string; content: string; expectedVersion: string }, guard: () => void): MemoryDocument;
  writeInput(path: string, chunks: Iterable<string>, guard: () => void): void;
  deleteFinal(path: string, guard: () => void): void;
  clear(guard: () => void): void;
  removeInput(path: string, guard: () => void): void;
  discardTemporary(guard: () => void): void;
}
export interface MemoryDocumentSlice { readonly path: string; readonly version: string; readonly content: string; readonly startLine: number; readonly nextLine: number; readonly truncated: boolean }
export interface MemoryDocument { readonly path: string; readonly version: string; readonly content: string; readonly readOnly: boolean }

export function createMemoryFiles(rootPath: string): MemoryFiles {
  const root = path.resolve(rootPath);
  function checked(relative: string): string {
    if (!relative || relative.includes('\\') || relative.split('/').some(part => !part || part === '.' || part === '..'
      || /[:\x00-\x1f<>"|?*]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(part))) throw new Error('PATH_DENIED');
    if (!['MEMORY.md', 'memory_summary.md', 'raw_memories.md'].includes(relative)
      && !/^rollout_summaries\/[a-zA-Z0-9_-]+\.md$/.test(relative)
      && !/^skills\/[a-zA-Z0-9_-]+\/.+$/.test(relative)) throw new Error('PATH_DENIED');
    const target = path.resolve(root, relative);
    if (!target.startsWith(root + path.sep)) throw new Error('PATH_DENIED');
    for (let ancestor = target;; ancestor = path.dirname(ancestor)) {
      try { if (lstatSync(ancestor).isSymbolicLink()) throw new Error('PATH_DENIED'); }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
      if (ancestor === path.dirname(ancestor)) break;
    }
    return target;
  }
  const readOnly = (relative: string) => relative === 'raw_memories.md' || relative.startsWith('rollout_summaries/');
  function text(buffer: Uint8Array): string {
    try {
      const value = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      if (value.includes('\0')) throw new Error();
      return value;
    } catch { throw new Error('OUTPUT_INVALID'); }
  }
  function read(relative: string): MemoryDocument | undefined {
    const target = checked(relative);
    if (!existsSync(target)) return undefined;
    const bytes = readFileSync(target);
    if (relative !== 'raw_memories.md' && bytes.length > 1048576) throw new Error('OUTPUT_INVALID');
    return { path: relative, content: text(bytes), version: createHash('sha256').update(bytes).digest('hex'), readOnly: readOnly(relative) };
  }
  function publish(relative: string, chunks: Iterable<string>, guard: () => void, expectedVersion?: string): void {
    const target = checked(relative);
    guard();
    if (expectedVersion !== undefined && (read(relative)?.version ?? 'absent') !== expectedVersion) throw new Error('VERSION_CONFLICT');
    mkdirSync(path.dirname(target), { recursive: true });
    checked(relative);
    const temporary = `${target}.${randomUUID()}.tmp`;
    const fd = openSync(temporary, 'wx');
    let size = 0;
    try {
      for (const chunk of chunks) {
        const bytes = Buffer.from(chunk, 'utf8');
        if (text(bytes) !== chunk) throw new Error('OUTPUT_INVALID');
        size += bytes.length;
        if (relative !== 'raw_memories.md' && size > 1048576) throw new Error('OUTPUT_INVALID');
        let offset = 0;
        while (offset < bytes.length) offset += writeSync(fd, bytes, offset);
      }
      fsyncSync(fd);
    } catch (error) { closeSync(fd); unlinkSync(temporary); throw error; }
    closeSync(fd);
    try {
      checked(relative); guard();
      if (expectedVersion !== undefined && (read(relative)?.version ?? 'absent') !== expectedVersion) throw new Error('VERSION_CONFLICT');
      renameSync(temporary, target);
    } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }
  function paths(includeTemporary = false): string[] {
    checked('MEMORY.md');
    if (!existsSync(root)) return [];
    const found: string[] = [];
    function walk(directory: string) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        const relative = path.relative(root, target).split(path.sep).join('/');
        if (entry.isSymbolicLink()) throw new Error('PATH_DENIED');
        if (entry.isDirectory()) {
          if (relative !== 'skills' && relative !== 'rollout_summaries' && !relative.startsWith('skills/')) throw new Error('PATH_DENIED');
          walk(target);
        } else {
          const temporary = /^(.*)\.[0-9a-f-]{36}\.tmp$/.exec(relative);
          checked(temporary?.[1] ?? relative);
          if (!temporary || includeTemporary) found.push(relative);
        }
      }
    }
    walk(root);
    return found.sort();
  }
  function discardTemporary(guard: () => void): void {
    for (const relative of paths(true)) {
      const temporary = /^(.*)\.[0-9a-f-]{36}\.tmp$/.exec(relative);
      if (!temporary) continue;
      checked(temporary[1]); guard(); unlinkSync(path.resolve(root, relative));
    }
  }
  return {
    list: () => paths().filter(relative => !readOnly(relative)).map(relative => read(relative)!),
    paths: () => paths(),
    discardTemporary,
    readLines(relative, startLine = 1, lineCount = 200) {
      if (!Number.isInteger(startLine) || startLine < 1 || !Number.isInteger(lineCount) || lineCount < 1 || lineCount > 400) throw new Error('INVALID_ARGUMENT');
      const target = checked(relative);
      if (!existsSync(target)) return undefined;
      const fd = openSync(target, 'r');
      const hash = createHash('sha256');
      const decoder = new TextDecoder('utf-8', { fatal: true });
      const buffer = Buffer.alloc(16384);
      let line = 1; let content = ''; let truncated = false; let nextLine = startLine;
      function collect(value: string) {
        if (value.includes('\0')) throw new Error('OUTPUT_INVALID');
        for (const char of value) {
          if (line >= startLine && line < startLine + lineCount && content.length < 16000) {
            content += char; nextLine = line + 1;
          } else if (line >= startLine) truncated = true;
          if (char === '\n') line++;
        }
      }
      try {
        let count: number;
        while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
          hash.update(buffer.subarray(0, count));
          collect(decoder.decode(buffer.subarray(0, count), { stream: true }));
        }
        collect(decoder.decode());
      } finally { closeSync(fd); }
      return { path: relative, version: hash.digest('hex'), content, startLine, nextLine, truncated };
    },
    read,
    writeFinal(input, guard) {
      checked(input.path);
      if (readOnly(input.path)) throw new Error('PATH_DENIED');
      publish(input.path, [input.content], guard, input.expectedVersion);
      return read(input.path)!;
    },
    writeInput(relative, chunks, guard) {
      checked(relative);
      if (!readOnly(relative)) throw new Error('PATH_DENIED');
      publish(relative, chunks, guard);
    },
    deleteFinal(relative, guard) {
      const target = checked(relative);
      if (readOnly(relative)) throw new Error('PATH_DENIED');
      guard();
      if (existsSync(target)) unlinkSync(target);
    },
    clear(guard) {
      const entries = paths();
      for (const relative of entries) { const target = checked(relative); guard(); unlinkSync(target); }
      discardTemporary(guard);
    },
    removeInput(relative, guard) {
      const target = checked(relative);
      if (!readOnly(relative)) throw new Error('PATH_DENIED');
      guard();
      if (existsSync(target)) unlinkSync(target);
    },
    hasArtifacts() {
      try {
        // Do not follow a root replaced with a link into another directory.
        const root = lstatSync(rootPath);
        if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('Invalid memory directory.');
        return paths().length > 0;
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
        throw error;
      }
    },
  };
}
