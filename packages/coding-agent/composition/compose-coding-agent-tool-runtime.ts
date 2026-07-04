// Composes Coding Agent tool services and wires them into the agent loop.
import path from 'node:path';
import fs from 'fs-extra';
import { createToolCallRunner } from '../agent-loop/tool-call';
import type { AgentLoopRepository } from '../persistence/repos/agent-loop.repo';
import type { ToolCallRepository } from '../persistence/repos/tool-call.repo';
import type { WorkspaceChangeRepository } from '../workspace/repositories/workspace-change-repository';
import type { ToolRuntimeFactory } from '../agent-loop/tool-call';
import type { PermissionSettingsProvider } from '../permissions/permission-settings-provider';
import {
  ToolExecutionService,
  ToolRegistryService,
} from '../tools';
import { createBuiltInToolAdapter, type WorkspaceFileAccess } from '../tools/adapters/built-in-tools';
import { classifyProjectPath } from '../workspace';

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

export function composeCodingAgentToolRegistryService(): ToolRegistryService {
  return new ToolRegistryService();
}

export function composeCodingAgentToolExecutionService(input: {
  projectRoot: string;
  fileSystem?: LocalWorkspaceFileSystem;
  registryService?: ToolRegistryService;
}): ToolExecutionService {
  const registryService = input.registryService ?? composeCodingAgentToolRegistryService();
  return new ToolExecutionService({
    registryService,
    builtInTools: createBuiltInToolAdapter({
      workspaceFileAccess: createLocalWorkspaceFileAccess({
        projectRoot: input.projectRoot,
        fileSystem: input.fileSystem ?? fs,
      }),
    }),
  });
}

export function createLocalWorkspaceFileAccess(input: {
  projectRoot: string;
  fileSystem?: LocalWorkspaceFileSystem;
}): WorkspaceFileAccess {
  const fileSystem = input.fileSystem ?? fs;

  return {
    async readFile(request) {
      const resolved = resolveReadablePath(input.projectRoot, request.path);
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
      const resolved = resolveReadablePath(input.projectRoot, request.path);
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
        rootRelativePath: request.path,
      });
    },
    async readTextFile(request) {
      const resolved = resolveReadablePath(input.projectRoot, request.path);
      return fileSystem.readFile(resolved.absolutePath, 'utf8');
    },
    async replaceText(request) {
      const resolved = resolveWritablePath(input.projectRoot, request.path);
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
      const resolved = resolveWritablePath(input.projectRoot, request.path);
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
      return resolveReadablePath(input.projectRoot, request.path).absolutePath;
    },
  };
}

export function composeCodingAgentToolRuntimeFactory(input: {
  toolRepository: ToolCallRepository;
  toolRegistry: ToolRegistryService;
  workspaceChangeRepository: WorkspaceChangeRepository;
  runRepository: AgentLoopRepository;
  permissionSettingsProvider: PermissionSettingsProvider;
}): ToolRuntimeFactory {
  void input.workspaceChangeRepository;
  return {
    async create({ projectRoot, permissionMode }) {
      return createToolCallRunner({
        repository: {
          startToolCall: (toolCall) => input.toolRepository.startToolCall(toolCall),
          getToolCall: (toolCallId) => input.toolRepository.getToolCall(toolCallId),
          recordToolExecution: (toolExecution) => input.toolRepository.recordToolExecution(toolExecution),
          getToolExecution: (toolExecutionId) => input.toolRepository.getToolExecution(toolExecutionId),
          getToolExecutionByToolCallId: (request) => input.toolRepository.getToolExecutionByToolCallId(request),
          listToolExecutionsByAssistantMessage: (request) => input.toolRepository.listToolExecutionsByAssistantMessage(request),
          recordPermissionDecision: (permissionDecision) => input.toolRepository.recordPermissionDecision(permissionDecision),
          createApprovalRequest: (approvalRequest) => input.toolRepository.createApprovalRequest(approvalRequest),
          getApprovalRequest: (approvalRequestId) => input.toolRepository.getApprovalRequest(approvalRequestId),
          completeToolCall: (toolResult) => input.toolRepository.completeToolCall(toolResult),
          markToolResultsSubmittedToModelInput: (request) =>
            input.toolRepository.markToolResultsSubmittedToModelInput(request),
          getRunSessionId(runId) {
            const run = input.runRepository.getRun(runId);
            return run ? String(run.sessionId) : undefined;
          },
        },
        toolRegistryService: input.toolRegistry,
        toolExecutionService: composeCodingAgentToolExecutionService({
          projectRoot,
          registryService: input.toolRegistry,
        }),
        permissionMode,
        projectRoot,
        settings: await input.permissionSettingsProvider.loadForProject(projectRoot),
        ids: {
          toolExecutionId: () => `tool-execution:${crypto.randomUUID()}`,
          toolResultId: () => `tool-result:${crypto.randomUUID()}`,
          permissionDecisionId: () => `permission-decision:${crypto.randomUUID()}`,
          approvalRequestId: () => `approval-request:${crypto.randomUUID()}`,
          rawToolResultId: () => `raw-tool-result:${crypto.randomUUID()}`,
          observationId: () => `tool-observation:${crypto.randomUUID()}`,
          eventId: () => `event:${crypto.randomUUID()}`,
        },
      });
    },
  };
}

function resolveReadablePath(projectRoot: string, targetPath: string): {
  absolutePath: string;
  relativePath: string;
} {
  const classification = classifyProjectPath({
    projectRoot,
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

function resolveWritablePath(projectRoot: string, targetPath: string): {
  absolutePath: string;
  relativePath: string;
} {
  return resolveReadablePath(projectRoot, targetPath);
}

async function walkFiles(input: {
  projectRoot: string;
  fileSystem: LocalWorkspaceFileSystem;
  rootRelativePath: string;
}): Promise<string[]> {
  const root = resolveReadablePath(input.projectRoot, input.rootRelativePath);
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
