/*
 * Protects the public Engine boundary: idempotent start and session exclusion.
 */
import { describe, expect, it, vi } from 'vitest';
import { approvalSubjectFor, registeredTool, succeeded, unrestrictedExecutionAccess } from './tool-call-test-fixtures';
import {
  approvalDecisionFor,
  assistantStream,
  collectEvents,
  createRunsFixture,
  neverEndingStream,
  settleRun,
  startedRun,
  startRequest,
} from './runs-test-fixtures';

describe('createRuns', () => {
  it('returns the same accepted Run for an identical requestId', async () => {
    const fixture = createRunsFixture({
      streams: [assistantStream('done')],
    });

    const first = await fixture.runs.start(startRequest);
    const second = await fixture.runs.start(startRequest);

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
    const fixture = createRunsFixture({
      streams: [neverEndingStream()],
      policy: { cancellationTimeoutMs: 10 },
    });

    const first = await fixture.runs.start(startRequest);
    const second = await fixture.runs.start({
      ...startRequest,
      requestId: 'request:2',
    });

    expect(first.status).toBe('started');
    expect(second.status).toBe('session_busy');
    if (first.status === 'started') {
      const cancellation = await fixture.runs.cancel({ runId: first.run.runId });
      if (cancellation.status === 'cancellation_requested') {
        await settleRun(fixture);
      }
    }
  });

  it('returns only the current non-terminal Run for a Session', async () => {
    const fixture = createRunsFixture({
      streams: [neverEndingStream()],
      policy: { cancellationTimeoutMs: 10 },
    });
    const started = await fixture.runs.start(startRequest);
    expect(started.status).toBe('started');
    if (started.status !== 'started') return;

    expect(fixture.runs.getActive({ sessionId: started.run.sessionId })).toMatchObject({
      status: 'found',
      run: { runId: started.run.runId, status: 'running' },
    });
    await fixture.runs.cancel({ runId: started.run.runId });
    expect(fixture.runs.getActive({ sessionId: started.run.sessionId })).toMatchObject({
      status: 'found',
      run: { status: 'cancelling' },
    });
    await settleRun(fixture);
    expect(fixture.runs.getActive({ sessionId: started.run.sessionId })).toEqual({
      status: 'not_found',
      sessionId: started.run.sessionId,
    });
  });

  it('treats requestId reuse with different input as a protocol failure', async () => {
    const fixture = createRunsFixture({
      streams: [assistantStream('done')],
    });

    const first = await fixture.runs.start(startRequest);
    const conflicting = await fixture.runs.start({
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
    const fixture = createRunsFixture({
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

    const resumed = await fixture.runs.resolveApproval({
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
    const duplicate = await fixture.runs.resolveApproval({
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

    const resolved = await fixture.runs.resolveApproval({
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
    const fixture = createRunsFixture({
      streams: [neverEndingStream()],
    });
    const started = await startedRun(fixture);
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(fixture.runs.shutdown({ timeoutMs: 1_000 })).resolves.toEqual({
      status: 'shut_down',
    });
    expect(fixture.runs.get({ runId: started.run.runId })).toMatchObject({
      status: 'found',
      run: { status: 'cancelled' },
    });
    await expect(fixture.runs.start({
      ...startRequest,
      requestId: 'request:after-shutdown',
    })).resolves.toMatchObject({ status: 'failed' });
  });

  it('does not form an unhandled rejection when terminal settlement fails', async () => {
    const fixture = createRunsFixture({
      streams: [assistantStream('answer')],
    });
    const started = await startedRun(fixture);
    // Make only the run.ended publish throw so the settlement step fails after
    // the terminal transition was already recorded; the loop itself keeps
    // publishing its other facts normally.
    const originalPublish = fixture.options.events.publish;
    fixture.options.events.publish = ((event: Parameters<typeof originalPublish>[0]) => {
      if (event.type === 'run.ended') throw new Error('publish down');
      return originalPublish(event);
    }) as never;

    // The Run still reaches its terminal state and the completion settles:
    // an unhandled rejection would fail this test via vitest.
    await vi.waitFor(() => {
      const found = fixture.runs.get({ runId: started.run.runId });
      expect(found.status === 'found' ? found.run.status : undefined).toBe('completed');
    });
  });

  it('keeps shutdown idempotent across repeated calls', async () => {
    const fixture = createRunsFixture({
      streams: [assistantStream('answer')],
    });
    const started = await startedRun(fixture);
    await settleRun(fixture);

    await expect(fixture.runs.shutdown({ timeoutMs: 1_000 })).resolves.toEqual({
      status: 'shut_down',
    });
    await expect(fixture.runs.shutdown({ timeoutMs: 1_000 })).resolves.toEqual({
      status: 'shut_down',
    });
    expect(fixture.runs.get({ runId: started.run.runId })).toMatchObject({
      status: 'found',
      run: { status: 'completed' },
    });
  });
});
