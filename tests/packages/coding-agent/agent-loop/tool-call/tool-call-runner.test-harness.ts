import { vi } from 'vitest';
import { createToolCallRunner } from '@megumi/coding-agent/agent-loop/tool-call';
import type { PermissionDecision as ServicePermissionDecision } from '@megumi/coding-agent/permissions';
import { ToolRegistryService, type ToolExecutionResult } from '@megumi/coding-agent/tools';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import type {
  ApprovalRequest,
  PermissionDecision,
  ToolCall,
  ToolExecutionDecision,
  ToolExecutionRecord,
  ToolObservation,
  ToolResult,
} from '@megumi/shared/tool';

export function createToolCallRunnerHarness(input: {
  decisions?: readonly ToolExecutionDecision[];
  existingRecords?: readonly ToolExecutionRecord[];
  failedToolCallIds?: readonly string[];
} = {}) {
  const repository = createInMemoryToolCallStore(input.existingRecords ?? []);
  const executor = createRecordingToolExecutionService(new Set(input.failedToolCallIds ?? []));
  const decisions = [...(input.decisions ?? [])];
  const toolCallHandler = createToolCallRunner({
    repository,
    toolRegistryService: new ToolRegistryService(),
    toolExecutionService: executor.service,
    permissionMode: 'default',
    projectRoot: 'C:/project',
    permissionSettings: { allow: [], ask: [], deny: [] },
    permissionService: {
      evaluateToolExecution: () => ({
        status: 'ok',
        decision: serviceDecisionFromLegacy(decisions.shift() ?? allowParallel('read_file')),
      }),
      validateApprovalDecision: () => ({ status: 'accepted' }),
      applyApprovalDecision: async () => ({
        status: 'applied',
        permission_state_change: { type: 'none' },
      }),
    },
    ids: createDeterministicIds(),
    now: () => '2026-06-15T00:00:00.000Z',
    runtimeCapabilityPolicy: {
      custom_tools_enabled: false,
      process_execution_enabled: true,
      network_enabled: true,
    },
  });
  return {
    toolCallHandler,
    repository,
    executor,
    recordsByCallOrder: () => repository.records().sort((a, b) => (a.callOrder ?? 0) - (b.callOrder ?? 0)),
  };
}

function serviceDecisionFromLegacy(decision: ToolExecutionDecision): ServicePermissionDecision {
  const executionClass = serviceExecutionClass(decision.executionClass);
  if (decision.outcome === 'allow') {
    return {
      type: 'allow',
      reason: decision.reason,
      execution_class: executionClass,
    };
  }
  if (decision.outcome === 'requireApproval') {
    return {
      type: 'requires_approval',
      reason: decision.reason,
      execution_class: executionClass,
      approval: {
        allowed_scopes: ['once', 'session'],
        default_scope: 'once',
      },
    };
  }
  return {
    type: 'deny',
    reason: decision.reason,
    execution_class: executionClass,
    denial_code: decision.reasonCode === 'PATH_OUTSIDE_WORKSPACE'
      ? 'outside_workspace'
      : 'policy_denied',
  };
}

function serviceExecutionClass(
  executionClass: ToolExecutionDecision['executionClass'],
): ServicePermissionDecision['execution_class'] {
  if (executionClass === 'readOnly') return 'read_only';
  if (executionClass === 'workspaceMutation') return 'workspace_mutation';
  if (executionClass === 'processExecution') return 'process_execution';
  return 'unknown';
}

export function createHandleInput(toolCalls: readonly ToolCall[]) {
  return {
    request: modelRequest(),
    toolCalls,
  };
}

export function modelRequest(): ModelStepRuntimeRequest {
  return {
    requestId: 'request:1',
    sessionId: 'session:1',
    runId: 'run:1',
    stepId: 'step:1',
    modelStepId: 'assistant-message:1',
    providerId: 'openai',
    modelId: 'test-model',
    inputContext: { parts: [] } as unknown as ModelStepRuntimeRequest['inputContext'],
    toolDefinitions: new ToolRegistryService().listAvailableTools().tools.map((tool) => ({
      ...tool.definition,
      name: tool.registeredToolName,
      description: tool.definition.modelFacingDescription ?? tool.definition.description,
    })),
    createdAt: '2026-06-15T00:00:00.000Z',
  };
}

