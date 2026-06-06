import fs from 'fs-extra';
import { normalizeToolError } from '@megumi/tools/normalization';
import type { ToolExecution, ToolResult } from '@megumi/shared/tool-contracts';
import type { WorkspaceChangeExecutionScope } from './workspace-change-tracker.service';
import {
  createEditFileExecutor,
  createGlobExecutor,
  createListDirectoryExecutor,
  createReadFileExecutor,
  createRunCommandExecutor,
  createSearchTextExecutor,
  createWriteFileExecutor,
  type ProjectToolFileSystem,
  type ProjectToolExecutorOptions,
  type SingleProjectToolExecutor,
} from './tool-executors';

export type { ProjectToolFileSystem, ProjectToolExecutorOptions } from './tool-executors';

export interface ProjectToolExecutor {
  executeToolExecution(
    toolExecution: ToolExecution,
    scope?: WorkspaceChangeExecutionScope,
  ): Promise<ToolResult>;
  finalizeWorkspaceChangeSet?(scope: WorkspaceChangeExecutionScope): unknown;
}

export function createProjectToolExecutor(options: ProjectToolExecutorOptions): ProjectToolExecutor {
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
    async executeToolExecution(toolExecution, scope) {
      try {
        const executor = executors[toolExecution.toolName];
        if (executor) {
          const execute = async () => executor.execute(toolExecution);
          if (context.workspaceChangeTracker) {
            return await context.workspaceChangeTracker.trackToolExecution({
              scope,
              toolExecution,
              execute,
            });
          }
          return await execute();
        }
        throw new Error(`Unsupported project tool: ${toolExecution.toolName}`);
      } catch (error) {
        return {
          toolResultId: ids.toolResultId(),
          toolCallId: toolExecution.toolCallId,
          toolExecutionId: toolExecution.toolExecutionId,
          runId: toolExecution.runId,
          kind: 'tool_error',
          textContent: error instanceof Error ? error.message : 'Tool execution failed.',
          error: normalizeToolError(error, {
            debugId: `tool-error:${toolExecution.toolExecutionId}`,
            fallbackMessage: 'Tool execution failed.',
          }),
          redactionState: 'none',
          createdAt: now(),
        };
      }
    },
    finalizeWorkspaceChangeSet(scope) {
      return context.workspaceChangeTracker?.finalizeChangeSet(scope);
    },
  };
}
