import { describe, expect, it } from 'vitest';
import type { AnyEvent } from '@megumi/events';
import {
  createRuntimeTimeline,
  reduceRuntimeTimeline,
  type TimelineMessage,
} from '../../../packages/projections/src/index';

function reduceRuntimeTimelineEvent(
  timeline: TimelineMessage[],
  eventToApply: AnyEvent,
): TimelineMessage[] {
  return reduceRuntimeTimeline({
    timeline: createRuntimeTimeline({ messages: timeline }),
    event: eventToApply,
  }).messages;
}

function event(
  eventType: AnyEvent['type'],
  payload: Record<string, unknown>,
  sequence: number,
  overrides: Partial<AnyEvent> = {},
): AnyEvent {
  return {
    id: `event:${sequence}`,
    type: eventType,
    payload,
    runId: 'run:1',
    sessionId: 'session:1',
    sequence,
    createdAt: `2026-07-09T00:00:${sequence.toString().padStart(2, '0')}.000Z`,
    ...overrides,
  } as AnyEvent;
}

describe('RuntimeTimeline', () => {
  it('suppresses an already applied event by identity', () => {
    const timeline = createRuntimeTimeline({});
    const once = reduceRuntimeTimeline({ timeline, event: event('run.started', {}, 1) });
    const twice = reduceRuntimeTimeline({ timeline: once, event: event('run.started', {}, 1) });
    expect(twice.messages).toEqual(once.messages);
  });

  it('streams assistant text as full snapshots into the answer block', () => {
    const timeline = createRuntimeTimeline({});
    let next = reduceRuntimeTimeline({ timeline, event: event('run.started', {}, 1) });
    next = reduceRuntimeTimeline({
      timeline: next,
      event: event('turn.started', { messageId: 'message:1' }, 2),
    });
    next = reduceRuntimeTimeline({
      timeline: next,
      event: event('message.update', { role: 'assistant', messageId: 'message:1', content: 'hel' }, 3),
    });
    next = reduceRuntimeTimeline({
      timeline: next,
      event: event('message.update', { role: 'assistant', messageId: 'message:1', content: 'hello' }, 4),
    });
    next = reduceRuntimeTimeline({
      timeline: next,
      event: event('message.ended', { role: 'assistant', messageId: 'message:1', content: 'hello' }, 5),
    });

    const serialized = JSON.stringify(next.messages);
    expect(serialized).toContain('hello');
    expect(serialized).not.toContain('"hel"');
  });

  it('keeps tool execution activity and results in the process block', () => {
    const timeline = createRuntimeTimeline({});
    let next = reduceRuntimeTimeline({ timeline, event: event('run.started', {}, 1) });
    next = reduceRuntimeTimeline({
      timeline: next,
      event: event('turn.started', { messageId: 'message:1' }, 2),
    });
    next = reduceRuntimeTimeline({
      timeline: next,
      event: event('turn.ended', { stopReason: 'tool_calls', messageId: 'message:1', toolCallIds: ['call:1'] }, 3),
    });
    next = reduceRuntimeTimeline({
      timeline: next,
      event: event('tool_execution.started', { toolCallId: 'call:1', toolName: 'lookup', args: { value: 'x' } }, 4),
    });
    next = reduceRuntimeTimeline({
      timeline: next,
      event: event('tool_execution.ended', { toolCallId: 'call:1', status: 'completed', result: 'found' }, 5),
    });

    const serialized = JSON.stringify(next.messages);
    expect(serialized).toContain('lookup');
    expect(serialized).toContain('"succeeded"');
  });

  it('keeps a failed Tool error out of resultSummary', () => {
    const timeline = createRuntimeTimeline({});
    let next = reduceRuntimeTimeline({ timeline, event: event('run.started', {}, 1) });
    next = reduceRuntimeTimeline({
      timeline: next,
      event: event('turn.started', { messageId: 'message:1' }, 2),
    });
    next = reduceRuntimeTimeline({
      timeline: next,
      event: event('turn.ended', { stopReason: 'tool_calls', messageId: 'message:1', toolCallIds: ['call:1'] }, 3),
    });
    next = reduceRuntimeTimeline({
      timeline: next,
      event: event('tool_execution.started', { toolCallId: 'call:1', toolName: 'lookup', args: {} }, 4),
    });
    next = reduceRuntimeTimeline({
      timeline: next,
      event: event('tool_execution.ended', { toolCallId: 'call:1', status: 'failed', error: { message: 'boom', code: 'tool_execution_failed' } }, 5),
    });

    const serialized = JSON.stringify(next.messages);
    expect(serialized).toContain('"failed"');
    expect(serialized).toContain('boom');
    expect(serialized).not.toContain('resultSummary');
  });

  it('surfaces a pending approval on the tool activity', () => {
    const timeline = createRuntimeTimeline({});
    let next = reduceRuntimeTimeline({ timeline, event: event('run.started', {}, 1) });
    next = reduceRuntimeTimeline({
      timeline: next,
      event: event('turn.started', { messageId: 'message:1' }, 2),
    });
    next = reduceRuntimeTimeline({
      timeline: next,
      event: event('turn.ended', { stopReason: 'tool_calls', messageId: 'message:1', toolCallIds: ['call:1'] }, 3),
    });
    next = reduceRuntimeTimeline({
      timeline: next,
      event: event('approval.requested', { toolCallId: 'call:1', toolName: 'rm', reason: 'destructive', args: {}, approvalRequestId: 'approval:1' }, 4),
    });

    const serialized = JSON.stringify(next.messages);
    expect(serialized).toContain('"awaiting_approval"');
    expect(serialized).toContain('destructive');
  });

  it('does not project session-scoped compaction into a Run timeline', () => {
    const timeline = createRuntimeTimeline({});
    let next = reduceRuntimeTimeline({ timeline, event: event('run.started', {}, 1) });
    next = reduceRuntimeTimeline({
      timeline: next,
      event: event('compaction.started', { trigger: 'manual' }, 2, { runId: undefined }),
    });

    const serialized = JSON.stringify(next.messages);
    expect(serialized).not.toContain('压缩');
  });

  it('settles the run process status from run.ended', () => {
    const timeline = createRuntimeTimeline({});
    let next = reduceRuntimeTimeline({ timeline, event: event('run.started', {}, 1) });
    next = reduceRuntimeTimeline({
      timeline: next,
      event: event('run.ended', { status: 'failed', error: { message: 'boom', code: 'x' } }, 2),
    });

    const serialized = JSON.stringify(next.messages);
    expect(serialized).toContain('"failed"');
    expect(serialized).toContain('boom');
  });
});
