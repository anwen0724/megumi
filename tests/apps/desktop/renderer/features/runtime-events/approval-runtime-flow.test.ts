/*
 * Protects the complete Engine Event to Desktop approval-control projection.
 */
import { RuntimeEventSchema } from '@megumi/events';
import { createRuntimeTimeline, reduceRuntimeTimeline } from '@megumi/projections';
import { describe, expect, it } from 'vitest';
import { collectPendingApprovalActivities } from '../../../../../../apps/desktop/src/renderer/features/chat/approval-overlay';
import {
  approvalDecisionFor,
  assistantStream,
  collectEvents,
  createEngineFixture,
  startRequest,
} from '../../../../../packages/engine/engine-test-fixtures';
import {
  approvalSubjectFor,
  registeredTool,
} from '../../../../../packages/engine/tool-call-test-fixtures';

describe('approval Runtime flow', () => {
  it('projects an Engine approval event into a resolvable Desktop approval activity', async () => {
    const tool = registeredTool('approval-tool');
    const fixture = createEngineFixture({
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

    const started = await fixture.engine.startRun(startRequest);
    if (started.status !== 'started') throw new Error('Expected started Run.');
    const events = await collectEvents(started.events);
    const approvalEvent = events.find((event) => event.eventType === 'approval.requested');
    expect(approvalEvent).toBeDefined();
    expect(RuntimeEventSchema.safeParse(approvalEvent).success).toBe(true);

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
          approvalRequestId: expect.stringMatching(/^approval:/),
          defaultOptionId: expect.stringMatching(/^once:/),
          options: expect.arrayContaining([
            expect.objectContaining({
              optionId: expect.stringMatching(/^once:/),
              scope: 'once',
            }),
          ]),
        }),
      }),
    ]);

    const cancellation = await fixture.engine.cancelRun({ runId: started.run.runId });
    if (cancellation.status === 'cancellation_requested') {
      await collectEvents(cancellation.events);
    }
  });
});
