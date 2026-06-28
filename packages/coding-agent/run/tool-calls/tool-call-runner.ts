// Owns run-time tool call orchestration for a Coding Agent turn.
// It delegates approval, execution, and continuation details to the matching tool-calls submodules.
import {
  createRejectionObservation,
} from '../../tools/observations';
import { resolveToolCallFromSnapshot } from '../../tools/registry';
import { validateToolInput } from '../../tools/schemas';
import type {
  PendingToolApproval,
  HandleToolCallsInput,
  ResumeToolApprovalInput,
  ResumeToolApprovalOutcome,
  ToolApprovalResumePort,
  ToolCallRunOutcome,
  ToolCallRunner,
} from './tool-call-contract';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { MergedPermissionSettings } from '@megumi/shared/permission';
import type { PermissionMode } from '@megumi/shared/permission';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type {
  ApprovalRequest,
  PermissionDecision,
  SnapshotToolEntry,
  ToolCall,
  ToolDefinition,
  ToolExecutionDecision,
  ToolExecutionRecord,
  ToolRegistrySnapshot,
  ToolResult,
} from '@megumi/shared/tool';
import {
  evaluateToolExecutionDecision,
  type ToolExecutionDecisionInput,
} from '../../permissions/tool-execution-decision';
import { resumeToolApproval } from './approval/approval-resume';
import { applyDecisionsToCreated, inferredDefinitionFields } from './approval/tool-call-approval';
import { advanceExecutionWindows } from './execution/tool-execution-window';
import { outcomeFromRecords } from './continuation/tool-result-continuation';
import type {
  CodingAgentToolExecutionHostPort,
  CodingAgentToolExecutionRunOptions,
} from '../../tools/tool-execution-host-port';

export interface ToolCallRunnerOutcome extends ToolCallRunOutcome {
  assistantMessageId: string;
  toolResults: readonly ToolResult[];
  pendingApprovals: readonly PendingToolApproval[];
  runtimeEvents: readonly RuntimeEvent[];
  continuationReady: boolean;
}

export interface ToolApprovalResumeRunnerOutcome extends ResumeToolApprovalOutcome {
  assistantMessageId: string;
  toolResults: readonly ToolResult[];
  pendingApprovals: readonly PendingToolApproval[];
  runtimeEvents: readonly RuntimeEvent[];
  continuationReady: boolean;
}

export interface ToolCallRunnerService extends ToolCallRunner, ToolApprovalResumePort {
  handleToolCalls(input: HandleToolCallsInput): Promise<ToolCallRunnerOutcome>;
  resumeToolApproval(input: ResumeToolApprovalInput): Promise<ToolApprovalResumeRunnerOutcome | undefined>;
}

export interface ToolCallRepositoryPort {
  saveToolCall(toolCall: ToolCall): ToolCall;
  getToolCall(toolCallId: string): ToolCall | undefined;
  saveToolExecution(toolExecution: ToolExecutionRecord): ToolExecutionRecord;
  getToolExecution(toolExecutionId: string): ToolExecutionRecord | undefined;
  getToolExecutionByToolCallId(input: {
    runId: string;
    assistantMessageId: string;
    toolCallId: string;
  }): ToolExecutionRecord | undefined;
  listToolExecutionsByAssistantMessage(input: {
    runId: string;
    assistantMessageId: string;
  }): ToolExecutionRecord[];
  savePermissionDecision(permissionDecision: PermissionDecision): PermissionDecision;
  saveApprovalRequest(approvalRequest: ApprovalRequest): ApprovalRequest;
  getApprovalRequest(approvalRequestId: string): ApprovalRequest | undefined;
  saveToolResult(toolResult: ToolResult): ToolResult;
  getToolRegistrySnapshotByRun(runId: string): ToolRegistrySnapshot | undefined;
  getRunSessionId(runId: string): string | undefined;
}

export interface ToolCallRunnerOptions {
  registry?: unknown;
  repository: ToolCallRepositoryPort;
  permissionMode: PermissionMode;
  projectRoot: string;
  settings: MergedPermissionSettings;
  toolExecutionRouter: CodingAgentToolExecutionHostPort;
  now?: () => string;
  ids?: {
    toolExecutionId(): string;
    toolResultId(): string;
    permissionDecisionId(): string;
    approvalRequestId(): string;
    rawToolResultId(): string;
    observationId(): string;
    eventId?(): string;
  };
  runtimeCapabilityPolicy?: ToolExecutionDecisionInput['runtimeCapabilityPolicy'];
  decisionEvaluator?: {
    evaluate(input: ToolExecutionDecisionInput): ToolExecutionDecision;
  };
}

