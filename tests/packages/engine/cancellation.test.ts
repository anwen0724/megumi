/*
 * Protects cancellation convergence and bounded failure for uncooperative work.
 */
import { describe, expect, it, vi } from 'vitest';
import type { CancelRunResult } from '@megumi/engine';
import {
  collectEvents,
  createRunsFixture,
  neverEndingStream,
  partialNeverEndingStream,
  partialThinkingStream,
  assistantStream,
  approvalDecisionFor,
  requestedCancellation,
  settleRun,
  startedRun,
  startRequest,
} from './runs-test-fixtures';
import { approvalSubjectFor, registeredTool } from './tool-call-test-fixtures';

describe('Engine cancellation', () => {
  it('cancels a Run whose Context build observes the Run AbortSignal', async () => {
    const fixture = createRunsFixture({
      contextBuild: (request) => new Promise((resolve) => {
        const resolveCancelled = () => resolve({
          status: 'failed',
          failure: {
            code: 'cancelled',
            message: 'cancelled',
            retryable: false,
          },
        });
        if (request.signal?.aborted) {
          resolveCancelled();
          return;
        }
        request.signal?.addEventListener('abort', resolveCancelled, { once: true });
      }),
    });
    const started = await startedRun(fixture);

    const cancellation = await fixture.runs.cancel({ executionId: started.run.executionId });
    expect(cancellation.status).toBe('cancellation_requested');
    if (cancellation.status !== 'cancellation_requested') {
      throw new Error('Expected cancellation request.');
    }
    await settleRun(fixture);
    expect(fixture.published.at(-1)?.type).toBe('run.ended');
    expect(fixture.published.at(-1)?.payload).toMatchObject({ status: 'cancelled' });
    expect(fixture.writes.at(-1)).toBe('assistant:cancelled');
  });

  it('commits valid streamed text as the cancelled Assistant Reply', async () => {
    const fixture = createRunsFixture({
      streams: [partialNeverEndingStream('partial answer')],
    });
    const started = await startedRun(fixture);
    await new Promise((resolve) => setTimeout(resolve, 0));

    await requestedCancellation(fixture, started.run.executionId);
    await settleRun(fixture);

    expect(fixture.published.at(-1)?.payload).toMatchObject({ status: 'cancelled' });
    expect(fixture.assistantReplies).toEqual([
      expect.objectContaining({
        status: 'cancelled',
        reason_code: 'user_cancelled',
        content: [{ type: 'text', text: 'partial answer' }],
      }),
    ]);
  });

  it('closes a persisted ToolCall with a cancelled ToolResult before Run cancellation', async () => {
    const tool = registeredTool('slow-tool');
    const executeTool = vi.fn(async (request, options) => new Promise<{
      type: 'failed';
      toolName: string;
      error: { code: 'tool_cancelled'; message: string };
      normalizedResult: {
        kind: 'error';
        content: string;
        isError: true;
        truncated: false;
      };
    }>((resolve) => {
      options?.signal?.addEventListener('abort', () => resolve({
        type: 'failed',
        toolName: request.toolName,
        error: { code: 'tool_cancelled', message: 'cancelled' },
        normalizedResult: {
          kind: 'error',
          content: 'cancelled',
          isError: true,
          truncated: false,
        },
      }), { once: true });
    }));
    const fixture = createRunsFixture({
      tools: [tool],
      executeTool,
      streams: [assistantStream('using tool', {
        id: 'provider-call:1',
        name: tool.registeredToolName,
        arguments: { value: 'x' },
      })],
    });
    const started = await startedRun(fixture);
    await vi.waitFor(() => expect(executeTool).toHaveBeenCalledOnce());

    await requestedCancellation(fixture, started.run.executionId);
    await settleRun(fixture);

    expect(fixture.published.at(-1)?.payload).toMatchObject({ status: 'cancelled' });
    expect(fixture.toolResults).toEqual([
      expect.objectContaining({
        tool_name: 'slow-tool',
        status: 'cancelled',
      }),
    ]);
    expect(fixture.writes.slice(-2)).toEqual(['tool', 'assistant:cancelled']);
  });

  it('closes every persisted waiting ToolCall before cancelling the Run', async () => {
    const tool = registeredTool('approval-tool');
    const fixture = createRunsFixture({
      tools: [tool],
      streams: [assistantStream('waiting', {
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
    const started = await startedRun(fixture);
    await vi.waitFor(() => {
      expect(fixture.published.some((event) => event.type === 'approval.requested')).toBe(true);
    });
    collectEvents(fixture, started.run.executionId);

    await requestedCancellation(fixture, started.run.executionId);
    await settleRun(fixture);

    expect(fixture.toolResults).toEqual([
      expect.objectContaining({
        tool_call_id: 'provider-call:1',
        status: 'cancelled',
        error: expect.objectContaining({ code: 'tool_cancelled' }),
      }),
    ]);
    expect(fixture.writes.slice(-2)).toEqual(['tool', 'assistant:cancelled']);
    // The pending approval settles as cancelled so the UI's approval card
    // disappears instead of lingering in awaiting_approval.
    const resolved = fixture.published.find((event) => event.type === 'approval.resolved');
    expect(resolved?.payload).toMatchObject({
      approvalRequestId: expect.any(String),
      toolCallId: 'provider-call:1',
      decision: 'cancelled',
      decidedAt: expect.any(String),
    });
  });

  it('publishes run.cancel.requested as a fact when cancellation is accepted', async () => {
    const fixture = createRunsFixture({
      streams: [neverEndingStream()],
    });
    const started = await startedRun(fixture);
    await new Promise((resolve) => setTimeout(resolve, 0));

    await requestedCancellation(fixture, started.run.executionId);
    await settleRun(fixture);

    const requested = fixture.published.find((event) => event.type === 'run.cancel.requested');
    expect(requested).toBeDefined();
    expect(requested?.payload).toEqual({
      requestedBy: 'user',
      reason: 'user_cancelled',
      scope: 'run',
    });
    expect(requested?.executionId).toBe(started.run.executionId);
    // The fact precedes the outcome.
    expect(requested!.sequence).toBeLessThan(
      fixture.published.find((event) => event.type === 'run.ended')!.sequence,
    );
  });

  it('reports unconverged Runs when provider work ignores abort', async () => {
    // The Engine never fakes convergence: a provider stream that ignores its
    // AbortSignal keeps the Run active, and shutdown says so honestly.
    const fixture = createRunsFixture({
      streams: [neverEndingStream()],
      contextBuild: () => new Promise(() => {}),
      policy: { cancellationTimeoutMs: 10 },
    });
    const started = await startedRun(fixture);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const cancellation = await fixture.runs.cancel({ executionId: started.run.executionId });
    expect(cancellation.status).toBe('cancellation_requested');
    const shutdown = await fixture.runs.shutdown({ timeoutMs: 50 });
    expect(shutdown.status).toBe('timed_out');
    if (shutdown.status === 'timed_out') {
      expect(shutdown.activeRuns.map((run) => run.executionId)).toContain(started.run.executionId);
    }
  });

  it('does not start a ModelCall or Turn when an ignored Context build returns after cancellation', async () => {
    let releaseContext!: () => void;
    const fixture = createRunsFixture({
      contextBuild: () => new Promise((resolve) => {
        releaseContext = () => resolve({
          status: 'ready',
          prompt: { systemPrompt: 'late', messages: [], tools: [] },
        });
      }),
      policy: { cancellationTimeoutMs: 10 },
    });
    const started = await startedRun(fixture);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const cancellation = await fixture.runs.cancel({ executionId: started.run.executionId });
    if (cancellation.status !== 'cancellation_requested') {
      throw new Error('Expected cancellation request.');
    }
    collectEvents(fixture, cancellation.run.executionId);

    releaseContext();
    await settleRun(fixture);

    expect(fixture.published.some((event) => event.type === 'turn.started')).toBe(false);
    // Cancellation converged with a cancelled reply committed, never a ModelCall.
    expect(fixture.writes).toEqual(['user', 'assistant:cancelled']);
  });

  it('does not commit a completed model reply after cancellation wins the async boundary', async () => {
    const fixture = createRunsFixture({
      streams: [assistantStream('completed before cancellation callback')],
    });
    const started = await startedRun(fixture);

    const cancellation = await fixture.runs.cancel({ executionId: started.run.executionId });
    if (cancellation.status !== 'cancellation_requested') {
      throw new Error('Expected cancellation request.');
    }
    await settleRun(fixture);

    expect(fixture.published.at(-1)?.type).toBe('run.ended');
    expect(fixture.published.at(-1)?.payload).toMatchObject({ status: 'cancelled' });
    expect(fixture.assistantReplies).toEqual([
      expect.objectContaining({ status: 'cancelled' }),
    ]);
    expect(fixture.assistantReplies).not.toEqual([
      expect.objectContaining({ status: 'completed' }),
    ]);
  });

  it('saves the cancelled reply with its Text and Thinking as separate content blocks', async () => {
    const fixture = createRunsFixture({
      streams: [partialThinkingStream('ponder xyz', 'partial answer')],
    });
    const started = await startedRun(fixture);
    await new Promise((resolve) => setTimeout(resolve, 0));

    await requestedCancellation(fixture, started.run.executionId);
    await settleRun(fixture);

    expect(fixture.published.at(-1)?.payload).toMatchObject({ status: 'cancelled' });
    expect(fixture.assistantReplies).toEqual([
      expect.objectContaining({
        status: 'cancelled',
        reason_code: 'user_cancelled',
        content: [
          { type: 'thinking', thinking: 'ponder xyz' },
          { type: 'text', text: 'partial answer' },
        ],
      }),
    ]);
    // Thinking never leaks into the user-visible message.ended content.
    const ended = fixture.published.find(
      (event) => event.type === 'message.ended' && event.payload.role === 'assistant',
    );
    expect((ended?.payload as { content: string }).content).not.toContain('ponder xyz');
    expect((ended?.payload as { content: string }).content).toBe('partial answer');
  });

  it('saves a thinking-only cancelled reply without dropping it', async () => {
    const fixture = createRunsFixture({
      streams: [partialThinkingStream('ponder only', '')],
    });
    const started = await startedRun(fixture);
    await new Promise((resolve) => setTimeout(resolve, 0));

    await requestedCancellation(fixture, started.run.executionId);
    await settleRun(fixture);

    expect(fixture.published.at(-1)?.payload).toMatchObject({ status: 'cancelled' });
    expect(fixture.assistantReplies).toEqual([
      expect.objectContaining({
        status: 'cancelled',
        content: [{ type: 'thinking', thinking: 'ponder only' }],
      }),
    ]);
  });

  it('stays convergent when cancellation lands after the Run settled', async () => {
    // The settle path guards against a cancelling Run converging as completed:
    // regardless of who wins, the Run reaches one terminal state and shutdown
    // never hangs on an unsettled completion.
    const fixture = createRunsFixture({
      streams: [assistantStream('answer')],
    });
    const started = await startedRun(fixture);
    await settleRun(fixture);
    expect(fixture.published.at(-1)?.payload).toMatchObject({ status: 'completed' });

    const cancellation = await fixture.runs.cancel({ executionId: started.run.executionId });
    expect(['already_terminal', 'cancellation_requested']).toContain(cancellation.status);
    await expect(fixture.runs.shutdown({ timeoutMs: 1_000 })).resolves.toEqual({
      status: 'shut_down',
    });
  });
});
