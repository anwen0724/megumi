// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ToolService } from '@megumi/desktop/main/services/tool.service';
import { createBuiltInToolRegistry } from '@megumi/tools/built-ins';
import { createRuntimeEvent } from '@megumi/shared/runtime-event-factory';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';

describe('ToolService', () => {
  it('lists built-in tool definitions without executing them', () => {
    const repository = {
      getToolExecution: vi.fn(),
      getApprovalRequest: vi.fn(),
      saveApprovalRecord: vi.fn(),
    };
    const service = new ToolService({
      registry: createBuiltInToolRegistry(),
      repository: repository as never,
    });

    expect(service.listDefinitions({ runId: 'run-1' }).map((tool) => tool.name)).toEqual([
      'read_file',
      'list_directory',
      'glob',
      'search_text',
      'edit_file',
      'write_file',
      'run_command',
    ]);
    expect(repository.getToolExecution).not.toHaveBeenCalled();
    expect(repository.getApprovalRequest).not.toHaveBeenCalled();
    expect(repository.saveApprovalRecord).not.toHaveBeenCalled();
  });

  it('returns canonical tool executions from the repository', () => {
    const repository = {
      getToolExecution: vi.fn(() => createToolExecution()),
      getApprovalRequest: vi.fn(),
      saveApprovalRecord: vi.fn(),
    };
    const service = new ToolService({
      registry: createBuiltInToolRegistry(),
      repository: repository as never,
    });

    const toolExecution = service.getToolExecution('tool-execution-1');

    expect(repository.getToolExecution).toHaveBeenCalledWith('tool-execution-1');
    expect(toolExecution).toEqual(expect.objectContaining({
      toolExecutionId: 'tool-execution-1',
      toolCallId: 'tool-call-1',
      stepId: 'step-1',
    }));
  });

  it('resolves approvals, updates request status, and exposes resumed runtime events', async () => {
    const approvalRequest = createApprovalRequest();
    const repository = {
      getToolExecution: vi.fn(),
      getApprovalRequest: vi.fn(() => approvalRequest),
      saveApprovalRecord: vi.fn((value) => value),
      saveApprovalRequest: vi.fn((value) => value),
    };
    const resumedEvent = createRuntimeEvent({
      eventId: 'event-approval-resolved',
      eventType: 'approval.resolved',
      runId: 'run-1',
      sessionId: 'session-1',
      stepId: 'step-1',
      sequence: 1,
      createdAt: '2026-05-20T00:00:03.000Z',
      source: 'approval',
      visibility: 'user',
      persist: 'required',
      payload: {
        approvalRequestId: 'approval-request-1',
        decision: 'approved',
        scope: 'once',
        decidedAt: '2026-05-20T00:00:03.000Z',
      },
    });
    const resumeApproval = vi.fn(() => asyncEvents([resumedEvent]));
    const service = new ToolService({
      registry: createBuiltInToolRegistry(),
      repository: repository as never,
      resumeApproval,
      idFactory: {
        approvalRecordId: () => 'approval-record-1',
      },
    });

    const response = service.resolveApproval({
      approvalRequestId: 'approval-request-1',
      decision: 'approved',
      scope: 'once',
      decidedAt: '2026-05-20T00:00:03.000Z',
      reason: 'Looks fine',
    });
    const events = [];
    for await (const event of response.events ?? []) {
      events.push(event);
    }

    expect(response.approval).toMatchObject({
      approvalRecordId: 'approval-record-1',
      approvalRequestId: 'approval-request-1',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
      decision: 'approved',
      scope: 'once',
      reason: 'Looks fine',
    });
    expect(repository.saveApprovalRecord).toHaveBeenCalledWith(expect.objectContaining({
      approvalRecordId: 'approval-record-1',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
    }));
    expect(repository.saveApprovalRequest).toHaveBeenCalledWith(expect.objectContaining({
      approvalRequestId: 'approval-request-1',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
      status: 'approved',
      resolvedAt: '2026-05-20T00:00:03.000Z',
    }));
    expect(resumeApproval).toHaveBeenCalledWith({
      approvalRequestId: 'approval-request-1',
      decision: 'approved',
      decidedAt: '2026-05-20T00:00:03.000Z',
      reason: 'Looks fine',
    });
    expect(events).toEqual([expect.objectContaining({
      eventType: 'approval.resolved',
      payload: expect.objectContaining({
        approvalRequestId: 'approval-request-1',
        decision: 'approved',
      }),
    })]);
  });

  it('rejects a second resolve for an already resolved approval request without overwriting state or resuming again', () => {
    const approvalRequest = createApprovalRequest();
    const approvalRequests = new Map<string, ReturnType<typeof createApprovalRequest>>([
      [approvalRequest.approvalRequestId, approvalRequest],
    ]);
    const repository = {
      getToolExecution: vi.fn(),
      getApprovalRequest: vi.fn((approvalRequestId: string) => approvalRequests.get(approvalRequestId)),
      saveApprovalRecord: vi.fn((value) => value),
      saveApprovalRequest: vi.fn((value: ReturnType<typeof createApprovalRequest>) => {
        approvalRequests.set(value.approvalRequestId, value);
        return value;
      }),
    };
    const resumeApproval = vi.fn(() => asyncEvents([]));
    const service = new ToolService({
      registry: createBuiltInToolRegistry(),
      repository: repository as never,
      resumeApproval,
      idFactory: {
        approvalRecordId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `approval-record-${index}`;
          };
        })(),
      },
    });

    const first = service.resolveApproval({
      approvalRequestId: 'approval-request-1',
      decision: 'approved',
      scope: 'once',
      decidedAt: '2026-05-20T00:00:03.000Z',
    });

    expect(first.approval).toMatchObject({
      approvalRecordId: 'approval-record-1',
      decision: 'approved',
    });
    expect(() => service.resolveApproval({
      approvalRequestId: 'approval-request-1',
      decision: 'denied',
      scope: 'once',
      decidedAt: '2026-05-20T00:00:04.000Z',
      reason: 'Changed my mind',
    })).toThrow(/already resolved/);
    expect(approvalRequests.get('approval-request-1')).toMatchObject({
      status: 'approved',
      resolvedAt: '2026-05-20T00:00:03.000Z',
    });
    expect(repository.saveApprovalRecord).toHaveBeenCalledTimes(1);
    expect(resumeApproval).toHaveBeenCalledTimes(1);
  });
});

