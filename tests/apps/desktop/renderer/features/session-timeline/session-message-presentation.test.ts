/* Protects projection of cross-window user submissions into the main Timeline. */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionTimelineSynchronizer } from '@megumi/desktop/renderer/features/session-timeline/session-timeline-synchronizer';
import {
  sessionTimelineKey,
  useSessionTimelineStore,
} from '@megumi/desktop/renderer/features/session-timeline/session-timeline-store';

describe('Session message presentation events', () => {
  let receiveMessageEvent: ((event: unknown) => void) | undefined;

  beforeEach(() => {
    sessionTimelineSynchronizer.stop();
    useSessionTimelineStore.getState().reset();
    receiveMessageEvent = undefined;
    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: {
        runtime: { onEvent: vi.fn(() => vi.fn()) },
        session: {
          message: {
            onPresentationEvent: vi.fn((listener: (event: unknown) => void) => {
              receiveMessageEvent = listener;
              return vi.fn();
            }),
          },
        },
      },
    });
  });

  it('shows pending voice text immediately and reconciles the accepted Run without duplication', () => {
    sessionTimelineSynchronizer.start();

    receiveMessageEvent?.({
      phase: 'pending',
      projectId: 'project:1',
      sessionId: 'session:1',
      clientMessageId: 'client-message:1',
      text: '语音输入',
      createdAt: '2026-08-14T00:00:00.000Z',
    });

    const key = sessionTimelineKey('project:1', 'session:1');
    expect(useSessionTimelineStore.getState().sessions[key]?.messages).toHaveLength(1);
    expect(useSessionTimelineStore.getState().sessions[key]?.messages[0]).toMatchObject({
      role: 'user',
      messageId: 'client-message:1',
    });

    receiveMessageEvent?.({
      phase: 'accepted',
      projectId: 'project:1',
      sessionId: 'session:1',
      clientMessageId: 'client-message:1',
      messageId: 'message:1',
      runId: 'run:1',
      text: '语音输入',
      createdAt: '2026-08-14T00:00:00.000Z',
    });

    const messages = useSessionTimelineStore.getState().sessions[key]?.messages;
    expect(messages).toHaveLength(1);
    expect(messages?.[0]).toMatchObject({
      role: 'user',
      messageId: 'message:1',
      clientMessageId: 'client-message:1',
      runId: 'run:1',
    });
  });
});
