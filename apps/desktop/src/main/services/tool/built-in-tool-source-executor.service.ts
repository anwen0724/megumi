// Adapts Desktop Main built-in tool executors to the source-aware ToolSourceExecutor port.
import fs from 'fs-extra';
import { normalizeToolError } from '@megumi/tools/normalization';
import type { ToolExecution, ToolResult, ToolSourceIdentity } from '@megumi/shared/tool';
import {
  createEditFileExecutor,
  createGlobExecutor,
  createListDirectoryExecutor,
  createReadFileExecutor,
  createRunCommandExecutor,
  createSearchTextExecutor,
  createWriteFileExecutor,
  type ProjectToolExecutorOptions,
  type ProjectToolFileSystem,
  type SingleProjectToolExecutor,
} from './tool-executors';
import type { ToolSourceExecutor } from './tool-execution-router.service';

export function createBuiltInToolSourceExecutor(options: ProjectToolExecutorOptions): ToolSourceExecutor {
  const fileSystem: ProjectToolFileSystem = options.fileSystem ?? fs;
  const now = options.now ?? (() => new Date().toISOString());
  const ids = options.ids ?? { toolResultId: () => `tool-result:${crypto.randomUUID()}` };
  const context = { ...options, fileSystem, now, ids };
  const executors: Record<string, SingleProjectToolExecutor> = {
    read_file: createReadFileExecutor(context),
    list_directory: createListDirectoryExecutor(context),
    glob: createGlobExecutor(context),
    search_text: createSearchTextExecutor(context),
    edit_file: createEditFileExecutor(context),
    write_file: createWriteFileExecutor(context),
    run_command: createRunCommandExecutor(context),
  };

  return {
    sourceId: 'built_in',
    sourceKind: 'built_in',
    async executeToolExecution(toolExecution, scope) {
      try {
        if (toolExecution.sourceId !== 'built_in' || toolExecution.namespace !== 'megumi') {
          throw new Error(`Unsupported built-in tool source: ${toolExecution.sourceId ?? 'unknown'}`);
        }

        const sourceToolName = String(toolExecution.sourceToolName ?? '');
        const executor = executors[sourceToolName];
        if (!executor) {
          throw new Error(`Unsupported built-in tool: ${sourceToolName || 'unknown'}`);
        }

        const execute = async () => executor.execute(toolExecution);
        if (context.workspaceChangeTracker) {
          return await context.workspaceChangeTracker.trackToolExecution({
            scope,
            toolExecution,
            execute,
          });
        }
        return await execute();
      } catch (error) {
        return createToolErrorResult(toolExecution, {
          ids,
          now,
          error,
          sourceIdentity: sourceIdentityFromRecord(toolExecution),
        });
      }
    },
    finalizeWorkspaceChangeSet(scope) {
      return context.workspaceChangeTracker?.finalizeChangeSet(scope);
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
): ToolResult {
  const error = normalizeToolError(input.error, {
    debugId: `tool-error:${toolExecution.toolExecutionId}`,
    fallbackMessage: 'Tool execution failed.',
  });
  return {
    toolResultId: input.ids.toolResultId(),
    toolCallId: toolExecution.toolCallId,
    toolExecutionId: toolExecution.toolExecutionId,
    runId: toolExecution.runId,
    kind: 'tool_error',
    textContent: error.message,
    error,
    redactionState: 'none',
    createdAt: input.now(),
    ...(input.sourceIdentity ? { metadata: { toolSourceIdentity: input.sourceIdentity } } : {}),
  };
}

function sourceIdentityFromRecord(record: Partial<ToolSourceIdentity>): ToolSourceIdentity | undefined {
  if (
    typeof record.registrySnapshotId !== 'string'
    || typeof record.snapshotEntryId !== 'string'
    || typeof record.modelVisibleName !== 'string'
    || typeof record.canonicalToolId !== 'string'
    || typeof record.sourceId !== 'string'
    || typeof record.namespace !== 'string'
    || typeof record.sourceToolName !== 'string'
  ) {
    return undefined;
  }

  return {
    registrySnapshotId: record.registrySnapshotId,
    snapshotEntryId: record.snapshotEntryId,
    modelVisibleName: record.modelVisibleName,
    canonicalToolId: record.canonicalToolId,
    sourceId: record.sourceId,
    namespace: record.namespace,
    sourceToolName: record.sourceToolName,
  };
}
