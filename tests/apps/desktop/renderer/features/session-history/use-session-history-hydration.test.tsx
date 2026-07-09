// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeEvent } from '@megumi/coding-agent/events';
import type { TimelineAssistantMessage, TimelineMessage } from '@megumi/coding-agent/projections/timeline';
import { useProjectStore } from '@megumi/desktop/renderer/entities/project/store';
import { useRunStore } from '@megumi/desktop/renderer/entities/run/store';
import { useSessionStore } from '@megumi/desktop/renderer/entities/session/store';
import { useRuntimeTimelineStore } from '@megumi/desktop/renderer/features/runtime-timeline';
import { useSessionHistoryHydration } from '@megumi/desktop/renderer/features/session-history/use-session-history-hydration';

const createdAt = '2026-05-17T00:00:00.000Z';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

function runtimeEvent(
  eventType: RuntimeEvent['eventType'],
  sequence: number,
  payload: RuntimeEvent['payload'] = {},
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
  } as RuntimeEvent;
}

function committedTimelineMessages(): TimelineMessage[] {
  return [
    {
      messageId: 'message-user-1',
      role: 'user',
      projectId: 'project-1',
      sessionId: 'session-1',
      runId: 'run-1',
      createdAt,
      blocks: [{
        blockId: 'user-text-1',
        kind: 'user_text',
        text: '你好',
        format: 'plain',
      }],
    },
    {
      messageId: 'assistant:run-1',
      role: 'assistant',
      projectId: 'project-1',
      sessionId: 'session-1',
      runId: 'run-1',
      createdAt: '2026-05-17T00:00:10.000Z',
      blocks: [{
        blockId: 'answer:run-1',
        kind: 'answer_text',
        runId: 'run-1',
        textId: 'text:committed',
        status: 'completed',
        text: '你好，我是 Megumi。',
        format: 'markdown',
      }],
    },
  ];
}

