// Routes validated ToolExecution records to Desktop Main source executors using run snapshot identity.
import { normalizeToolError } from '@megumi/tools/normalization';
import type {
  ToolExecution,
  ToolResult,
  ToolSourceIdentity,
  ToolSourceKind,
} from '@megumi/shared/tool';
import type { WorkspaceChangeExecutionScope } from '../workspace/workspace-change-tracker.service';

export interface ToolSourceExecutor {
  readonly sourceId: string;
  readonly sourceKind: ToolSourceKind;
  executeToolExecution(
    toolExecution: ToolExecution,
    scope?: WorkspaceChangeExecutionScope,
  ): Promise<ToolResult>;
  finalizeWorkspaceChangeSet?(scope: WorkspaceChangeExecutionScope): unknown;
}

export interface ToolExecutionRouting extends ToolSourceIdentity {
  toolExecutionId: string;
  toolName: ToolExecution['toolName'];
  executorKind: ToolSourceKind;
}

export type RoutedToolExecutionResult =
  | { routed: true; routing: ToolExecutionRouting; toolResult: ToolResult }
  | { routed: false; toolResult: ToolResult };

export interface ToolExecutionRouter {
  executeToolExecution(
    toolExecution: ToolExecution,
    scope?: WorkspaceChangeExecutionScope,
  ): Promise<RoutedToolExecutionResult>;
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
    async executeToolExecution(toolExecution, scope) {
      const sourceIdentity = sourceIdentityFromExecution(toolExecution);
      if (!sourceIdentity) {
        return {
          routed: false,
          toolResult: createToolErrorResult(toolExecution, {
            ids,
            now,
            message: 'Tool execution is missing source identity.',
          }),
        };
      }

      const executor = executorsBySourceId.get(sourceIdentity.sourceId);
      const routing: ToolExecutionRouting = {
        ...sourceIdentity,
        toolExecutionId: String(toolExecution.toolExecutionId),
        toolName: toolExecution.toolName,
        executorKind: executor?.sourceKind ?? (sourceIdentity.sourceId as ToolSourceKind),
      };

      if (!executor) {
        return {
          routed: true,
          routing,
          toolResult: createToolErrorResult(toolExecution, {
            ids,
            now,
            message: `Unsupported tool source: ${sourceIdentity.sourceId}`,
            sourceIdentity,
          }),
        };
      }

      try {
        return {
          routed: true,
          routing,
          toolResult: await executor.executeToolExecution(toolExecution, scope),
        };
      } catch (error) {
        return {
          routed: true,
          routing,
          toolResult: createToolErrorResult(toolExecution, {
            ids,
            now,
            message: 'Tool execution failed.',
            error,
            sourceIdentity,
          }),
        };
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
): ToolResult {
  const error = normalizeToolError(input.error ?? new Error(input.message), {
    debugId: `tool-error:${toolExecution.toolExecutionId}`,
    fallbackMessage: input.message,
  });
  return {
    toolResultId: input.ids.toolResultId(),
    toolCallId: toolExecution.toolCallId,
    toolExecutionId: toolExecution.toolExecutionId,
    runId: toolExecution.runId,
    kind: 'tool_error',
    textContent: input.error ? error.message : input.message,
    error,
    redactionState: 'none',
    createdAt: input.now(),
    ...(input.sourceIdentity ? { metadata: { toolSourceIdentity: input.sourceIdentity } } : {}),
  };
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
