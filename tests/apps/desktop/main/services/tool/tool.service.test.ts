// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ToolRegistryService } from '@megumi/coding-agent/tools';
import { ApprovalResolutionService } from '@megumi/coding-agent/host-interface/permissions/approval-resolution-service';
import { createRuntimeEvent } from '@megumi/shared/runtime';
import type { RuntimeEvent } from '@megumi/shared/runtime';

describe('ToolRegistryService desktop integration surface', () => {
  it('lists built-in registered tool definitions without executing them', () => {
    const service = new ToolRegistryService();

    expect(service.listAvailableTools().tools.map((tool) => tool.registeredToolName)).toEqual([
      'read_file',
      'list_directory',
      'glob',
      'search_text',
      'edit_file',
      'write_file',
      'run_command',
    ]);
  });

  it('returns registered tool metadata by model tool call name', () => {
    const service = new ToolRegistryService();

    expect(service.getRegisteredTool({ toolName: 'read_file' })).toMatchObject({
      type: 'found',
      tool: {
        registeredToolName: 'read_file',
        identity: {
          sourceId: 'built_in',
          namespace: 'megumi',
          sourceToolName: 'read_file',
        },
      },
    });
  });
});

describe('ApprovalResolutionService desktop integration surface', () => {
  it('resolves approvals, updates request status, and exposes resumed runtime events', async () => {
    const approvalRequest = createApprovalRequest();
    const repository = {
      getApprovalRequest: vi.fn(() => approvalRequest),
      resolveApprovalRequest: vi.fn((value) => value),
      createApprovalRequest: vi.fn((value) => value),
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
    const service = new ApprovalResolutionService({
      repository,
      resumeApproval,
      idFactory: {
        approvalRecordId: () => 'approval-record-1',
      },
    });

    const response = service.resolve({
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

    expect(response.data.approval).toMatchObject({
      approvalRecordId: 'approval-record-1',
      approvalRequestId: 'approval-request-1',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
      decision: 'approved',
      scope: 'once',
      reason: 'Looks fine',
    });
    expect(repository.resolveApprovalRequest).toHaveBeenCalledWith(expect.objectContaining({
      approvalRecordId: 'approval-record-1',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
    }));
    expect(repository.createApprovalRequest).toHaveBeenCalledWith(expect.objectContaining({
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
      getApprovalRequest: vi.fn((approvalRequestId: string) => approvalRequests.get(approvalRequestId)),
      resolveApprovalRequest: vi.fn((value) => value),
      createApprovalRequest: vi.fn((value: ReturnType<typeof createApprovalRequest>) => {
        approvalRequests.set(value.approvalRequestId, value);
        return value;
      }),
    };
    const resumeApproval = vi.fn(() => asyncEvents([]));
    const service = new ApprovalResolutionService({
      repository,
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

    const first = service.resolve({
      approvalRequestId: 'approval-request-1',
      decision: 'approved',
      scope: 'once',
      decidedAt: '2026-05-20T00:00:03.000Z',
    });

    expect(first.data.approval).toMatchObject({
      approvalRecordId: 'approval-record-1',
      decision: 'approved',
    });
    expect(() => service.resolve({
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
    expect(repository.resolveApprovalRequest).toHaveBeenCalledTimes(1);
    expect(resumeApproval).toHaveBeenCalledTimes(1);
  });
});

async function* asyncEvents(events: RuntimeEvent[]): AsyncIterable<RuntimeEvent> {
  yield* events;
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
