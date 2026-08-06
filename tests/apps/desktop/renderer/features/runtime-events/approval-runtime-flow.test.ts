/*
 * Protects the complete Engine Event to Desktop approval-control projection.
 */
import { EventSchema } from '@megumi/events';
import { createRuntimeTimeline, reduceRuntimeTimeline } from '@megumi/projections';
import { describe, expect, it, vi } from 'vitest';
import { collectPendingApprovalActivities } from '../../../../../../apps/desktop/src/renderer/features/chat/approval-overlay';
import {
  approvalDecisionFor,
  assistantStream,
  collectEvents,
  createRunsFixture,
  startRequest,
} from '../../../../../packages/engine/runs-test-fixtures';
import {
  approvalSubjectFor,
  registeredTool,
} from '../../../../../packages/engine/tool-call-test-fixtures';

describe('approval Runtime flow', () => {
  it('projects an Engine approval event into a resolvable Desktop approval activity', async () => {
    const tool = registeredTool('approval-tool');
    const fixture = createRunsFixture({
      tools: [tool],
      streams: [assistantStream('needs approval', {
        id: 'provider-call:1',
        name: tool.registeredToolName,
        arguments: { value: 'x' },
      })],
      permissions: {
        evaluateToolCall: async (request) => {
          const decision = approvalDecisionFor(request);
          return {
            status: 'ok',
            operations: decision.operations,
            decision,
            approvalSubject: approvalSubjectFor(request, decision),
          };
        },
        applyApprovalDecision: async () => ({
          status: 'applied',
          effect: { type: 'none' },
        }),
      },
    });

    const started = await fixture.runs.start(startRequest);
    if (started.status !== 'started') throw new Error('Expected started Run.');

    // The engine emits asynchronously; wait until the approval fact settles.
    await vi.waitFor(() => {
      expect(fixture.published.some((event) => event.type === 'approval.requested')).toBe(true);
    });

    const events = collectEvents(fixture, started.run.runId);
    const approvalEvent = events.find((event) => event.type === 'approval.requested');
    expect(approvalEvent).toBeDefined();
    expect(EventSchema.safeParse(approvalEvent).success).toBe(true);

    const timeline = events.reduce(
      (current, event) => reduceRuntimeTimeline({ timeline: current, event }),
      createRuntimeTimeline({}),
    );
    expect(collectPendingApprovalActivities(timeline.messages)).toEqual([
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
  });
});
