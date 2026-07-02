// Owns run-time tool call orchestration for a Coding Agent turn.
// It delegates approval, execution, and next-model-input shaping to focused internal modules.
import type { RegisteredTool, ToolExecutionService, ToolRegistryService } from '../../tools';
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
  ToolCall,
  ToolDefinition,
  ToolExecutionDecision,
  ToolExecutionRecord,
  ToolResult,
} from '@megumi/shared/tool';
import {
  evaluateToolExecutionDecision,
  type ToolExecutionDecisionInput,
} from '../../permissions/tool-execution-decision';
import { resumeToolApproval } from './approval/approval-resume';
import {
  collectApprovalResumeRuntimeEvents,
  createApprovalResolvedRuntimeEvent,
} from './approval/approval-resume-events';
import {
  closePendingApprovalGroup,
  PendingApprovalRegistry,
  resolvePendingApproval,
} from './approval/pending-approval-registry';
import { prepareApprovalResumeModelInput } from './approval/approval-resume-model-input';
import { applyDecisionsToCreated, inferredDefinitionFields } from './approval/tool-call-approval';
import { createRejectionObservation } from './approval/rejection-observation';
import { advanceExecutionWindows } from './execution/tool-execution-window';
import { markToolResultsSubmittedToModelInput } from './model-input/tool-result-model-input-emitted';
import { outcomeFromRecords } from './model-input/tool-result-model-input';

export { PendingApprovalRegistry };

export interface ToolCallRunnerOutcome extends ToolCallRunOutcome {
  assistantMessageId: string;
  toolResults: readonly ToolResult[];
  pendingApprovals: readonly PendingToolApproval[];
  runtimeEvents: readonly RuntimeEvent[];
  nextModelInputReady: boolean;
}

export interface ToolApprovalResumeRunnerOutcome extends ResumeToolApprovalOutcome {
  assistantMessageId: string;
  toolResults: readonly ToolResult[];
  pendingApprovals: readonly PendingToolApproval[];
  runtimeEvents: readonly RuntimeEvent[];
  nextModelInputReady: boolean;
}

export interface ToolCallRunnerService extends ToolCallRunner, ToolApprovalResumePort {
  handleToolCalls(input: HandleToolCallsInput): Promise<ToolCallRunnerOutcome>;
  resumeToolApproval(input: ResumeToolApprovalInput): Promise<ToolApprovalResumeRunnerOutcome | undefined>;
  resolvePendingApproval: typeof resolvePendingApproval;
  closePendingApprovalGroup: typeof closePendingApprovalGroup;
  createApprovalResolvedRuntimeEvent: typeof createApprovalResolvedRuntimeEvent;
  collectApprovalResumeRuntimeEvents: typeof collectApprovalResumeRuntimeEvents;
  prepareApprovalResumeModelInput: typeof prepareApprovalResumeModelInput;
  markToolResultsSubmittedToModelInput(
    input: Omit<Parameters<typeof markToolResultsSubmittedToModelInput>[0], 'repository' | 'ids'>,
  ): ReturnType<typeof markToolResultsSubmittedToModelInput>;
}

export interface ToolCallRepositoryPort {
  startToolCall(toolCall: ToolCall): ToolCall;
  getToolCall(toolCallId: string): ToolCall | undefined;
  recordToolExecution(toolExecution: ToolExecutionRecord): ToolExecutionRecord;
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
  recordPermissionDecision(permissionDecision: PermissionDecision): PermissionDecision;
  createApprovalRequest(approvalRequest: ApprovalRequest): ApprovalRequest;
  getApprovalRequest(approvalRequestId: string): ApprovalRequest | undefined;
  completeToolCall(toolResult: ToolResult): ToolResult;
  getRunSessionId(runId: string): string | undefined;
  markToolResultsSubmittedToModelInput?(input: {
    toolExecutionIds: string[];
    emittedAt: string;
  }): void;
}

