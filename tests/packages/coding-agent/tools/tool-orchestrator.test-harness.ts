import { vi } from 'vitest';
import { createToolOrchestratorService } from '@megumi/coding-agent/tools/tool-orchestrator';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import type {
  ApprovalRequest,
  PermissionDecision,
  RawToolResult,
  ToolCall,
  ToolExecutionDecision,
  ToolExecutionRecord,
  ToolObservation,
  ToolRegistrySnapshot,
  ToolResult,
} from '@megumi/shared/tool';

export function createToolOrchestratorHarness(input: {
  decisions?: readonly ToolExecutionDecision[];
  existingRecords?: readonly ToolExecutionRecord[];
  snapshot?: ToolRegistrySnapshot;
  failedToolCallIds?: readonly string[];
} = {}) {
  const repository = createInMemoryToolRepository(input.existingRecords ?? [], input.snapshot);
  const executor = createRecordingRawExecutor(new Set(input.failedToolCallIds ?? []));
  const decisions = [...(input.decisions ?? [])];
  const orchestrator = createToolOrchestratorService({
    repository,
    permissionMode: 'default',
    projectRoot: 'C:/project',
    settings: { allow: [], ask: [], deny: [] },
    toolExecutionRouter: executor.router,
    decisionEvaluator: {
      evaluate: () => decisions.shift() ?? allowParallel('read_file'),
    },
    ids: createDeterministicIds(),
    now: () => '2026-06-15T00:00:00.000Z',
    runtimeCapabilityPolicy: { customToolsEnabled: false, processExecutionEnabled: true },
  });
  return {
    orchestrator,
    repository,
    executor,
    recordsByCallOrder: () => repository.records().sort((a, b) => (a.callOrder ?? 0) - (b.callOrder ?? 0)),
  };
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
    input: {},
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
    input: {},
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

function createInMemoryToolRepository(
  initialRecords: readonly ToolExecutionRecord[],
  snapshot?: ToolRegistrySnapshot,
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
    saveToolCall: vi.fn((value: ToolCall) => {
      toolCalls.set(String(value.toolCallId), value);
      return value;
    }),
    getToolCall: vi.fn((id: string) => toolCalls.get(id)),
    saveToolExecution: vi.fn((record: ToolExecutionRecord) => {
      records.set(String(record.toolExecutionId), record);
      return record;
    }),
    getToolExecution: vi.fn((id: string) => records.get(id)),
    getToolExecutionByToolCallId: vi.fn((input: { toolCallId: string }) =>
      [...records.values()].find((record) => record.toolCallId === input.toolCallId)),
    listToolExecutionsByAssistantMessage: vi.fn(() =>
      [...records.values()].sort((a, b) => (a.callOrder ?? 0) - (b.callOrder ?? 0))),
    savePermissionDecision: vi.fn((decision: PermissionDecision) => decision),
    saveApprovalRequest: vi.fn((approval: ApprovalRequest) => {
      approvals.set(String(approval.approvalRequestId), approval);
      return approval;
    }),
    getApprovalRequest: vi.fn((id: string) => approvals.get(id)),
    saveToolResult: vi.fn((result: ToolResult) => {
      toolResults.push(result);
      return result;
    }),
    getToolRegistrySnapshotByRun: vi.fn(() => snapshot),
    getRunSessionId: vi.fn(() => 'session:1'),
  };
}

function createRecordingRawExecutor(failedToolCallIds: ReadonlySet<string>) {
  const started: string[] = [];
  const windows: string[][] = [];
  return {
    router: {
      executeToolExecution: vi.fn(async (record: ToolExecutionRecord): Promise<RawToolResult> => {
        started.push(String(record.toolCallId));
        windows.push([String(record.toolCallId)]);
        if (failedToolCallIds.has(String(record.toolCallId))) {
          return {
            rawToolResultId: `raw:${record.callOrder}`,
            toolExecutionId: record.toolExecutionId,
            toolCallId: record.toolCallId,
            isError: true,
            outputKind: 'error',
            content: {
              code: 'tool_failed',
              message: `failed ${record.toolCallId}`,
              severity: 'error',
              retryable: false,
              source: 'tool',
            },
            createdAt: '2026-06-15T00:00:00.000Z',
          };
        }
        return {
          rawToolResultId: `raw:${record.callOrder}`,
          toolExecutionId: record.toolExecutionId,
          toolCallId: record.toolCallId,
          isError: false,
          outputKind: 'text',
          content: `result for ${record.toolCallId}`,
          createdAt: '2026-06-15T00:00:00.000Z',
        };
      }),
      finalizeWorkspaceChangeSet: vi.fn(),
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