async function* asyncEvents(events: RuntimeEvent[]): AsyncIterable<RuntimeEvent> {
  yield* events;
}

function createToolExecution() {
  return {
    toolExecutionId: 'tool-execution-1',
    toolCallId: 'tool-call-1',
    runId: 'run-1',
    stepId: 'step-1',
    toolName: 'read_file',
    input: { path: 'README.md' },
    inputPreview: {
      summary: 'read_file README.md',
      targets: [{ kind: 'file', label: 'README.md' }],
      redactionState: 'none',
    },
    capabilities: ['project_read'],
    riskLevel: 'low',
    sideEffect: 'none',
    status: 'pending_approval',
    requestedAt: '2026-05-20T00:00:01.000Z',
  };
}

function createApprovalRequest() {
  return {
    approvalRequestId: 'approval-request-1',
    toolCallId: 'tool-call-1',
    toolExecutionId: 'tool-execution-1',
    runId: 'run-1',
    stepId: 'step-1',
    toolName: 'read_file',
    capabilities: ['project_read'],
    riskLevel: 'low',
    title: 'Approve read_file',
    summary: 'User approval is required.',
    preview: {
      action: 'read_file',
      targets: [],
    },
    requestedScope: 'once',
    status: 'pending',
    createdAt: '2026-05-20T00:00:02.000Z',
  } as const;
}
