// Executes one permission-decided Tool Call through registered tools and host ports.
import type { PolicyDecision } from '../permission';
import type { WorkspaceManager } from '../workspace';
import { preflightToolCall, type ToolPreflightFailureStatus } from './preflight';
import type { ToolRegistry } from './registry';
import { createInMemoryToolExecutionRepository, type ToolExecutionRepository } from './repository';
import type { ToolAuditRecord, ToolCall, ToolExecution, ToolExecutionContext, ToolProcessHost, ToolResult } from './types';
import { toolErrorFromUnknown } from './types';

export interface ToolExecutionServiceOptions {
  registry: ToolRegistry;
  workspace: WorkspaceManager;
  processHost?: ToolProcessHost;
  executionRepository?: ToolExecutionRepository;
  now: () => string;
  createId: (prefix: string, value: string) => string;
}

export interface ToolExecutionRequestContext {
  permissionDecision?: PolicyDecision;
  approvalRequestId?: string;
}

export interface ToolExecutionService {
  execute(call: ToolCall, context: ToolExecutionRequestContext): Promise<ToolResult>;
  getAuditRecords(): Promise<ToolAuditRecord[]>;
  getExecutions(): Promise<ToolExecution[]>;
}

export function createToolExecutionService(options: ToolExecutionServiceOptions): ToolExecutionService {
  const repository = options.executionRepository ?? createInMemoryToolExecutionRepository();
  const executionContext: ToolExecutionContext = {
    workspace: options.workspace,
    ...(options.processHost ? { processHost: options.processHost } : {}),
  };

  const audit = async (call: ToolCall, result: ToolResult, decision?: PolicyDecision): Promise<ToolResult> => {
    await repository.saveAuditRecord({
      id: options.createId('tool-audit', call.id),
      toolCallId: call.id,
      toolName: call.name,
      status: result.status,
      createdAt: options.now(),
      ...(decision ? { decision } : {}),
      ...(result.status === 'error' ? { error: result.error } : {}),
    });
    return result;
  };

  return {
    async execute(call, context) {
      const preflight = preflightToolCall(call, options.registry);
      if (preflight.status !== 'ready') {
        const execution = createExecution(call, 'failed', options);
        await repository.createExecution(execution);
        return audit(call, {
          status: 'error',
          toolCallId: call.id,
          toolName: call.name,
          error: toolErrorFromPreflight(preflight.status, preflight.message),
        }, context.permissionDecision);
      }

      const decision = context.permissionDecision;
      if (!decision) {
        const execution = createExecution(call, 'failed', options);
        await repository.createExecution(execution);
        return audit(call, {
          status: 'error',
          toolCallId: call.id,
          toolName: call.name,
          error: {
            code: 'TOOL_PERMISSION_DECISION_REQUIRED',
            message: `Permission decision is required before executing ${call.name}.`,
            retryable: true,
          },
        });
      }

      if (decision.kind === 'deny') {
        const execution = createExecution(call, 'rejected', options);
        await repository.createExecution(execution);
        return audit(call, {
          status: 'rejected',
          toolCallId: call.id,
          toolName: call.name,
          decision,
          text: decision.reason,
        }, decision);
      }

      if (decision.kind === 'ask') {
        const execution = createExecution(call, 'awaiting_approval', options);
        await repository.createExecution(execution);
        return audit(call, {
          status: 'awaiting_approval',
          toolCallId: call.id,
          toolName: call.name,
          decision,
          ...(context.approvalRequestId ? { approvalRequestId: context.approvalRequestId } : {}),
          text: decision.reason,
        }, decision);
      }

      const execution = createExecution(call, 'running', options);
      await repository.createExecution(execution);
      try {
        const executor = options.registry.getExecutor(call.name);
        if (!executor) {
          throw new Error(`Missing executor for tool: ${call.name}`);
        }
        const result = await executor.execute({ ...call, input: preflight.executionInput }, executionContext);
        await repository.updateExecution({ ...execution, status: 'succeeded', endedAt: options.now() });
        return audit(call, result, decision);
      } catch (error) {
        await repository.updateExecution({ ...execution, status: 'failed', endedAt: options.now() });
        return audit(call, {
          status: 'error',
          toolCallId: call.id,
          toolName: call.name,
          error: toolErrorFromUnknown(error),
        }, decision);
      }
    },

    async getAuditRecords() {
      return repository.listAuditRecords();
    },

    async getExecutions() {
      return repository.listExecutions();
    },
  };
}

function createExecution(call: ToolCall, status: ToolExecution['status'], options: ToolExecutionServiceOptions): ToolExecution {
  const execution: ToolExecution = {
    id: options.createId('tool-execution', call.id),
    toolCallId: call.id,
    toolName: call.name,
    status,
    startedAt: options.now(),
  };
  return status === 'running' ? execution : { ...execution, endedAt: options.now() };
}

function toolErrorFromPreflight(status: ToolPreflightFailureStatus, message: string) {
  const code = status === 'invalid_tool'
    ? 'TOOL_NOT_FOUND'
    : status === 'invalid_input'
      ? 'TOOL_INPUT_INVALID'
      : 'TOOL_PREFLIGHT_FAILED';
  return {
    code,
    message,
    retryable: false,
  };
}
