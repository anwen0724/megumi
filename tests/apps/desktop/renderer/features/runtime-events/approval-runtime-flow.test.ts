/*
 * Protects the complete Megumi Agent Event to Desktop approval-control projection.
 */
import { EventSchema } from '@megumi/events';
import type { PermissionDecision } from '@megumi/permissions';
import { reduceRuntimeTimelineEvent } from '@megumi/desktop/renderer/features/session-timeline';
import { describe, expect, it, vi } from 'vitest';
import { collectPendingApprovalActivities } from '../../../../../../apps/desktop/src/renderer/features/chat/approval-overlay';
import {
  assistantStream,
  collectEvents,
  createExecutionFixture,
  launchedExecution,
} from '../../../../../packages/discovery/execution-test-fixtures';
import {
  permissionService,
  registeredTool,
} from '../../../../../packages/discovery/tool-call-test-fixtures';

describe('approval Runtime flow', () => {
  it('projects a Megumi Agent approval event into a resolvable Desktop approval activity', async () => {
    const tool = registeredTool('approval-tool');
    const fixture = createExecutionFixture({
      tools: [tool],
      streams: [
        assistantStream('needs approval', {
          id: 'provider-call:1',
          name: tool.registeredToolName,
          arguments: { value: 'x' },
        }),
        assistantStream('done'),
      ],
      permissions: permissionService(approvalDecisionFor),
    });
    let resolveApproval!: (resolution: { readonly status: 'cancelled' }) => void;
    const approval = new Promise<{ readonly status: 'cancelled' }>((resolve) => { resolveApproval = resolve; });
    const launched = await launchedExecution(fixture, { awaitApproval: async () => approval });
    const completion = launched.execute();

    await vi.waitFor(() => {
      expect(fixture.published.some((event) => event.type === 'approval.requested')).toBe(true);
    });

    const events = collectEvents(fixture, 'execution:1');
    const approvalEvent = events.find((event) => event.type === 'approval.requested');
    expect(approvalEvent).toBeDefined();
    expect(EventSchema.safeParse(approvalEvent).success).toBe(true);

    const messages = events.reduce(
      (current, event) => reduceRuntimeTimelineEvent(current, event, 'project-1'),
      [],
    );
    expect(collectPendingApprovalActivities(messages)).toEqual([
      expect.objectContaining({
        toolCallId: 'provider-call:1',
        toolName: tool.registeredToolName,
        status: 'awaiting_approval',
        approval: expect.objectContaining({
          approvalRequestId: expect.any(String),
          summary: expect.any(String),
        }),
      }),
    ]);

    resolveApproval({ status: 'cancelled' });
    await completion;
  });
});

function approvalDecisionFor(
  request: import('@megumi/permissions').EvaluateToolCallRequest,
): Extract<PermissionDecision, { type: 'requires_approval' }> {
  const identity = request.operations[0]?.context.toolIdentity ?? {
    sourceId: 'built_in', namespace: 'megumi', sourceToolName: 'internal', registeredToolName: 'internal',
  };
  return {
    type: 'requires_approval',
    operations: [...request.operations],
    safetyAssessment: 'safe',
    safetySummary: 'Safe in test.',
    reason: 'Approval required.',
    options: [{
      optionId: `once:${request.toolCallId}`,
      scope: 'once',
      display: { label: 'Once', description: 'Allow once.' },
      effect: { type: 'current_tool_call' },
    }],
    defaultOptionId: `once:${request.toolCallId}`,
    subjectFingerprint: `test-subject:${request.toolCallId}:${identity.registeredToolName}`,
  };
}
