// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createToolUseHandlerService } from '@megumi/desktop/main/services/tool-use-handler.service';
import { createBuiltInToolRegistry } from '@megumi/tools/built-ins';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';
import type {
  ApprovalRequest,
  PermissionDecision,
  ToolCall,
  ToolResult,
  ToolUse,
} from '@megumi/shared/tool-contracts';

describe('ToolUseHandlerService', () => {
  it('persists policy decisions, executes allowed tools, and returns saved ToolResult records', async () => {
    const repository = fakeRepository();
    const executor = {
      executeToolCall: vi.fn(async (toolCall: ToolCall): Promise<ToolResult> => ({
        toolResultId: 'tool-result-1',
        toolUseId: toolCall.toolUseId,
        toolCallId: toolCall.toolCallId,
        runId: toolCall.runId,
        kind: 'success',
        structuredContent: { content: 'hello' },
        textContent: 'hello',
        redactionState: 'none',
        createdAt: '2026-05-20T00:00:02.000Z',
      })),
    };
    const handler = createToolUseHandlerService({
      registry: createBuiltInToolRegistry(),
      repository,
      permissionMode: 'default',
      projectRoot: 'C:/project',
      settings: { allow: [], ask: [], deny: [] },
      projectExecutor: executor,
      now: () => '2026-05-20T00:00:01.000Z',
      ids: fixedIds(),
    });

    const outcome = await handler.handleToolUses({
      request: modelRequest(),
      toolUses: [toolUse('read_file', { path: 'README.md' })],
    });

    expect(repository.saveToolUse).toHaveBeenCalledWith(expect.objectContaining({
      toolUseId: 'tool-use-1',
      toolName: 'read_file',
    }));
    expect(repository.saveToolCall).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: 'tool-call-1',
      toolUseId: 'tool-use-1',
      toolName: 'read_file',
      status: 'requested',
    }));
    expect(repository.savePermissionDecision).toHaveBeenCalledWith(expect.objectContaining({
      permissionDecisionId: 'permission-decision-1',
      decision: 'allow',
      mode: 'default',
    }));
    expect(executor.executeToolCall).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'read_file',
      status: 'running',
    }));
    expect(repository.saveToolCall).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: 'tool-call-1',
      status: 'succeeded',
    }));
    expect(outcome.toolResults).toEqual([expect.objectContaining({
      kind: 'success',
      textContent: 'hello',
    })]);
    expect(outcome.pendingApprovals).toEqual([]);
    expect(repository.saveToolResult).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'success',
      toolCallId: 'tool-call-1',
    }));
  });

  it('does not execute denied tools and returns a saved policy_denied ToolResult', async () => {
    const repository = fakeRepository();
    const executor = { executeToolCall: vi.fn() };
    const handler = createToolUseHandlerService({
      registry: createBuiltInToolRegistry(),
      repository,
      permissionMode: 'plan',
      projectRoot: 'C:/project',
      settings: { allow: [], ask: [], deny: [] },
      projectExecutor: executor,
      now: () => '2026-05-20T00:00:01.000Z',
      ids: fixedIds(),
    });

    const outcome = await handler.handleToolUses({
      request: modelRequest(),
      toolUses: [toolUse('write_file', { path: 'src/index.ts', content: 'export {}' })],
    });

    expect(executor.executeToolCall).not.toHaveBeenCalled();
    expect(repository.savePermissionDecision).toHaveBeenCalledWith(expect.objectContaining({
      permissionDecisionId: 'permission-decision-1',
      decision: 'deny',
      mode: 'plan',
    }));
    expect(repository.saveToolCall).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: 'tool-call-1',
      status: 'denied',
    }));
    expect(outcome.toolResults).toEqual([expect.objectContaining({
      kind: 'policy_denied',
      toolCallId: 'tool-call-1',
    })]);
    expect(outcome.pendingApprovals).toEqual([]);
    expect(repository.saveToolResult).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'policy_denied',
      toolCallId: 'tool-call-1',
    }));
  });

  it('creates ApprovalRequest for ask decisions without executing the tool', async () => {
    const repository = fakeRepository();
    const executor = { executeToolCall: vi.fn() };
    const handler = createToolUseHandlerService({
      registry: createBuiltInToolRegistry(),
      repository,
      permissionMode: 'default',
      projectRoot: 'C:/project',
      settings: { allow: [], ask: [], deny: [] },
      projectExecutor: executor,
      now: () => '2026-05-20T00:00:01.000Z',
      ids: fixedIds(),
    });

    const outcome = await handler.handleToolUses({
      request: modelRequest(),
      toolUses: [toolUse('run_command', { command: 'npm install lodash' })],
    });

    expect(outcome.toolResults).toEqual([]);
    expect(outcome.pendingApprovals).toEqual([expect.objectContaining({
      approvalRequest: expect.objectContaining({
        approvalRequestId: 'approval-request-1',
        toolUseId: 'tool-use-1',
        toolCallId: 'tool-call-1',
        permissionDecisionId: 'permission-decision-1',
        status: 'pending',
      }),
      toolUse: expect.objectContaining({ toolUseId: 'tool-use-1' }),
      toolCall: expect.objectContaining({
        toolCallId: 'tool-call-1',
        status: 'waiting_for_approval',
      }),
    })]);
    expect(executor.executeToolCall).not.toHaveBeenCalled();
    expect(repository.saveApprovalRequest).toHaveBeenCalledWith(expect.objectContaining({
      toolUseId: 'tool-use-1',
      toolCallId: 'tool-call-1',
      permissionDecisionId: 'permission-decision-1',
      status: 'pending',
    }));
    expect(repository.saveToolCall).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: 'tool-call-1',
      status: 'waiting_for_approval',
    }));
  });

  it('resumes approved waiting tool calls by resolving approval and executing the host adapter', async () => {
    const toolCall = waitingToolCall();
    const approvalRequest = pendingApprovalRequest(toolCall);
    const repository = fakeRepository({
      toolCalls: new Map([[toolCall.toolCallId, toolCall]]),
      approvalRequests: new Map([[approvalRequest.approvalRequestId, approvalRequest]]),
    });
    const executor = {
      executeToolCall: vi.fn(async (runningToolCall: ToolCall): Promise<ToolResult> => ({
        toolResultId: 'tool-result-executed',
        toolUseId: runningToolCall.toolUseId,
        toolCallId: runningToolCall.toolCallId,
        runId: runningToolCall.runId,
        kind: 'success',
        textContent: 'executed',
        redactionState: 'none',
        createdAt: '2026-05-20T00:00:04.000Z',
      })),
    };
    const handler = createToolUseHandlerService({
      registry: createBuiltInToolRegistry(),
      repository,
      permissionMode: 'default',
      projectRoot: 'C:/project',
      settings: { allow: [], ask: [], deny: [] },
      projectExecutor: executor,
      now: () => '2026-05-20T00:00:01.000Z',
      ids: fixedIds(),
    });

    const result = await handler.resumeToolApproval({
      approvalRequestId: 'approval-request-1',
      decision: 'approved',
      decidedAt: '2026-05-20T00:00:03.000Z',
    });

    expect(repository.saveApprovalRequest).toHaveBeenCalledWith(expect.objectContaining({
      approvalRequestId: 'approval-request-1',
      status: 'approved',
      resolvedAt: '2026-05-20T00:00:03.000Z',
    }));
    expect(repository.saveToolCall).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: 'tool-call-1',
      status: 'running',
      startedAt: '2026-05-20T00:00:03.000Z',
    }));
    expect(executor.executeToolCall).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: 'tool-call-1',
      status: 'running',
    }));
    expect(repository.saveToolCall).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: 'tool-call-1',
      status: 'succeeded',
      completedAt: '2026-05-20T00:00:04.000Z',
      resultPreview: 'executed',
    }));
    expect(repository.saveToolResult).toHaveBeenCalledWith(expect.objectContaining({
      toolResultId: 'tool-result-executed',
      toolCallId: 'tool-call-1',
      kind: 'success',
    }));
    expect(result).toMatchObject({
      toolResultId: 'tool-result-executed',
      kind: 'success',
    });
  });

  it('resumes denied waiting tool calls by saving a user_rejected ToolResult without execution', async () => {
    const toolCall = waitingToolCall();
    const approvalRequest = pendingApprovalRequest(toolCall);
    const repository = fakeRepository({
      toolCalls: new Map([[toolCall.toolCallId, toolCall]]),
      approvalRequests: new Map([[approvalRequest.approvalRequestId, approvalRequest]]),
    });
    const executor = { executeToolCall: vi.fn() };
    const handler = createToolUseHandlerService({
      registry: createBuiltInToolRegistry(),
      repository,
      permissionMode: 'default',
      projectRoot: 'C:/project',
      settings: { allow: [], ask: [], deny: [] },
      projectExecutor: executor,
      now: () => '2026-05-20T00:00:01.000Z',
      ids: fixedIds(),
    });

    const result = await handler.resumeToolApproval({
      approvalRequestId: 'approval-request-1',
      decision: 'denied',
      decidedAt: '2026-05-20T00:00:03.000Z',
      reason: 'Not now',
    });

    expect(executor.executeToolCall).not.toHaveBeenCalled();
    expect(repository.saveApprovalRequest).toHaveBeenCalledWith(expect.objectContaining({
      approvalRequestId: 'approval-request-1',
      status: 'denied',
      resolvedAt: '2026-05-20T00:00:03.000Z',
    }));
    expect(repository.saveToolCall).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: 'tool-call-1',
      status: 'denied',
      completedAt: '2026-05-20T00:00:03.000Z',
    }));
    expect(repository.saveToolResult).toHaveBeenCalledWith(expect.objectContaining({
      toolResultId: 'tool-result-1',
      toolCallId: 'tool-call-1',
      kind: 'user_rejected',
      denialReason: 'Not now',
    }));
    expect(result).toMatchObject({
      kind: 'user_rejected',
      textContent: 'Not now',
    });
  });
});

