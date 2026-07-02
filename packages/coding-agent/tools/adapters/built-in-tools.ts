// Executes Megumi built-in tools through injected local workspace dependencies.
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import fs from 'fs-extra';
import { classifyProjectPath } from '../../workspace';
import type { RawToolResult } from '../contracts/tool-contracts';

export interface BuiltInToolFileSystem {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  writeFile(path: string, content: string, encoding: 'utf8'): Promise<void>;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  stat(path: string): Promise<{ isFile(): boolean; isDirectory(): boolean; size: number }>;
  readdir(path: string, options: { withFileTypes: true }): Promise<Array<{
    name: string;
    isFile(): boolean;
    isDirectory(): boolean;
  }>>;
}

export type BuiltInToolSpawn = typeof nodeSpawn;

export type BuiltInToolAdapterExecuteRequest = {
  toolName: string;
  input: unknown;
  signal?: AbortSignal;
};

export interface BuiltInToolAdapter {
  execute(request: BuiltInToolAdapterExecuteRequest): Promise<RawToolResult>;
}

export function createBuiltInToolAdapter(input: {
  projectRoot: string;
  fileSystem?: BuiltInToolFileSystem;
  spawn?: BuiltInToolSpawn;
}): BuiltInToolAdapter {
  const context = {
    projectRoot: input.projectRoot,
    fileSystem: input.fileSystem ?? fs,
    spawn: input.spawn ?? nodeSpawn,
  };

  return {
    async execute(request) {
      switch (request.toolName) {
        case 'read_file':
          return readFile(context, request.input);
        case 'list_directory':
          return listDirectory(context, request.input);
        case 'glob':
          return glob(context, request.input);
        case 'search_text':
          return searchText(context, request.input);
        case 'edit_file':
          return editFile(context, request.input);
        case 'write_file':
          return writeFile(context, request.input);
        case 'run_command':
          return runCommand(context, request.input, request.signal);
        default:
          throw new Error(`Unsupported built-in tool: ${request.toolName}`);
      }
    },
  };
}

async function readFile(
  context: BuiltInToolContext,
  input: unknown,
): Promise<RawToolResult> {
  const record = inputRecord(input);
  const targetPath = requireString(record, 'path');
  const maxBytes = optionalPositiveInteger(record, 'maxBytes', 256 * 1024);
  const resolved = resolveReadablePath(context, targetPath);
  const rawContent = await context.fileSystem.readFile(resolved.absolutePath, 'utf8');
  const truncated = truncateUtf8(rawContent, maxBytes);

  return {
    outputKind: 'file',
    content: truncated.content,
    metadata: {
      path: resolved.relativePath,
      truncated: truncated.truncated,
      sizeBytes: Buffer.byteLength(rawContent, 'utf8'),
    },
  };
}

async function listDirectory(
  context: BuiltInToolContext,
  input: unknown,
): Promise<RawToolResult> {
  const record = inputRecord(input);
  const requestedPath = optionalString(record, 'path', '.');
  const resolved = resolveReadablePath(context, requestedPath);
  const entries = await context.fileSystem.readdir(resolved.absolutePath, { withFileTypes: true });
  const visibleEntries = entries
    .filter((entry) => entry.isFile() || entry.isDirectory())
    .map((entry) => {
      const relativePath = normalizeSlash(resolved.relativePath === '.'
        ? entry.name
        : `${resolved.relativePath}/${entry.name}`);
      return {
        name: entry.name,
        kind: entry.isDirectory() ? 'directory' : 'file',
        path: relativePath,
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));

  return {
    outputKind: 'json',
    content: {
      path: resolved.relativePath,
      entries: visibleEntries,
      truncated: false,
    },
  };
}

async function glob(
  context: BuiltInToolContext,
  input: unknown,
): Promise<RawToolResult> {
  const record = inputRecord(input);
  const pattern = requireString(record, 'pattern');
  const cwd = optionalString(record, 'cwd', globStaticBase(pattern));
  const limit = optionalPositiveInteger(record, 'limit', 500);
  const files = await walkFiles(context, cwd);
  const matcher = globToRegExp(pattern);
  const matches = files
    .filter((file) => matcher.test(normalizeSlash(file)))
    .slice(0, limit);

  return {
    outputKind: 'json',
    content: {
      matches,
      truncated: files.length > matches.length,
    },
  };
}

async function searchText(
  context: BuiltInToolContext,
  input: unknown,
): Promise<RawToolResult> {
  const record = inputRecord(input);
  const query = requireString(record, 'query');
  const rootPath = optionalString(record, 'path', '.');
  const caseSensitive = Boolean(record.caseSensitive);
  const limit = optionalPositiveInteger(record, 'limit', 100);
  const files = await walkFiles(context, rootPath);
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: Array<{ path: string; line: number; preview: string }> = [];

  for (const file of files) {
    const resolved = resolveReadablePath(context, file);
    const content = await context.fileSystem.readFile(resolved.absolutePath, 'utf8');
    const lines = content.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const haystack = caseSensitive ? line : line.toLowerCase();
      if (haystack.includes(needle)) {
        matches.push({ path: file, line: index + 1, preview: line.slice(0, 500) });
      }
      if (matches.length >= limit) {
        return {
          outputKind: 'json',
          content: { matches, truncated: true },
        };
      }
    }
  }

  return {
    outputKind: 'json',
    content: { matches, truncated: false },
  };
}

