/* Resolves registered Tool Call facts into normalized permission operations. */
import type { EvaluateToolCallRequest, PermissionOperation } from '../contracts/permission-contracts';

const PATH_ACTIONS: Record<string, 'workspace.read' | 'workspace.write'> = {
  read_file: 'workspace.read', list_directory: 'workspace.read', glob: 'workspace.read', search_text: 'workspace.read',
  write_file: 'workspace.write', edit_file: 'workspace.write',
};

export function resolvePermissionOperations(request: EvaluateToolCallRequest): PermissionOperation[] {
  const name = request.registered_tool.registered_tool_name;
  const context: PermissionOperation['context'] = {
    workspace_id: request.workspace_id, session_id: request.session_id, run_id: request.run_id,
    tool_identity: request.registered_tool,
  };
  const pathAction = PATH_ACTIONS[name];
  if (pathAction) {
    // Rules inside a Workspace use stable Workspace-relative identities (for
    // example `docs/**`). Targets outside the boundary retain their absolute
    // identity so an approval never disguises which external path is involved.
    const id = request.workspace_path
      ? (request.workspace_path.inside_workspace
          ? request.workspace_path.workspace_path
          : request.workspace_path.absolute_path)
      : readString(request.tool_input, ['path', 'target_path', 'workspace_path']);
    return [{ action: pathAction, resource: { type: 'workspace.path', ...(id ? { id } : {}) }, context }];
  }
  if (name === 'run_command') {
    const command = readString(request.tool_input, ['command']);
    return [{ action: 'process.execute', resource: { type: 'process.command', ...(command ? { id: normalizeCommand(command) } : {}) }, context }];
  }
  if (name === 'web_search') return [{ action: 'network.search', resource: { type: 'network.public_web' }, context }];
  if (name === 'web_fetch') {
    const url = normalizeUrl(readString(request.tool_input, ['url']));
    return [{
      action: 'network.fetch',
      resource: {
        type: 'network.url',
        ...(url ? { id: url.id, attributes: { hostname: url.hostname } } : {}),
      },
      context,
    }];
  }
  if (name === 'use_skill') return [{ action: 'agent.context.activate', context }];
  const stableId = `${request.registered_tool.source_id}/${request.registered_tool.namespace}/${request.registered_tool.source_tool_name}`;
  return [{ action: 'external.invoke', resource: { type: 'tool.identity', id: stableId }, context }];
}

function readString(input: unknown, fields: string[]): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  for (const field of fields) {
    const value = (input as Record<string, unknown>)[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function normalizeCommand(command: string): string { return command.trim().replace(/\s+/g, ' '); }

function normalizeUrl(value: string | undefined): { id: string; hostname: string } | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return { id: url.toString(), hostname: url.hostname.toLowerCase() };
  } catch {
    return undefined;
  }
}
