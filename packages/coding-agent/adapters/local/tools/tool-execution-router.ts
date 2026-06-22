// Routes validated ToolExecution records to Desktop Main source executors using run snapshot identity.
import { createRawToolResultFromContent, normalizeToolError } from '@megumi/coding-agent/tools/normalization';
import type {
  RawToolResult,
  ToolExecution,
  ToolSourceIdentity,
  ToolSourceKind,
} from '@megumi/shared/tool';
import type { WorkspaceChangeExecutionScope } from '@megumi/coding-agent/workspace';

export interface ToolExecutionRunOptions {
  scope?: WorkspaceChangeExecutionScope;
  signal?: AbortSignal;
}

export interface ToolSourceExecutor {
  readonly sourceId: string;
  readonly sourceKind: ToolSourceKind;
  executeToolExecution(
    toolExecution: ToolExecution,
    options?: ToolExecutionRunOptions,
  ): Promise<RawToolResult>;
  finalizeWorkspaceChangeSet?(scope: WorkspaceChangeExecutionScope): unknown;
}

export interface ToolExecutionRouting extends ToolSourceIdentity {
  toolExecutionId: string;
  toolName: ToolExecution['toolName'];
  executorKind: ToolSourceKind;
}

export type RoutedToolExecutionResult =
  | { routed: true; routing: ToolExecutionRouting; rawResult: RawToolResult }
  | { routed: false; rawResult: RawToolResult };

export interface ToolExecutionRouter {
  executeToolExecution(
    toolExecution: ToolExecution,
    options?: ToolExecutionRunOptions,
  ): Promise<RawToolResult>;
  finalizeWorkspaceChangeSet?(scope: WorkspaceChangeExecutionScope): unknown;
}

export function createToolExecutionRouter(input: {
  sourceExecutors: ToolSourceExecutor[];
  now?: () => string;
  ids?: { toolResultId(): string };
}): ToolExecutionRouter {
  const executorsBySourceId = new Map(input.sourceExecutors.map((executor) => [executor.sourceId, executor]));
  const now = input.now ?? (() => new Date().toISOString());
  const ids = input.ids ?? { toolResultId: () => `tool-result:${crypto.randomUUID()}` };

  return {
    async executeToolExecution(toolExecution, options) {
      const sourceIdentity = sourceIdentityFromExecution(toolExecution);
      if (!sourceIdentity) {
        return createToolErrorResult(toolExecution, {
          ids,
          now,
          message: 'Tool execution is missing source identity.',
        });
      }

      const executor = executorsBySourceId.get(sourceIdentity.sourceId);

      if (!executor) {
        return createToolErrorResult(toolExecution, {
          ids,
          now,
          message: `Unsupported tool source: ${sourceIdentity.sourceId}`,
          sourceIdentity,
        });
      }

      const routing: ToolExecutionRouting = {
        ...sourceIdentity,
        toolExecutionId: String(toolExecution.toolExecutionId),
        toolName: toolExecution.toolName,
        executorKind: executor.sourceKind,
      };

      try {
        void routing;
        return await executor.executeToolExecution(toolExecution, options);
      } catch (error) {
        void routing;
        return createToolErrorResult(toolExecution, {
          ids,
          now,
          message: 'Tool execution failed.',
          error,
          sourceIdentity,
        });
      }
    },
    finalizeWorkspaceChangeSet(scope) {
      for (const executor of input.sourceExecutors) {
        executor.finalizeWorkspaceChangeSet?.(scope);
      }
    },
  };
}

function createToolErrorResult(
  toolExecution: ToolExecution,
  input: {
    ids: { toolResultId(): string };
    now: () => string;
    message: string;
    error?: unknown;
    sourceIdentity?: ToolSourceIdentity;
  },
): RawToolResult {
  const error = normalizeToolError(input.error ?? new Error(input.message), {
    debugId: `tool-error:${toolExecution.toolExecutionId}`,
    fallbackMessage: input.message,
  });
  return createRawToolResultFromContent({
    rawToolResultId: input.ids.toolResultId(),
    toolExecutionId: String(toolExecution.toolExecutionId),
    toolCallId: String(toolExecution.toolCallId),
    isError: true,
    outputKind: 'error',
    content: input.error ? error : input.message,
    metadata: input.sourceIdentity ? { toolSourceIdentity: input.sourceIdentity } : undefined,
    createdAt: input.now(),
  });
}

function sourceIdentityFromExecution(toolExecution: ToolExecution): ToolSourceIdentity | undefined {
  if (
    typeof toolExecution.registrySnapshotId !== 'string'
    || typeof toolExecution.snapshotEntryId !== 'string'
    || typeof toolExecution.modelVisibleName !== 'string'
    || typeof toolExecution.canonicalToolId !== 'string'
    || typeof toolExecution.sourceId !== 'string'
    || typeof toolExecution.namespace !== 'string'
    || typeof toolExecution.sourceToolName !== 'string'
  ) {
    return undefined;
  }

  return {
    registrySnapshotId: toolExecution.registrySnapshotId,
    snapshotEntryId: toolExecution.snapshotEntryId,
    modelVisibleName: toolExecution.modelVisibleName,
    canonicalToolId: toolExecution.canonicalToolId,
    sourceId: toolExecution.sourceId,
    namespace: toolExecution.namespace,
    sourceToolName: toolExecution.sourceToolName,
  };
}
