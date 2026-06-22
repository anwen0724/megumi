import path from 'node:path';
import {
  classifyProjectPath,
  isProtectedProjectPath,
  isSensitiveProjectPath,
} from '@megumi/coding-agent/permissions/project-boundary-policy';
import { redactRuntimeMessage } from '@megumi/security/redaction';
import { normalizeToolResult } from '@megumi/coding-agent/tools/normalization';
import { createRawToolResultFromContent } from '@megumi/coding-agent/tools/normalization';
import type { RawToolResult, ToolExecution, ToolResult } from '@megumi/shared/tool';
import type { WorkspaceChangeTrackerService } from '../../workspace/workspace-change-tracker.service';
import type { SpawnLike } from './run-command.executor';

export interface ProjectToolFileSystem {
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

export interface ProjectToolExecutorOptions {
  projectRoot: string;
  fileSystem?: ProjectToolFileSystem;
  spawn?: SpawnLike;
  workspaceChangeTracker?: WorkspaceChangeTrackerService;
  now?: () => string;
  ids?: {
    toolResultId(): string;
    rawToolResultId?(): string;
  };
}

export interface ProjectToolExecutorContext {
  projectRoot: string;
  fileSystem: ProjectToolFileSystem;
  spawn?: SpawnLike;
  workspaceChangeTracker?: WorkspaceChangeTrackerService;
  now: () => string;
  ids: {
    toolResultId(): string;
    rawToolResultId?(): string;
  };
}

export interface SingleProjectToolExecutor {
  execute(toolExecution: ToolExecution): Promise<RawToolResult>;
}

export interface ProjectFileEntry {
  absolutePath: string;
  relativePath: string;
}

export function successResult(
  context: ProjectToolExecutorContext,
  toolExecution: ToolExecution,
  input: {
    structuredContent?: ToolResult['structuredContent'];
    textContent?: string;
    redactionState?: ToolResult['redactionState'];
    metadata?: ToolResult['metadata'];
    outputKind?: RawToolResult['outputKind'];
  },
): RawToolResult {
  const normalized = normalizeToolResult(toolExecution, {
    toolResultId: context.ids.toolResultId(),
    structuredContent: input.structuredContent,
    textContent: input.textContent,
    redactionState: input.redactionState,
    metadata: input.metadata,
    createdAt: context.now(),
  });
  return createRawToolResultFromContent({
    rawToolResultId: context.ids.rawToolResultId?.() ?? normalized.toolResultId,
    toolExecutionId: String(toolExecution.toolExecutionId),
    toolCallId: String(toolExecution.toolCallId),
    isError: false,
    outputKind: input.outputKind ?? (input.structuredContent ? 'json' : 'text'),
    content: {
      structuredContent: normalized.structuredContent,
      textContent: normalized.textContent,
      redactionState: normalized.redactionState,
      metadata: normalized.metadata,
    },
    createdAt: normalized.createdAt,
  });
}

export function resolveProjectPath(
  context: Pick<ProjectToolExecutorContext, 'projectRoot'>,
  targetPath: string,
): { absolutePath: string; relativePath: string; protected: boolean; sensitive: boolean } {
  const classification = classifyProjectPath({
    projectRoot: context.projectRoot,
    targetPath,
  });

  if (!classification.insideProject) {
    throw new Error(`Project path is outside the project: ${targetPath}`);
  }

  return {
    absolutePath: classification.absolutePath,
    relativePath: classification.relativePath || '.',
    protected: classification.protected,
    sensitive: classification.sensitive,
  };
}

export function assertOrdinaryProjectPath(
  context: Pick<ProjectToolExecutorContext, 'projectRoot'>,
  targetPath: string,
): { absolutePath: string; relativePath: string } {
  const resolved = resolveProjectPath(context, targetPath);

  if (resolved.protected) {
    throw new Error(`Project path is protected: ${resolved.relativePath}`);
  }

  if (resolved.sensitive) {
    throw new Error(`Project path is sensitive: ${resolved.relativePath}`);
  }

  return resolved;
}

export function inputRecord(toolExecution: ToolExecution): Record<string, unknown> {
  if (!toolExecution.input || typeof toolExecution.input !== 'object' || Array.isArray(toolExecution.input)) {
    throw new Error(`Tool input must be an object: ${toolExecution.toolName}`);
  }
  return toolExecution.input as Record<string, unknown>;
}

export function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string') {
    throw new Error(`Missing or invalid string input: ${key}`);
  }
  return value;
}