async function editFile(
  context: BuiltInToolContext,
  input: unknown,
): Promise<RawToolResult> {
  const record = inputRecord(input);
  const targetPath = requireString(record, 'path');
  const oldText = requireString(record, 'oldText');
  const newText = requireString(record, 'newText');
  const replaceAll = Boolean(record.replaceAll);
  const resolved = resolveWritablePath(context, targetPath);
  const content = await context.fileSystem.readFile(resolved.absolutePath, 'utf8');
  const occurrences = content.split(oldText).length - 1;
  if (occurrences === 0) {
    throw new Error(`Text not found in file: ${resolved.relativePath}`);
  }
  if (!replaceAll && occurrences > 1) {
    throw new Error(`Text occurs multiple times in file: ${resolved.relativePath}`);
  }
  const updated = replaceAll
    ? content.split(oldText).join(newText)
    : content.replace(oldText, newText);

  await context.fileSystem.writeFile(resolved.absolutePath, updated, 'utf8');

  return {
    outputKind: 'json',
    content: {
      path: resolved.relativePath,
      replacements: replaceAll ? occurrences : 1,
      changed: updated !== content,
    },
  };
}

async function writeFile(
  context: BuiltInToolContext,
  input: unknown,
): Promise<RawToolResult> {
  const record = inputRecord(input);
  const targetPath = requireString(record, 'path');
  const content = requireString(record, 'content');
  const overwrite = Boolean(record.overwrite);
  const resolved = resolveWritablePath(context, targetPath);
  const exists = await existsAsFile(context.fileSystem, resolved.absolutePath);
  if (exists && !overwrite) {
    throw new Error(`File already exists: ${resolved.relativePath}`);
  }

  await context.fileSystem.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
  await context.fileSystem.writeFile(resolved.absolutePath, content, 'utf8');

  return {
    outputKind: 'json',
    content: {
      path: resolved.relativePath,
      bytesWritten: Buffer.byteLength(content, 'utf8'),
      created: !exists,
      overwritten: exists,
    },
  };
}

async function runCommand(
  context: BuiltInToolContext,
  input: unknown,
  signal?: AbortSignal,
): Promise<RawToolResult> {
  const record = inputRecord(input);
  const command = requireString(record, 'command');
  const cwd = resolveReadablePath(context, optionalString(record, 'cwd', '.')).absolutePath;
  const timeoutMs = optionalPositiveInteger(record, 'timeoutMs', 60_000);
  const startedAt = Date.now();
  const result = await runShellCommand({
    command,
    cwd,
    timeoutMs,
    signal,
    spawn: context.spawn,
  });

  return {
    outputKind: 'command',
    content: {
      exitCode: result.exitCode,
      stdoutPreview: truncateUtf8(result.stdout, 20_000).content,
      stderrPreview: truncateUtf8(result.stderr, 20_000).content,
      durationMs: Date.now() - startedAt,
      truncated: Buffer.byteLength(result.stdout + result.stderr, 'utf8') > 40_000,
    },
    isError: result.exitCode !== 0,
  };
}

