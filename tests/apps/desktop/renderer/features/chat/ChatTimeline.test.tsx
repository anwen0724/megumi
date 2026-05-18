// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineMessageData } from '@megumi/desktop/renderer/entities/chat/types';
import { useChatStore } from '@megumi/desktop/renderer/entities/chat/store';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import { useRunStore } from '@megumi/desktop/renderer/entities/run/store';
import { ChatTimeline } from '@megumi/desktop/renderer/features/chat';

let runtimeEventCallback: ((event: RuntimeEvent) => void) | null = null;
let runtimeSequence = 1;

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

function emitRuntimeEvent(
  eventType: RuntimeEvent['eventType'],
  requestId: string,
  payload: RuntimeEvent['payload'] = {},
  overrides: Partial<RuntimeEvent> = {},
) {
  runtimeEventCallback?.(runtimeEvent(eventType, runtimeSequence++, payload, {
    requestId,
    ...overrides,
  }));
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
        onEvent: vi.fn((callback: (event: RuntimeEvent) => void) => {
          runtimeEventCallback = callback;
          return () => {
            runtimeEventCallback = null;
          };
        }),
      },
      provider: { list: vi.fn(), update: vi.fn(), setApiKey: vi.fn(), deleteApiKey: vi.fn() },
    },
  });
  return session;
}

describe('ChatTimeline', () => {
  beforeEach(() => {
    runtimeEventCallback = null;
    runtimeSequence = 1;
    resetChatStore();
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-05-10T12:00:42.000Z'));
    useRunStore.getState().resetRuns();
  });

  afterEach(() => {
    vi.useRealTimers();
    runtimeEventCallback = null;
  });

  it('renders the empty warm workspace state with full composer controls', () => {
    render(<ChatTimeline />);
    expect(screen.getByText('Today, where should we start?')).toBeInTheDocument();
    expect(screen.getByText('Megumi is ready to help with this workspace.')).toBeInTheDocument();
    expect(screen.getByLabelText('Message Megumi')).toBeInTheDocument();
    expect(screen.getByLabelText('Composer mode')).toHaveValue('chat');
    expect(screen.getByLabelText('Model')).toHaveValue('deepseek-v4-flash');
  });

  it('keeps timeline layout independent from the bottom composer overlay', () => {
    render(<ChatTimeline />);

    const root = screen.getByTestId('chat-timeline-root');
    const scrollArea = screen.getByTestId('chat-timeline-scroll');
    const composerOverlay = screen.getByTestId('chat-composer-overlay');

    expect(root).toHaveClass('relative');
    expect(root).toHaveClass('overflow-hidden');
    expect(root).toHaveClass('min-w-[42rem]');
    expect(scrollArea).toHaveClass('absolute');
    expect(scrollArea).toHaveClass('inset-0');
    expect(scrollArea).toHaveClass('overflow-y-auto');
    expect(scrollArea).toHaveClass('pb-72');
    expect(composerOverlay).toHaveClass('absolute');
    expect(composerOverlay).toHaveClass('inset-x-0');
    expect(composerOverlay).toHaveClass('bottom-0');
    expect(within(scrollArea).getByText('Today, where should we start?')).toBeInTheDocument();
    expect(within(composerOverlay).getByLabelText('Message Megumi')).toBeInTheDocument();
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

  it('shows processing disclosure while a sent message is waiting for runtime events', async () => {
    installMegumiMock();
    render(<ChatTimeline />);

    fireEvent.change(screen.getByLabelText('Message Megumi'), { target: { value: 'Start with the shell' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Collapse processing disclosure/ })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    });

    expect(screen.getByText('正在处理')).toBeInTheDocument();
    expect(screen.getByText('当前动作')).toBeInTheDocument();
    expect(screen.getByText('正在连接模型...')).toBeInTheDocument();
    expect(screen.queryByText('Megumi is connecting to the provider...')).not.toBeInTheDocument();
  });

  it('keeps processing disclosure around the final response on the real runtime event path', async () => {
    const session = installMegumiMock();
    render(<ChatTimeline />);

    fireEvent.change(screen.getByLabelText('Message Megumi'), { target: { value: 'Explain Verilog' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(session.message.send).toHaveBeenCalledTimes(1);
    });

    const requestId = session.message.send.mock.calls[0][0].requestId;

    act(() => {
      emitRuntimeEvent('run.started', requestId, { runKind: 'chat' });
      emitRuntimeEvent('assistant.output.delta', requestId, { delta: 'Verilog is ' });
      emitRuntimeEvent('assistant.output.delta', requestId, { delta: 'an HDL.' });
      emitRuntimeEvent('assistant.output.completed', requestId, { content: 'Verilog is an HDL.' });
      emitRuntimeEvent('step.completed', requestId, { kind: 'model', title: '生成回复' }, { stepId: 'step-1' });
      emitRuntimeEvent('run.completed', requestId);
    });

    await waitFor(() => {
      expect(screen.getByText('Verilog is an HDL.')).toBeInTheDocument();
    });

    const timelineText = screen.getByRole('log', { name: 'Chat timeline' }).textContent ?? '';
    expect(timelineText.indexOf('Explain Verilog')).toBeLessThan(timelineText.indexOf('已处理'));
    expect(timelineText.indexOf('已处理')).toBeLessThan(timelineText.indexOf('Verilog is an HDL.'));
    expect(screen.getByRole('button', { name: /Expand processing disclosure/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByText('Megumi is connecting to the provider...')).not.toBeInTheDocument();
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

  it('wires the running composer Stop button to the active session message cancel request', async () => {
    const session = installMegumiMock();
    render(<ChatTimeline />);

    fireEvent.change(screen.getByLabelText('Message Megumi'), { target: { value: 'Cancel this run' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(session.message.send).toHaveBeenCalledTimes(1);
    });

    useChatStore.setState({ agentStatus: 'running' });

    await userEvent.type(screen.getByLabelText('Message Megumi'), 'draft for later');
    fireEvent.keyDown(screen.getByLabelText('Message Megumi'), { key: 'Enter' });
    await userEvent.click(screen.getByRole('button', { name: 'Stop current run' }));

    const startRequestId = session.message.send.mock.calls[0][0].requestId;
    const startTraceId = session.message.send.mock.calls[0][0].context.traceId;

    expect(session.message.send).toHaveBeenCalledTimes(1);
    expect(session.message.cancel).toHaveBeenCalledWith(expect.objectContaining({
      payload: {
        targetRequestId: startRequestId,
      },
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.session.message.cancel,
        source: 'renderer',
      }),
      context: expect.objectContaining({
        traceId: startTraceId,
        operationName: 'session.message.cancel',
        source: 'renderer',
      }),
    }));
  });
});
