// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { buildModelStepInputContextFromSources } from '@megumi/context-management';
import { createToolCallHandlerService } from '@megumi/desktop/main/services/tool/tool-call-handler.service';
import { createBuiltInToolRegistry } from '@megumi/tools/built-ins';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import type {
  ApprovalRequest,
  PermissionDecision,
  ToolCall,
  ToolExecution,
  ToolResult,
} from '@megumi/shared/tool';

describe('ToolCallHandlerService', () => {
  it('saves unknown tools as invalid_tool_call ToolResult without executing a tool', async () => {
    const repository = fakeRepository();
    const executor = { executeToolExecution: vi.fn(), finalizeWorkspaceChangeSet: vi.fn() };
    const handler = createToolCallHandlerService({
      registry: createBuiltInToolRegistry(),
      repository,
      permissionMode: 'default',
      projectRoot: 'C:/project',
      settings: { allow: [], ask: [], deny: [] },
      projectExecutor: executor,
      now: () => '2026-05-20T00:00:01.000Z',
      ids: fixedIds(),
    });

    const outcome = await handler.handleToolCalls({
      request: modelRequest(),
      toolCalls: [toolCall('missing_tool', { path: 'README.md' })],
    });

    expect(repository.saveToolCall).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: 'tool-call-1',
      providerToolCallId: 'provider-tool-call-1',
      toolName: 'missing_tool',
    }));
    expect(executor.executeToolExecution).not.toHaveBeenCalled();
    expect(repository.saveToolExecution).not.toHaveBeenCalled();
    expect(outcome.pendingApprovals).toEqual([]);
    expect(outcome.toolResults).toEqual([expect.objectContaining({
      kind: 'invalid_tool_call',
      toolCallId: 'tool-call-1',
      runId: 'run-1',
      textContent: 'Unknown tool: missing_tool',
    })]);
    expect(repository.saveToolResult).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'invalid_tool_call',
      toolCallId: 'tool-call-1',
    }));
  });

  it('saves schema validation failures as invalid_tool_input ToolResult without executing a tool', async () => {
    const repository = fakeRepository();
    const executor = { executeToolExecution: vi.fn(), finalizeWorkspaceChangeSet: vi.fn() };
    const handler = createToolCallHandlerService({
      registry: createBuiltInToolRegistry(),
      repository,
      permissionMode: 'default',
      projectRoot: 'C:/project',
      settings: { allow: [], ask: [], deny: [] },
      projectExecutor: executor,
      now: () => '2026-05-20T00:00:01.000Z',
      ids: fixedIds(),
    });

    const outcome = await handler.handleToolCalls({
      request: modelRequest(),
      toolCalls: [toolCall('read_file', { path: 123 })],
    });

    expect(repository.saveToolCall).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: 'tool-call-1',
      providerToolCallId: 'provider-tool-call-1',
      toolName: 'read_file',
    }));
    expect(executor.executeToolExecution).not.toHaveBeenCalled();
    expect(repository.saveToolExecution).not.toHaveBeenCalled();
    expect(outcome.pendingApprovals).toEqual([]);
    expect(outcome.toolResults).toEqual([expect.objectContaining({
      kind: 'invalid_tool_input',
      toolCallId: 'tool-call-1',
      runId: 'run-1',
    })]);
    expect(repository.saveToolResult).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'invalid_tool_input',
      toolCallId: 'tool-call-1',
    }));
  });

  it('returns redacted tool results to the loop as model-consumable ToolResult facts', async () => {
    const repository = fakeRepository();
    const executor = {
      executeToolExecution: vi.fn(async (toolExecution: ToolExecution): Promise<ToolResult> => ({
        toolResultId: 'tool-result-redacted',
        toolCallId: toolExecution.toolCallId,
        toolExecutionId: toolExecution.toolExecutionId,
        runId: toolExecution.runId,
        kind: 'redacted',
        textContent: 'secret=[redacted]',
        redactionState: 'redacted',
        structuredContent: { content: 'secret=[redacted]', truncated: true },
        createdAt: '2026-05-20T00:00:02.000Z',
      })),
      finalizeWorkspaceChangeSet: vi.fn(),
    };
    const handler = createToolCallHandlerService({
      registry: createBuiltInToolRegistry(),
      repository,
      permissionMode: 'default',
      projectRoot: 'C:/project',
      settings: { allow: [], ask: [], deny: [] },
      projectExecutor: executor,
      now: () => '2026-05-20T00:00:01.000Z',
      ids: fixedIds(),
    });

    const outcome = await handler.handleToolCalls({
      request: modelRequest(),
      toolCalls: [toolCall('read_file', { path: 'README.md' })],
    });

    expect(outcome.toolResults).toEqual([expect.objectContaining({
      kind: 'redacted',
      redactionState: 'redacted',
      textContent: 'secret=[redacted]',
    })]);
    expect(outcome.runtimeEvents?.map((event) => event.eventType)).toEqual([
      'tool.execution.requested',
      'tool.execution.policy_decided',
      'permission.decision.created',
      'tool.execution.started',
      'tool.execution.completed',
      'tool.result.created',
    ]);
    expect(executor.executeToolExecution).toHaveBeenCalledTimes(1);
  });

  it('persists policy decisions, executes allowed tools, and returns saved ToolResult records', async () => {
    const repository = fakeRepository();
    const executor = {
      executeToolExecution: vi.fn(async (toolExecution: ToolExecution): Promise<ToolResult> => ({
        toolResultId: 'tool-result-1',
        toolCallId: toolExecution.toolCallId,
        toolExecutionId: toolExecution.toolExecutionId,
        runId: toolExecution.runId,
        kind: 'success',
        structuredContent: { content: 'hello' },
        textContent: 'hello',
        redactionState: 'none',
        createdAt: '2026-05-20T00:00:02.000Z',
      })),
      finalizeWorkspaceChangeSet: vi.fn(),
    };
    const handler = createToolCallHandlerService({
      registry: createBuiltInToolRegistry(),
      repository,
      permissionMode: 'default',
      projectRoot: 'C:/project',
      settings: { allow: [], ask: [], deny: [] },
      projectExecutor: executor,
      now: () => '2026-05-20T00:00:01.000Z',
      ids: fixedIds(),
    });

    const outcome = await handler.handleToolCalls({
      request: modelRequest(),
      toolCalls: [toolCall('read_file', { path: 'README.md' })],
    });

    expect(repository.saveToolCall).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: 'tool-call-1',
      toolName: 'read_file',
    }));
    expect(repository.saveToolExecution).toHaveBeenCalledWith(expect.objectContaining({
      toolExecutionId: 'tool-execution-1',
      toolCallId: 'tool-call-1',
      toolName: 'read_file',
      status: 'pending_approval',
    }));
    expect(repository.savePermissionDecision).toHaveBeenCalledWith(expect.objectContaining({
      permissionDecisionId: 'permission-decision-1',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
      decision: 'allow',
      mode: 'default',
    }));
    expect(executor.executeToolExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        toolExecutionId: 'tool-execution-1',
        toolName: 'read_file',
        status: 'running',
      }),
      {
        sessionId: 'session-1',
        runId: 'run-1',
        stepId: 'step-1',
      },
    );
    expect(executor.finalizeWorkspaceChangeSet).toHaveBeenCalledWith({
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
    });
    expect(repository.saveToolExecution).toHaveBeenCalledWith(expect.objectContaining({
      toolExecutionId: 'tool-execution-1',
      status: 'completed',
    }));
    expect(outcome.toolResults).toEqual([expect.objectContaining({
      kind: 'success',
      textContent: 'hello',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
    })]);
    expect(outcome.pendingApprovals).toEqual([]);
    expect(outcome.runtimeEvents?.map((event) => event.eventType)).toEqual([
      'tool.execution.requested',
      'tool.execution.policy_decided',
      'permission.decision.created',
      'tool.execution.started',
      'tool.execution.completed',
      'tool.result.created',
    ]);
    expect(repository.saveToolResult).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'success',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
    }));
  });

  it('does not execute denied tools and returns a saved policy_denied ToolResult', async () => {
    const repository = fakeRepository();
    const executor = { executeToolExecution: vi.fn(), finalizeWorkspaceChangeSet: vi.fn() };
    const handler = createToolCallHandlerService({
      registry: createBuiltInToolRegistry(),
      repository,
      permissionMode: 'plan',
      projectRoot: 'C:/project',
      settings: { allow: [], ask: [], deny: [] },
      projectExecutor: executor,
      now: () => '2026-05-20T00:00:01.000Z',
      ids: fixedIds(),
    });

    const outcome = await handler.handleToolCalls({
      request: modelRequest(),
      toolCalls: [toolCall('write_file', { path: 'src/index.ts', content: 'export {}' })],
    });

    expect(executor.executeToolExecution).not.toHaveBeenCalled();
    expect(repository.savePermissionDecision).toHaveBeenCalledWith(expect.objectContaining({
      permissionDecisionId: 'permission-decision-1',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
      decision: 'deny',
      mode: 'plan',
    }));
    expect(repository.saveToolExecution).toHaveBeenCalledWith(expect.objectContaining({
      toolExecutionId: 'tool-execution-1',
      status: 'denied',
    }));
    expect(outcome.toolResults).toEqual([expect.objectContaining({
      kind: 'policy_denied',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
    })]);
    expect(outcome.pendingApprovals).toEqual([]);
    expect(outcome.runtimeEvents?.map((event) => event.eventType)).toEqual([
      'tool.execution.requested',
      'tool.execution.policy_decided',
      'permission.decision.created',
      'tool.execution.denied',
      'tool.result.created',
    ]);
    expect(repository.saveToolResult).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'policy_denied',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
    }));
  });

  it('creates ApprovalRequest for ask decisions without executing the tool', async () => {
    const repository = fakeRepository();
    const executor = { executeToolExecution: vi.fn(), finalizeWorkspaceChangeSet: vi.fn() };
    const handler = createToolCallHandlerService({
      registry: createBuiltInToolRegistry(),
      repository,
      permissionMode: 'default',
      projectRoot: 'C:/project',
      settings: { allow: [], ask: [], deny: [] },
      projectExecutor: executor,
      now: () => '2026-05-20T00:00:01.000Z',
      ids: fixedIds(),
    });

    const outcome = await handler.handleToolCalls({
      request: modelRequest(),
      toolCalls: [toolCall('run_command', { command: 'npm install lodash' })],
    });

    expect(outcome.toolResults).toEqual([]);
    expect(outcome.pendingApprovals).toEqual([expect.objectContaining({
      approvalRequest: expect.objectContaining({
        approvalRequestId: 'approval-request-1',
        toolCallId: 'tool-call-1',
        toolExecutionId: 'tool-execution-1',
        permissionDecisionId: 'permission-decision-1',
        status: 'pending',
      }),
      toolCall: expect.objectContaining({ toolCallId: 'tool-call-1' }),
      toolExecution: expect.objectContaining({
        toolExecutionId: 'tool-execution-1',
        status: 'pending_approval',
      }),
    })]);
    expect(outcome.runtimeEvents?.map((event) => event.eventType)).toEqual([
      'tool.execution.requested',
      'tool.execution.policy_decided',
      'permission.decision.created',
      'tool.execution.approval_requested',
      'approval.requested',
    ]);
    expect(executor.executeToolExecution).not.toHaveBeenCalled();
    expect(executor.finalizeWorkspaceChangeSet).not.toHaveBeenCalled();
    expect(repository.saveApprovalRequest).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
      permissionDecisionId: 'permission-decision-1',
      status: 'pending',
    }));
    expect(repository.saveToolExecution).toHaveBeenCalledWith(expect.objectContaining({
      toolExecutionId: 'tool-execution-1',
      status: 'pending_approval',
    }));
  });

  it('finalizes executed workspace changes when a later tool pauses for approval', async () => {
    const repository = fakeRepository();
    const executor = {
      executeToolExecution: vi.fn(async (toolExecution: ToolExecution): Promise<ToolResult> => ({
        toolResultId: 'tool-result-1',
        toolCallId: toolExecution.toolCallId,
        toolExecutionId: toolExecution.toolExecutionId,
        runId: toolExecution.runId,
        kind: 'success',
        textContent: 'wrote',
        redactionState: 'none',
        createdAt: '2026-05-20T00:00:02.000Z',
      })),
      finalizeWorkspaceChangeSet: vi.fn(),
    };
    const handler = createToolCallHandlerService({
      registry: createBuiltInToolRegistry(),
      repository,
      permissionMode: 'accept_edits',
      projectRoot: 'C:/project',
      settings: { allow: [], ask: [], deny: [] },
      projectExecutor: executor,
      now: () => '2026-05-20T00:00:01.000Z',
      ids: fixedIds(),
    });

    const outcome = await handler.handleToolCalls({
      request: modelRequest(),
      toolCalls: [
        toolCall('write_file', { path: 'src/app.ts', content: 'export {}' }, 'tool-call-1'),
        toolCall('run_command', { command: 'npm install lodash' }, 'tool-call-2'),
      ],
    });

    expect(outcome.toolResults).toHaveLength(1);
    expect(outcome.pendingApprovals).toHaveLength(1);
    expect(executor.executeToolExecution).toHaveBeenCalledTimes(1);
    expect(executor.finalizeWorkspaceChangeSet).toHaveBeenCalledWith({
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
    });
  });

  it('resumes approved waiting tool executions by resolving approval and executing the host adapter', async () => {
    const toolCall = waitingToolCall();
    const toolExecution = waitingToolExecution(toolCall);
    const approvalRequest = pendingApprovalRequest(toolCall, toolExecution);
    const repository = fakeRepository({
      toolCalls: new Map([[toolCall.toolCallId, toolCall]]),
      toolExecutions: new Map([[toolExecution.toolExecutionId, toolExecution]]),
      approvalRequests: new Map([[approvalRequest.approvalRequestId, approvalRequest]]),
    });
    const executor = {
      executeToolExecution: vi.fn(async (runningToolExecution: ToolExecution): Promise<ToolResult> => ({
        toolResultId: 'tool-result-executed',
        toolCallId: runningToolExecution.toolCallId,
        toolExecutionId: runningToolExecution.toolExecutionId,
        runId: runningToolExecution.runId,
        kind: 'success',
        textContent: 'executed',
        redactionState: 'none',
        createdAt: '2026-05-20T00:00:04.000Z',
      })),
      finalizeWorkspaceChangeSet: vi.fn(),
    };
    const handler = createToolCallHandlerService({
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
    expect(repository.saveToolExecution).toHaveBeenCalledWith(expect.objectContaining({
      toolExecutionId: 'tool-execution-1',
      status: 'running',
      startedAt: '2026-05-20T00:00:03.000Z',
    }));
    expect(executor.executeToolExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        toolExecutionId: 'tool-execution-1',
        status: 'running',
      }),
      {
        sessionId: 'session-1',
        runId: 'run-1',
        stepId: 'step-1',
      },
    );
    expect(executor.finalizeWorkspaceChangeSet).toHaveBeenCalledWith({
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
    });
    expect(repository.saveToolExecution).toHaveBeenCalledWith(expect.objectContaining({
      toolExecutionId: 'tool-execution-1',
      status: 'completed',
      completedAt: '2026-05-20T00:00:04.000Z',
      resultPreview: 'executed',
    }));
    expect(repository.saveToolResult).toHaveBeenCalledWith(expect.objectContaining({
      toolResultId: 'tool-result-executed',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
      kind: 'success',
    }));
    expect(result?.toolResult).toMatchObject({
      toolResultId: 'tool-result-executed',
      kind: 'success',
    });
    expect(result?.runtimeEvents?.map((event) => event.eventType)).toEqual([
      'tool.execution.started',
      'tool.execution.completed',
      'tool.result.created',
    ]);
  });

  it('resumes approved waiting tool executions with failed tool status runtime events', async () => {
    const toolCall = waitingToolCall();
    const toolExecution = waitingToolExecution(toolCall);
    const approvalRequest = pendingApprovalRequest(toolCall, toolExecution);
    const repository = fakeRepository({
      toolCalls: new Map([[toolCall.toolCallId, toolCall]]),
      toolExecutions: new Map([[toolExecution.toolExecutionId, toolExecution]]),
      approvalRequests: new Map([[approvalRequest.approvalRequestId, approvalRequest]]),
    });
    const executor = {
      executeToolExecution: vi.fn(async (runningToolExecution: ToolExecution): Promise<ToolResult> => ({
        toolResultId: 'tool-result-failed',
        toolCallId: runningToolExecution.toolCallId,
        toolExecutionId: runningToolExecution.toolExecutionId,
        runId: runningToolExecution.runId,
        kind: 'tool_error',
        textContent: 'failed',
        error: {
          code: 'runtime_unknown',
          message: 'Tool failed.',
          severity: 'error',
          retryable: false,
          source: 'tool',
        },
        redactionState: 'none',
        createdAt: '2026-05-20T00:00:04.000Z',
      })),
      finalizeWorkspaceChangeSet: vi.fn(),
    };
    const handler = createToolCallHandlerService({
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

    expect(repository.saveToolExecution).toHaveBeenCalledWith(expect.objectContaining({
      toolExecutionId: 'tool-execution-1',
      status: 'failed',
      completedAt: '2026-05-20T00:00:04.000Z',
    }));
    expect(result?.toolResult).toMatchObject({
      toolResultId: 'tool-result-failed',
      kind: 'tool_error',
    });
    expect(result?.runtimeEvents?.map((event) => event.eventType)).toEqual([
      'tool.execution.started',
      'tool.execution.failed',
      'tool.result.created',
    ]);
    expect(executor.finalizeWorkspaceChangeSet).toHaveBeenCalledWith({
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
    });
  });

  it('does not resume approved tool execution when run session cannot be resolved', async () => {
    const toolCall = waitingToolCall();
    const toolExecution = waitingToolExecution(toolCall);
    const approvalRequest = pendingApprovalRequest(toolCall, toolExecution);
    const repository = fakeRepository({
      toolCalls: new Map([[toolCall.toolCallId, toolCall]]),
      toolExecutions: new Map([[toolExecution.toolExecutionId, toolExecution]]),
      approvalRequests: new Map([[approvalRequest.approvalRequestId, approvalRequest]]),
    });
    repository.getRunSessionId.mockReturnValue(undefined);
    const executor = {
      executeToolExecution: vi.fn(),
      finalizeWorkspaceChangeSet: vi.fn(),
    };
    const handler = createToolCallHandlerService({
      registry: createBuiltInToolRegistry(),
      repository,
      permissionMode: 'default',
      projectRoot: 'C:/project',
      settings: { allow: [], ask: [], deny: [] },
      projectExecutor: executor,
      now: () => '2026-05-20T00:00:01.000Z',
      ids: fixedIds(),
    });

    await expect(handler.resumeToolApproval({
      approvalRequestId: 'approval-request-1',
      decision: 'approved',
      decidedAt: '2026-05-20T00:00:03.000Z',
    })).resolves.toBeUndefined();

    expect(repository.saveApprovalRequest).not.toHaveBeenCalledWith(expect.objectContaining({
      approvalRequestId: 'approval-request-1',
      status: 'approved',
    }));
    expect(repository.saveToolExecution).not.toHaveBeenCalledWith(expect.objectContaining({
      toolExecutionId: 'tool-execution-1',
      status: 'running',
    }));
    expect(executor.executeToolExecution).not.toHaveBeenCalled();
    expect(executor.finalizeWorkspaceChangeSet).not.toHaveBeenCalled();
  });

  it('resumes denied waiting tool executions by saving a user_rejected ToolResult without execution', async () => {
    const toolCall = waitingToolCall();
    const toolExecution = waitingToolExecution(toolCall);
    const approvalRequest = pendingApprovalRequest(toolCall, toolExecution);
    const repository = fakeRepository({
      toolCalls: new Map([[toolCall.toolCallId, toolCall]]),
      toolExecutions: new Map([[toolExecution.toolExecutionId, toolExecution]]),
      approvalRequests: new Map([[approvalRequest.approvalRequestId, approvalRequest]]),
    });
    const executor = { executeToolExecution: vi.fn() };
    const handler = createToolCallHandlerService({
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

    expect(executor.executeToolExecution).not.toHaveBeenCalled();
    expect(repository.saveApprovalRequest).toHaveBeenCalledWith(expect.objectContaining({
      approvalRequestId: 'approval-request-1',
      status: 'denied',
      resolvedAt: '2026-05-20T00:00:03.000Z',
    }));
    expect(repository.saveToolExecution).toHaveBeenCalledWith(expect.objectContaining({
      toolExecutionId: 'tool-execution-1',
      status: 'denied',
      completedAt: '2026-05-20T00:00:03.000Z',
    }));
    expect(repository.saveToolResult).toHaveBeenCalledWith(expect.objectContaining({
      toolResultId: 'tool-result-1',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
      kind: 'user_rejected',
      denialReason: 'Not now',
    }));
    expect(result?.toolResult).toMatchObject({
      kind: 'user_rejected',
      textContent: 'Not now',
    });
    expect(result?.runtimeEvents?.map((event) => event.eventType)).toEqual([
      'tool.execution.denied',
      'tool.result.created',
    ]);
  });
});

function modelRequest(): ModelStepRuntimeRequest {
  const createdAt = '2026-05-20T00:00:00.000Z';
  return {
    requestId: 'request-1',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    providerId: 'openai',
    modelId: 'gpt-5.2',
    inputContext: buildModelStepInputContextFromSources({
      contextId: 'model-input-context:tool-handler',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      buildReason: 'test',
      builtAt: createdAt,
    }),
    createdAt,
  };
}

function toolCall(
  toolName: ToolCall['toolName'],
  input: ToolCall['input'],
  toolCallId = 'tool-call-1',
): ToolCall {
  return {
    toolCallId,
    runId: 'run-1',
    modelStepId: 'model-step-1',
    providerToolCallId: `provider-${toolCallId}`,
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
    toolExecutionId: () => 'tool-execution-1',
    toolResultId: () => 'tool-result-1',
    permissionDecisionId: () => 'permission-decision-1',
    approvalRequestId: () => 'approval-request-1',
  };
}

function waitingToolCall(): ToolCall {
  return {
    toolCallId: 'tool-call-1',
    runId: 'run-1',
    modelStepId: 'model-step-1',
    providerToolCallId: 'provider-tool-call-1',
    toolName: 'read_file',
    input: { path: 'README.md' },
    inputPreview: {
      summary: 'read_file',
      targets: [],
      redactionState: 'none',
    },
    status: 'created',
    createdAt: '2026-05-20T00:00:00.000Z',
  };
}

function waitingToolExecution(toolCall: ToolCall): ToolExecution {
  return {
    toolExecutionId: 'tool-execution-1',
    toolCallId: toolCall.toolCallId,
    runId: toolCall.runId,
    stepId: 'step-1',
    toolName: toolCall.toolName,
    input: toolCall.input,
    inputPreview: toolCall.inputPreview,
    capabilities: ['project_read'],
    riskLevel: 'low',
    sideEffect: 'none',
    status: 'pending_approval',
    requestedAt: '2026-05-20T00:00:01.000Z',
    approvalRequestId: 'approval-request-1',
  };
}

function pendingApprovalRequest(toolCall: ToolCall, toolExecution: ToolExecution): ApprovalRequest {
  return {
    approvalRequestId: 'approval-request-1',
    toolCallId: toolCall.toolCallId,
    toolExecutionId: toolExecution.toolExecutionId,
    runId: toolCall.runId,
    stepId: String(toolExecution.stepId),
    toolName: toolCall.toolName,
    capabilities: toolExecution.capabilities,
    riskLevel: toolExecution.riskLevel,
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
  toolExecutions?: Map<string, ToolExecution>;
  approvalRequests?: Map<string, ApprovalRequest>;
}) {
  const toolCalls = initial?.toolCalls ?? new Map<string, ToolCall>();
  const toolExecutions = initial?.toolExecutions ?? new Map<string, ToolExecution>();
  const approvalRequests = initial?.approvalRequests ?? new Map<string, ApprovalRequest>();

  return {
    saveToolCall: vi.fn((value: ToolCall) => {
      toolCalls.set(String(value.toolCallId), value);
      return value;
    }),
    getToolCall: vi.fn((toolCallId: string) => toolCalls.get(toolCallId)),
    saveToolExecution: vi.fn((value: ToolExecution) => {
      toolExecutions.set(String(value.toolExecutionId), value);
      return value;
    }),
    getToolExecution: vi.fn((toolExecutionId: string) => toolExecutions.get(toolExecutionId)),
    savePermissionDecision: vi.fn((value: PermissionDecision) => value),
    saveApprovalRequest: vi.fn((value: ApprovalRequest) => {
      approvalRequests.set(value.approvalRequestId, value);
      return value;
    }),
    getApprovalRequest: vi.fn((approvalRequestId: string) => approvalRequests.get(approvalRequestId)),
    saveToolResult: vi.fn((value: ToolResult) => value),
    getRunSessionId: vi.fn((runId: string) => (runId === 'run-1' ? 'session-1' : undefined)),
  };
}