type BuiltInToolContext = {
  projectRoot: string;
  fileSystem: BuiltInToolFileSystem;
  spawn: BuiltInToolSpawn;
};

function resolveReadablePath(context: BuiltInToolContext, targetPath: string): {
  absolutePath: string;
  relativePath: string;
} {
  const classification = classifyProjectPath({
    projectRoot: context.projectRoot,
    targetPath,
  });
  if (!classification.insideProject) {
    throw new Error(`Project path is outside the project: ${targetPath}`);
  }
  if (classification.protected || classification.sensitive) {
    throw new Error(`Project path cannot be accessed: ${classification.relativePath}`);
  }
  return {
    absolutePath: classification.absolutePath,
    relativePath: classification.relativePath || '.',
  };
}

function resolveWritablePath(context: BuiltInToolContext, targetPath: string): {
  absolutePath: string;
  relativePath: string;
} {
  return resolveReadablePath(context, targetPath);
}

async function walkFiles(context: BuiltInToolContext, rootRelativePath: string): Promise<string[]> {
  const root = resolveReadablePath(context, rootRelativePath);
  const stats = await context.fileSystem.stat(root.absolutePath);
  if (stats.isFile()) {
    return [root.relativePath];
  }
  if (!stats.isDirectory()) {
    return [];
  }

  const output: string[] = [];
  await walkDirectory(context, root.absolutePath, root.relativePath === '.' ? '' : root.relativePath, output);
  return output.sort();
}

async function walkDirectory(
  context: BuiltInToolContext,
  absoluteDirectory: string,
  relativeDirectory: string,
  output: string[],
): Promise<void> {
  const entries = await context.fileSystem.readdir(absoluteDirectory, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = normalizeSlash(relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name);
    const absolutePath = path.join(absoluteDirectory, entry.name);
    if (entry.isFile()) {
      output.push(relativePath);
      continue;
    }
    if (entry.isDirectory()) {
      await walkDirectory(context, absolutePath, relativePath, output);
    }
  }
}

function inputRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Tool input must be an object');
  }
  return input as Record<string, unknown>;
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing or invalid string input: ${key}`);
  }
  return value;
}

function optionalString(input: Record<string, unknown>, key: string, fallback: string): string {
  const value = input[key];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'string') {
    throw new Error(`Invalid string input: ${key}`);
  }
  return value;
}

function optionalPositiveInteger(input: Record<string, unknown>, key: string, fallback: number): number {
  const value = input[key];
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`Invalid positive integer input: ${key}`);
  }
  return Number(value);
}

function truncateUtf8(content: string, maxBytes: number): { content: string; truncated: boolean } {
  const buffer = Buffer.from(content, 'utf8');
  if (buffer.byteLength <= maxBytes) {
    return { content, truncated: false };
  }
  return {
    content: buffer.subarray(0, maxBytes).toString('utf8'),
    truncated: true,
  };
}

async function existsAsFile(fileSystem: BuiltInToolFileSystem, filePath: string): Promise<boolean> {
  try {
    const stats = await fileSystem.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

function normalizeSlash(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\/+/, '') || '.';
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizeSlash(pattern);
  let source = '^';
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === '*' && next === '*') {
      source += '.*';
      index += 1;
      continue;
    }
    if (char === '*') {
      source += '[^/]*';
      continue;
    }
    source += escapeRegExp(char);
  }
  return new RegExp(`${source}$`);
}

function globStaticBase(pattern: string): string {
  const normalized = normalizeSlash(pattern);
  const segments = normalized.split('/');
  const staticSegments: string[] = [];
  for (const segment of segments) {
    if (segment.includes('*')) {
      break;
    }
    staticSegments.push(segment);
  }
  return staticSegments.join('/') || '.';
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function runShellCommand(input: {
  command: string;
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
  spawn: BuiltInToolSpawn;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = input.spawn(input.command, [], {
      cwd: input.cwd,
      shell: true,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out after ${input.timeoutMs}ms`));
    }, input.timeoutMs);

    input.signal?.addEventListener('abort', () => {
      child.kill();
      reject(new Error('Command execution was cancelled'));
    }, { once: true });

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ exitCode: code ?? 0, stdout, stderr });
    });
  });
}