export interface ToolCallRunnerOptions {
  repository: ToolCallRepositoryPort;
  toolRegistryService: Pick<ToolRegistryService, 'getRegisteredTool'>;
  toolExecutionService: Pick<ToolExecutionService, 'executeTool'>;
  permissionMode: PermissionMode;
  projectRoot: string;
  settings: MergedPermissionSettings;
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
  ids: NonNullable<ToolCallRunnerOptions['ids']> & { eventId(): string };
  runtimeCapabilityPolicy: ToolExecutionDecisionInput['runtimeCapabilityPolicy'];
  decisionEvaluator: NonNullable<ToolCallRunnerOptions['decisionEvaluator']>;
}

type ToolResultModelInputEmissionRepository = NonNullable<Parameters<typeof markToolResultsSubmittedToModelInput>[0]['repository']>;
type ToolResultModelInputEmissionIds = Parameters<typeof markToolResultsSubmittedToModelInput>[0]['ids'];

export function ensureToolCallRunnerService(
  runner: ToolCallRunner & ToolApprovalResumePort,
  options: {
    modelInputEmissionRepository?: ToolResultModelInputEmissionRepository;
    ids?: ToolResultModelInputEmissionIds;
  } = {},
): ToolCallRunnerService {
  const maybeRunner = runner as Partial<ToolCallRunnerService>;
  if (
    maybeRunner.resolvePendingApproval
    && maybeRunner.closePendingApprovalGroup
    && maybeRunner.createApprovalResolvedRuntimeEvent
    && maybeRunner.collectApprovalResumeRuntimeEvents
    && maybeRunner.prepareApprovalResumeModelInput
    && maybeRunner.markToolResultsSubmittedToModelInput
  ) {
    return runner as ToolCallRunnerService;
  }

  return Object.assign(runner, {
    resolvePendingApproval,
    closePendingApprovalGroup,
    createApprovalResolvedRuntimeEvent,
    collectApprovalResumeRuntimeEvents,
    prepareApprovalResumeModelInput,
    markToolResultsSubmittedToModelInput(
      input: Omit<Parameters<typeof markToolResultsSubmittedToModelInput>[0], 'repository' | 'ids'>,
    ) {
      if (!options.ids) {
        return undefined;
      }
      return markToolResultsSubmittedToModelInput({
        ...input,
        repository: options.modelInputEmissionRepository,
        ids: options.ids,
      });
    },
  }) as unknown as ToolCallRunnerService;
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
    resolvePendingApproval,
    closePendingApprovalGroup,
    createApprovalResolvedRuntimeEvent,
    collectApprovalResumeRuntimeEvents,
    prepareApprovalResumeModelInput,
    markToolResultsSubmittedToModelInput(input) {
      return markToolResultsSubmittedToModelInput({
        ...input,
        repository: modelInputEmissionRepository(resolved.repository),
        ids: resolved.ids,
      });
    },
  };
}

function modelInputEmissionRepository(
  repository: ToolCallRepositoryPort,
): ToolResultModelInputEmissionRepository | undefined {
  return repository.markToolResultsSubmittedToModelInput
    ? { markToolResultsSubmittedToModelInput: (input) => repository.markToolResultsSubmittedToModelInput?.(input) }
    : undefined;
}


