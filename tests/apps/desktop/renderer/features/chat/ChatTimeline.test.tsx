// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineMessageData } from '@megumi/desktop/renderer/entities/chat/types';
import { useChatStore } from '@megumi/desktop/renderer/entities/chat/store';
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

function installMegumiMock() {
  const chat = {
    start: vi.fn().mockResolvedValue({ ok: true, requestId: 'request-1' }),
    cancel: vi.fn(),
  };
  Object.defineProperty(window, 'megumi', {
    configurable: true,
    value: {
      session: {
        message: {
          send: chat.start,
          cancel: chat.cancel,
        },
      },
      runtime: {
        onEvent: vi.fn(() => () => undefined),
      },
      provider: { list: vi.fn(), update: vi.fn(), setApiKey: vi.fn(), deleteApiKey: vi.fn() },
    },
  });
  return chat;
}

describe('ChatTimeline', () => {
  beforeEach(() => {
    resetChatStore();
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
    const chat = installMegumiMock();
    render(<ChatTimeline />);

    fireEvent.change(screen.getByLabelText('Message Megumi'), { target: { value: 'Start with the shell' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(screen.getByText('Start with the shell')).toBeInTheDocument();
    });
    expect(chat.start).toHaveBeenCalled();
  });

  it('renders persisted runtime error messages and does not retry from an empty draft', async () => {
    const chat = installMegumiMock();
    render(<ChatTimeline />);

    fireEvent.change(screen.getByLabelText('Message Megumi'), { target: { value: 'please fail this run' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(chat.start).toHaveBeenCalledTimes(1);
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
    expect(chat.start).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'deepseek-v4-flash' } });
    expect(chat.start).toHaveBeenCalledTimes(1);
  });
});
