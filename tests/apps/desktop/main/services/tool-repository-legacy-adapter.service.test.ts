// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createLegacyToolRepositoryAdapter } from '@megumi/desktop/main/services/tool-repository-legacy-adapter.service';
import type {
  ApprovalRequest,
  PermissionDecision,
  ToolCall,
  ToolExecution,
  ToolResult,
} from '@megumi/shared/tool-contracts';

describe('createLegacyToolRepositoryAdapter', () => {
  it('writes legacy repository shapes but returns new-domain save inputs with both ids preserved', () => {
    const legacyRepository = fakeLegacyRepository();
    const adapter = createLegacyToolRepositoryAdapter(legacyRepository);
    const toolCall = modelToolCall();
    const toolExecution = hostToolExecution();
    const permissionDecision = toolPermissionDecision();
    const approvalRequest = toolApprovalRequest();
    const toolResult = executionToolResult();

    expect(adapter.saveToolCall(toolCall)).toEqual(toolCall);
    expect(legacyRepository.saveToolUse).toHaveBeenCalledWith(expect.objectContaining({
      toolUseId: 'tool-call-1',
      providerToolUseId: 'provider-tool-call-1',
    }));

    expect(adapter.saveToolExecution(toolExecution)).toEqual(toolExecution);
    expect(legacyRepository.saveToolCall).toHaveBeenCalledWith(expect.objectContaining({
      toolUseId: 'tool-call-1',
      toolCallId: 'tool-execution-1',
    }));

    expect(adapter.savePermissionDecision(permissionDecision)).toEqual(permissionDecision);
    expect(legacyRepository.savePermissionDecision).toHaveBeenCalledWith(expect.objectContaining({
      toolUseId: 'tool-call-1',
      toolCallId: 'tool-execution-1',
    }));

    expect(adapter.saveApprovalRequest(approvalRequest)).toEqual(approvalRequest);
    expect(legacyRepository.saveApprovalRequest).toHaveBeenCalledWith(expect.objectContaining({
      toolUseId: 'tool-call-1',
      toolCallId: 'tool-execution-1',
    }));

    expect(adapter.saveToolResult(toolResult)).toEqual(toolResult);
    expect(legacyRepository.saveToolResult).toHaveBeenCalledWith(expect.objectContaining({
      toolUseId: 'tool-call-1',
      toolCallId: 'tool-execution-1',
    }));
  });

  it('maps legacy get rows back to new-domain ids', () => {
    const legacyRepository = fakeLegacyRepository();
    const adapter = createLegacyToolRepositoryAdapter(legacyRepository);

    expect(adapter.getToolCall('tool-call-1')).toEqual(expect.objectContaining({
      toolCallId: 'tool-call-1',
      providerToolCallId: 'provider-tool-call-1',
      modelStepId: 'model-step-1',
    }));
    expect(adapter.getToolCall('tool-call-1')).not.toHaveProperty('toolUseId');
    expect(adapter.getToolCall('tool-call-1')).not.toHaveProperty('providerToolUseId');

    expect(adapter.getToolExecution('tool-execution-1')).toEqual(expect.objectContaining({
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
      stepId: 'step-1',
    }));
    expect(adapter.getToolExecution('tool-execution-1')).not.toHaveProperty('toolUseId');

    expect(adapter.getApprovalRequest('approval-request-1')).toEqual(expect.objectContaining({
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
      approvalRequestId: 'approval-request-1',
    }));
    expect(adapter.getApprovalRequest('approval-request-1')).not.toHaveProperty('toolUseId');
  });
});