export interface ResolvedToolCallRunnerOptions extends ToolCallRunnerOptions {
  now: () => string;
  ids: NonNullable<ToolCallRunnerOptions['ids']>;
  runtimeCapabilityPolicy: ToolExecutionDecisionInput['runtimeCapabilityPolicy'];
  decisionEvaluator: NonNullable<ToolCallRunnerOptions['decisionEvaluator']>;
}

export function createToolCallRunner(
  options: ToolCallRunnerOptions,
): ToolCallRunnerService {
  const resolved = resolveOptions(options);

  return {
    async handleToolCalls(input) {
      const assistantMessageId = String(input.request.modelStepId);
      await prepareRecords(resolved, input);
      await applyDecisionsToCreated(resolved, {
        runId: String(input.request.runId),
        assistantMessageId,
      });
      const records = await advanceExecutionWindows(resolved, {
        runId: String(input.request.runId),
        assistantMessageId,
        executionOptions: executionOptionsFromRequest(input.request, input.signal),
      });
      return outcomeFromRecords(resolved, assistantMessageId, records, resolved.now());
    },
    async resumeToolApproval(input) {
      return resumeToolApproval(resolved, input);
    },
  };
}


async function prepareRecords(
  options: ResolvedToolCallRunnerOptions,
  input: HandleToolCallsInput,
): Promise<ToolExecutionRecord[]> {
  const assistantMessageId = String(input.request.modelStepId);
  const snapshot = options.repository.getToolRegistrySnapshotByRun(String(input.request.runId));

  for (const [index, toolCall] of input.toolCalls.entries()) {
    const existing = options.repository.getToolExecutionByToolCallId({
      runId: String(input.request.runId),
      assistantMessageId,
      toolCallId: String(toolCall.toolCallId),
    });
    if (existing) {
      continue;
    }

    const resolution = snapshot ? resolveToolCallFromSnapshot(snapshot, toolCall.toolName) : undefined;
    const hasInlineIdentity = Boolean(toolCall.sourceId && toolCall.namespace && toolCall.sourceToolName);
    const resolvedToolCall = resolution?.ok
      ? { ...toolCall, ...resolution.sourceIdentity, toolName: resolution.definition.name }
      : toolCall;
    options.repository.saveToolCall({
      ...resolvedToolCall,
      status: resolution?.ok || hasInlineIdentity ? 'validated' : 'failed',
      ...(resolution?.ok || hasInlineIdentity ? {} : { completedAt: options.now() }),
    });

    const definition = resolution?.ok ? resolution.definition : undefined;
    if (definition) {
      const validation = validateToolInput(definition, toolCall.input);
      if (!validation.ok) {
        const failed = createRejectedRecord(options, input.request, toolCall, index, {
          reason: validation.errorMessage,
          reasonCode: 'INVALID_ARGUMENTS',
        });
        options.repository.saveToolExecution(failed);
        continue;
      }
    }

    const record = resolution?.ok
      ? recordFromResolvedCall(options, input.request, resolvedToolCall, index, resolution.entry, resolution.definition)
      : hasInlineIdentity
        ? recordFromInlineToolCall(options, input.request, toolCall, index)
        : createRejectedRecord(options, input.request, toolCall, index, {
        reason: resolution?.message ?? `Unknown tool: ${toolCall.toolName}`,
        reasonCode: 'TOOL_NOT_FOUND',
      });
    options.repository.saveToolExecution(record);
  }

  return options.repository.listToolExecutionsByAssistantMessage({
    runId: String(input.request.runId),
    assistantMessageId,
  });
}

function recordFromInlineToolCall(
  options: ResolvedToolCallRunnerOptions,
  request: ModelStepRuntimeRequest,
  toolCall: ToolCall,
  callOrder: number,
): ToolExecutionRecord {
  const inferred = inferredDefinitionFields(toolCall.toolName);
  return {
    toolExecutionId: options.ids.toolExecutionId(),
    toolCallId: toolCall.toolCallId,
    runId: request.runId,
    stepId: request.stepId,
    assistantMessageId: String(request.modelStepId),
    callOrder: toolCall.callOrder ?? callOrder,
    toolName: toolCall.toolName,
    registrySnapshotId: toolCall.registrySnapshotId,
    snapshotEntryId: toolCall.snapshotEntryId,
    modelVisibleName: toolCall.modelVisibleName,
    canonicalToolId: toolCall.canonicalToolId,
    sourceId: toolCall.sourceId,
    namespace: toolCall.namespace,
    sourceToolName: toolCall.sourceToolName,
    input: toolCall.input,
    inputPreview: toolCall.inputPreview,
    capabilities: inferred.capabilities,
    riskLevel: inferred.riskLevel,
    sideEffect: inferred.sideEffect,
    status: 'created',
    requestedAt: options.now(),
    continuationEmitted: false,
    metadata: {
      providerToolCallId: toolCall.providerToolCallId,
    },
  };
}

