// Coordinates durable tool execution records for agent-loop tool calls.
import { evaluatePermissionPolicy } from '@megumi/security/tool-policy';
import {
  createObservationFromRawToolResult,
  createRawToolResultFromContent,
  createRejectionObservation,
  normalizeToolError,
} from '@megumi/tools';
import {
  modelVisibleDefinitionForSnapshotEntry,
  resolveToolCallFromSnapshot,
} from '@megumi/tools/registry';
import { validateToolInput } from '@megumi/tools/validation';
import type {
  PendingToolApproval,
  ToolApprovalResumeInput,
  ToolApprovalResumeOutcome,
  ToolApprovalResumePort,
  ToolCallHandlerOutcome,
  ToolCallHandlerPort,
} from '@megumi/core/agent-runtime';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { MergedPermissionSettings } from '@megumi/shared/permission';
import type { PermissionMode } from '@megumi/shared/permission';
import { createRuntimeEvent, type RuntimeEvent } from '@megumi/shared/runtime';
import type {
  ApprovalRequest,
  PermissionDecision,
  RawToolResult,
  SnapshotToolEntry,
  ToolCall,
  ToolDefinition,
  ToolExecutionDecision,
  ToolExecutionRecord,
  ToolObservationBudgetProfile,
  ToolRegistrySnapshot,
  ToolResult,
} from '@megumi/shared/tool';
import {
  evaluateToolExecutionDecision,
  type ToolExecutionDecisionInput,
} from './tool-execution-decision.service';
import type { ToolExecutionRouter, ToolExecutionRunOptions } from './tool-execution-router.service';

export interface ToolOrchestratorHandleInput {
  request: ModelStepRuntimeRequest;
  toolCalls: readonly ToolCall[];
  signal?: AbortSignal;
}

export interface ToolOrchestratorOutcome extends ToolCallHandlerOutcome {
  assistantMessageId: string;
  toolResults: readonly ToolResult[];
  pendingApprovals: readonly PendingToolApproval[];
  runtimeEvents: readonly RuntimeEvent[];
  continuationReady: boolean;
}

export interface ToolOrchestratorResumeOutcome extends ToolApprovalResumeOutcome {
  assistantMessageId: string;
  toolResults: readonly ToolResult[];
  pendingApprovals: readonly PendingToolApproval[];
  runtimeEvents: readonly RuntimeEvent[];
  continuationReady: boolean;
}

export interface ToolOrchestratorService extends ToolCallHandlerPort, ToolApprovalResumePort {
  handleToolCalls(input: ToolOrchestratorHandleInput): Promise<ToolOrchestratorOutcome>;
  resumeToolApproval(input: ToolApprovalResumeInput): Promise<ToolOrchestratorResumeOutcome | undefined>;
}

