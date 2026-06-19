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
  runId?: string;
  sessionId?: string;
  workspaceId?: string;
  turnIndex?: number;
}

export interface ToolExecutionService {
  execute(call: ToolCall, context: ToolExecutionRequestContext): Promise<ToolResult>;
  getAuditRecords(): Promise<ToolAuditRecord[]>;
  getExecutions(): Promise<ToolExecution[]>;
}

export function createToolExecutionService(options: ToolExecutionServiceOptions): ToolExecutionService {
  const repository = options.executionRepository ?? createInMemoryToolExecutionRepository();
  let auditSequence = 0;
  const executionContext: ToolExecutionContext = {
    workspace: options.workspace,
    ...(options.processHost ? { processHost: options.processHost } : {}),
  };

  const audit = async (
    call: ToolCall,
    result: ToolResult,
    context: ToolExecutionRequestContext,
    decision?: PolicyDecision,
  ): Promise<ToolResult> => {
    await repository.saveAuditRecord({
      id: options.createId('tool-audit', `${call.id}-${auditSequence += 1}`),
      toolCallId: call.id,
      toolName: call.name,
      status: result.status,
      ...(context.runId ? { runId: context.runId } : {}),
      ...(context.sessionId ? { sessionId: context.sessionId } : {}),
      ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
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
        const execution = createExecution(call, 'failed', options, context);
        await repository.createExecution(execution);
        return audit(call, {
          status: 'error',
          toolCallId: call.id,
          toolName: call.name,
          error: toolErrorFromPreflight(preflight.status, preflight.message),
        }, context, context.permissionDecision);
      }

      const decision = context.permissionDecision;
      if (!decision) {
        const execution = createExecution(call, 'failed', options, context);
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
        }, context);
      }

      if (decision.kind === 'deny') {
        const execution = createExecution(call, 'rejected', options, context);
        await repository.createExecution(execution);
        return audit(call, {
          status: 'rejected',
          toolCallId: call.id,
          toolName: call.name,
          decision,
          text: decision.reason,
        }, context, decision);
      }

      if (decision.kind === 'ask') {
        const execution = createExecution(call, 'awaiting_approval', options, context);
        await repository.createExecution(execution);
        return audit(call, {
          status: 'awaiting_approval',
          toolCallId: call.id,
          toolName: call.name,
          decision,
          ...(context.approvalRequestId ? { approvalRequestId: context.approvalRequestId } : {}),
          text: decision.reason,
        }, context, decision);
      }

      const execution = createExecution(call, 'running', options, context);
      await repository.createExecution(execution);
      const tracksWorkspaceChanges = preflight.executionConstraint.mutation === 'mutation';
      try {
        const executor = options.registry.getExecutor(call.name);
        if (!executor) {
          throw new Error(`Missing executor for tool: ${call.name}`);
        }
        if (tracksWorkspaceChanges) {
          options.workspace.beginChangeSet({
            sessionId: context.sessionId,
            runId: context.runId,
            toolCallId: call.id,
            toolExecutionId: execution.id,
          });
        }
        const result = await executor.execute({ ...call, input: preflight.executionInput }, executionContext);
        const workspaceChangeSet = tracksWorkspaceChanges ? await options.workspace.finalizeActiveChangeSet() : undefined;
        await repository.updateExecution({
          ...execution,
          status: statusFromToolResult(result),
          endedAt: options.now(),
          ...(workspaceChangeSet ? { workspaceChangeSetId: String(workspaceChangeSet.id) } : {}),
        });
        return audit(call, result, context, decision);
      } catch (error) {
        const workspaceChangeSet = await finalizeFailedWorkspaceChangeSet(options.workspace, tracksWorkspaceChanges);
        await repository.updateExecution({
          ...execution,
          status: 'failed',
          endedAt: options.now(),
          ...(workspaceChangeSet ? { workspaceChangeSetId: String(workspaceChangeSet.id) } : {}),
        });
        return audit(call, {
          status: 'error',
          toolCallId: call.id,
          toolName: call.name,
          error: toolErrorFromUnknown(error),
        }, context, decision);
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

async function finalizeFailedWorkspaceChangeSet(workspace: WorkspaceManager, tracksWorkspaceChanges: boolean) {
  if (!tracksWorkspaceChanges) return undefined;
  const activeChangeSet = workspace.getActiveChangeSet();
  if (activeChangeSet.changes.length === 0) return undefined;
  return workspace.finalizeActiveChangeSet();
}

function statusFromToolResult(result: ToolResult): ToolExecution['status'] {
  if (result.status === 'success') return 'succeeded';
  if (result.status === 'error') return 'failed';
  if (result.status === 'rejected') return 'rejected';
  return 'awaiting_approval';
}

function createExecution(
  call: ToolCall,
  status: ToolExecution['status'],
  options: ToolExecutionServiceOptions,
  context: ToolExecutionRequestContext,
): ToolExecution {
  const execution: ToolExecution = {
    id: options.createId('tool-execution', call.id),
    toolCallId: call.id,
    toolName: call.name,
    status,
    ...(context.runId ? { runId: context.runId } : {}),
    ...(context.sessionId ? { sessionId: context.sessionId } : {}),
    ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
    ...(context.turnIndex !== undefined ? { turnIndex: context.turnIndex } : {}),
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
