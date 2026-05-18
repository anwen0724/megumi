// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineMessageData } from '@megumi/desktop/renderer/entities/chat/types';
import { useChatStore } from '@megumi/desktop/renderer/entities/chat/store';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import { useRunStore } from '@megumi/desktop/renderer/entities/run/store';
import { ChatTimeline } from '@megumi/desktop/renderer/features/chat';

function resetChatStore() {
  useChatStore.setState({
    messages: [],
    streamingText: '',
    isStreaming: false,
    pendingToolCalls: [],
    completedToolActivities: [],
    sessionSnapshots: {},
    agentStatus: 'idle',
    lastError: null,
  });
}

function createMessage(overrides: Partial<TimelineMessageData> = {}): TimelineMessageData {
  return {
    id: 'message-1',
    role: 'assistant',
    content: 'Hello from Megumi',
    stepNum: 1,
    timestamp: '2026-05-10T00:00:00.000Z',
    ...overrides,
  };
}

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
    createdAt: `2026-05-10T12:00:${sequence.toString().padStart(2, '0')}.000Z`,
    source: 'core',
    visibility: 'user',
    persist: 'required',
    payload,
    ...overrides,
  } as RuntimeEvent;
}

function installMegumiMock() {
  const session = {
    message: {
      send: vi.fn().mockResolvedValue({ ok: true, requestId: 'request-1' }),
      cancel: vi.fn(),
    },
  };
  Object.defineProperty(window, 'megumi', {
    configurable: true,
    value: {
      session: {
        message: {
          send: session.message.send,
          cancel: session.message.cancel,
        },
      },
      runtime: {
        onEvent: vi.fn(() => () => undefined),
      },
      provider: { list: vi.fn(), update: vi.fn(), setApiKey: vi.fn(), deleteApiKey: vi.fn() },
    },
  });
  return session;
}

describe('ChatTimeline', () => {
  beforeEach(() => {
    resetChatStore();
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-05-10T12:00:42.000Z'));
    useRunStore.getState().resetRuns();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the empty warm workspace state with full composer controls', () => {
    render(<ChatTimeline />);
    expect(screen.getByText('Today, where should we start?')).toBeInTheDocument();
    expect(screen.getByText('Megumi is ready to help with this workspace.')).toBeInTheDocument();
    expect(screen.getByLabelText('Message Megumi')).toBeInTheDocument();
    expect(screen.getByLabelText('Composer mode')).toHaveValue('chat');
    expect(screen.getByLabelText('Model')).toHaveValue('deepseek-v4-flash');
  });

  it('renders existing messages from chat state', () => {
    useChatStore.getState().setMessages([
      createMessage({ id: 'message-user', role: 'user', content: 'Can you inspect the shell?', stepNum: 1 }),
      createMessage({ id: 'message-assistant', role: 'assistant', content: 'I can help with that.', stepNum: 2 }),
    ]);
    render(<ChatTimeline />);
    expect(screen.getByText('Can you inspect the shell?')).toBeInTheDocument();
    expect(screen.getByText('I can help with that.')).toBeInTheDocument();
  });

  it('submits a message through the runtime chat flow', async () => {
    const session = installMegumiMock();
    render(<ChatTimeline />);

    fireEvent.change(screen.getByLabelText('Message Megumi'), { target: { value: 'Start with the shell' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(screen.getByText('Start with the shell')).toBeInTheDocument();
    });
    expect(session.message.send).toHaveBeenCalled();
  });

  it('renders persisted runtime error messages and does not retry from an empty draft', async () => {
    const session = installMegumiMock();
    render(<ChatTimeline />);

    fireEvent.change(screen.getByLabelText('Message Megumi'), { target: { value: 'please fail this run' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(session.message.send).toHaveBeenCalledTimes(1);
    });

    useChatStore.setState({
      messages: [
        createMessage({ id: 'message-user', role: 'user', content: 'please fail this run', stepNum: 1 }),
        createMessage({
          id: 'message-error',
          role: 'assistant',
          content: 'Provider API key is missing.',
          stepNum: 2,
        }),
      ],
      agentStatus: 'error',
      lastError: 'Provider API key is missing.',
    });

    await waitFor(() => {
      expect(screen.getAllByText('Provider API key is missing.')).toHaveLength(1);
    });

    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(session.message.send).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'deepseek-v4-flash' } });
    expect(session.message.send).toHaveBeenCalledTimes(1);
  });

  it('renders active processing disclosure after the latest user message without showing guessed future work', () => {
    useChatStore.getState().setMessages([
      createMessage({
        id: 'message-user',
        role: 'user',
        content: '请检查当前 UI',
        stepNum: 1,
        timestamp: '2026-05-10T12:00:00.000Z',
      }),
    ]);
    useRunStore.getState().applyRuntimeEvent(runtimeEvent('run.started', 1, { runKind: 'chat' }));
    useRunStore.getState().applyRuntimeEvent(runtimeEvent('context.effective.updated', 2, { sourceCount: 2 }));
    useRunStore.getState().applyRuntimeEvent(runtimeEvent('assistant.output.delta', 3, { delta: '处理中' }));
    useChatStore.setState({
      agentStatus: 'running',
      streamingText: '处理中',
      isStreaming: true,
    });

    render(<ChatTimeline />);

    const timeline = screen.getByRole('log', { name: 'Chat timeline' });
    expect(timeline).toHaveTextContent('请检查当前 UI');
    expect(timeline).toHaveTextContent('正在处理');
    expect(timeline).toHaveTextContent('41s');
    expect(timeline).toHaveTextContent('当前动作');
    expect(timeline).toHaveTextContent('正在生成回复...');
    expect(timeline).toHaveTextContent('已更新有效上下文');
    expect(timeline).toHaveTextContent('处理中');
    expect(timeline).not.toHaveTextContent(/下一步|思考过程|chain-of-thought/i);
  });

  it('renders completed processing disclosure collapsed before final assistant response', async () => {
    useChatStore.getState().setMessages([
      createMessage({
        id: 'message-user',
        role: 'user',
        content: '总结 UI 调整',
        stepNum: 1,
        timestamp: '2026-05-10T12:00:00.000Z',
      }),
      createMessage({
        id: 'message-assistant',
        role: 'assistant',
        content: '已完成 UI 调整总结。',
        stepNum: 2,
        timestamp: '2026-05-10T12:01:43.000Z',
      }),
    ]);
    useRunStore.getState().applyRuntimeEvent(runtimeEvent('run.started', 1, { runKind: 'chat' }));
    useRunStore.getState().applyRuntimeEvent(runtimeEvent('step.completed', 2, {
      kind: 'model',
      title: '生成 UI 总结',
    }, { stepId: 'step-1' }));
    useRunStore.getState().applyRuntimeEvent(runtimeEvent('run.completed', 3, {}, {
      createdAt: '2026-05-10T12:01:42.000Z',
    }));

    render(<ChatTimeline />);

    const timelineText = screen.getByRole('log', { name: 'Chat timeline' }).textContent ?? '';
    expect(timelineText.indexOf('总结 UI 调整')).toBeLessThan(timelineText.indexOf('已处理'));
    expect(timelineText.indexOf('已处理')).toBeLessThan(timelineText.indexOf('已完成 UI 调整总结。'));
    expect(screen.getByRole('button', { name: /Expand processing disclosure/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByText('已完成步骤：生成 UI 总结')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Expand processing disclosure/ }));

    expect(screen.getByText('已完成步骤：生成 UI 总结')).toBeInTheDocument();
  });
});
