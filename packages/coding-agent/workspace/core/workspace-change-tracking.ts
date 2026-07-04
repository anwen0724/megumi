/*
 * Pure Workspace change tracking helpers. They classify managed mutation tools
 * and derive persisted file change facts without reading file content.
 */
import type {
  WorkspaceChangeKind,
  WorkspaceToolExecution,
} from '../contracts/workspace-change-contracts';

export type ManagedWorkspaceMutation =
  | { status: 'managed'; workspace_path_input: string; mutation_kind: 'write' | 'edit' }
  | { status: 'unmanaged' };

export function getManagedWorkspaceMutation(tool_execution: WorkspaceToolExecution): ManagedWorkspaceMutation {
  if (
    tool_execution.tool_name !== 'write_file'
    && tool_execution.tool_name !== 'edit_file'
  ) {
    return { status: 'unmanaged' };
  }

  if (!tool_execution.input || typeof tool_execution.input !== 'object' || Array.isArray(tool_execution.input)) {
    return { status: 'unmanaged' };
  }

  const pathInput = (tool_execution.input as Record<string, unknown>).path;
  if (typeof pathInput !== 'string') {
    return { status: 'unmanaged' };
  }

  return {
    status: 'managed',
    workspace_path_input: pathInput,
    mutation_kind: mutationKindForTool(tool_execution.tool_name),
  };
}

export function resolveChangeKind(input: {
  mutation_kind: 'write' | 'edit';
  existed_before: boolean;
  exists_after: boolean;
}): WorkspaceChangeKind | undefined {
  if (!input.existed_before && input.exists_after) {
    return 'created';
  }

  if (input.existed_before && input.exists_after) {
    return 'modified';
  }

  return undefined;
}

function mutationKindForTool(tool_name: string): 'write' | 'edit' {
  return tool_name === 'edit_file' ? 'edit' : 'write';
}