function modelRequest(): ModelStepRuntimeRequest {
  return {
    requestId: 'request-1',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    providerId: 'openai',
    modelId: 'gpt-5.2',
    messages: [],
    createdAt: '2026-05-20T00:00:00.000Z',
  };
}

function toolUse(toolName: ToolUse['toolName'], input: ToolUse['input']): ToolUse {
  return {
    toolUseId: 'tool-use-1',
    runId: 'run-1',
    modelStepId: 'model-step-1',
    providerToolUseId: 'provider-tool-use-1',
    toolName,
    input,
    inputPreview: {
      summary: toolName,
      targets: [],
      redactionState: 'none',
    },
    status: 'created',
    createdAt: '2026-05-20T00:00:00.000Z',
  };
}

function fixedIds() {
  return {
    toolCallId: () => 'tool-call-1',
    toolResultId: () => 'tool-result-1',
    permissionDecisionId: () => 'permission-decision-1',
    approvalRequestId: () => 'approval-request-1',
  };
}

function waitingToolCall(): ToolCall {
  return {
    toolCallId: 'tool-call-1',
    toolUseId: 'tool-use-1',
    runId: 'run-1',
    stepId: 'step-1',
    toolName: 'read_file',
    input: { path: 'README.md' },
    inputPreview: {
      summary: 'read_file',
      targets: [],
      redactionState: 'none',
    },
    capabilities: ['project_read'],
    riskLevel: 'low',
    sideEffect: 'none',
    status: 'waiting_for_approval',
    requestedAt: '2026-05-20T00:00:01.000Z',
    approvalRequestId: 'approval-request-1',
  };
}

