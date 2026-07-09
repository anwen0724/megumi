// Executes Megumi built-in tools through injected local workspace dependencies.
import { spawn as nodeSpawn } from 'node:child_process';
import type { RawToolResult } from '../contracts/tool-contracts';
import type { SkillService } from '../../skills';
import type { JsonObject } from '../../shared-json';

export interface WorkspaceFileAccess {
  readFile(input: {
    path: string;
    maxBytes: number;
  }): Promise<{
    path: string;
    content: string;
    truncated: boolean;
    sizeBytes: number;
  }>;
  listDirectory(input: {
    path: string;
  }): Promise<{
    path: string;
    entries: Array<{
      name: string;
      kind: 'file' | 'directory';
      path: string;
    }>;
    truncated: boolean;
  }>;
  walkFiles(input: {
    path: string;
  }): Promise<string[]>;
  readTextFile(input: {
    path: string;
  }): Promise<string>;
  replaceText(input: {
    path: string;
    oldText: string;
    newText: string;
    replaceAll: boolean;
  }): Promise<{
    path: string;
    replacements: number;
    changed: boolean;
  }>;
  writeFile(input: {
    path: string;
    content: string;
    overwrite: boolean;
  }): Promise<{
    path: string;
    bytesWritten: number;
    created: boolean;
    overwritten: boolean;
  }>;
  resolveCommandCwd(input: {
    path: string;
  }): Promise<string>;
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
  workspaceFileAccess: WorkspaceFileAccess;
  spawn?: BuiltInToolSpawn;
  skillService?: Pick<SkillService, 'activateSkill'>;
  runContext?: {
    runId: string;
    sessionId: string;
    workspaceId?: string;
  };
}): BuiltInToolAdapter {
  const context = {
    workspaceFileAccess: input.workspaceFileAccess,
    spawn: input.spawn ?? nodeSpawn,
    skillService: input.skillService,
    runContext: input.runContext,
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
        case 'activate_skill':
          return activateSkill(context, request.input);
        default:
          throw new Error(`Unsupported built-in tool: ${request.toolName}`);
      }
    },
  };
}

async function activateSkill(
  context: BuiltInToolContext,
  input: unknown,
): Promise<RawToolResult> {
  if (!context.skillService || !context.runContext) {
    throw new Error('activate_skill requires SkillService and run context.');
  }
  const record = inputRecord(input);
  const skillId = requireString(record, 'skillId');
  const result = await context.skillService.activateSkill({
    skillId,
    sessionId: context.runContext.sessionId,
    ...(context.runContext.workspaceId ? { workspaceId: context.runContext.workspaceId } : {}),
    runId: context.runContext.runId,
    trigger: 'model_tool',
  });

  if (result.status !== 'ok') {
    return {
      outputKind: 'error',
      content: `Skill activation failed: ${result.status}`,
      isError: true,
      metadata: { skillId, status: result.status },
    };
  }

  return {
    outputKind: 'json',
    content: {
      activated: true,
      skillId: result.activatedSkill.skillId,
      message: `Skill activated: ${result.activatedSkill.skillId}`,
    },
    runtimeSources: [{
      source_id: `skill:${result.activatedSkill.skillId}`,
      source_kind: 'skill',
      text: result.activatedSkill.content,
      persisted: false,
      metadata: {
        skillId: result.activatedSkill.skillId,
        name: result.activatedSkill.name,
        description: result.activatedSkill.description,
        origin_module: 'skills',
      },
    }],
  };
}

async function readFile(
  context: BuiltInToolContext,
  input: unknown,
): Promise<RawToolResult> {
  const record = inputRecord(input);
  const targetPath = requireString(record, 'path');
  const maxBytes = optionalPositiveInteger(record, 'maxBytes', 256 * 1024);
  const result = await context.workspaceFileAccess.readFile({
    path: targetPath,
    maxBytes,
  });

  return {
    outputKind: 'file',
    content: result.content,
    metadata: {
      path: result.path,
      truncated: result.truncated,
      sizeBytes: result.sizeBytes,
    },
  };
}

async function listDirectory(
  context: BuiltInToolContext,
  input: unknown,
): Promise<RawToolResult> {
  const record = inputRecord(input);
  const requestedPath = optionalString(record, 'path', '.');
  const result = await context.workspaceFileAccess.listDirectory({ path: requestedPath });

  return {
    outputKind: 'json',
    content: {
      path: result.path,
      entries: result.entries,
      truncated: result.truncated,
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
  const files = await context.workspaceFileAccess.walkFiles({ path: cwd });
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
  const files = await context.workspaceFileAccess.walkFiles({ path: rootPath });
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: Array<{ path: string; line: number; preview: string }> = [];

  for (const file of files) {
    const content = await context.workspaceFileAccess.readTextFile({ path: file });
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
  const result = await context.workspaceFileAccess.replaceText({
    path: targetPath,
    oldText,
    newText,
    replaceAll,
  });

  return {
    outputKind: 'json',
    content: {
      path: result.path,
      replacements: result.replacements,
      changed: result.changed,
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
  const result = await context.workspaceFileAccess.writeFile({
    path: targetPath,
    content,
    overwrite,
  });

  return {
    outputKind: 'json',
    content: {
      path: result.path,
      bytesWritten: result.bytesWritten,
      created: result.created,
      overwritten: result.overwritten,
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
  const cwd = await context.workspaceFileAccess.resolveCommandCwd({
    path: optionalString(record, 'cwd', '.'),
  });
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
    ...(isJsonObject(record.metadata) ? { metadata: record.metadata } : {}),
  };
}

type BuiltInToolContext = {
  workspaceFileAccess: WorkspaceFileAccess;
  spawn: BuiltInToolSpawn;
  skillService?: Pick<SkillService, 'activateSkill'>;
  runContext?: {
    runId: string;
    sessionId: string;
    workspaceId?: string;
  };
};

function inputRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Tool input must be an object');
  }
  return input as Record<string, unknown>;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
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