describe('useSessionHistoryHydration', () => {
  beforeEach(() => {
    useRuntimeTimelineStore.getState().reset();
    useRuntimeTimelineStore.getState().setActiveSession('project-1', 'session-1');
    useRunStore.getState().resetRuns();
    useProjectStore.setState({
      projects: [{
        id: 'project-1',
        projectId: 'project-1',
        name: 'Project',
        repoPath: 'C:/repo',
        repoPathKey: 'repo-key',
        status: 'available',
        createdAt,
        lastOpenedAt: createdAt,
      }],
      currentProjectId: 'project-1',
      loading: false,
      error: null,
    });
    useSessionStore.setState({
      sessions: [{
        id: 'session-1',
        projectId: 'project-1',
        agentType: 'free',
        title: 'Session',
        createdAt,
        updatedAt: createdAt,
      }],
      activeSessionId: 'session-1',
    });

    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: {
        session: {
          timeline: {
            list: vi.fn().mockResolvedValue({
              ok: true,
              data: { messages: committedTimelineMessages() },
            }),
          },
        },
        run: {
          listBySession: vi.fn().mockResolvedValue({
            ok: true,
            data: {
              runs: [{
                runId: 'run-1',
                sessionId: 'session-1',
                status: 'completed',
                createdAt,
                completedAt: '2026-05-17T00:00:10.000Z',
              }],
            },
          }),
          events: {
            list: vi.fn().mockResolvedValue({
              ok: true,
              data: {
                events: [
                  runtimeEvent('run.started', 1, { runKind: 'agent' }),
                  runtimeEvent('model.thinking.started', 2, { modelStepId: 'thinking-1' }),
                  runtimeEvent('model.thinking.delta', 3, { modelStepId: 'thinking-1', delta: 'Need greet.' }),
                  runtimeEvent('model.thinking.completed', 4, { modelStepId: 'thinking-1' }),
                  runtimeEvent('model_call.text_delta', 5, {
                    modelCallId: 'model-call-1',
                    delta: 'Duplicate replay text.',
                  }),
                  runtimeEvent('run.completed', 6, {}),
                ],
              },
            }),
          },
        },
      },
    });
  });

  it('hydrates committed session messages and persisted runtime process events into one assistant timeline', async () => {
    const { result } = renderHook(() => useSessionHistoryHydration());

    await act(async () => {
      await result.current.hydrateSessionTimeline('session-1');
    });

    const session = useRuntimeTimelineStore.getState().sessions['project-1:session-1'];
    const user = session?.messages.find((message) => message.role === 'user');
    const assistant = session?.messages.find((message): message is TimelineAssistantMessage =>
      message.role === 'assistant' && message.runId === 'run-1',
    );
    const process = assistant?.blocks.find((block) => block.kind === 'process_disclosure');
    const answerBlocks = assistant?.blocks.filter((block) => block.kind === 'answer_text') ?? [];

    expect(user?.blocks).toEqual([
      expect.objectContaining({
        kind: 'user_text',
        text: '你好',
      }),
    ]);
    expect(process?.items).toEqual([
      expect.objectContaining({
        kind: 'thinking',
        status: 'completed',
        text: 'Need greet.',
      }),
    ]);
    expect(answerBlocks).toHaveLength(1);
    expect(answerBlocks[0]).toMatchObject({
      kind: 'answer_text',
      status: 'completed',
      text: '你好，我是 Megumi。',
    });
    expect(window.megumi.run.listBySession).toHaveBeenCalledTimes(1);
    expect(window.megumi.run.events.list).toHaveBeenCalledTimes(1);
  });

  it('rebuilds the session timeline idempotently when the same session is hydrated again', async () => {
    const { result } = renderHook(() => useSessionHistoryHydration());

    await act(async () => {
      await result.current.hydrateSessionTimeline('session-1');
      await result.current.hydrateSessionTimeline('session-1');
    });

    const session = useRuntimeTimelineStore.getState().sessions['project-1:session-1'];
    const assistant = session?.messages.find((message): message is TimelineAssistantMessage =>
      message.role === 'assistant' && message.runId === 'run-1',
    );
    const process = assistant?.blocks.find((block) => block.kind === 'process_disclosure');
    const thinkingItems = process?.items.filter((item) => item.kind === 'thinking') ?? [];
    const answerBlocks = assistant?.blocks.filter((block) => block.kind === 'answer_text') ?? [];

    expect(thinkingItems).toHaveLength(1);
    expect(thinkingItems[0]).toMatchObject({
      kind: 'thinking',
      text: 'Need greet.',
    });
    expect(answerBlocks).toHaveLength(1);
    expect(answerBlocks[0]).toMatchObject({
      kind: 'answer_text',
      text: '你好，我是 Megumi。',
    });
    expect(window.megumi.run.listBySession).toHaveBeenCalledTimes(2);
    expect(window.megumi.run.events.list).toHaveBeenCalledTimes(2);
  });

  it('does not publish a partial committed-only timeline before runtime events are loaded', async () => {
    const runsDeferred = deferred<unknown>();
    window.megumi.run.listBySession = vi.fn().mockReturnValue(runsDeferred.promise);
    const { result } = renderHook(() => useSessionHistoryHydration());

    const hydratePromise = result.current.hydrateSessionTimeline('session-1');
    await Promise.resolve();

    expect(useRuntimeTimelineStore.getState().sessions['project-1:session-1']).toBeUndefined();

    runsDeferred.resolve({
      ok: true,
      data: {
        runs: [{
          runId: 'run-1',
          sessionId: 'session-1',
          status: 'completed',
          createdAt,
          completedAt: '2026-05-17T00:00:10.000Z',
        }],
      },
    });

    await act(async () => {
      await hydratePromise;
    });

    const session = useRuntimeTimelineStore.getState().sessions['project-1:session-1'];
    const assistant = session?.messages.find((message): message is TimelineAssistantMessage =>
      message.role === 'assistant' && message.runId === 'run-1',
    );
    const process = assistant?.blocks.find((block) => block.kind === 'process_disclosure');

    expect(process?.items).toEqual([
      expect.objectContaining({
        kind: 'thinking',
        text: 'Need greet.',
      }),
    ]);
  });
});