function pendingApprovalRequest(toolCall: ToolCall): ApprovalRequest {
  return {
    approvalRequestId: 'approval-request-1',
    toolUseId: toolCall.toolUseId,
    toolCallId: toolCall.toolCallId,
    runId: toolCall.runId,
    stepId: String(toolCall.stepId),
    toolName: toolCall.toolName,
    capabilities: toolCall.capabilities,
    riskLevel: toolCall.riskLevel,
    title: 'Approve read_file',
    summary: 'User approval is required.',
    preview: {
      action: 'read_file',
      targets: [],
    },
    requestedScope: 'once',
    status: 'pending',
    createdAt: '2026-05-20T00:00:02.000Z',
  };
}

function fakeRepository(initial?: {
  toolCalls?: Map<string, ToolCall>;
  approvalRequests?: Map<string, ApprovalRequest>;
}) {
  const toolCalls = initial?.toolCalls ?? new Map<string, ToolCall>();
  const approvalRequests = initial?.approvalRequests ?? new Map<string, ApprovalRequest>();

  return {
    saveToolUse: vi.fn((value) => value),
    saveToolCall: vi.fn((value: ToolCall) => {
      toolCalls.set(value.toolCallId, value);
      return value;
    }),
    getToolCall: vi.fn((toolCallId: string) => toolCalls.get(toolCallId)),
    savePermissionDecision: vi.fn((value: PermissionDecision) => value),
    saveApprovalRequest: vi.fn((value: ApprovalRequest) => {
      approvalRequests.set(value.approvalRequestId, value);
      return value;
    }),
    getApprovalRequest: vi.fn((approvalRequestId: string) => approvalRequests.get(approvalRequestId)),
    saveToolResult: vi.fn((value) => value),
  };
}
