/*
 * Protects the public Engine boundary: idempotent start and session exclusion.
 */
import { describe, expect, it, vi } from 'vitest';
import { approvalSubjectFor, registeredTool, succeeded, unrestrictedExecutionAccess } from './tool-call-test-fixtures';
import {
  approvalDecisionFor,
  assistantStream,
  collectEvents,
  createEngineFixture,
  neverEndingStream,
  settleRun,
  startedRun,
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
      await settleRun(fixture);
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
        await settleRun(fixture);
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
      input: {
        displayContent: [{ type: 'text', text: 'different' }],
        modelContent: [{ type: 'text', text: 'different' }],
        attachments: [],
      },
    });

    expect(conflicting).toMatchObject({
      status: 'failed',
      failure: { code: 'runtime_protocol_violation' },
    });
    if (first.status === 'started') await settleRun(fixture);
  });

  it('resolves an Engine-owned pending approval and continues the same Run in place', async () => {
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

    const started = await startedRun(fixture);
    await vi.waitFor(() => {
      expect(fixture.published.some((event) => event.type === 'approval.requested')).toBe(true);
    });
    const requested = fixture.published.find((event) => event.type === 'approval.requested');
    if (!requested) throw new Error('Expected approval request event.');
    const approval = {
      approvalRequestId: requested.payload.approvalRequestId,
      toolCallId: requested.payload.toolCallId,
    };

    const resumed = await fixture.engine.resolveApproval({
      approvalId: approval.approvalRequestId,
      decision: {
        decision: 'approved',
        optionId: approval.approvalRequestId,
      },
    });
    expect(resumed.status).toBe('accepted');
    if (resumed.status !== 'accepted') throw new Error('Expected accepted approval.');
    // The original Agent Loop keeps waiting; the decision is applied in place.
    expect(resumed.run.status).toBe('waiting');
    expect(fixture.writes).not.toContain('assistant:completed');
    const duplicate = await fixture.engine.resolveApproval({
      approvalId: approval.approvalRequestId,
      decision: {
        decision: 'approved',
        optionId: approval.approvalRequestId,
      },
    });
    expect(duplicate.status).toBe('already_resolved');

    releaseExecution();
    await settleRun(fixture);

    expect(applyApprovalDecision).toHaveBeenCalledOnce();
    expect(executeTool).toHaveBeenCalledOnce();
    expect(fixture.published.some((event) => (
      event.type === 'approval.resolved' && event.payload.decision === 'approved'
    ))).toBe(true);
    expect(fixture.published.at(-1)?.type).toBe('run.ended');
    expect(fixture.published.at(-1)?.payload).toMatchObject({ status: 'completed' });
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
    const started = await startedRun(fixture);
    await vi.waitFor(() => {
      expect(fixture.published.some((event) => event.type === 'approval.requested')).toBe(true);
    });
    const requested = fixture.published.find((event) => event.type === 'approval.requested');
    if (!requested) throw new Error('Expected approval request event.');
    const approvalRequestId = requested.payload.approvalRequestId;

    const resolved = await fixture.engine.resolveApproval({
      approvalId: approvalRequestId,
      decision: { decision: 'approved', optionId: approvalRequestId },
    });
    // The decision is accepted; applying it fails inside the Agent Loop, which
    // closes the pending ToolCall and fails the Run.
    expect(resolved).toMatchObject({ status: 'accepted' });
    await settleRun(fixture);

    expect(fixture.toolResults).toEqual([
      expect.objectContaining({
        tool_call_id: 'provider-call:1',
        status: 'failure',
        error: expect.objectContaining({ code: 'run_failed_before_tool_result' }),
      }),
    ]);
    expect(fixture.published.at(-1)?.type).toBe('run.ended');
    expect(fixture.published.at(-1)?.payload).toMatchObject({ status: 'failed' });
  });

  it('owns shutdown by rejecting new Runs and converging active Runs', async () => {
    const fixture = createEngineFixture({
      streams: [neverEndingStream()],
    });
    const started = await startedRun(fixture);
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

  it('keeps shutdown idempotent across repeated calls', async () => {
    const fixture = createEngineFixture({
      streams: [assistantStream('answer')],
    });
    const started = await startedRun(fixture);
    await settleRun(fixture);

    await expect(fixture.engine.shutdown({ timeoutMs: 1_000 })).resolves.toEqual({
      status: 'shut_down',
    });
    await expect(fixture.engine.shutdown({ timeoutMs: 1_000 })).resolves.toEqual({
      status: 'shut_down',
    });
    expect(fixture.engine.getRun({ runId: started.run.runId })).toMatchObject({
      status: 'found',
      run: { status: 'completed' },
    });
  });
});
