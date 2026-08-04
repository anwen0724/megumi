/*
 * Protects cancellation convergence and bounded failure for uncooperative work.
 */
import { describe, expect, it, vi } from 'vitest';
import type { CancelRunResult } from '@megumi/engine';
import {
  collectEvents,
  createEngineFixture,
  neverEndingStream,
  partialNeverEndingStream,
  assistantStream,
  approvalDecisionFor,
  requestedCancellation,
  settleRun,
  startedRun,
  startRequest,
} from './engine-test-fixtures';
import { approvalSubjectFor, registeredTool } from './tool-call-test-fixtures';

describe('Engine cancellation', () => {
  it('cancels a Run whose Context build observes the Run AbortSignal', async () => {
    const fixture = createEngineFixture({
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

    const cancellation = await fixture.engine.cancelRun({ runId: started.run.runId });
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
    const fixture = createEngineFixture({
      streams: [partialNeverEndingStream('partial answer')],
    });
    const started = await startedRun(fixture);
    await new Promise((resolve) => setTimeout(resolve, 0));

    await requestedCancellation(fixture, started.run.runId);
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
    const fixture = createEngineFixture({
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

    await requestedCancellation(fixture, started.run.runId);
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
    const fixture = createEngineFixture({
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
    collectEvents(fixture, started.run.runId);

    await requestedCancellation(fixture, started.run.runId);
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
    const fixture = createEngineFixture({
      streams: [neverEndingStream()],
    });
    const started = await startedRun(fixture);
    await new Promise((resolve) => setTimeout(resolve, 0));

    await requestedCancellation(fixture, started.run.runId);
    await settleRun(fixture);

    const requested = fixture.published.find((event) => event.type === 'run.cancel.requested');
    expect(requested).toBeDefined();
    expect(requested?.payload).toEqual({
      requestedBy: 'user',
      reason: 'user_cancelled',
      scope: 'run',
    });
    expect(requested?.runId).toBe(started.run.runId);
    // The fact precedes the outcome.
    expect(requested!.sequence).toBeLessThan(
      fixture.published.find((event) => event.type === 'run.ended')!.sequence,
    );
  });

  it('fails cancellation after the deadline when provider work ignores abort', async () => {
    const fixture = createEngineFixture({
      streams: [neverEndingStream()],
      contextBuild: () => new Promise(() => {}),
      policy: { cancellationTimeoutMs: 10 },
    });
    const started = await startedRun(fixture);
    await new Promise((resolve) => setTimeout(resolve, 0));

    await requestedCancellation(fixture, started.run.runId);
    await settleRun(fixture);

    expect(fixture.published.at(-1)?.type).toBe('run.ended');
    expect(fixture.published.at(-1)?.payload).toMatchObject({
      status: 'failed',
      error: { code: 'cancellation_failed' },
    });
  });

  it('does not start a ModelCall when an ignored Context build returns after cancellation failed', async () => {
    let releaseContext!: () => void;
    const fixture = createEngineFixture({
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

    const cancellation = await fixture.engine.cancelRun({ runId: started.run.runId });
    if (cancellation.status !== 'cancellation_requested') {
      throw new Error('Expected cancellation request.');
    }
    collectEvents(fixture, cancellation.run.runId);

    releaseContext();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fixture.published.some((event) => event.type === 'turn.started')).toBe(false);
    // Cancellation converged with a cancelled reply committed, never a ModelCall.
    expect(fixture.writes).toEqual(['user', 'assistant:cancelled']);
  });

  it('does not commit a completed model reply after cancellation wins the async boundary', async () => {
    const fixture = createEngineFixture({
      streams: [assistantStream('completed before cancellation callback')],
    });
    const started = await startedRun(fixture);

    const cancellation = await fixture.engine.cancelRun({ runId: started.run.runId });
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
});
