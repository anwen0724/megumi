/*
 * Protects the public Engine boundary: idempotent start and session exclusion.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ApprovalRequestedPayload } from '@megumi/events';
import { approvalSubjectFor, registeredTool, succeeded, unrestrictedExecutionAccess } from './tool-call-test-fixtures';
import {
  approvalDecisionFor,
  assistantStream,
  collectEvents,
  createEngineFixture,
  neverEndingStream,
  startRequest,
} from './engine-test-fixtures';

describe('createEngine', () => {
  it('returns the same accepted Run for an identical requestId', async () => {
    const fixture = createEngineFixture({
      streams: [assistantStream('done')],
    });

    const first = await fixture.engine.startRun(startRequest);
    const second = await fixture.engine.startRun(startRequest);

    expect(first.status).toBe('started');
    expect(second.status).toBe('already_started');
    if (first.status === 'started' && second.status === 'already_started') {
      expect(second.run.runId).toBe(first.run.runId);
      expect(second.userEntry.entry_id).toBe(first.userEntry.entry_id);
      await collectEvents(first.events);
    }
    expect(fixture.writes.filter((write) => write === 'user')).toHaveLength(1);
  });

  it('rejects a second active Run in the same Session', async () => {
    const fixture = createEngineFixture({
      streams: [neverEndingStream()],
      policy: { cancellationTimeoutMs: 10 },
    });

    const first = await fixture.engine.startRun(startRequest);
    const second = await fixture.engine.startRun({
      ...startRequest,
      requestId: 'request:2',
    });

    expect(first.status).toBe('started');
    expect(second.status).toBe('session_busy');
    if (first.status === 'started') {
      const cancellation = await fixture.engine.cancelRun({ runId: first.run.runId });
      if (cancellation.status === 'cancellation_requested') {
        await collectEvents(cancellation.events);
      }
    }
  });

  it('treats requestId reuse with different input as a protocol failure', async () => {
    const fixture = createEngineFixture({
      streams: [assistantStream('done')],
    });

    const first = await fixture.engine.startRun(startRequest);
    const conflicting = await fixture.engine.startRun({
      ...startRequest,
      input: { text: 'different', attachments: [] },
    });

    expect(conflicting).toMatchObject({
      status: 'failed',
      failure: { code: 'runtime_protocol_violation' },
    });
    if (first.status === 'started') await collectEvents(first.events);
  });

  it('resumes an Engine-owned pending approval and continues the same Run', async () => {
    const tool = registeredTool('approval-tool');
    let releaseExecution!: () => void;
    const executionGate = new Promise<void>((resolve) => {
      releaseExecution = resolve;
    });
    const executeTool = vi.fn(async ({ toolName }) => {
      await executionGate;
      return succeeded(toolName);
    });
    const applyApprovalDecision = vi.fn(async () => ({
      status: 'applied' as const,
      effect: { type: 'none' as const },
      executionAccess: unrestrictedExecutionAccess,
    }));
    const fixture = createEngineFixture({
      tools: [tool],
      streams: [
        assistantStream('needs approval', {
          id: 'provider-call:1',
          name: tool.registeredToolName,
          arguments: { value: 'x' },
        }),
        assistantStream('completed after approval'),
      ],
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
        applyApprovalDecision,
      },
      executeTool,
    });

    const started = await fixture.engine.startRun(startRequest);
    if (started.status !== 'started') throw new Error('Expected started Run.');
    const firstSegment = await collectEvents(started.events);
    const requested = firstSegment.find((event) => event.eventType === 'approval.requested');
    if (!requested) throw new Error('Expected approval request event.');
    const approvalRequest = (requested.payload as ApprovalRequestedPayload).approvalRequest;
    expect(approvalRequest.options[0]).toHaveProperty('optionId');
    const approval = {
      approvalRequestId: approvalRequest.approvalRequestId,
      defaultOptionId: approvalRequest.defaultOptionId,
    };

    const resumed = await fixture.engine.resumeRun({
      runApprovalId: approval.approvalRequestId,
      decision: {
        decision: 'approved',
        optionId: approval.defaultOptionId,
      },
    });
    expect(resumed.status).toBe('resumed');
    if (resumed.status !== 'resumed') throw new Error('Expected resumed Run.');
    expect(resumed.run.status).toBe('running');
    const duplicate = await fixture.engine.resumeRun({
      runApprovalId: approval.approvalRequestId,
      decision: {
        decision: 'approved',
        optionId: approval.defaultOptionId,
      },
    });
    expect(duplicate.status).toBe('already_resolved');
    expect(fixture.writes).not.toContain('assistant:completed');

    releaseExecution();
    const resumedEvents = await collectEvents(resumed.events);

    expect(applyApprovalDecision).toHaveBeenCalledOnce();
    expect(executeTool).toHaveBeenCalledOnce();
    expect(resumedEvents.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      'approval.resolved',
      'run.resumed',
      'run.completed',
    ]));
    expect(
      resumedEvents.find((event) => event.eventType === 'run.resumed')?.payload,
    ).toEqual({ runApprovalId: approval.approvalRequestId });
    expect(resumedEvents.at(-1)?.eventType).toBe('run.completed');
  });

  it('closes the pending ToolCall when approval application fails', async () => {
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
          status: 'failed',
          failure: { code: 'settings_failed', message: 'Settings failed.' },
        }),
      },
    });
    const started = await fixture.engine.startRun(startRequest);
    if (started.status !== 'started') throw new Error('Expected started Run.');
    const waitingEvents = await collectEvents(started.events);
    const requested = waitingEvents.find((event) => event.eventType === 'approval.requested');
    if (!requested) throw new Error('Expected approval request event.');
    const approvalRequest = (requested.payload as ApprovalRequestedPayload).approvalRequest;
    const approval = {
      approvalRequestId: approvalRequest.approvalRequestId,
      defaultOptionId: approvalRequest.defaultOptionId,
    };

    const resumed = await fixture.engine.resumeRun({
      runApprovalId: approval.approvalRequestId,
      decision: { decision: 'approved', optionId: approval.defaultOptionId },
    });
    expect(resumed).toMatchObject({
      status: 'failed',
      failure: { code: 'permission_failed' },
    });

    expect(fixture.toolResults).toEqual([
      expect.objectContaining({
        tool_call_id: 'provider-call:1',
        status: 'failure',
        error: expect.objectContaining({ code: 'run_failed_before_tool_result' }),
      }),
    ]);
    expect(fixture.published.at(-1)?.eventType).toBe('run.failed');
  });

  it('owns shutdown by rejecting new Runs and converging active Runs', async () => {
    const fixture = createEngineFixture({
      streams: [neverEndingStream()],
    });
    const started = await fixture.engine.startRun(startRequest);
    if (started.status !== 'started') throw new Error('Expected started Run.');
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(fixture.engine.shutdown({ timeoutMs: 1_000 })).resolves.toEqual({
      status: 'shut_down',
    });
    expect(fixture.engine.getRun({ runId: started.run.runId })).toMatchObject({
      status: 'found',
      run: { status: 'cancelled' },
    });
    await expect(fixture.engine.startRun({
      ...startRequest,
      requestId: 'request:after-shutdown',
    })).resolves.toMatchObject({ status: 'failed' });
  });
});
