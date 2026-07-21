// Composes Agent tool services for product runtime wiring.
import path from 'node:path';
import fs from 'fs-extra';
import {
  ToolExecutionService,
  ToolRegistryService,
} from '../tools';
import {
  createBuiltInToolExecutor,
  type WebSearchService,
  type WebFetchService,
  type WorkspaceFileAccess,
} from '../tools/built-in-tools';
import type { SkillService } from '@megumi/skills';
import type { WorkspacePathPolicyService } from '../workspace';
import { createWorkspacePathPolicyService } from '../workspace';

export interface LocalWorkspaceFileSystem {
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

export function composeAgentToolRegistryService(input: {
  webSearchEnabled?: boolean;
  isWebSearchEnabled?: () => boolean;
  isBuiltInToolAvailable?: (toolName: string) => boolean;
} = {}): ToolRegistryService {
  return new ToolRegistryService({
    isBuiltInToolAvailable: (toolName) => {
      if (input.isBuiltInToolAvailable && !input.isBuiltInToolAvailable(toolName)) {
        return false;
      }
      if (toolName !== 'web_search') {
        return true;
      }
      return input.isWebSearchEnabled ? input.isWebSearchEnabled() : Boolean(input.webSearchEnabled);
    },
  });
}

export function composeAgentToolExecutionService(input: {
  projectRoot: string;
  fileSystem?: LocalWorkspaceFileSystem;
  registryService?: ToolRegistryService;
  workspacePathPolicyService?: WorkspacePathPolicyService;
  skillService?: Pick<SkillService, 'useSkill'>;
  webSearchService?: WebSearchService;
  webFetchService?: WebFetchService;
}): ToolExecutionService {
  const registryService = input.registryService ?? composeAgentToolRegistryService();
  return new ToolExecutionService({
    registryService,
    builtInTools: createBuiltInToolExecutor({
      workspaceFileAccess: createLocalWorkspaceFileAccess({
        projectRoot: input.projectRoot,
        fileSystem: input.fileSystem ?? fs,
        workspacePathPolicyService: input.workspacePathPolicyService ?? createWorkspacePathPolicyService(),
      }),
      ...(input.skillService ? { skillService: input.skillService } : {}),
      ...(input.webSearchService ? { webSearchService: input.webSearchService } : {}),
      ...(input.webFetchService ? { webFetchService: input.webFetchService } : {}),
    }),
  });
}

export function createLocalWorkspaceFileAccess(input: {
  projectRoot: string;
  fileSystem?: LocalWorkspaceFileSystem;
  workspacePathPolicyService?: WorkspacePathPolicyService;
}): WorkspaceFileAccess {
  const fileSystem = input.fileSystem ?? fs;
  const workspacePathPolicyService = input.workspacePathPolicyService ?? createWorkspacePathPolicyService();

  return {
    async readFile(request) {
      const resolved = resolveReadablePath(workspacePathPolicyService, input.projectRoot, request.path);
      const rawContent = await fileSystem.readFile(resolved.absolutePath, 'utf8');
      return {
        path: resolved.relativePath,
        content: rawContent,
        sizeBytes: Buffer.byteLength(rawContent, 'utf8'),
      };
    },
    async listDirectory(request) {
      const resolved = resolveReadablePath(workspacePathPolicyService, input.projectRoot, request.path);
      const visibleEntries: Array<{ name: string; kind: 'file' | 'directory'; path: string }> = [];
      await collectDirectoryEntries({
        fileSystem,
        absoluteDirectory: resolved.absolutePath,
        relativeDirectory: resolved.relativePath === '.' ? '' : resolved.relativePath,
        maxDepth: request.maxDepth,
        includeHidden: request.includeHidden,
        output: visibleEntries,
      });

      return {
        path: resolved.relativePath,
        entries: visibleEntries.sort((left, right) => compareStableText(left.path, right.path)),
      };
    },
    async walkFiles(request) {
      return walkFiles({
        projectRoot: input.projectRoot,
        fileSystem,
        workspacePathPolicyService,
        rootRelativePath: request.path,
        includeHidden: request.includeHidden ?? true,
      });
    },
    async readTextFile(request) {
      const resolved = resolveReadablePath(workspacePathPolicyService, input.projectRoot, request.path);
      return fileSystem.readFile(resolved.absolutePath, 'utf8');
    },
    async replaceText(request) {
      const resolved = resolveWritablePath(workspacePathPolicyService, input.projectRoot, request.path);
      const content = await fileSystem.readFile(resolved.absolutePath, 'utf8');
      const occurrences = content.split(request.oldText).length - 1;
      if (occurrences === 0) {
        throw new Error(`Text not found in file: ${resolved.relativePath}`);
      }
      if (!request.replaceAll && occurrences > 1) {
        throw new Error(`Text occurs multiple times in file: ${resolved.relativePath}`);
      }
      const updated = request.replaceAll
        ? content.split(request.oldText).join(request.newText)
        : content.replace(request.oldText, request.newText);

      await fileSystem.writeFile(resolved.absolutePath, updated, 'utf8');

      return {
        path: resolved.relativePath,
        replacements: request.replaceAll ? occurrences : 1,
        changed: updated !== content,
      };
    },
    async writeFile(request) {
      const resolved = resolveWritablePath(workspacePathPolicyService, input.projectRoot, request.path);
      const exists = await existsAsFile(fileSystem, resolved.absolutePath);
      if (exists && !request.overwrite) {
        throw new Error(`File already exists: ${resolved.relativePath}`);
      }

      await fileSystem.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
      await fileSystem.writeFile(resolved.absolutePath, request.content, 'utf8');

      return {
        path: resolved.relativePath,
        bytesWritten: Buffer.byteLength(request.content, 'utf8'),
        created: !exists,
        overwritten: exists,
      };
    },
    async resolveCommandCwd(request) {
      return resolveReadablePath(workspacePathPolicyService, input.projectRoot, request.path).absolutePath;
    },
  };
}

function resolveReadablePath(
  workspacePathPolicyService: WorkspacePathPolicyService,
  projectRoot: string,
  targetPath: string,
): {
  absolutePath: string;
  relativePath: string;
} {
  const resolved = workspacePathPolicyService.classifyPath({
    workspace_root: projectRoot,
    target_path: targetPath,
  });
  return {
    absolutePath: resolved.absolute_path,
    relativePath: resolved.workspace_path || '.',
  };
}

function resolveWritablePath(
  workspacePathPolicyService: WorkspacePathPolicyService,
  projectRoot: string,
  targetPath: string,
): {
  absolutePath: string;
  relativePath: string;
} {
  return resolveReadablePath(workspacePathPolicyService, projectRoot, targetPath);
}

async function walkFiles(input: {
  projectRoot: string;
  fileSystem: LocalWorkspaceFileSystem;
  workspacePathPolicyService: WorkspacePathPolicyService;
  rootRelativePath: string;
  includeHidden: boolean;
}): Promise<string[]> {
  const root = resolveReadablePath(input.workspacePathPolicyService, input.projectRoot, input.rootRelativePath);
  const stats = await input.fileSystem.stat(root.absolutePath);
  if (stats.isFile()) {
    return [root.relativePath];
  }
  if (!stats.isDirectory()) {
    return [];
  }

  const output: string[] = [];
  await walkDirectory(
    input.fileSystem,
    root.absolutePath,
    root.relativePath === '.' ? '' : root.relativePath,
    output,
    input.includeHidden,
  );
  return output.sort();
}

async function walkDirectory(
  fileSystem: LocalWorkspaceFileSystem,
  absoluteDirectory: string,
  relativeDirectory: string,
  output: string[],
  includeHidden: boolean,
): Promise<void> {
  const entries = await fileSystem.readdir(absoluteDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (!includeHidden && isHiddenName(entry.name)) {
      continue;
    }
    const relativePath = normalizeSlash(relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name);
    const absolutePath = path.join(absoluteDirectory, entry.name);
    if (entry.isFile()) {
      output.push(relativePath);
      continue;
    }
    if (entry.isDirectory()) {
      await walkDirectory(fileSystem, absolutePath, relativePath, output, includeHidden);
    }
  }
}

async function existsAsFile(fileSystem: LocalWorkspaceFileSystem, filePath: string): Promise<boolean> {
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

async function collectDirectoryEntries(input: {
  fileSystem: LocalWorkspaceFileSystem;
  absoluteDirectory: string;
  relativeDirectory: string;
  maxDepth: number;
  includeHidden: boolean;
  output: Array<{ name: string; kind: 'file' | 'directory'; path: string }>;
  depth?: number;
}): Promise<void> {
  const depth = input.depth ?? 1;
  const entries = await input.fileSystem.readdir(input.absoluteDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if ((!entry.isFile() && !entry.isDirectory()) || (!input.includeHidden && isHiddenName(entry.name))) {
      continue;
    }
    const relativePath = normalizeSlash(input.relativeDirectory
      ? `${input.relativeDirectory}/${entry.name}`
      : entry.name);
    input.output.push({
      name: entry.name,
      kind: entry.isDirectory() ? 'directory' : 'file',
      path: relativePath,
    });
    if (entry.isDirectory() && depth < input.maxDepth) {
      await collectDirectoryEntries({
        ...input,
        absoluteDirectory: path.join(input.absoluteDirectory, entry.name),
        relativeDirectory: relativePath,
        depth: depth + 1,
      });
    }
  }
}

function isHiddenName(name: string): boolean {
  return name.startsWith('.');
}

function compareStableText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
