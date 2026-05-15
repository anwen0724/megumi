import { describe, expect, it, vi } from 'vitest';
import { runAgentTurn } from '@megumi/core/agent-runtime/run-agent-turn';
import { createAgentRunCreatedEvent } from '@megumi/core/agent-runtime/events';
import type { AgentRuntimeLifecycleSink } from '@megumi/core/agent-runtime/types';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';

function createSink() {
  const events: RuntimeEvent[] = [];
  const sink: AgentRuntimeLifecycleSink = {
    saveRun: vi.fn(),
    saveStep: vi.fn(),
    saveAction: vi.fn(),
    saveObservation: vi.fn(),
    appendEvent: vi.fn((event: RuntimeEvent) => {
      events.push(event);
    }),
  };

  return { sink, events };
}

const ids = {
  runId: () => 'run-1',
  stepId: () => 'step-1',
  actionId: () => 'action-1',
  observationId: () => 'observation-1',
  debugId: () => 'debug-agent-1',
  eventId: vi.fn()
    .mockReturnValueOnce('event-1')
    .mockReturnValueOnce('event-2')
    .mockReturnValueOnce('event-3')
    .mockReturnValueOnce('event-4')
    .mockReturnValueOnce('event-5')
    .mockReturnValueOnce('event-6')
    .mockReturnValueOnce('event-7')
    .mockReturnValueOnce('event-8')
    .mockReturnValueOnce('event-9')
    .mockReturnValueOnce('event-10')
    .mockReturnValueOnce('event-11'),
  messageId: () => 'message-1',
};

describe('agent runtime lifecycle events', () => {
  it('creates run.created events with stable lifecycle payloads', () => {
    expect(createAgentRunCreatedEvent({
      eventId: 'event-1',
      runId: 'run-1',
      sessionId: 'session-1',
      sequence: 1,
      createdAt: '2026-05-15T00:00:00.000Z',
      mode: 'chat',
      goal: 'Answer',
      triggerMessageId: 'message-1',
    })).toMatchObject({
      eventType: 'run.created',
      runId: 'run-1',
      sessionId: 'session-1',
      sequence: 1,
      source: 'core',
      visibility: 'user',
      persist: 'required',
      payload: {
        status: 'queued',
        mode: 'chat',
        goal: 'Answer',
        triggerMessageId: 'message-1',
      },
    });
  });

  it('runs the minimal Action -> Host -> Observation loop and persists lifecycle facts', async () => {
    const { sink, events } = createSink();

    const result = await runAgentTurn({
      sessionId: 'session-1',
      triggerMessageId: 'message-1',
      mode: 'chat',
      goal: 'Answer the user',
      lifecycle: sink,
      hostBoundary: {
        handleAction: (action) => ({
          observationId: 'observation-1',
          runId: action.runId,
          stepId: action.stepId,
          actionId: action.actionId,
          source: 'runtime',
          kind: 'message_emitted',
          receivedAt: '2026-05-15T00:00:00.000Z',
          summary: 'Message emitted',
        }),
      },
      clock: { now: () => '2026-05-15T00:00:00.000Z' },
      ids,
    });

    expect(result.run.status).toBe('completed');
    expect(result.step.status).toBe('succeeded');
    expect(result.action.kind).toBe('emit_message');
    expect(result.observation.kind).toBe('message_emitted');
    expect(events.map((event) => event.eventType)).toEqual([
      'run.created',
      'run.status.changed',
      'run.started',
      'step.created',
      'step.status.changed',
      'action.requested',
      'observation.received',
      'step.status.changed',
      'step.completed',
      'run.status.changed',
      'run.completed',
    ]);
    expect(sink.saveRun).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
    expect(sink.saveStep).toHaveBeenCalledWith(expect.objectContaining({ status: 'succeeded' }));
    expect(sink.saveAction).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
    expect(sink.saveObservation).toHaveBeenCalledWith(expect.objectContaining({ kind: 'message_emitted' }));
  });

  it('normalizes host boundary failures into failed run state and run.failed event', async () => {
    const { sink, events } = createSink();

    const result = await runAgentTurn({
      sessionId: 'session-1',
      mode: 'chat',
      goal: 'Fail safely',
      lifecycle: sink,
      hostBoundary: {
        handleAction: () => {
          throw new Error('boom secret sk-test-1234567890abcdef');
        },
      },
      clock: { now: () => '2026-05-15T00:00:00.000Z' },
      ids: {
        ...ids,
        eventId: () => `event-${Math.random().toString(36).slice(2)}`,
      },
    });

    expect(result.run.status).toBe('failed');
    expect(events.map((event) => event.eventType)).toContain('step.status.changed');
    expect(events.map((event) => event.eventType)).toContain('step.failed');
    expect(events.map((event) => event.eventType)).toContain('run.status.changed');
    expect(events.at(-1)?.eventType).toBe('run.failed');
    expect(events.find((event) =>
      event.eventType === 'run.status.changed' &&
      (event.payload as { to?: string }).to === 'failed',
    )?.payload).toMatchObject({
      from: 'running',
      to: 'failed',
    });
    expect(events.at(-1)?.payload).toMatchObject({
      error: {
        debugId: 'debug-agent-1',
        source: 'core',
      },
    });
    expect(JSON.stringify(events)).not.toContain('sk-test-1234567890abcdef');
  });
});