function executionOptionsFromRequest(
  request: ModelStepRuntimeRequest,
  signal?: AbortSignal,
): CodingAgentToolExecutionRunOptions {
  return {
    scope: {
      sessionId: String(request.sessionId),
      runId: String(request.runId),
      stepId: String(request.stepId),
    },
    ...(signal ? { signal } : {}),
  };
}

function recordFromResolvedCall(
  options: ResolvedToolCallRunnerOptions,
  request: ModelStepRuntimeRequest,
  toolCall: ToolCall,
  callOrder: number,
  snapshotEntry: SnapshotToolEntry,
  definition: ToolDefinition,
): ToolExecutionRecord {
  return {
    toolExecutionId: options.ids.toolExecutionId(),
    toolCallId: toolCall.toolCallId,
    runId: request.runId,
    stepId: request.stepId,
    assistantMessageId: String(request.modelStepId),
    callOrder: toolCall.callOrder ?? callOrder,
    toolName: definition.name,
    registrySnapshotId: snapshotEntry.snapshotId,
    snapshotEntryId: snapshotEntry.snapshotEntryId,
    modelVisibleName: snapshotEntry.modelVisibleName,
    canonicalToolId: snapshotEntry.canonicalToolId,
    sourceId: snapshotEntry.sourceId,
    namespace: snapshotEntry.namespace,
    sourceToolName: snapshotEntry.sourceToolName,
    input: toolCall.input,
    inputPreview: toolCall.inputPreview,
    capabilities: definition.capabilities,
    riskLevel: definition.riskLevel,
    sideEffect: definition.sideEffect,
    status: 'created',
    requestedAt: options.now(),
    continuationEmitted: false,
    metadata: {
      providerToolCallId: toolCall.providerToolCallId,
    },
  };
}

function createRejectedRecord(
  options: ResolvedToolCallRunnerOptions,
  request: ModelStepRuntimeRequest,
  toolCall: ToolCall,
  callOrder: number,
  input: {
    reason: string;
    reasonCode: ToolExecutionDecision['reasonCode'];
  },
): ToolExecutionRecord {
  const base: ToolExecutionRecord = {
    toolExecutionId: options.ids.toolExecutionId(),
    toolCallId: toolCall.toolCallId,
    runId: request.runId,
    stepId: request.stepId,
    assistantMessageId: String(request.modelStepId),
    callOrder,
    toolName: toolCall.toolName,
    input: toolCall.input,
    inputPreview: toolCall.inputPreview,
    status: 'created',
    requestedAt: options.now(),
    continuationEmitted: false,
  };
  const decision: ToolExecutionDecision = {
    outcome: 'reject',
    reasonCode: input.reasonCode,
    reason: input.reason,
    executionClass: 'unknown',
    executionMode: 'serial',
  };
  const observation = createRejectionObservation({
    record: base,
    decision,
    ids: options.ids,
    now: options.now,
  });
  return {
    ...base,
    decision,
    executionMode: 'serial',
    status: 'rejected',
    completedAt: observation.createdAt,
    observation,
    resultPreview: observation.content.slice(0, 500),
  };
}

function resolveOptions(options: ToolCallRunnerOptions): ResolvedToolCallRunnerOptions {
  return {
    ...options,
    now: options.now ?? (() => new Date().toISOString()),
    ids: options.ids ?? {
      toolExecutionId: () => `tool-execution:${crypto.randomUUID()}`,
      toolResultId: () => `tool-result:${crypto.randomUUID()}`,
      permissionDecisionId: () => `permission-decision:${crypto.randomUUID()}`,
      approvalRequestId: () => `approval-request:${crypto.randomUUID()}`,
      rawToolResultId: () => `raw-tool-result:${crypto.randomUUID()}`,
      observationId: () => `tool-observation:${crypto.randomUUID()}`,
    },
    runtimeCapabilityPolicy: options.runtimeCapabilityPolicy ?? {
      customToolsEnabled: true,
      processExecutionEnabled: true,
    },
    decisionEvaluator: options.decisionEvaluator ?? {
      evaluate: evaluateToolExecutionDecision,
    },
  };
}
