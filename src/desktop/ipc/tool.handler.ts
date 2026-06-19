// Handles renderer tool queries by projecting tools-owned facts without executing tools.
import { mapToolDefinition, mapToolExecutionDetail } from '../mappers/productization.mapper';
import type { DesktopIpcContext } from './ipc-context';
import { unavailable } from './ipc-errors';

export async function handleToolOperation(operation: string, payload: unknown, context: DesktopIpcContext): Promise<unknown> {
  if (operation === 'tool.list') {
    const runtime = requireRuntime(context, operation);
    return { tools: runtime.toolRegistry.list().map(mapToolDefinition) };
  }
  if (operation === 'tool.execution.get') {
    const runtime = requireRuntime(context, operation);
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const executionId = typeof record.executionId === 'string' ? record.executionId : undefined;
    const toolCallId = typeof record.toolCallId === 'string' ? record.toolCallId : undefined;
    const execution = executionId
      ? await runtime.toolExecutionRepository.getExecution(executionId)
      : (await runtime.toolExecutionRepository.listExecutions({ toolCallId })).at(-1);
    if (!execution) throw unavailable(operation, 'tool execution was not found');
    const auditRecords = await runtime.toolExecutionRepository.listAuditRecords({ toolCallId: execution.toolCallId });
    return mapToolExecutionDetail(execution, auditRecords);
  }
  return undefined;
}

function requireRuntime(context: DesktopIpcContext, operation: string) {
  if (!context.runtime) throw unavailable(operation, 'desktop runtime services are not attached to IPC context');
  return context.runtime;
}