function fakeLegacyRepository() {
  return {
    saveToolUse: vi.fn((value: unknown) => ({
      ...value as Record<string, unknown>,
      toolUseId: 'legacy-return-tool-use-id',
      providerToolUseId: 'legacy-return-provider-tool-use-id',
    })),
    getToolUse: vi.fn(() => ({
      ...modelToolCall(),
      toolUseId: 'tool-call-1',
      providerToolUseId: 'provider-tool-call-1',
      toolCallId: 'legacy-return-tool-call-id',
      providerToolCallId: 'legacy-return-provider-tool-call-id',
    })),
    saveToolCall: vi.fn((value: unknown) => ({
      ...value as Record<string, unknown>,
      toolUseId: 'legacy-return-tool-use-id',
      toolCallId: 'legacy-return-tool-execution-id',
    })),
    getToolCall: vi.fn(() => ({
      ...hostToolExecution(),
      toolUseId: 'tool-call-1',
      toolCallId: 'tool-execution-1',
      toolExecutionId: 'legacy-return-tool-execution-id',
    })),
    savePermissionDecision: vi.fn((value: unknown) => ({
      ...value as Record<string, unknown>,
      toolUseId: 'legacy-return-tool-use-id',
      toolCallId: 'legacy-return-tool-execution-id',
    })),
    saveApprovalRequest: vi.fn((value: unknown) => ({
      ...value as Record<string, unknown>,
      toolUseId: 'legacy-return-tool-use-id',
      toolCallId: 'legacy-return-tool-execution-id',
    })),
    getApprovalRequest: vi.fn(() => ({
      ...toolApprovalRequest(),
      toolUseId: 'tool-call-1',
      toolCallId: 'tool-execution-1',
      toolExecutionId: 'legacy-return-tool-execution-id',
    })),
    saveToolResult: vi.fn((value: unknown) => ({
      ...value as Record<string, unknown>,
      toolUseId: 'legacy-return-tool-use-id',
      toolCallId: 'legacy-return-tool-execution-id',
    })),
  };
}

function modelToolCall(): ToolCall {
  return {
    toolCallId: 'tool-call-1',
    runId: 'run-1',
    modelStepId: 'model-step-1',
    providerToolCallId: 'provider-tool-call-1',
    toolName: 'read_file',
    input: { path: 'README.md' },
    inputPreview: inputPreview(),
    status: 'created',
    createdAt: '2026-05-20T00:00:00.000Z',
  };
}

function hostToolExecution(): ToolExecution {
  return {
    toolExecutionId: 'tool-execution-1',
    toolCallId: 'tool-call-1',
    runId: 'run-1',
    stepId: 'step-1',
    toolName: 'read_file',
    input: { path: 'README.md' },
    inputPreview: inputPreview(),
    capabilities: ['project_read'],
    riskLevel: 'low',
    sideEffect: 'none',
    status: 'pending_approval',
    requestedAt: '2026-05-20T00:00:01.000Z',
  };
}

function toolPermissionDecision(): PermissionDecision {
  return {
    permissionDecisionId: 'permission-decision-1',
    toolCallId: 'tool-call-1',
    toolExecutionId: 'tool-execution-1',
    runId: 'run-1',
    decision: 'ask',
    source: 'permission_mode',
    reason: 'approval required',
    mode: 'default',
    capability: 'project_read',
    sideEffect: 'none',
    effectiveRiskLevel: 'low',
    evaluatedAt: '2026-05-20T00:00:01.000Z',
  };
}

function toolApprovalRequest(): ApprovalRequest {
  return {
    approvalRequestId: 'approval-request-1',
    toolCallId: 'tool-call-1',
    toolExecutionId: 'tool-execution-1',
    permissionDecisionId: 'permission-decision-1',
    runId: 'run-1',
    stepId: 'step-1',
    toolName: 'read_file',
    capabilities: ['project_read'],
    riskLevel: 'low',
    title: 'Read README.md',
    summary: 'read_file README.md',
    preview: {
      action: 'Read README.md',
      targets: [{ kind: 'file', label: 'README.md' }],
    },
    requestedScope: 'once',
    status: 'pending',
    createdAt: '2026-05-20T00:00:01.000Z',
  };
}

function executionToolResult(): ToolResult {
  return {
    toolResultId: 'tool-result-1',
    toolCallId: 'tool-call-1',
    toolExecutionId: 'tool-execution-1',
    runId: 'run-1',
    kind: 'success',
    textContent: 'ok',
    redactionState: 'none',
    createdAt: '2026-05-20T00:00:02.000Z',
  };
}

function inputPreview() {
  return {
    summary: 'read_file README.md',
    targets: [{ kind: 'file' as const, label: 'README.md' }],
    redactionState: 'none' as const,
  };
}