export function toolCall(toolCallId: string, toolName: string): ToolCall {
  return {
    toolCallId,
    providerToolCallId: toolCallId,
    runId: 'run:1',
    modelStepId: 'assistant-message:1',
    toolName,
    modelVisibleName: toolName,
    canonicalToolId: `built_in:megumi:${toolName}`,
    sourceId: 'built_in',
    namespace: 'megumi',
    sourceToolName: toolName,
    input: { __toolCallId: toolCallId },
    inputPreview: inputPreview(toolName),
    status: 'created',
    createdAt: '2026-06-15T00:00:00.000Z',
  };
}

export function allowParallel(toolName: string): ToolExecutionDecision {
  return {
    outcome: 'allow',
    reasonCode: 'BUILTIN_READ_ALLOWED',
    reason: `${toolName} is read-only.`,
    executionClass: 'readOnly',
    executionMode: 'parallel',
  };
}

export function allowSerial(toolName: string): ToolExecutionDecision {
  return {
    outcome: 'allow',
    reasonCode: toolName === 'run_command' ? 'PROCESS_ALLOWED_BY_POSTURE' : 'WORKSPACE_MUTATION_ALLOWED_BY_POSTURE',
    reason: `${toolName} is allowed by the current posture.`,
    executionClass: toolName === 'run_command' ? 'processExecution' : 'workspaceMutation',
    executionMode: 'serial',
  };
}

export function requireApprovalSerial(toolName: string): ToolExecutionDecision {
  return {
    outcome: 'requireApproval',
    reasonCode: toolName === 'run_command' ? 'PROCESS_REQUIRES_APPROVAL' : 'WORKSPACE_MUTATION_REQUIRES_APPROVAL',
    reason: `${toolName} requires approval.`,
    executionClass: toolName === 'run_command' ? 'processExecution' : 'workspaceMutation',
    executionMode: 'serial',
  };
}

export function createdRecord(toolCallId: string, callOrder: number): ToolExecutionRecord {
  return baseRecord(toolCallId, callOrder, 'created');
}

export function awaitingApprovalRecord(toolCallId: string, callOrder: number): ToolExecutionRecord {
  return {
    ...baseRecord(toolCallId, callOrder, 'awaitingApproval'),
    toolName: 'edit_file',
    sourceToolName: 'edit_file',
    approvalRequestId: 'approval:1',
    decision: requireApprovalSerial('edit_file'),
    executionMode: 'serial',
  };
}

export function terminalSucceededRecord(toolCallId: string, callOrder: number): ToolExecutionRecord {
  const record = baseRecord(toolCallId, callOrder, 'succeeded');
  return {
    ...record,
    decision: allowParallel('read_file'),
    executionMode: 'parallel',
    observation: observationFor(record, `obs:${callOrder}`, false),
  };
}

function baseRecord(
  toolCallId: string,
  callOrder: number,
  status: ToolExecutionRecord['status'],
): ToolExecutionRecord {
  return {
    toolExecutionId: `exec:${callOrder}`,
    toolCallId,
    runId: 'run:1',
    stepId: 'step:1',
    assistantMessageId: 'assistant-message:1',
    callOrder,
    toolName: 'read_file',
    registrySnapshotId: 'snapshot:1',
    snapshotEntryId: `snapshot-entry:${toolCallId}`,
    modelVisibleName: 'read_file',
    canonicalToolId: 'built_in:megumi:read_file',
    sourceId: 'built_in',
    namespace: 'megumi',
    sourceToolName: 'read_file',
    input: { __toolCallId: toolCallId },
    inputPreview: inputPreview('read_file'),
    capabilities: ['project_read'],
    riskLevel: 'low',
    sideEffect: 'none',
    status,
    requestedAt: '2026-06-15T00:00:00.000Z',
    continuationEmitted: false,
  };
}

function observationFor(
  record: ToolExecutionRecord,
  observationId: string,
  isError: boolean,
): ToolObservation {
  return {
    observationId,
    toolExecutionId: record.toolExecutionId,
    toolCallId: record.toolCallId,
    runId: record.runId,
    stepId: record.stepId,
    kind: 'text',
    isError,
    content: isError ? 'error observation' : 'success observation',
    truncated: false,
    byteLength: 19,
    createdAt: '2026-06-15T00:00:00.000Z',
  };
}

