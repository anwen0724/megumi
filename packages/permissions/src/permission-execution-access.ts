/* Resolves the minimum executable file, process, and network scope for an allowed ToolCall. */
import { z } from 'zod';
import type { ToolExecutionAccess } from '@megumi/sandbox';
import type { EvaluateToolCallRequest, PermissionOperation } from './permission-operation';

export const ToolExecutionAccessSchema: z.ZodType<ToolExecutionAccess> = z.object({
  fileSystem: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('workspace') }).strict(),
    z.object({
      mode: z.literal('workspace_and_paths'),
      readablePaths: z.array(z.string().min(1)),
      writablePaths: z.array(z.string().min(1)),
    }).strict(),
    z.object({ mode: z.literal('unrestricted') }).strict(),
  ]),
  process: z.enum(['sandboxed', 'unrestricted']),
  network: z.enum(['denied', 'unrestricted']),
}).strict();

export function executionAccessFor(request: {
  readonly permissionMode: EvaluateToolCallRequest['permissionMode'];
  readonly operations: readonly PermissionOperation[];
  readonly approved?: boolean;
}): ToolExecutionAccess {
  if (request.permissionMode === 'full_access') {
    return {
      fileSystem: { mode: 'unrestricted' },
      process: 'unrestricted',
      network: 'unrestricted',
    };
  }

  const executesProcess = request.operations.some((operation) => operation.action === 'process.execute');
  if (request.approved === true && executesProcess) {
    return {
      fileSystem: { mode: 'unrestricted' },
      process: 'unrestricted',
      network: 'unrestricted',
    };
  }

  const readablePaths: string[] = [];
  const writablePaths: string[] = [];
  for (const operation of request.operations) {
    if ((operation.action !== 'workspace.read' && operation.action !== 'workspace.write')
      || operation.resource?.type !== 'workspace.path'
      || operation.resource.attributes?.insideWorkspace !== false
      || !operation.resource.id) continue;
    (operation.action === 'workspace.read' ? readablePaths : writablePaths).push(operation.resource.id);
  }
  const hasExternalPaths = readablePaths.length > 0 || writablePaths.length > 0;
  const needsNetwork = request.operations.some((operation) => (
    operation.action === 'network.fetch' || operation.action === 'network.search'
  ));
  return {
    fileSystem: hasExternalPaths
      ? {
          mode: 'workspace_and_paths',
          readablePaths: [...new Set(readablePaths)].sort(),
          writablePaths: [...new Set(writablePaths)].sort(),
        }
      : { mode: 'workspace' },
    process: 'sandboxed',
    network: needsNetwork ? 'unrestricted' : 'denied',
  };
}
