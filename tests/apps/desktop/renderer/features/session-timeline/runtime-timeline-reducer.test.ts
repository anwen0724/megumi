import { describe, expect, it } from 'vitest';
import type { AnyEvent } from '@megumi/events';
import {
  createRuntimeTimeline,
  reduceRuntimeTimeline as reduceDesktopRuntimeTimeline,
} from '../../../../../../apps/desktop/src/renderer/features/session-timeline/runtime-timeline-reducer';
import type {
  TimelineMessage,
} from '../../../../../../apps/desktop/src/renderer/features/session-timeline/timeline-model';

function reduceRuntimeTimeline(
  request: Omit<Parameters<typeof reduceDesktopRuntimeTimeline>[0], 'projectId'>,
) {
  return reduceDesktopRuntimeTimeline({ ...request, projectId: 'project:1' });
}

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

    const serialized = JSON.stringify(next);
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

    const serialized = JSON.stringify(next);
    expect(serialized).toContain('lookup');
    expect(serialized).toContain('"succeeded"');
  });

  it('shows the result summary, never the raw result payload', () => {
    let next = reduceRuntimeTimelineEvent([], event('run.started', {}, 1));
    next = reduceRuntimeTimelineEvent(next, event('turn.started', { messageId: 'message:1' }, 2));
    next = reduceRuntimeTimelineEvent(next, event('turn.ended', { stopReason: 'tool_calls', messageId: 'message:1', toolCallIds: ['call:1'] }, 3));
    next = reduceRuntimeTimelineEvent(next, event('tool_execution.started', { toolCallId: 'call:1', toolName: 'read_file', args: {}, toolExecutionId: 'exec:1' }, 4));
    next = reduceRuntimeTimelineEvent(next, event('tool_execution.ended', {
      toolCallId: 'call:1',
      toolExecutionId: 'exec:1',
      status: 'completed',
      result: '{ "path": "/a", "content": "raw data" }',
      summary: 'Read 12 characters from /a',
    }, 5));

    const serialized = JSON.stringify(next);
    expect(serialized).toContain('Read 12 characters from /a');
    expect(serialized).not.toContain('raw data');
  });

  it('leaves resultSummary unset when no summary is available', () => {
    let next = reduceRuntimeTimelineEvent([], event('run.started', {}, 1));
    next = reduceRuntimeTimelineEvent(next, event('turn.started', { messageId: 'message:1' }, 2));
    next = reduceRuntimeTimelineEvent(next, event('turn.ended', { stopReason: 'tool_calls', messageId: 'message:1', toolCallIds: ['call:1'] }, 3));
    next = reduceRuntimeTimelineEvent(next, event('tool_execution.started', { toolCallId: 'call:1', toolName: 'lookup', args: {}, toolExecutionId: 'exec:1' }, 4));
    next = reduceRuntimeTimelineEvent(next, event('tool_execution.ended', {
      toolCallId: 'call:1',
      toolExecutionId: 'exec:1',
      status: 'completed',
      result: '{ "path": "/a" }',
    }, 5));

    const serialized = JSON.stringify(next);
    expect(serialized).not.toContain('resultSummary');
    expect(serialized).not.toContain('path');
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

    const serialized = JSON.stringify(next);
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
      event: event('approval.requested', {
        toolCallId: 'call:1',
        toolName: 'rm',
        reason: 'destructive',
        args: {},
        approvalRequestId: 'approval:1',
        options: [{ optionId: 'once', scope: 'once', label: 'Once', description: 'allow once' }],
        defaultOptionId: 'once',
      }, 4),
    });

    const serialized = JSON.stringify(next);
    expect(serialized).toContain('"awaiting_approval"');
    expect(serialized).toContain('destructive');
  });

  it('streams thinking as a thinking item with full-snapshot replaces', () => {
    let next = reduceRuntimeTimelineEvent([], event('run.started', {}, 1));
    next = reduceRuntimeTimelineEvent(next, event('turn.started', { messageId: 'message:1' }, 2));
    next = reduceRuntimeTimelineEvent(next, event('message.thinking.update', { messageId: 'message:1', thinking: 'ponder' }, 3));
    next = reduceRuntimeTimelineEvent(next, event('message.thinking.update', { messageId: 'message:1', thinking: 'ponder deep' }, 4));

    const serialized = JSON.stringify(next);
    expect(serialized).toContain('"kind":"thinking"');
    expect(serialized).toContain('ponder deep');
    expect(serialized).not.toContain('"text":"ponder"');
    expect(serialized).toContain('"streaming"');
  });

  it('settles the thinking item when the assistant message ends', () => {
    let next = reduceRuntimeTimelineEvent([], event('run.started', {}, 1));
    next = reduceRuntimeTimelineEvent(next, event('turn.started', { messageId: 'message:1' }, 2));
    next = reduceRuntimeTimelineEvent(next, event('message.thinking.update', { messageId: 'message:1', thinking: 'ponder' }, 3));
    next = reduceRuntimeTimelineEvent(next, event('message.ended', { role: 'assistant', messageId: 'message:1', content: 'answer' }, 4));

    const serialized = JSON.stringify(next);
    expect(serialized).toContain('"kind":"thinking"');
    expect(serialized).toContain('"completed"');
  });

  it('surfaces tool_execution.requested with the tool name before execution starts', () => {
    let next = reduceRuntimeTimelineEvent([], event('run.started', {}, 1));
    next = reduceRuntimeTimelineEvent(next, event('turn.started', { messageId: 'message:1' }, 2));
    next = reduceRuntimeTimelineEvent(next, event('turn.ended', { stopReason: 'tool_calls', messageId: 'message:1', toolCallIds: ['call:1'] }, 3));
    next = reduceRuntimeTimelineEvent(next, event('tool_execution.requested', { toolCallId: 'call:1', toolName: 'lookup', args: { value: 'x' } }, 4));

    const serialized = JSON.stringify(next);
    expect(serialized).toContain('lookup');
    expect(serialized).toContain('"requested"');
  });

  it('marks a permission-denied tool execution as denied', () => {
    let next = reduceRuntimeTimelineEvent([], event('run.started', {}, 1));
    next = reduceRuntimeTimelineEvent(next, event('turn.started', { messageId: 'message:1' }, 2));
    next = reduceRuntimeTimelineEvent(next, event('turn.ended', { stopReason: 'tool_calls', messageId: 'message:1', toolCallIds: ['call:1'] }, 3));
    next = reduceRuntimeTimelineEvent(next, event('tool_execution.ended', { toolCallId: 'call:1', status: 'denied' }, 4));

    const serialized = JSON.stringify(next);
    expect(serialized).toContain('"denied"');
  });

  it('tracks model call retries as retry activity', () => {
    let next = reduceRuntimeTimelineEvent([], event('run.started', {}, 1));
    next = reduceRuntimeTimelineEvent(next, event('turn.started', { messageId: 'message:1' }, 2));
    next = reduceRuntimeTimelineEvent(next, event('turn.retry.started', { attemptNumber: 2, retryKind: 'model_call' }, 3));

    const serialized = JSON.stringify(next);
    expect(serialized).toContain('"kind":"retry_activity"');
    expect(serialized).toContain('"attemptNumber":2');
  });

  it('renders a plan activity from tool_execution.plan_updated', () => {
    let next = reduceRuntimeTimelineEvent([], event('run.started', {}, 1));
    next = reduceRuntimeTimelineEvent(next, event('turn.started', { messageId: 'message:1' }, 2));
    next = reduceRuntimeTimelineEvent(next, event('tool_execution.plan_updated', {
      toolCallId: 'call:1',
      explanation: 'edits files',
      plan: [{ step: 'write a', status: 'pending' }],
    }, 3));

    const serialized = JSON.stringify(next);
    expect(serialized).toContain('"kind":"plan_activity"');
    expect(serialized).toContain('edits files');
    expect(serialized).toContain('write a');
  });

  it('carries the approval options and the engine approval identity', () => {
    let next = reduceRuntimeTimelineEvent([], event('run.started', {}, 1));
    next = reduceRuntimeTimelineEvent(next, event('turn.started', { messageId: 'message:1' }, 2));
    next = reduceRuntimeTimelineEvent(next, event('approval.requested', {
      toolCallId: 'call:1',
      toolName: 'rm',
      reason: 'destructive',
      args: {},
      approvalRequestId: 'approval:1',
      options: [{ optionId: 'once', scope: 'once', label: 'Once', description: 'allow once' }],
      defaultOptionId: 'once',
    }, 3));

    const serialized = JSON.stringify(next);
    expect(serialized).toContain('"approvalRequestId":"approval:1"');
    expect(serialized).toContain('"defaultOptionId":"once"');
    expect(serialized).toContain('"optionId":"once"');
    expect(serialized).toContain('"scope":"once"');
  });

  it('projects session-scoped compaction as one standalone activity', () => {
    const timeline = createRuntimeTimeline({});
    let next = reduceRuntimeTimeline({ timeline, event: event('run.started', {}, 1) });
    next = reduceRuntimeTimeline({
      timeline: next,
      event: event('session.compaction.started', {
        trigger: 'manual',
        compactionId: 'compaction:1',
      }, 2, { runId: undefined }),
    });
    next = reduceRuntimeTimeline({
      timeline: next,
      event: event('session.compaction.ended', {
        status: 'completed',
        compactionId: 'compaction:1',
      }, 3, { runId: undefined }),
    });

    expect(next.messages.filter((message) => message.role === 'activity')).toEqual([
      expect.objectContaining({
        messageId: 'session-compaction:compaction:1',
        blocks: [expect.objectContaining({
          kind: 'session_compaction_activity',
          status: 'completed',
        })],
      }),
    ]);
  });

  it('settles the run process status from run.ended', () => {
    const timeline = createRuntimeTimeline({});
    let next = reduceRuntimeTimeline({ timeline, event: event('run.started', {}, 1) });
    next = reduceRuntimeTimeline({
      timeline: next,
      event: event('run.ended', { status: 'failed', error: { message: 'boom', code: 'x' } }, 2),
    });

    const serialized = JSON.stringify(next);
    expect(serialized).toContain('"failed"');
    expect(serialized).toContain('boom');
  });
});