async function prepareRecords(
  options: ResolvedToolCallRunnerOptions,
  input: HandleToolCallsInput,
): Promise<ToolExecutionRecord[]> {
  const assistantMessageId = String(input.request.modelStepId);

  for (const [index, toolCall] of input.toolCalls.entries()) {
    const existing = options.repository.getToolExecutionByToolCallId({
      runId: String(input.request.runId),
      assistantMessageId,
      toolCallId: String(toolCall.toolCallId),
    });
    if (existing) {
      continue;
    }

    const allowedByCurrentToolSet = isToolAllowedByCurrentModelCallToolSet(input.request, toolCall.toolName);
    const resolution = allowedByCurrentToolSet
      ? options.toolRegistryService.getRegisteredTool({ toolName: toolCall.toolName })
      : { type: 'not_found' as const, toolName: toolCall.toolName };
    const registeredTool = resolution.type === 'found' ? resolution.tool : undefined;
    const resolvedToolCall = registeredTool
      ? { ...toolCall, toolName: registeredTool.registeredToolName }
      : toolCall;
    options.repository.startToolCall({
      ...resolvedToolCall,
      status: registeredTool ? 'validated' : 'failed',
      ...(registeredTool ? {} : { completedAt: options.now() }),
    });

    const record = registeredTool
      ? recordFromRegisteredTool(options, input.request, resolvedToolCall, index, registeredTool)
      : createRejectedRecord(options, input.request, toolCall, index, {
        reason: allowedByCurrentToolSet
          ? `Unknown tool: ${toolCall.toolName}`
          : `Tool not available in current model-call Tool Set: ${toolCall.toolName}`,
        reasonCode: 'TOOL_NOT_FOUND',
      });
    options.repository.recordToolExecution(record);
  }

  return options.repository.listToolExecutionsByAssistantMessage({
    runId: String(input.request.runId),
    assistantMessageId,
  });
}

function isToolAllowedByCurrentModelCallToolSet(
  request: ModelStepRuntimeRequest,
  toolName: string,
): boolean {
  return Boolean(request.toolDefinitions?.some((definition) => definition.name === toolName));
}

function recordFromRegisteredTool(
  options: ResolvedToolCallRunnerOptions,
  request: ModelStepRuntimeRequest,
  toolCall: ToolCall,
  callOrder: number,
  registeredTool: RegisteredTool,
): ToolExecutionRecord {
  return {
    toolExecutionId: options.ids.toolExecutionId(),
    toolCallId: toolCall.toolCallId,
    runId: request.runId,
    stepId: request.stepId,
    assistantMessageId: String(request.modelStepId),
    callOrder: toolCall.callOrder ?? callOrder,
    toolName: registeredTool.registeredToolName,
    modelVisibleName: registeredTool.registeredToolName,
    canonicalToolId: [
      registeredTool.identity.sourceId,
      registeredTool.identity.namespace,
      registeredTool.identity.sourceToolName,
    ].join(':'),
    sourceId: registeredTool.identity.sourceId,
    namespace: registeredTool.identity.namespace,
    sourceToolName: registeredTool.identity.sourceToolName,
    input: toolCall.input,
    inputPreview: toolCall.inputPreview,
    capabilities: [...registeredTool.definition.capabilities],
    riskLevel: registeredTool.definition.riskLevel,
    sideEffect: registeredTool.definition.sideEffect,
    status: 'created',
    requestedAt: options.now(),
    continuationEmitted: false,
    metadata: {
      providerToolCallId: toolCall.providerToolCallId,
    },
  };
}

function executionOptionsFromRequest(
  _request: ModelStepRuntimeRequest,
  signal?: AbortSignal,
): { signal?: AbortSignal } {
  return signal ? { signal } : {};
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
  const ids = options.ids
    ? {
        ...options.ids,
        eventId: options.ids.eventId ?? (() => `runtime-event:${crypto.randomUUID()}`),
      }
    : {
        toolExecutionId: () => `tool-execution:${crypto.randomUUID()}`,
        toolResultId: () => `tool-result:${crypto.randomUUID()}`,
        permissionDecisionId: () => `permission-decision:${crypto.randomUUID()}`,
        approvalRequestId: () => `approval-request:${crypto.randomUUID()}`,
        rawToolResultId: () => `raw-tool-result:${crypto.randomUUID()}`,
        observationId: () => `tool-observation:${crypto.randomUUID()}`,
        eventId: () => `runtime-event:${crypto.randomUUID()}`,
      };

  return {
    ...options,
    now: options.now ?? (() => new Date().toISOString()),
    ids,
    runtimeCapabilityPolicy: options.runtimeCapabilityPolicy ?? {
      customToolsEnabled: true,
      processExecutionEnabled: true,
    },
    decisionEvaluator: options.decisionEvaluator ?? {
      evaluate: evaluateToolExecutionDecision,
    },
  };
}