function createInMemoryToolCallStore(
  initialRecords: readonly ToolExecutionRecord[],
) {
  const records = new Map(initialRecords.map((record) => [String(record.toolExecutionId), record]));
  const toolCalls = new Map<string, ToolCall>();
  const approvals = new Map<string, ApprovalRequest>();
  const toolResults: ToolResult[] = [];

  for (const record of initialRecords) {
    toolCalls.set(String(record.toolCallId), toolCall(String(record.toolCallId), record.toolName));
    if (record.approvalRequestId) {
      approvals.set(record.approvalRequestId, approvalFor(record));
    }
  }

  return {
    records: () => [...records.values()],
    toolResults: () => [...toolResults],
    startToolCall: vi.fn((value: ToolCall) => {
      toolCalls.set(String(value.toolCallId), value);
      return value;
    }),
    getToolCall: vi.fn((id: string) => toolCalls.get(id)),
    recordToolExecution: vi.fn((record: ToolExecutionRecord) => {
      records.set(String(record.toolExecutionId), record);
      return record;
    }),
    getToolExecution: vi.fn((id: string) => records.get(id)),
    getToolExecutionByToolCallId: vi.fn((input: { toolCallId: string }) =>
      [...records.values()].find((record) => record.toolCallId === input.toolCallId)),
    listToolExecutionsByAssistantMessage: vi.fn(() =>
      [...records.values()].sort((a, b) => (a.callOrder ?? 0) - (b.callOrder ?? 0))),
    recordPermissionDecision: vi.fn((decision: PermissionDecision) => decision),
    createApprovalRequest: vi.fn((approval: ApprovalRequest) => {
      approvals.set(String(approval.approvalRequestId), approval);
      return approval;
    }),
    getApprovalRequest: vi.fn((id: string) => approvals.get(id)),
    completeToolCall: vi.fn((result: ToolResult) => {
      toolResults.push(result);
      return result;
    }),
    getRunSessionId: vi.fn(() => 'session:1'),
    getRunWorkspaceId: vi.fn(() => 'workspace:1'),
  };
}

function createRecordingToolExecutionService(failedToolCallIds: ReadonlySet<string>) {
  const started: string[] = [];
  const windows: string[][] = [];
  return {
    service: {
      executeTool: vi.fn(async (request): Promise<ToolExecutionResult> => {
        const callId = String((request.input as { __toolCallId?: unknown }).__toolCallId ?? request.toolName);
        started.push(callId);
        windows.push([callId]);
        if (failedToolCallIds.has(callId)) {
          return {
            type: 'failed',
            toolName: request.toolName,
            error: {
              code: 'tool_execution_failed',
              message: `failed ${callId}`,
            },
            normalizedResult: {
              kind: 'error',
              content: `failed ${callId}`,
              isError: true,
              truncated: false,
            },
            toolExecutionObservation: {
              summary: `failed ${callId}`,
            },
          };
        }
        return {
          type: 'succeeded',
          toolName: request.toolName,
          rawResult: {
            outputKind: 'text',
            content: `result for ${callId}`,
          },
          normalizedResult: {
            kind: 'text',
            content: `result for ${callId}`,
            isError: false,
            truncated: false,
          },
          toolExecutionObservation: {
            summary: `${request.toolName} completed`,
          },
        };
      }),
    },
    startedToolCallIds: () => started,
    executionWindows: () => windows,
    executionCountFor: (toolCallId: string) => started.filter((id) => id === toolCallId).length,
  };
}

function createDeterministicIds() {
  let executionIndex = 0;
  let observationIndex = 0;
  let resultIndex = 0;
  return {
    toolExecutionId: () => `exec:new:${executionIndex++}`,
    approvalRequestId: () => 'approval:1',
    permissionDecisionId: () => `permission:${executionIndex}`,
    rawToolResultId: () => `raw:new:${executionIndex}`,
    observationId: () => `obs:${observationIndex++}`,
    toolResultId: () => `tool-result:${resultIndex++}`,
    eventId: () => `event:${resultIndex}`,
  };
}

function inputPreview(toolName: string): ToolCall['inputPreview'] {
  return {
    summary: `${toolName} input`,
    targets: [{ kind: 'file', label: 'README.md' }],
    redactionState: 'none',
  };
}

function approvalFor(record: ToolExecutionRecord): ApprovalRequest {
  return {
    approvalRequestId: String(record.approvalRequestId ?? 'approval:1'),
    toolCallId: String(record.toolCallId),
    toolExecutionId: String(record.toolExecutionId),
    runId: String(record.runId),
    stepId: String(record.stepId),
    toolName: record.toolName,
    capabilities: [...(record.capabilities ?? ['project_write'])],
    riskLevel: record.riskLevel ?? 'medium',
    title: `Approve ${record.toolName}`,
    summary: 'Approval required.',
    preview: { action: 'edit file', targets: [{ kind: 'file', label: 'README.md' }] },
    requestedScope: 'once',
    status: 'pending',
    createdAt: '2026-06-15T00:00:00.000Z',
  };
}
