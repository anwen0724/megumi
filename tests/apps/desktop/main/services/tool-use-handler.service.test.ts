// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createToolUseHandlerService } from '@megumi/desktop/main/services/tool-use-handler.service';
import { createBuiltInToolRegistry } from '@megumi/tools/built-ins';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';
import type {
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

function fakeRepository() {
  return {
    saveToolUse: vi.fn((value) => value),
    saveToolCall: vi.fn((value) => value),
    savePermissionDecision: vi.fn((value: PermissionDecision) => value),
    saveApprovalRequest: vi.fn((value) => value),
    saveToolResult: vi.fn((value) => value),
  };
}
