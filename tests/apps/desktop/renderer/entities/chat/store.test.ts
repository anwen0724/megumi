// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import type { TimelineMessageData } from '@megumi/desktop/renderer/entities/chat/types';
import { useChatStore } from '@megumi/desktop/renderer/entities/chat/store';

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

describe('useChatStore', () => {
  beforeEach(() => {
    resetChatStore();
  });

  it('stores messages directly and appends new messages', () => {
    useChatStore.getState().setMessages([createMessage({ id: 'message-1' })]);
    useChatStore.getState().addMessage(createMessage({ id: 'message-2', content: 'Second message' }));

    expect(useChatStore.getState().messages).toEqual([
      createMessage({ id: 'message-1' }),
      createMessage({ id: 'message-2', content: 'Second message' }),
    ]);
  });

  it('stores explicit agent status and last error', () => {
    useChatStore.getState().setAgentStatus('running');
    useChatStore.getState().setLastError('The mock run failed');

    expect(useChatStore.getState().agentStatus).toBe('running');
    expect(useChatStore.getState().lastError).toBe('The mock run failed');
  });

  it('marks the agent as running while streaming tokens are appended', () => {
    useChatStore.getState().appendStreamToken('Hello');
    useChatStore.getState().appendStreamToken(' there');

    expect(useChatStore.getState().streamingText).toBe('Hello there');
    expect(useChatStore.getState().isStreaming).toBe(true);
    expect(useChatStore.getState().agentStatus).toBe('running');
  });

  it('commits streaming text as a final assistant message and returns to idle', () => {
    useChatStore.getState().appendStreamToken('Partial response');
    useChatStore.getState().setLastError('Old error');
    useChatStore.getState().addToolCall({
      id: 'tool-1',
      name: 'read_workspace',
      args: { query: 'workspace' },
    });

    useChatStore.getState().commitStream(createMessage({ id: 'assistant-1', content: 'Final response' }));

    expect(useChatStore.getState().messages).toEqual([
      createMessage({ id: 'assistant-1', content: 'Final response' }),
    ]);
    expect(useChatStore.getState().streamingText).toBe('');
    expect(useChatStore.getState().isStreaming).toBe(false);
    expect(useChatStore.getState().pendingToolCalls).toEqual([]);
    expect(useChatStore.getState().agentStatus).toBe('idle');
    expect(useChatStore.getState().lastError).toBeNull();
  });

  it('tracks executing and completed tool calls', () => {
    useChatStore.getState().addToolCall({
      id: 'tool-1',
      name: 'read_workspace',
      args: { query: 'workspace' },
    });

    expect(useChatStore.getState().agentStatus).toBe('running');
    expect(useChatStore.getState().pendingToolCalls).toEqual([
      {
        id: 'tool-1',
        name: 'read_workspace',
        args: { query: 'workspace' },
        status: 'executing',
      },
    ]);

    useChatStore.getState().completeToolCall('tool-1', {
      success: true,
      output: 'Workspace summary ready',
      duration: '240ms',
    });

    expect(useChatStore.getState().pendingToolCalls).toEqual([
      {
        id: 'tool-1',
        name: 'read_workspace',
        args: { query: 'workspace' },
        status: 'completed',
        result: 'Workspace summary ready',
        error: undefined,
        duration: '240ms',
      },
    ]);
    expect(useChatStore.getState().agentStatus).toBe('running');
  });

  it('moves into error state when a tool call fails', () => {
    useChatStore.getState().addToolCall({
      id: 'tool-1',
      name: 'read_workspace',
      args: { query: 'workspace' },
    });

    useChatStore.getState().completeToolCall('tool-1', {
      success: false,
      output: '',
      error: 'Workspace read failed',
      duration: '240ms',
    });

    expect(useChatStore.getState().agentStatus).toBe('error');
    expect(useChatStore.getState().lastError).toBe('Workspace read failed');
    expect(useChatStore.getState().pendingToolCalls).toEqual([
      {
        id: 'tool-1',
        name: 'read_workspace',
        args: { query: 'workspace' },
        status: 'failed',
        result: '',
        error: 'Workspace read failed',
        duration: '240ms',
      },
    ]);
  });

  it('stores completed tool activity records separately from pending tool calls', () => {
    useChatStore.getState().addCompletedToolActivity({
      id: 'activity-1',
      name: 'read_workspace',
      args: {
        query: 'Plan the next UI step',
        mode: 'execute',
        model: 'deepseek-v4-pro',
      },
      result: 'Prepared workspace context for "Plan the next UI step".',
      duration: '240ms',
      completedAt: '2026-05-10T12:00:00.350Z',
    });

    expect(useChatStore.getState().completedToolActivities).toEqual([
      {
        id: 'activity-1',
        name: 'read_workspace',
        args: {
          query: 'Plan the next UI step',
          mode: 'execute',
          model: 'deepseek-v4-pro',
        },
        result: 'Prepared workspace context for "Plan the next UI step".',
        duration: '240ms',
        completedAt: '2026-05-10T12:00:00.350Z',
      },
    ]);
    expect(useChatStore.getState().pendingToolCalls).toEqual([]);
  });

  it('keeps completed activity when committing the final assistant stream', () => {
    useChatStore.getState().addCompletedToolActivity({
      id: 'activity-1',
      name: 'read_workspace',
      args: { query: 'workspace' },
      result: 'Workspace context ready',
      duration: '240ms',
      completedAt: '2026-05-10T12:00:00.350Z',
    });
    useChatStore.getState().appendStreamToken('Final response');

    useChatStore.getState().commitStream(createMessage({ id: 'assistant-1', content: 'Final response' }));

    expect(useChatStore.getState().completedToolActivities).toEqual([
      {
        id: 'activity-1',
        name: 'read_workspace',
        args: { query: 'workspace' },
        result: 'Workspace context ready',
        duration: '240ms',
        completedAt: '2026-05-10T12:00:00.350Z',
      },
    ]);
    expect(useChatStore.getState().pendingToolCalls).toEqual([]);
    expect(useChatStore.getState().agentStatus).toBe('idle');
  });

  it('clears completed tool activities explicitly', () => {
    useChatStore.getState().addCompletedToolActivity({
      id: 'activity-1',
      name: 'read_workspace',
      args: { query: 'workspace' },
      result: 'Workspace context ready',
      duration: '240ms',
      completedAt: '2026-05-10T12:00:00.350Z',
    });

    useChatStore.getState().clearCompletedToolActivities();

    expect(useChatStore.getState().completedToolActivities).toEqual([]);
  });

  it('saves and restores a chat snapshot for a session', () => {
    useChatStore.getState().setMessages([
      createMessage({
        id: 'message-user',
        role: 'user',
        content: 'Old session prompt',
        stepNum: 1,
      }),
      createMessage({
        id: 'message-assistant',
        role: 'assistant',
        content: 'Old session answer',
        stepNum: 2,
      }),
    ]);
    useChatStore.getState().addCompletedToolActivity({
      id: 'activity-1',
      name: 'read_workspace',
      args: { query: 'Old session prompt' },
      result: 'Workspace context ready',
      duration: '240ms',
      completedAt: '2026-05-10T12:00:00.350Z',
    });

    useChatStore.getState().saveCurrentSessionSnapshot('session-1');
    useChatStore.getState().loadSessionSnapshot('session-2');

    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().completedToolActivities).toEqual([]);
    expect(useChatStore.getState().agentStatus).toBe('idle');

    useChatStore.getState().loadSessionSnapshot('session-1');

    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual([
      'Old session prompt',
      'Old session answer',
    ]);
    expect(useChatStore.getState().completedToolActivities).toEqual([
      {
        id: 'activity-1',
        name: 'read_workspace',
        args: { query: 'Old session prompt' },
        result: 'Workspace context ready',
        duration: '240ms',
        completedAt: '2026-05-10T12:00:00.350Z',
      },
    ]);
  });

  it('loads an empty snapshot when a session has no saved chat yet', () => {
    useChatStore.getState().setMessages([
      createMessage({
        id: 'message-user',
        role: 'user',
        content: 'Unsaved current message',
        stepNum: 1,
      }),
    ]);
    useChatStore.getState().appendStreamToken('Streaming text');
    useChatStore.getState().setLastError('Old error');

    useChatStore.getState().loadSessionSnapshot('new-session');

    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().streamingText).toBe('');
    expect(useChatStore.getState().isStreaming).toBe(false);
    expect(useChatStore.getState().pendingToolCalls).toEqual([]);
    expect(useChatStore.getState().completedToolActivities).toEqual([]);
    expect(useChatStore.getState().agentStatus).toBe('idle');
    expect(useChatStore.getState().lastError).toBeNull();
  });

  it('clears session snapshots explicitly', () => {
    useChatStore.getState().setMessages([
      createMessage({
        id: 'message-user',
        role: 'user',
        content: 'Saved message',
        stepNum: 1,
      }),
    ]);

    useChatStore.getState().saveCurrentSessionSnapshot('session-1');
    useChatStore.getState().clearSessionSnapshots();

    expect(useChatStore.getState().sessionSnapshots).toEqual({});
  });

  it('clears stream state, tool calls, status, and error together', () => {
    useChatStore.getState().appendStreamToken('Partial response');
    useChatStore.getState().setLastError('Old error');
    useChatStore.getState().addToolCall({
      id: 'tool-1',
      name: 'read_workspace',
      args: { query: 'workspace' },
    });

    useChatStore.getState().clearStream();

    expect(useChatStore.getState().streamingText).toBe('');
    expect(useChatStore.getState().isStreaming).toBe(false);
    expect(useChatStore.getState().pendingToolCalls).toEqual([]);
    expect(useChatStore.getState().agentStatus).toBe('idle');
    expect(useChatStore.getState().lastError).toBeNull();
  });

  it('clears pending tool calls without changing the current run status', () => {
    useChatStore.getState().setAgentStatus('sending');
    useChatStore.getState().addToolCall({
      id: 'tool-1',
      name: 'read_workspace',
      args: { query: 'workspace' },
    });
    useChatStore.getState().setAgentStatus('sending');

    useChatStore.getState().clearToolCalls();

    expect(useChatStore.getState().pendingToolCalls).toEqual([]);
    expect(useChatStore.getState().agentStatus).toBe('sending');
  });
});
