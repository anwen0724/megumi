import fs from 'fs-extra';
import { normalizeToolError } from '@megumi/tools/normalization';
import type { ToolCall, ToolResult } from '@megumi/shared/tool-contracts';
import {
  createEditFileExecutor,
  createGlobExecutor,
  createListDirectoryExecutor,
  createReadFileExecutor,
  createSearchTextExecutor,
  createWriteFileExecutor,
  type ProjectToolFileSystem,
  type ProjectToolExecutorOptions,
  type SingleProjectToolExecutor,
} from './tool-executors';

export type { ProjectToolFileSystem, ProjectToolExecutorOptions } from './tool-executors';

export interface ProjectToolExecutor {
  executeToolCall(toolCall: ToolCall): Promise<ToolResult>;
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
  };

  return {
    async executeToolCall(toolCall) {
      try {
        const executor = executors[toolCall.toolName];
        if (executor) {
          return await executor.execute(toolCall);
        }
        throw new Error(`Unsupported project tool: ${toolCall.toolName}`);
      } catch (error) {
        return {
          toolResultId: ids.toolResultId(),
          toolUseId: toolCall.toolUseId,
          toolCallId: toolCall.toolCallId,
          runId: toolCall.runId,
          kind: 'tool_error',
          textContent: error instanceof Error ? error.message : 'Tool execution failed.',
          error: normalizeToolError(error, {
            debugId: `tool-error:${toolCall.toolCallId}`,
            fallbackMessage: 'Tool execution failed.',
          }),
          redactionState: 'none',
          createdAt: now(),
        };
      }
    },
  };
}
