// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineMessageData } from '@megumi/desktop/renderer/entities/chat/types';
import { useChatStore } from '@megumi/desktop/renderer/entities/chat/store';
import { useApprovalStore } from '@megumi/desktop/renderer/entities/approval';
import { useProjectStore } from '@megumi/desktop/renderer/entities/project/store';
import { useSessionStore } from '@megumi/desktop/renderer/entities/session/store';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import { useRunStore } from '@megumi/desktop/renderer/entities/run/store';
import { useToolCallStore } from '@megumi/desktop/renderer/entities/tool-call';
import { ChatTimeline } from '@megumi/desktop/renderer/features/chat';
import type { ApprovalRequest, ToolCall } from '@megumi/shared/tool-contracts';

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

function createToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    toolCallId: 'tool-call-1',
    toolUseId: 'tool-use-1',
    runId: 'run-1',
    stepId: 'step-1',
    toolName: 'run_command',
    input: { command: 'npm test' },
    inputPreview: {
      summary: 'Run npm test',
      targets: [{ kind: 'command', label: 'npm test' }],
      redactionState: 'none',
    },
    capabilities: ['command_run'],
    riskLevel: 'medium',
    sideEffect: 'execute_command',
    policyDecision: {
      permissionDecisionId: 'permission-1',
      toolUseId: 'tool-use-1',
      toolCallId: 'tool-call-1',
      runId: 'run-1',
      decision: 'ask',
      source: 'permission_mode',
      reason: 'Command execution requires approval in default mode.',
      mode: 'default',
      capability: 'command_run',
      sideEffect: 'execute_command',
      effectiveRiskLevel: 'medium',
      requiredApproval: {
        scope: 'run',
        reason: 'Command execution requires approval in default mode.',
      },
      evaluatedAt: '2026-05-20T00:00:01.000Z',
    },
    status: 'waiting_for_approval',
    requestedAt: '2026-05-20T00:00:00.000Z',
    ...overrides,
  };
}

function createApprovalRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    approvalRequestId: 'approval-1',
    toolUseId: 'tool-use-1',
    toolCallId: 'tool-call-1',
    permissionDecisionId: 'permission-1',
    runId: 'run-1',
    stepId: 'step-1',
    toolName: 'run_command',
    capabilities: ['command_run'],
    riskLevel: 'medium',
    title: 'Approve command',
    summary: 'Run npm test',
    preview: {
      action: 'npm test',
      targets: [{ kind: 'command', label: 'npm test' }],
    },
    requestedScope: 'once',
    status: 'pending',
    createdAt: '2026-05-20T00:00:02.000Z',
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
  const approval = {
    resolve: vi.fn().mockResolvedValue({ ok: true, requestId: 'request-approval-1' }),
  };
  Object.defineProperty(window, 'megumi', {
    configurable: true,
    value: {
      project: {
        useExisting: vi.fn().mockResolvedValue({ ok: true, data: { cancelled: true } }),
      },
      session: {
        message: {
          send: session.message.send,
          cancel: session.message.cancel,
        },
      },
      approval,
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
  return { ...session, approval };
}

function selectMegumiProject() {
  useProjectStore.setState({
    projects: [{
      id: 'project-1',
      projectId: 'project-1',
      name: 'Megumi',
      repoPath: 'C:/all/work/study/megumi',
      repoPathKey: 'c:/all/work/study/megumi',
      status: 'available' as const,
      createdAt: '2026-05-10T00:00:00.000Z',
      lastOpenedAt: '2026-05-19T00:00:00.000Z',
    }],
    currentProjectId: 'project-1',
    loading: false,
    error: null,
  });
}

describe('ChatTimeline', () => {
  beforeEach(() => {
    runtimeEventCallback = null;
    runtimeSequence = 1;
    resetChatStore();
    useProjectStore.setState({
      projects: [],
      currentProjectId: null,
      loading: false,
      error: null,
    });
    useSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      activeAgentType: 'free',
    });
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-05-10T12:00:42.000Z'));
    useRunStore.getState().resetRuns();
    useToolCallStore.getState().reset();
    useApprovalStore.getState().reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    runtimeEventCallback = null;
  });

  it('renders the open workspace welcome state when no project is selected, with composer controls available', () => {
    render(<ChatTimeline />);
    expect(screen.getByText('Welcome to Megumi')).toBeInTheDocument();
    expect(screen.getByText('Open a workspace to get started.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open workspace' })).toBeInTheDocument();
    expect(screen.getByLabelText('Message Megumi')).toBeInTheDocument();
    expect(screen.getByLabelText('Permission mode')).toHaveValue('default');
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
    expect(within(scrollArea).getByText('Welcome to Megumi')).toBeInTheDocument();
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

  it('renders pending approvals without the separate tool-call card section', () => {
    installMegumiMock();
    useRunStore.getState().applyRuntimeEvent(runtimeEvent('run.started', 1, { runKind: 'agent' }));
    useToolCallStore.getState().upsertToolCall(createToolCall());
    useApprovalStore.getState().upsertApprovalRequest(createApprovalRequest());

    render(<ChatTimeline />);

    const timeline = screen.getByRole('log', { name: 'Chat timeline' });
    expect(timeline).toHaveTextContent('run_command');
    expect(timeline).toHaveTextContent('Run npm test');
    expect(screen.queryByRole('heading', { name: 'Tool calls' })).not.toBeInTheDocument();
    expect(screen.queryByText('Policy: ask - Command execution requires approval in default mode.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve run_command' })).toBeInTheDocument();
  });

  it('resolves pending approvals through the approval preload API', async () => {
    const megumi = installMegumiMock();
    useRunStore.getState().applyRuntimeEvent(runtimeEvent('run.started', 1, { runKind: 'agent' }));
    useApprovalStore.getState().upsertApprovalRequest(createApprovalRequest());

    render(<ChatTimeline />);

    await userEvent.selectOptions(screen.getByLabelText('Approval scope'), 'run');
    await userEvent.click(screen.getByRole('button', { name: 'Approve run_command' }));

    expect(megumi.approval.resolve).toHaveBeenCalledWith(expect.objectContaining({
      payload: {
        approvalRequestId: 'approval-1',
        decision: 'approved',
        scope: 'run',
        decidedAt: '2026-05-10T12:00:42.000Z',
      },
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.approval.resolve,
        source: 'renderer',
      }),
      context: expect.objectContaining({
        operationName: 'approval.resolve',
        source: 'renderer',
      }),
    }));
  });

  it('submits a message through the runtime chat flow', async () => {
    const session = installMegumiMock();
    selectMegumiProject();
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
    selectMegumiProject();
    render(<ChatTimeline />);

    fireEvent.change(screen.getByLabelText('Message Megumi'), { target: { value: 'Start with the shell' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(screen.getByText('Start with the shell')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /processing disclosure/ })).toBeInTheDocument();
  });

  it('keeps only messages around the final response on the real runtime event path', async () => {
    const session = installMegumiMock();
    selectMegumiProject();
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
    expect(timelineText.indexOf('Explain Verilog')).toBeLessThan(timelineText.indexOf('Verilog is an HDL.'));
    expect(screen.queryByText('Megumi is connecting to the provider...')).not.toBeInTheDocument();
  });

  it('continues writing live runtime output to the original session after switching sessions', async () => {
    const session = installMegumiMock();
    selectMegumiProject();
    render(<ChatTimeline />);

    fireEvent.change(screen.getByLabelText('Message Megumi'), { target: { value: 'Explain Verilog' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(session.message.send).toHaveBeenCalledTimes(1);
    });

    const originalSessionId = useSessionStore.getState().activeSessionId;
    expect(originalSessionId).toBeTruthy();
    if (!originalSessionId) {
      throw new Error('Expected an active session after sending a message.');
    }
    useChatStore.getState().saveCurrentSessionSnapshot(originalSessionId);
    useSessionStore.setState((state) => ({
      sessions: [
        ...state.sessions,
        {
          id: 'session-2',
          projectId: 'project-1',
          title: 'Other session',
          agentType: 'free',
          createdAt: '2026-05-10T12:00:00.000Z',
          updatedAt: '2026-05-10T12:00:00.000Z',
        },
      ],
      activeSessionId: 'session-2',
    }));
    useChatStore.getState().loadSessionSnapshot('session-2');

    const requestId = session.message.send.mock.calls[0][0].requestId;

    act(() => {
      emitRuntimeEvent('run.started', requestId, { runKind: 'chat' }, { sessionId: originalSessionId });
      emitRuntimeEvent('assistant.output.delta', requestId, { delta: 'Verilog is an HDL.' }, {
        sessionId: originalSessionId,
      });
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });

    expect(screen.queryByText('Verilog is an HDL.')).not.toBeInTheDocument();
    expect(useChatStore.getState().sessionSnapshots[originalSessionId]).toMatchObject({
      streamingText: 'Verilog is an HDL.',
      isStreaming: true,
      agentStatus: 'running',
    });
  });

  it('renders persisted runtime error messages and does not retry from an empty draft', async () => {
    const session = installMegumiMock();
    selectMegumiProject();
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

  it('renders the processing disclosure while a run is active', () => {
    useChatStore.getState().setMessages([
      createMessage({
        id: 'message-user',
        role: 'user',
        content: 'Check current UI',
        stepNum: 1,
        timestamp: '2026-05-10T12:00:00.000Z',
      }),
    ]);
    useRunStore.getState().applyRuntimeEvent(runtimeEvent('run.started', 1, { runKind: 'chat' }));
    useRunStore.getState().applyRuntimeEvent(runtimeEvent('context.effective.updated', 2, { sourceCount: 2 }));
    useRunStore.getState().applyRuntimeEvent(runtimeEvent('assistant.output.delta', 3, { delta: 'Working' }));
    useChatStore.setState({
      agentStatus: 'running',
      streamingText: 'Working',
      isStreaming: true,
    });

    render(<ChatTimeline />);

    const timeline = screen.getByRole('log', { name: 'Chat timeline' });
    expect(timeline).toHaveTextContent('Check current UI');
    expect(screen.getByRole('button', { name: /processing disclosure/ })).toHaveAttribute('aria-expanded', 'true');
    expect(timeline).toHaveTextContent('Working');
    expect(timeline).not.toHaveTextContent(/chain-of-thought/i);
  });

  it('keeps a lightweight processing disclosure visible for pure text streaming runs', () => {
    useChatStore.getState().setMessages([
      createMessage({
        id: 'message-user',
        role: 'user',
        content: 'Explain Verilog',
        stepNum: 1,
        timestamp: '2026-05-10T12:00:00.000Z',
      }),
    ]);
    useRunStore.getState().applyRuntimeEvent(runtimeEvent('run.started', 1, { runKind: 'chat' }));
    useChatStore.setState({
      agentStatus: 'running',
      streamingText: 'Verilog is an HDL.',
      isStreaming: true,
    });

    render(<ChatTimeline />);

    const timeline = screen.getByRole('log', { name: 'Chat timeline' });
    const timelineText = timeline.textContent ?? '';
    expect(timeline).toHaveTextContent('正在处理');
    expect(timeline).not.toHaveTextContent('live');
    expect(timelineText.indexOf('Explain Verilog')).toBeLessThan(timelineText.indexOf('Verilog is an HDL.'));
  });

  it('renders completed processing disclosure collapsed before final assistant response', () => {
    useChatStore.getState().setMessages([
      createMessage({
        id: 'message-user',
        role: 'user',
        content: 'Summarize UI updates',
        stepNum: 1,
        timestamp: '2026-05-10T12:00:00.000Z',
      }),
      createMessage({
        id: 'message-assistant',
        role: 'assistant',
        content: 'UI update summary is complete.',
        stepNum: 2,
        timestamp: '2026-05-10T12:01:43.000Z',
      }),
    ]);
    useRunStore.getState().applyRuntimeEvent(runtimeEvent('run.started', 1, { runKind: 'chat' }));
    useRunStore.getState().applyRuntimeEvent(runtimeEvent('step.completed', 2, {
      kind: 'model',
      title: 'Generate UI summary',
    }, { stepId: 'step-1' }));
    useRunStore.getState().applyRuntimeEvent(runtimeEvent('run.completed', 3, {}, {
      createdAt: '2026-05-10T12:01:42.000Z',
    }));

    render(<ChatTimeline />);

    const timelineText = screen.getByRole('log', { name: 'Chat timeline' }).textContent ?? '';
    expect(timelineText).toContain('Summarize UI updates');
    expect(timelineText).toContain('UI update summary is complete.');
    expect(screen.getByRole('button', { name: /Expand processing disclosure/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/Generate UI summary/)).not.toBeInTheDocument();
  });

  it('wires the running composer Stop button to the active session message cancel request', async () => {
    const session = installMegumiMock();
    selectMegumiProject();
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

  it('calls useExistingProject when the Open workspace button is clicked', async () => {
    installMegumiMock();
    render(<ChatTimeline />);

    const openButton = screen.getByRole('button', { name: 'Open workspace' });
    expect(openButton).toBeInTheDocument();

    await userEvent.click(openButton);

    expect(window.megumi.project.useExisting).toHaveBeenCalled();
  });

  it('shows the welcome empty state and project repoPath when a project is selected but no messages exist', () => {
    useProjectStore.setState({
      projects: [
        {
          id: 'p1',
          name: 'Test Project',
          repoPath: '/home/user/test',
          repoPathKey: '/home/user/test',
          status: 'available' as const,
          createdAt: '2026-05-01T00:00:00.000Z',
          lastOpenedAt: '2026-05-19T00:00:00.000Z',
          projectId: 'p1',
        },
      ],
      currentProjectId: 'p1',
      loading: false,
      error: null,
    });

    render(<ChatTimeline />);

    expect(screen.getByText('Welcome to Megumi')).toBeInTheDocument();
    expect(screen.getByText('Megumi is ready to help with this workspace.')).toBeInTheDocument();
    expect(screen.getByText('/home/user/test')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open workspace' })).not.toBeInTheDocument();
  });
});
