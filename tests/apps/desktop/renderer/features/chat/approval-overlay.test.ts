/* Ensures composer approvals are selected from, not copied out of, canonical Tool Activity state. */
import { describe, expect, it } from 'vitest';
import type { TimelineMessage } from '@megumi/product/runtime-timeline';
import { collectPendingApprovalActivities } from '@megumi/desktop/renderer/features/chat/approval-overlay';

describe('collectPendingApprovalActivities', () => {
  it('returns only unique awaiting Tool Activities that carry approval facts', () => {
    const pending = tool('pending', 'awaiting_approval', 'approval-1');
    const messages: TimelineMessage[] = [assistant([pending, tool('running', 'running'), pending])];

    expect(collectPendingApprovalActivities(messages)).toEqual([pending]);
  });
});

function tool(id: string, status: 'awaiting_approval' | 'running', approvalRequestId?: string) {
  return {
    itemId: `tool:${id}`, kind: 'tool_activity' as const, toolCallId: id, toolName: 'write_file', status,
    ...(approvalRequestId ? { approval: {
      approvalRequestId, defaultOptionId: `once:${id}`,
      options: [{ optionId: `once:${id}`, scope: 'once' as const, label: 'Once', description: 'Only this call.' }],
    } } : {}),
  };
}

function assistant(items: ReturnType<typeof tool>[]): TimelineMessage {
  return {
    messageId: 'assistant-1', role: 'assistant', projectId: 'workspace-1', sessionId: 'session-1', runId: 'run-1',
    createdAt: '2026-07-20T00:00:00.000Z',
    blocks: [{ blockId: 'process:run-1', kind: 'process_disclosure', runId: 'run-1', status: 'running', items }],
  };
}