export interface ToolOrchestratorRepositoryPort {
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

export interface ToolOrchestratorServiceOptions {
  registry?: unknown;
  repository: ToolOrchestratorRepositoryPort;
  permissionMode: PermissionMode;
  projectRoot: string;
  settings: MergedPermissionSettings;
  toolExecutionRouter: ToolExecutionRouter;
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

interface ResolvedToolOrchestratorOptions extends ToolOrchestratorServiceOptions {
  now: () => string;
  ids: NonNullable<ToolOrchestratorServiceOptions['ids']>;
  runtimeCapabilityPolicy: ToolExecutionDecisionInput['runtimeCapabilityPolicy'];
  decisionEvaluator: NonNullable<ToolOrchestratorServiceOptions['decisionEvaluator']>;
}

export function createToolOrchestratorService(
  options: ToolOrchestratorServiceOptions,
): ToolOrchestratorService {
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

async function resumeToolApproval(
  options: ResolvedToolOrchestratorOptions,
  input: ToolApprovalResumeInput,
): Promise<ToolOrchestratorResumeOutcome | undefined> {
  const approval = options.repository.getApprovalRequest(input.approvalRequestId);
  if (!approval) {
    return undefined;
  }
  const approvedRecord = options.repository.getToolExecution(approval.toolExecutionId);
  if (!approvedRecord) {
    return undefined;
  }
  const previouslyTerminalIds = new Set(
    options.repository.listToolExecutionsByAssistantMessage({
      runId: String(approvedRecord.runId),
      assistantMessageId: approvedRecord.assistantMessageId ?? String(approvedRecord.stepId),
    })
      .filter((record) => isContinuationTerminal(record.status))
      .map((record) => String(record.toolExecutionId)),
  );

  options.repository.saveApprovalRequest({
    ...approval,
    status: input.decision,
    resolvedAt: input.decidedAt,
  });

  if (input.decision === 'denied') {
    const decision = approvedRecord.decision ?? {
      outcome: 'reject',
      reasonCode: 'CUSTOM_TOOL_REJECTED',
      reason: input.reason ?? 'User rejected the requested tool execution.',
      executionClass: 'unknown',
      executionMode: approvedRecord.executionMode ?? 'serial',
    } satisfies ToolExecutionDecision;
    const observation = createRejectionObservation({
      record: approvedRecord,
      decision: {
        ...decision,
        outcome: 'reject',
        reason: input.reason ?? decision.reason,
      },
      ids: options.ids,
      now: () => input.decidedAt,
    });
    options.repository.saveToolExecution({
      ...approvedRecord,
      decision: {
        ...decision,
        outcome: 'reject',
        reason: input.reason ?? decision.reason,
      },
      status: 'rejected',
      completedAt: input.decidedAt,
      observation,
      resultPreview: observation.content.slice(0, 500),
    });
  } else {
    options.repository.saveToolExecution({
      ...approvedRecord,
      status: 'queued',
      startedAt: undefined,
      executionMode: approvedRecord.executionMode ?? approvedRecord.decision?.executionMode ?? 'serial',
    });
  }

  const assistantMessageId = approvedRecord.assistantMessageId ?? String(approvedRecord.stepId);
  await applyDecisionsToCreated(options, {
    runId: String(approvedRecord.runId),
    assistantMessageId,
  });
  const records = await advanceExecutionWindows(options, {
    runId: String(approvedRecord.runId),
    assistantMessageId,
    executionOptions: executionOptionsFromRecord(options, approvedRecord),
  });
  const changedToolExecutionIds = new Set(
    records
      .filter((record) => {
        if (String(record.toolExecutionId) === String(approvedRecord.toolExecutionId)) {
          return true;
        }
        return isContinuationTerminal(record.status)
          && !previouslyTerminalIds.has(String(record.toolExecutionId));
      })
      .map((record) => String(record.toolExecutionId)),
  );
  return outcomeFromRecords(options, assistantMessageId, records, input.decidedAt, {
    includeToolExecutionIds: changedToolExecutionIds,
  });
}

async function prepareRecords(
  options: ResolvedToolOrchestratorOptions,
  input: ToolOrchestratorHandleInput,
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
  options: ResolvedToolOrchestratorOptions,
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

async function applyDecisionsToCreated(
  options: ResolvedToolOrchestratorOptions,
  input: { runId: string; assistantMessageId: string },
): Promise<void> {
  const records = options.repository.listToolExecutionsByAssistantMessage(input);
  for (const record of records) {
    if (record.status !== 'created' || record.decision) {
      continue;
    }
    applyDecision(options, record);
  }
}

function applyDecision(
  options: ResolvedToolOrchestratorOptions,
  record: ToolExecutionRecord,
): ToolExecutionRecord {
  const permissionDecision = options.repository.savePermissionDecision(
    permissionDecisionForRecord(options, record),
  );
  const decision = options.decisionEvaluator.evaluate({
    toolName: record.toolName,
    parsedArguments: record.input,
    snapshotEntry: snapshotEntryFromRecord(record),
    permissionPosture: options.permissionMode,
    permissionDecision,
    runtimeCapabilityPolicy: options.runtimeCapabilityPolicy,
  });

  if (decision.outcome === 'reject') {
    const observation = createRejectionObservation({
      record,
      decision,
      ids: options.ids,
      now: options.now,
    });
    return options.repository.saveToolExecution({
      ...record,
      decision,
      policyDecision: permissionDecision,
      executionMode: decision.executionMode,
      status: 'rejected',
      completedAt: observation.createdAt,
      observation,
      resultPreview: observation.content.slice(0, 500),
    });
  }

  if (decision.outcome === 'requireApproval') {
    const approvalRequest = options.repository.saveApprovalRequest(createApprovalRequest(options, record, decision));
    return options.repository.saveToolExecution({
      ...record,
      decision,
      policyDecision: permissionDecision,
      executionMode: decision.executionMode,
      approvalRequestId: approvalRequest.approvalRequestId,
      status: 'awaitingApproval',
    });
  }

  return options.repository.saveToolExecution({
    ...record,
    decision,
    policyDecision: permissionDecision,
    executionMode: decision.executionMode,
    status: 'queued',
  });
}

async function advanceExecutionWindows(
  options: ResolvedToolOrchestratorOptions,
  input: {
    runId: string;
    assistantMessageId: string;
    executionOptions?: ToolExecutionRunOptions;
  },
): Promise<ToolExecutionRecord[]> {
  try {
    let records = options.repository.listToolExecutionsByAssistantMessage(input);

    while (!input.executionOptions?.signal?.aborted) {
      const window = nextExecutableWindow(records);
      if (window.length === 0) {
        return records;
      }

      if (window.length === 1) {
        await runRecord(options, window[0], input.executionOptions);
      } else {
        await Promise.all(window.map((record) => runRecord(options, record, input.executionOptions)));
      }

      records = options.repository.listToolExecutionsByAssistantMessage(input);
    }

    for (const record of records) {
      if (isActiveStatus(record.status)) {
        options.repository.saveToolExecution({
          ...record,
          status: 'cancelled',
          completedAt: options.now(),
        });
      }
    }
    return options.repository.listToolExecutionsByAssistantMessage(input);
  } finally {
    finalizeWorkspaceChangeSet(options, input.executionOptions);
  }
}

function finalizeWorkspaceChangeSet(
  options: ResolvedToolOrchestratorOptions,
  executionOptions?: ToolExecutionRunOptions,
): void {
  if (!executionOptions?.scope) {
    return;
  }

  options.toolExecutionRouter.finalizeWorkspaceChangeSet?.(executionOptions.scope);
}

function nextExecutableWindow(records: readonly ToolExecutionRecord[]): ToolExecutionRecord[] {
  const window: ToolExecutionRecord[] = [];

  for (const record of [...records].sort((a, b) => (a.callOrder ?? 0) - (b.callOrder ?? 0))) {
    if (isContinuationTerminal(record.status)) {
      continue;
    }
    if (record.status === 'cancelled' || record.status === 'created') {
      return window;
    }
    if (record.status === 'awaitingApproval' || record.status === 'running') {
      return window;
    }
    if (record.status !== 'queued') {
      return window;
    }

    if (record.executionMode === 'parallel') {
      window.push(record);
      continue;
    }

    if (window.length === 0) {
      window.push(record);
    }
    return window;
  }

  return window;
}

async function runRecord(
  options: ResolvedToolOrchestratorOptions,
  record: ToolExecutionRecord,
  executionOptions?: ToolExecutionRunOptions,
): Promise<ToolExecutionRecord> {
  if (isContinuationTerminal(record.status) || record.status === 'cancelled') {
    return record;
  }

  const running = options.repository.saveToolExecution({
    ...record,
    status: 'running',
    startedAt: options.now(),
  });

  try {
    const rawResult = await options.toolExecutionRouter.executeToolExecution(
      running,
      executionOptions,
    );
    const observation = createObservationFromRawToolResult({
      rawResult,
      profile: budgetProfileForRecord(running, rawResult),
      record: running,
      ids: options.ids,
      now: options.now,
    });
    return options.repository.saveToolExecution({
      ...running,
      status: rawResult.isError ? 'failed' : 'succeeded',
      completedAt: observation.createdAt,
      rawResultRef: rawResult.rawToolResultId,
      observation,
      resultPreview: observation.content.slice(0, 500),
      ...(rawResult.isError ? { error: normalizeToolError(rawResult.content, {
        debugId: `tool-error:${running.toolExecutionId}`,
        fallbackMessage: 'Tool execution failed.',
      }) } : {}),
    });
  } catch (error) {
    const normalizedError = normalizeToolError(error, {
      debugId: `tool-error:${running.toolExecutionId}`,
      fallbackMessage: 'Tool execution failed.',
    });
    const rawResult = createRawToolResultFromContent({
      rawToolResultId: options.ids.rawToolResultId(),
      toolExecutionId: String(running.toolExecutionId),
      toolCallId: String(running.toolCallId),
      isError: true,
      outputKind: 'error',
      content: normalizedError,
      createdAt: options.now(),
    });
    const observation = createObservationFromRawToolResult({
      rawResult,
      profile: 'error',
      record: running,
      ids: options.ids,
      now: options.now,
    });
    return options.repository.saveToolExecution({
      ...running,
      status: 'failed',
      completedAt: observation.createdAt,
      rawResultRef: rawResult.rawToolResultId,
      observation,
      error: normalizedError,
      resultPreview: observation.content.slice(0, 500),
    });
  }
}

function outcomeFromRecords(
  options: ResolvedToolOrchestratorOptions,
  assistantMessageId: string,
  records: readonly ToolExecutionRecord[],
  createdAt: string,
  filter: { includeToolExecutionIds?: ReadonlySet<string> } = {},
): ToolOrchestratorOutcome {
  const eventRecords = filter.includeToolExecutionIds
    ? records.filter((record) => filter.includeToolExecutionIds?.has(String(record.toolExecutionId)))
    : records;
  const toolResults = buildContinuationToolResults(options, { records: eventRecords, createdAt });
  return {
    assistantMessageId,
    toolResults,
    pendingApprovals: pendingApprovalsFromRecords(options, records),
    runtimeEvents: runtimeEventsFromRecords(options, assistantMessageId, records, eventRecords, createdAt),
    continuationReady: continuationReady(records),
  };
}

function buildContinuationToolResults(
  options: ResolvedToolOrchestratorOptions,
  input: { records: readonly ToolExecutionRecord[]; createdAt: string },
): ToolResult[] {
  return [...input.records]
    .sort((a, b) => (a.callOrder ?? 0) - (b.callOrder ?? 0))
    .filter((record) => isContinuationTerminal(record.status))
    .map((record) => {
      if (!record.observation) {
        throw new Error(`Missing ToolObservation for ${record.toolExecutionId}.`);
      }
      return options.repository.saveToolResult({
        toolResultId: options.ids.toolResultId(),
        toolCallId: record.toolCallId,
        toolExecutionId: record.toolExecutionId,
        observationId: String(record.observation.observationId),
        runId: record.runId,
        kind: record.observation.isError ? 'tool_error' : 'success',
        textContent: record.observation.content,
        redactionState: 'none',
        createdAt: input.createdAt,
        metadata: {
          callOrder: record.callOrder ?? 0,
    assistantMessageId: record.assistantMessageId ?? String(record.stepId),
        },
      });
    });
}

function runtimeEventsFromRecords(
  options: ResolvedToolOrchestratorOptions,
  assistantMessageId: string,
  allRecords: readonly ToolExecutionRecord[],
  eventRecords: readonly ToolExecutionRecord[],
  createdAt: string,
): RuntimeEvent[] {
  const events: RuntimeEvent[] = [];

  for (const record of eventRecords) {
    if (record.decision) {
      events.push(createRuntimeEvent({
        eventId: options.ids.eventId?.() ?? `event:${crypto.randomUUID()}`,
        eventType: 'tool.execution.decided',
        runId: String(record.runId),
        stepId: String(record.stepId),
        sequence: 0,
        createdAt,
        source: 'tool',
        visibility: 'system',
        persist: 'required',
        payload: {
          ...recordEventPayload(record),
          decision: {
            outcome: record.decision.outcome,
            reasonCode: record.decision.reasonCode,
            executionClass: record.decision.executionClass,
            executionMode: record.decision.executionMode,
          },
        },
      }));
    }
    if (record.decision?.outcome === 'allow') {
      events.push(createRuntimeEvent({
        eventId: options.ids.eventId?.() ?? `event:${crypto.randomUUID()}`,
        eventType: 'tool.execution.queued',
        runId: String(record.runId),
        stepId: String(record.stepId),
        sequence: 0,
        createdAt,
        source: 'tool',
        visibility: 'system',
        persist: 'required',
        payload: {
          ...recordEventPayload(record),
          status: 'queued',
        },
      }));
    }
    if (record.status === 'awaitingApproval' && record.approvalRequestId) {
      const approvalRequest = options.repository.getApprovalRequest(String(record.approvalRequestId));
      if (approvalRequest) {
        events.push(createRuntimeEvent({
          eventId: options.ids.eventId?.() ?? `event:${crypto.randomUUID()}`,
          eventType: 'tool.execution.approval_requested',
          runId: String(record.runId),
          stepId: String(record.stepId),
          sequence: 0,
          createdAt: approvalRequest.createdAt,
          source: 'tool',
          visibility: 'system',
          persist: 'required',
          payload: {
            toolExecutionId: String(record.toolExecutionId),
            toolName: record.toolName,
            approvalRequest,
          },
        }));
        events.push(createRuntimeEvent({
          eventId: options.ids.eventId?.() ?? `event:${crypto.randomUUID()}`,
          eventType: 'approval.requested',
          runId: String(record.runId),
          stepId: String(record.stepId),
          sequence: 0,
          createdAt: approvalRequest.createdAt,
          source: 'approval',
          visibility: 'system',
          persist: 'required',
          payload: {
            approvalRequest,
          },
        }));
      }
    }
    if (record.status === 'rejected' && record.decision) {
      events.push(createRuntimeEvent({
        eventId: options.ids.eventId?.() ?? `event:${crypto.randomUUID()}`,
        eventType: 'tool.execution.rejected',
        runId: String(record.runId),
        stepId: String(record.stepId),
        sequence: 0,
        createdAt,
        source: 'tool',
        visibility: 'system',
        persist: 'required',
        payload: {
          ...recordEventPayload(record),
          decision: {
            outcome: record.decision.outcome,
            reasonCode: record.decision.reasonCode,
            executionClass: record.decision.executionClass,
            executionMode: record.decision.executionMode,
          },
        },
      }));
    }
    if (record.status === 'cancelled') {
      events.push(createRuntimeEvent({
        eventId: options.ids.eventId?.() ?? `event:${crypto.randomUUID()}`,
        eventType: 'tool.execution.cancelled',
        runId: String(record.runId),
        stepId: String(record.stepId),
        sequence: 0,
        createdAt,
        source: 'tool',
        visibility: 'system',
        persist: 'required',
        payload: recordEventPayload(record),
      }));
    }
    if (record.observation) {
      events.push(createRuntimeEvent({
        eventId: options.ids.eventId?.() ?? `event:${crypto.randomUUID()}`,
        eventType: 'tool.observation.ready',
        runId: String(record.runId),
        stepId: String(record.stepId),
        sequence: 0,
        createdAt: record.observation.createdAt,
        source: 'tool',
        visibility: 'system',
        persist: 'required',
        payload: {
          ...recordEventPayload(record),
          observationId: String(record.observation.observationId),
          isError: record.observation.isError,
          truncated: record.observation.truncated,
        },
      }));
    }
  }

  if (continuationReady(allRecords)) {
    events.push(createRuntimeEvent({
      eventId: options.ids.eventId?.() ?? `event:${crypto.randomUUID()}`,
      eventType: 'tool.continuation.ready',
      runId: String(allRecords[0]?.runId ?? ''),
      stepId: String(allRecords[0]?.stepId ?? ''),
      sequence: 0,
      createdAt,
      source: 'tool',
      visibility: 'system',
      persist: 'required',
      payload: {
        assistantMessageId,
        toolExecutionIds: allRecords
          .filter((record) => isContinuationTerminal(record.status))
          .map((record) => String(record.toolExecutionId)),
      },
    }));
  }

  return events;
}

function recordEventPayload(record: ToolExecutionRecord) {
  return {
    assistantMessageId: record.assistantMessageId ?? String(record.stepId),
    toolExecutionId: String(record.toolExecutionId),
    toolCallId: String(record.toolCallId),
    toolName: record.toolName,
    callOrder: record.callOrder ?? 0,
    status: record.status,
  };
}

function pendingApprovalsFromRecords(
  options: ResolvedToolOrchestratorOptions,
  records: readonly ToolExecutionRecord[],
): PendingToolApproval[] {
  return records
    .filter((record) => record.status === 'awaitingApproval' && record.approvalRequestId)
    .map((record) => {
      const approvalRequest = options.repository.getApprovalRequest(String(record.approvalRequestId))
        ?? createApprovalRequest(options, record, record.decision ?? {
          outcome: 'requireApproval',
          reasonCode: 'CUSTOM_TOOL_REQUIRES_APPROVAL',
          reason: 'Tool execution requires approval.',
          executionClass: 'unknown',
          executionMode: record.executionMode ?? 'serial',
        });
      return {
        approvalRequest,
        toolCall: options.repository.getToolCall(String(record.toolCallId)) ?? toolCallFromRecord(record),
        toolExecution: record,
      };
    });
}

function executionOptionsFromRequest(
  request: ModelStepRuntimeRequest,
  signal?: AbortSignal,
): ToolExecutionRunOptions {
  return {
    scope: {
      sessionId: String(request.sessionId),
      runId: String(request.runId),
      stepId: String(request.stepId),
    },
    ...(signal ? { signal } : {}),
  };
}

function executionOptionsFromRecord(
  options: ResolvedToolOrchestratorOptions,
  record: ToolExecutionRecord,
): ToolExecutionRunOptions {
  return {
    scope: {
      sessionId: options.repository.getRunSessionId(String(record.runId)) ?? String(record.metadata?.sessionId ?? ''),
      runId: String(record.runId),
      stepId: String(record.stepId),
    },
  };
}

function continuationReady(records: readonly ToolExecutionRecord[]): boolean {
  if (records.length === 0) {
    return true;
  }
  return records.every((record) => isContinuationTerminal(record.status) && Boolean(record.observation));
}

function isContinuationTerminal(status: ToolExecutionRecord['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'rejected';
}

function isActiveStatus(status: ToolExecutionRecord['status']): boolean {
  return status === 'created' || status === 'awaitingApproval' || status === 'queued' || status === 'running';
}

function recordFromResolvedCall(
  options: ResolvedToolOrchestratorOptions,
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
  options: ResolvedToolOrchestratorOptions,
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

function permissionDecisionForRecord(
  options: ResolvedToolOrchestratorOptions,
  record: ToolExecutionRecord,
): PermissionDecision {
  const definition = definitionForRecord(options, record);
  return {
    ...evaluatePermissionPolicy({
      definition,
      toolExecution: record,
      permissionMode: options.permissionMode,
      projectRoot: options.projectRoot,
      settings: options.settings,
      evaluatedAt: options.now(),
    }),
    permissionDecisionId: options.ids.permissionDecisionId(),
  };
}

function definitionForRecord(
  options: ResolvedToolOrchestratorOptions,
  record: ToolExecutionRecord,
): ToolDefinition {
  const snapshot = options.repository.getToolRegistrySnapshotByRun(String(record.runId));
  const entry = snapshot?.entries.find((candidate) => candidate.snapshotEntryId === record.snapshotEntryId);
  if (entry) {
    return modelVisibleDefinitionForSnapshotEntry(entry);
  }
  const inferred = inferredDefinitionFields(record.toolName);
  return {
    name: record.toolName,
    description: record.toolName,
    inputSchema: { type: 'object', properties: {}, additionalProperties: true },
    capabilities: [...(record.capabilities ?? inferred.capabilities)],
    riskLevel: record.riskLevel ?? inferred.riskLevel,
    sideEffect: record.sideEffect ?? inferred.sideEffect,
    availability: { status: 'available' },
    executionMode: record.executionMode,
  };
}

function inferredDefinitionFields(toolName: string): Pick<ToolDefinition, 'capabilities' | 'riskLevel' | 'sideEffect'> {
  if (toolName === 'run_command') {
    return {
      capabilities: ['command_run'],
      riskLevel: 'medium',
      sideEffect: 'execute_command',
    };
  }
  if (toolName === 'edit_file' || toolName === 'write_file') {
    return {
      capabilities: ['project_write'],
      riskLevel: 'medium',
      sideEffect: 'project_file_operation',
    };
  }
  return {
    capabilities: ['project_read'],
    riskLevel: 'low',
    sideEffect: 'none',
  };
}

function snapshotEntryFromRecord(record: ToolExecutionRecord): ToolExecutionDecisionInput['snapshotEntry'] {
  if (!record.sourceId || !record.namespace || !record.sourceToolName || !record.modelVisibleName) {
    return undefined;
  }
  return {
    modelVisibleName: record.modelVisibleName,
    sourceId: record.sourceId,
    namespace: record.namespace,
    sourceToolName: record.sourceToolName,
    capabilities: record.capabilities,
    riskLevel: record.riskLevel,
    sideEffect: record.sideEffect,
    executionMode: record.executionMode,
  };
}

function createApprovalRequest(
  options: ResolvedToolOrchestratorOptions,
  record: ToolExecutionRecord,
  decision: ToolExecutionDecision,
): ApprovalRequest {
  return {
    approvalRequestId: options.ids.approvalRequestId(),
    toolCallId: String(record.toolCallId),
    toolExecutionId: String(record.toolExecutionId),
    runId: String(record.runId),
    stepId: String(record.stepId),
    toolName: record.toolName,
    registrySnapshotId: record.registrySnapshotId,
    snapshotEntryId: record.snapshotEntryId,
    modelVisibleName: record.modelVisibleName,
    canonicalToolId: record.canonicalToolId,
    sourceId: record.sourceId,
    namespace: record.namespace,
    sourceToolName: record.sourceToolName,
    capabilities: [...(record.capabilities ?? ['project_write'])],
    riskLevel: record.riskLevel ?? 'medium',
    title: `Approve ${record.toolName}`,
    summary: decision.reason,
    preview: {
      action: typeof record.inputPreview === 'object' && record.inputPreview && 'summary' in record.inputPreview
        ? String(record.inputPreview.summary)
        : `Run ${record.toolName}`,
      targets: previewTargets(record.inputPreview),
    },
    requestedScope: 'once',
    status: 'pending',
    createdAt: options.now(),
  };
}

function previewTargets(inputPreview: ToolExecutionRecord['inputPreview']): ApprovalRequest['preview']['targets'] {
  if (!inputPreview || typeof inputPreview !== 'object' || Array.isArray(inputPreview) || !('targets' in inputPreview)) {
    return [];
  }
  const targets = inputPreview.targets;
  if (!Array.isArray(targets)) {
    return [];
  }
  return targets.flatMap((target) => (
    target && typeof target === 'object' && !Array.isArray(target)
      && typeof target.kind === 'string' && typeof target.label === 'string'
      ? [{
        kind: target.kind as ApprovalRequest['preview']['targets'][number]['kind'],
        label: target.label,
        ...(typeof target.sensitivity === 'string'
          ? { sensitivity: target.sensitivity as ApprovalRequest['preview']['targets'][number]['sensitivity'] }
          : {}),
      }]
      : []
  ));
}

function budgetProfileForRecord(
  record: ToolExecutionRecord,
  rawResult: RawToolResult,
): ToolObservationBudgetProfile {
  if (rawResult.isError || rawResult.outputKind === 'error') {
    return 'error';
  }
  if (rawResult.outputKind === 'command' || record.toolName === 'run_command') {
    return 'commandOutput';
  }
  if (rawResult.outputKind === 'file' || record.toolName === 'read_file') {
    return 'fileRead';
  }
  return 'largeText';
}

function toolCallFromRecord(record: ToolExecutionRecord): ToolCall {
  return {
    toolCallId: record.toolCallId,
    providerToolCallId: typeof record.metadata?.providerToolCallId === 'string'
      ? record.metadata.providerToolCallId
      : String(record.toolCallId),
    runId: record.runId,
    modelStepId: record.assistantMessageId ?? String(record.stepId),
    toolName: record.toolName,
    registrySnapshotId: record.registrySnapshotId,
    snapshotEntryId: record.snapshotEntryId,
    modelVisibleName: record.modelVisibleName,
    canonicalToolId: record.canonicalToolId,
    sourceId: record.sourceId,
    namespace: record.namespace,
    sourceToolName: record.sourceToolName,
    input: record.input,
    inputPreview: record.inputPreview as ToolCall['inputPreview'],
    status: 'validated',
    createdAt: record.requestedAt,
    completedAt: record.completedAt,
  };
}

function resolveOptions(options: ToolOrchestratorServiceOptions): ResolvedToolOrchestratorOptions {
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
