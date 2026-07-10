// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { RuntimeEvent } from '@megumi/coding-agent/events';
import type { TimelineAssistantMessage } from '@megumi/coding-agent/projections/timeline';
import { useRuntimeTimelineStore } from '@megumi/desktop/renderer/features/runtime-timeline';

function runtimeEvent(
  eventType: RuntimeEvent['eventType'],
  sequence: number,
  payload: RuntimeEvent['payload'] = {},
  overrides: Partial<RuntimeEvent> = {},
): RuntimeEvent {
  return {
    eventId: `event-${sequence}`,
    schemaVersion: 1,
    eventType,
    runId: 'run-1',
    sessionId: 'session-1',
    sequence,
    createdAt: `2026-05-17T00:00:${sequence.toString().padStart(2, '0')}.000Z`,
    source: 'core',
    visibility: 'user',
    persist: 'required',
    payload,
    ...overrides,
  } as RuntimeEvent;
}

describe('runtime timeline store', () => {
  beforeEach(() => {
    useRuntimeTimelineStore.getState().reset();
    useRuntimeTimelineStore.getState().setActiveSession('project-1', 'session-1');
  });

  it('accepts distinct events with the same sequence and projects both into timeline text', () => {
    const store = useRuntimeTimelineStore.getState();

    store.dispatch(runtimeEvent('run.started', 1, { runKind: 'agent' }));
    store.dispatch(runtimeEvent('model_call.text_delta', 2, {
      modelCallId: 'model-call-1',
      delta: 'Hello ',
    }, { eventId: 'event-text-1' }));
    store.dispatch(runtimeEvent('model_call.text_delta', 2, {
      modelCallId: 'model-call-1',
      delta: 'world',
    }, { eventId: 'event-text-2' }));

    const session = useRuntimeTimelineStore.getState().sessions['project-1:session-1'];
    const assistant = session?.messages.find((message) => message.role === 'assistant');
    const answer = assistant?.blocks.find((block) => block.kind === 'answer_text');

    expect(answer).toMatchObject({
      kind: 'answer_text',
      text: 'Hello world',
    });
    expect(session?.streamsById['run-1']).toMatchObject({
      lastSeq: 2,
      status: 'running',
    });
  });

  it('does not project the same runtime event more than once', () => {
    const store = useRuntimeTimelineStore.getState();
    const thinkingDelta = runtimeEvent('model.thinking.delta', 3, {
      modelStepId: 'thinking-1',
      delta: 'Think once.',
    });

    store.dispatch(runtimeEvent('run.started', 1, { runKind: 'agent' }));
    store.dispatch(runtimeEvent('model.thinking.started', 2, { modelStepId: 'thinking-1' }));
    store.dispatch(thinkingDelta);
    store.dispatch(thinkingDelta);

    const session = useRuntimeTimelineStore.getState().sessions['project-1:session-1'];
    const assistant = session?.messages.find((message): message is TimelineAssistantMessage =>
      message.role === 'assistant' && message.runId === 'run-1',
    );
    const process = assistant?.blocks.find((block) => block.kind === 'process_disclosure');
    const thinking = process?.items.find((item) => item.kind === 'thinking');

    expect(thinking).toMatchObject({
      kind: 'thinking',
      text: 'Think once.',
    });
  });

  it('rebuilds a hydrated session from committed messages before replaying runtime events', () => {
    const store = useRuntimeTimelineStore.getState();
    const committedAssistant: TimelineAssistantMessage = {
      messageId: 'assistant:run-1',
      role: 'assistant',
      projectId: 'project-1',
      sessionId: 'session-1',
      runId: 'run-1',
      createdAt: '2026-05-17T00:00:00.000Z',
      updatedAt: '2026-05-17T00:00:10.000Z',
      blocks: [({
        blockId: 'answer:run-1',
        kind: 'answer_text',
        runId: 'run-1',
        textId: 'text:committed',
        status: 'completed',
        text: 'Committed final answer.',
        format: 'markdown',
      })],
    };

    store.dispatch(runtimeEvent('run.started', 1, { runKind: 'agent' }));
    store.dispatch(runtimeEvent('model.thinking.started', 2, { modelStepId: 'thinking-1' }));
    store.dispatch(runtimeEvent('model.thinking.delta', 3, { modelStepId: 'thinking-1', delta: 'Dirty duplicate.' }));

    store.hydrateCommittedMessages('project-1', 'session-1', [committedAssistant]);
    store.dispatch(runtimeEvent('run.started', 1, { runKind: 'agent' }));
    store.dispatch(runtimeEvent('model.thinking.started', 2, { modelStepId: 'thinking-1' }));
    store.dispatch(runtimeEvent('model.thinking.delta', 3, { modelStepId: 'thinking-1', delta: 'Clean replay.' }, {
      eventId: 'event-clean-thinking',
    }));

    const session = useRuntimeTimelineStore.getState().sessions['project-1:session-1'];
    const assistant = session?.messages.find((message): message is TimelineAssistantMessage =>
      message.role === 'assistant' && message.runId === 'run-1',
    );
    const process = assistant?.blocks.find((block) => block.kind === 'process_disclosure');
    const thinking = process?.items.find((item) => item.kind === 'thinking');

    expect(thinking).toMatchObject({
      kind: 'thinking',
      text: 'Clean replay.',
    });
  });

  it('sorts runtime-only assistant messages with their original user turn during hydration', () => {
    const store = useRuntimeTimelineStore.getState();

    store.hydrateSessionTimeline('project-1', 'session-1', [
      {
        messageId: 'user-old',
        role: 'user',
        projectId: 'project-1',
        sessionId: 'session-1',
        runId: 'run-old',
        createdAt: '2026-07-09T07:01:00.000Z',
        blocks: [{
          blockId: 'user-text-old',
          kind: 'user_text',
          text: '用 ts 代码写一个 hollow world 吧',
          format: 'plain',
        }],
      },
      {
        messageId: 'user-new',
        role: 'user',
        projectId: 'project-1',
        sessionId: 'session-1',
        runId: 'run-new',
        createdAt: '2026-07-09T11:12:00.000Z',
        blocks: [{
          blockId: 'user-text-new',
          kind: 'user_text',
          text: '我的意思是直接输出代码',
          format: 'plain',
        }],
      },
      {
        messageId: 'assistant-new',
        role: 'assistant',
        projectId: 'project-1',
        sessionId: 'session-1',
        runId: 'run-new',
        createdAt: '2026-07-09T11:12:04.000Z',
        blocks: [{
          blockId: 'answer-new',
          kind: 'answer_text',
          runId: 'run-new',
          textId: 'text-new',
          status: 'completed',
          text: '直接给你代码。',
          format: 'markdown',
        }],
      },
    ], [
      runtimeEvent('run.started', 1, {}, {
        runId: 'run-old',
        eventId: 'event-old-run-started',
        createdAt: '2026-07-09T07:01:01.000Z',
      }),
      runtimeEvent('model_call.text_delta', 2, {
        modelCallId: 'model-call-old',
        delta: '哈哈，hollow world。',
      }, {
        runId: 'run-old',
        eventId: 'event-old-text',
        createdAt: '2026-07-09T07:01:02.000Z',
      }),
      runtimeEvent('run.cancelled', 3, {
        reason: 'runtime_started_cleanup',
      }, {
        runId: 'run-old',
        eventId: 'event-old-cancelled',
        createdAt: '2026-07-09T07:01:03.000Z',
      }),
    ]);

    const session = useRuntimeTimelineStore.getState().sessions['project-1:session-1'];

    expect(session?.messages.map((message) =>
      message.role === 'separator' ? `separator:${message.messageId}` : `${message.role}:${message.runId}`,
    )).toEqual([
      'user:run-old',
      'assistant:run-old',
      'user:run-new',
      'assistant:run-new',
    ]);
  });

  it('keeps committed answer text authoritative while replaying runtime process events', () => {
    const store = useRuntimeTimelineStore.getState();
    const committedAssistant: TimelineAssistantMessage = {
      messageId: 'assistant:run-1',
      role: 'assistant',
      projectId: 'project-1',
      sessionId: 'session-1',
      runId: 'run-1',
      createdAt: '2026-05-17T00:00:00.000Z',
      updatedAt: '2026-05-17T00:00:10.000Z',
      blocks: [{
        blockId: 'answer:run-1',
        kind: 'answer_text',
        runId: 'run-1',
        textId: 'text:committed',
        status: 'completed',
        text: 'Committed final answer.',
        format: 'markdown',
      }],
    };

    store.hydrateCommittedMessages('project-1', 'session-1', [committedAssistant]);
    store.dispatch(runtimeEvent('run.started', 1, { runKind: 'agent' }));
    store.dispatch(runtimeEvent('model.thinking.started', 2, { modelStepId: 'thinking-1' }));
    store.dispatch(runtimeEvent('model.thinking.delta', 3, { modelStepId: 'thinking-1', delta: 'I should answer.' }));
    store.dispatch(runtimeEvent('model.thinking.completed', 4, { modelStepId: 'thinking-1' }));
    store.dispatch(runtimeEvent('model_call.text_delta', 5, {
      modelCallId: 'model-call-1',
      delta: 'Replayed duplicate text.',
    }));
    store.dispatch(runtimeEvent('run.completed', 6, {}));

    const session = useRuntimeTimelineStore.getState().sessions['project-1:session-1'];
    const assistant = session?.messages.find((message): message is TimelineAssistantMessage =>
      message.role === 'assistant' && message.runId === 'run-1',
    );
    const process = assistant?.blocks.find((block) => block.kind === 'process_disclosure');
    const answerBlocks = assistant?.blocks.filter((block) => block.kind === 'answer_text') ?? [];

    expect(process?.items).toEqual([
      expect.objectContaining({
        kind: 'thinking',
        status: 'completed',
        text: 'I should answer.',
      }),
    ]);
    expect(answerBlocks).toHaveLength(1);
    expect(answerBlocks[0]).toMatchObject({
      kind: 'answer_text',
      status: 'completed',
      text: 'Committed final answer.',
    });
  });

  it('tracks session timeline hydration freshness by session owner version', () => {
    const store = useRuntimeTimelineStore.getState();

    store.markSessionTimelineHydrated('project-1', 'session-1', '2026-07-10T01:00:00.000Z');

    expect(store.isSessionTimelineFresh(
      'project-1',
      'session-1',
      '2026-07-10T01:00:00.000Z',
    )).toBe(true);
    expect(store.isSessionTimelineFresh(
      'project-1',
      'session-1',
      '2026-07-10T02:00:00.000Z',
    )).toBe(false);

    store.markSessionTimelineHydrating('project-1', 'session-1', '2026-07-10T02:00:00.000Z');
    expect(store.getHydrationState('project-1', 'session-1')).toMatchObject({
      status: 'hydrating',
      sessionUpdatedAt: '2026-07-10T02:00:00.000Z',
    });

    store.markSessionTimelineHydrationFailed(
      'project-1',
      'session-1',
      '2026-07-10T02:00:00.000Z',
      'Hydration failed.',
    );
    expect(store.getHydrationState('project-1', 'session-1')).toMatchObject({
      status: 'failed',
      error: 'Hydration failed.',
    });
  });
});
