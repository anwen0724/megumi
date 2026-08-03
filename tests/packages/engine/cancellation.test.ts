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
    const started = await fixture.engine.startRun(startRequest);
    if (started.status !== 'started') throw new Error('Expected started Run.');

    const cancellation = await fixture.engine.cancelRun({ runId: started.run.runId });
    expect(cancellation.status).toBe('cancellation_requested');
    if (cancellation.status !== 'cancellation_requested') {
      throw new Error('Expected cancellation request.');
    }
    const events = await collectEvents(cancellation.events);

    expect(events.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      'run.cancel.requested',
      'run.cancelling',
      'run.cancelled',
    ]));
    expect(events.at(-1)?.eventType).toBe('run.cancelled');
    expect(fixture.writes.at(-1)).toBe('assistant:cancelled');
  });

  it('commits valid streamed text as the cancelled Assistant Reply', async () => {
    const fixture = createEngineFixture({
      streams: [partialNeverEndingStream('partial answer')],
    });
    const started = await fixture.engine.startRun(startRequest);
    if (started.status !== 'started') throw new Error('Expected started Run.');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const cancellation = await fixture.engine.cancelRun({ runId: started.run.runId });
    if (cancellation.status !== 'cancellation_requested') {
      throw new Error('Expected cancellation request.');
    }
    const events = await collectEvents(cancellation.events);

    expect(events.at(-1)?.eventType).toBe('run.cancelled');
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
    const started = await fixture.engine.startRun(startRequest);
    if (started.status !== 'started') throw new Error('Expected started Run.');
    await vi.waitFor(() => expect(executeTool).toHaveBeenCalledOnce());

    const cancellation = await fixture.engine.cancelRun({ runId: started.run.runId });
    if (cancellation.status !== 'cancellation_requested') {
      throw new Error('Expected cancellation request.');
    }
    const events = await collectEvents(cancellation.events);

    expect(events.at(-1)?.eventType).toBe('run.cancelled');
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
    const started = await fixture.engine.startRun(startRequest);
    if (started.status !== 'started') throw new Error('Expected started Run.');
    const waitingEvents = await collectEvents(started.events);
    expect(waitingEvents.at(-1)?.eventType).toBe('run.waiting');

    const cancellation = await fixture.engine.cancelRun({ runId: started.run.runId });
    if (cancellation.status !== 'cancellation_requested') {
      throw new Error('Expected cancellation request.');
    }
    const events = await collectEvents(cancellation.events);

    expect(fixture.toolResults).toEqual([
      expect.objectContaining({
        tool_call_id: 'provider-call:1',
        status: 'cancelled',
        error: expect.objectContaining({ code: 'tool_cancelled' }),
      }),
    ]);
    expect(fixture.writes.slice(-2)).toEqual(['tool', 'assistant:cancelled']);
    expect(events.at(-1)?.eventType).toBe('run.cancelled');
  });

  it('fails cancellation after the deadline when provider work ignores abort', async () => {
    const fixture = createEngineFixture({
      streams: [neverEndingStream()],
      contextBuild: () => new Promise(() => {}),
      policy: { cancellationTimeoutMs: 10 },
    });
    const started = await fixture.engine.startRun(startRequest);
    if (started.status !== 'started') throw new Error('Expected started Run.');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const cancellation = await fixture.engine.cancelRun({ runId: started.run.runId });
    if (cancellation.status !== 'cancellation_requested') {
      throw new Error('Expected cancellation request.');
    }
    const events = await collectEvents(cancellation.events);

    expect(events.at(-1)?.eventType).toBe('run.failed');
    expect(events.at(-1)?.payload).toMatchObject({
      error: { code: 'runtime_cancellation_failed' },
    });
  });

  it('does not start a ModelCall when an ignored Context build returns after cancellation failed', async () => {
    let releaseContext!: () => void;
    const fixture = createEngineFixture({
      contextBuild: () => new Promise((resolve) => {
        releaseContext = () => resolve({
          status: 'ready',
          prepared: {
            preparationId: 'preparation:late',
            context: { systemPrompt: 'late', messages: [] },
            usage: {
              usedTokens: 0,
              contextWindowTokens: 4_096,
              remainingTokens: 4_096,
              usedRatio: 0,
              compactionThresholdRatio: 0.8,
            },
            sourceRefs: [],
          },
        });
      }),
      policy: { cancellationTimeoutMs: 10 },
    });
    const started = await fixture.engine.startRun(startRequest);
    if (started.status !== 'started') throw new Error('Expected started Run.');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const cancellation = await fixture.engine.cancelRun({ runId: started.run.runId });
    if (cancellation.status !== 'cancellation_requested') {
      throw new Error('Expected cancellation request.');
    }
    await collectEvents(cancellation.events);
    const eventCountAtFailure = fixture.published.length;

    releaseContext();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fixture.published).toHaveLength(eventCountAtFailure);
    expect(fixture.published.some((event) => event.eventType === 'model_call.started')).toBe(false);
    expect(fixture.writes).toEqual(['user']);
  });

  it('does not commit a completed model reply after cancellation wins the async boundary', async () => {
    let cancellationPromise: Promise<CancelRunResult> | undefined;
    let startedRunId = '';
    const fixture = createEngineFixture({
      streams: [assistantStream('completed before cancellation callback')],
      eventPublisher: {
        publish: (event) => {
          if (event.eventType === 'model_call.completed' && !cancellationPromise) {
            cancellationPromise = fixture.engine.cancelRun({ runId: startedRunId });
          }
        },
      },
    });
    const started = await fixture.engine.startRun(startRequest);
    if (started.status !== 'started') throw new Error('Expected started Run.');
    startedRunId = started.run.runId;
    await collectEvents(started.events);
    if (!cancellationPromise) throw new Error('Expected cancellation to be requested.');

    const cancellation = await cancellationPromise;
    if (cancellation.status !== 'cancellation_requested') {
      throw new Error('Expected cancellation request.');
    }
    const events = await collectEvents(cancellation.events);

    expect(events.at(-1)?.eventType).toBe('run.cancelled');
    expect(fixture.assistantReplies).toEqual([
      expect.objectContaining({ status: 'cancelled' }),
    ]);
    expect(fixture.assistantReplies).not.toEqual([
      expect.objectContaining({ status: 'completed' }),
    ]);
  });
});