export function optionalString(input: Record<string, unknown>, key: string, fallback: string): string {
  const value = input[key];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'string') {
    throw new Error(`Invalid string input: ${key}`);
  }
  return value;
}

export function optionalPositiveInteger(
  input: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = input[key];
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`Invalid positive integer input: ${key}`);
  }
  return Number(value);
}

export function redactToolText(content: string): {
  content: string;
  redactionState: ToolResult['redactionState'];
} {
  const redacted = redactRuntimeMessage(content);
  return {
    content: redacted,
    redactionState: redacted === content ? 'none' : 'redacted',
  };
}

export function truncateUtf8(content: string, maxBytes: number): { content: string; truncated: boolean } {
  const buffer = Buffer.from(content, 'utf8');
  if (buffer.byteLength <= maxBytes) {
    return { content, truncated: false };
  }
  return {
    content: buffer.subarray(0, maxBytes).toString('utf8'),
    truncated: true,
  };
}

export async function walkProjectFiles(
  context: ProjectToolExecutorContext,
  rootRelativePath = '.',
): Promise<ProjectFileEntry[]> {
  const root = resolveProjectPath(context, rootRelativePath);
  if (isHiddenProjectPath(root.relativePath, root.protected, root.sensitive)) {
    return [];
  }

  const rootStats = await context.fileSystem.stat(root.absolutePath);
  if (rootStats.isFile()) {
    return [{ absolutePath: root.absolutePath, relativePath: root.relativePath }];
  }

  const entries: ProjectFileEntry[] = [];
  await walkDirectory(context, root.absolutePath, root.relativePath === '.' ? '' : root.relativePath, entries);
  return entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function walkDirectory(
  context: ProjectToolExecutorContext,
  absoluteDirectory: string,
  relativeDirectory: string,
  output: ProjectFileEntry[],
): Promise<void> {
  const entries = await context.fileSystem.readdir(absoluteDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() && !entry.isDirectory()) {
      continue;
    }

    const relativePath = normalizeSlash(relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name);
    const classification = classifyProjectPath({
      projectRoot: context.projectRoot,
      targetPath: relativePath,
    });

    if (!classification.insideProject || isHiddenProjectPath(
      classification.relativePath,
      classification.protected,
      classification.sensitive,
    )) {
      continue;
    }

    const absolutePath = path.join(absoluteDirectory, entry.name);
    if (entry.isFile()) {
      output.push({ absolutePath, relativePath });
      continue;
    }

    await walkDirectory(context, absolutePath, relativePath, output);
  }
}

export function normalizeSlash(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

export function isHiddenProjectPath(
  relativePath: string,
  protectedPath = isProtectedProjectPath(relativePath),
  sensitivePath = isSensitiveProjectPath(relativePath),
): boolean {
  const normalized = normalizeSlash(relativePath);
  const basename = normalized.split('/').at(-1) ?? normalized;
  return protectedPath
    || sensitivePath
    || isProtectedProjectPath(basename)
    || isSensitiveProjectPath(basename);
}

export function globToRegExp(pattern: string): RegExp {
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

export function globStaticBase(pattern: string): string {
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

export { createReadFileExecutor } from './read-file.executor';
export { createListDirectoryExecutor } from './list-directory.executor';
export { createGlobExecutor } from './glob.executor';
export { createSearchTextExecutor } from './search-text.executor';
export { createEditFileExecutor } from './edit-file.executor';
export { createWriteFileExecutor } from './write-file.executor';
export { createRunCommandExecutor } from './run-command.executor';


