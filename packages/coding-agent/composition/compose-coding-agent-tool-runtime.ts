// Composes Coding Agent tool services for product runtime wiring.
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
import type { SkillService } from '../skills';
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

export function composeCodingAgentToolRegistryService(input: {
  webSearchEnabled?: boolean;
  isWebSearchEnabled?: () => boolean;
} = {}): ToolRegistryService {
  return new ToolRegistryService({
    ...(input.isWebSearchEnabled
      ? { isBuiltInToolAvailable: (toolName) => toolName !== 'web_search' || input.isWebSearchEnabled!() }
      : { disabledBuiltInTools: input.webSearchEnabled ? [] : ['web_search'] }),
  });
}

export function composeCodingAgentToolExecutionService(input: {
  projectRoot: string;
  fileSystem?: LocalWorkspaceFileSystem;
  registryService?: ToolRegistryService;
  workspacePathPolicyService?: WorkspacePathPolicyService;
  skillService?: Pick<SkillService, 'activateSkill'>;
  webSearchService?: WebSearchService;
  webFetchService?: WebFetchService;
  runContext?: {
    runId: string;
    sessionId: string;
    workspaceId?: string;
  };
}): ToolExecutionService {
  const registryService = input.registryService ?? composeCodingAgentToolRegistryService();
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
      ...(input.runContext ? { runContext: input.runContext } : {}),
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
      const truncated = truncateUtf8(rawContent, request.maxBytes);
      return {
        path: resolved.relativePath,
        content: truncated.content,
        truncated: truncated.truncated,
        sizeBytes: Buffer.byteLength(rawContent, 'utf8'),
      };
    },
    async listDirectory(request) {
      const resolved = resolveReadablePath(workspacePathPolicyService, input.projectRoot, request.path);
      const entries = await fileSystem.readdir(resolved.absolutePath, { withFileTypes: true });
      const visibleEntries = entries
        .filter((entry) => entry.isFile() || entry.isDirectory())
        .map((entry) => {
          const relativePath = normalizeSlash(resolved.relativePath === '.'
            ? entry.name
            : `${resolved.relativePath}/${entry.name}`);
          return {
            name: entry.name,
            kind: entry.isDirectory() ? 'directory' as const : 'file' as const,
            path: relativePath,
          };
        })
        .sort((left, right) => left.path.localeCompare(right.path));

      return {
        path: resolved.relativePath,
        entries: visibleEntries,
        truncated: false,
      };
    },
    async walkFiles(request) {
      return walkFiles({
        projectRoot: input.projectRoot,
        fileSystem,
        workspacePathPolicyService,
        rootRelativePath: request.path,
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
  const resolved = workspacePathPolicyService.assertOrdinaryPath({
    workspace_root: projectRoot,
    target_path: targetPath,
  });
  if (resolved.status === 'rejected' && resolved.reason === 'outside_workspace') {
    throw new Error(`Project path is outside the project: ${targetPath}`);
  }
  if (resolved.status === 'rejected') {
    throw new Error(`Project path cannot be accessed: ${targetPath}`);
  }
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
  );
  return output.sort();
}

async function walkDirectory(
  fileSystem: LocalWorkspaceFileSystem,
  absoluteDirectory: string,
  relativeDirectory: string,
  output: string[],
): Promise<void> {
  const entries = await fileSystem.readdir(absoluteDirectory, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = normalizeSlash(relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name);
    const absolutePath = path.join(absoluteDirectory, entry.name);
    if (entry.isFile()) {
      output.push(relativePath);
      continue;
    }
    if (entry.isDirectory()) {
      await walkDirectory(fileSystem, absolutePath, relativePath, output);
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
