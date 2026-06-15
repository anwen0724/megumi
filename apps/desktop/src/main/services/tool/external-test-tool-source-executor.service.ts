// Implements the external_test demo source executor used to prove source-aware execution without MCP or plugins.
import { createRawToolResultFromContent, normalizeToolError } from '@megumi/tools/normalization';
import type { RawToolResult, ToolExecution, ToolSourceIdentity } from '@megumi/shared/tool';
import type { ToolSourceExecutor } from './tool-execution-router.service';

export function createExternalTestToolSourceExecutor(input: {
  now?: () => string;
  ids?: { toolResultId(): string };
} = {}): ToolSourceExecutor {
  const now = input.now ?? (() => new Date().toISOString());
  const ids = input.ids ?? { toolResultId: () => `tool-result:${crypto.randomUUID()}` };

  return {
    sourceId: 'external_test',
    sourceKind: 'external_test',
    async executeToolExecution(toolExecution) {
      try {
        if (
          toolExecution.sourceId !== 'external_test'
          || toolExecution.namespace !== 'demo'
          || toolExecution.sourceToolName !== 'echo'
        ) {
          throw new Error(`Unsupported external_test tool: ${String(toolExecution.sourceToolName ?? 'unknown')}`);
        }

        if (!toolExecution.input || typeof toolExecution.input !== 'object' || Array.isArray(toolExecution.input)) {
          throw new Error('External test echo input must be an object.');
        }
        const message = (toolExecution.input as Record<string, unknown>).message;
        if (typeof message !== 'string') {
          throw new Error('External test echo input requires a string message.');
        }

        const sourceIdentity = sourceIdentityFromExecution(toolExecution);
        return {
          rawToolResultId: ids.toolResultId(),
          toolExecutionId: String(toolExecution.toolExecutionId),
          toolCallId: String(toolExecution.toolCallId),
          isError: false,
          outputKind: 'text',
          content: {
            structuredContent: { message },
            textContent: message,
            redactionState: 'none',
          },
          createdAt: now(),
          ...(sourceIdentity ? { metadata: { toolSourceIdentity: sourceIdentity } } : {}),
        };
      } catch (error) {
        return createToolErrorResult(toolExecution, {
          ids,
          now,
          error,
          sourceIdentity: sourceIdentityFromExecution(toolExecution),
        });
      }
    },
  };
}

function createToolErrorResult(
  toolExecution: ToolExecution,
  input: {
    ids: { toolResultId(): string };
    now: () => string;
    error: unknown;
    sourceIdentity?: ToolSourceIdentity;
  },
): RawToolResult {
  const error = normalizeToolError(input.error, {
    debugId: `tool-error:${toolExecution.toolExecutionId}`,
    fallbackMessage: 'Tool execution failed.',
  });
  return createRawToolResultFromContent({
    rawToolResultId: input.ids.toolResultId(),
    toolExecutionId: String(toolExecution.toolExecutionId),
    toolCallId: String(toolExecution.toolCallId),
    isError: true,
    outputKind: 'error',
    content: error,
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
