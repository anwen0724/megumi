// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatUiStore } from '@megumi/desktop/renderer/entities/chat-ui/store';
import { useApprovalStore } from '@megumi/desktop/renderer/entities/approval';
import { useProjectStore } from '@megumi/desktop/renderer/entities/project/store';
import { useSessionStore } from '@megumi/desktop/renderer/entities/session/store';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import { useRunStore } from '@megumi/desktop/renderer/entities/run/store';
import { useToolCallStore } from '@megumi/desktop/renderer/entities/tool-call';
import { ChatTimeline } from '@megumi/desktop/renderer/features/chat';
import {
  chatStreamSessionKey,
  useChatStreamStore,
} from '@megumi/desktop/renderer/features/chat-stream';
import type { ApprovalRequest, ToolCall } from '@megumi/shared/tool-contracts';
import type {
  TimelineAssistantMessage,
  TimelineMessage,
  TimelineUserMessage,
} from '@megumi/shared/timeline-message-blocks';

let runtimeEventCallback: ((event: RuntimeEvent) => void) | null = null;
let runtimeSequence = 1;

function resetChatUiStore() {
  useChatUiStore.setState({
    activeSessionId: null,
    agentStatus: 'idle',
    lastError: null,
    sessionStates: {},
  });
}

function committedUser(messageId: string, text: string): TimelineUserMessage {
  return {
    messageId,
    role: 'user',
    projectId: 'project-1',
    sessionId: 'session-1',
    createdAt: '2026-05-24T00:00:00.000Z',
    updatedAt: '2026-05-24T00:00:00.000Z',
    blocks: [{
      blockId: `user-text:${messageId}`,
      kind: 'user_text',
      text,
      format: 'plain',
    }],
  };
}

function committedAssistant(messageId: string, runId: string, text: string): TimelineAssistantMessage {
  return {
    messageId,
    role: 'assistant',
    projectId: 'project-1',
    sessionId: 'session-1',
    runId,
    createdAt: '2026-05-24T00:00:01.000Z',
    updatedAt: '2026-05-24T00:00:01.000Z',
    blocks: [{
      blockId: `answer:${runId}`,
      kind: 'answer_text',
      runId,
      textId: `text:${runId}`,
      status: 'completed',
      text,
      format: 'markdown',
    }],
  };
}

function activateCanonicalSession(messages: TimelineMessage[]) {
  selectMegumiProject();
  useSessionStore.setState({
    sessions: [{
      id: 'session-1',
      projectId: 'project-1',
      title: 'Canonical session',
      agentType: 'free',
      createdAt: '2026-05-10T12:00:00.000Z',
      updatedAt: '2026-05-10T12:00:00.000Z',
    }],
    activeSessionId: 'session-1',
    activeAgentType: 'free',
  });
  useChatStreamStore.getState().hydrateCommittedMessages('project-1', 'session-1', messages);
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
    resetChatUiStore();
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
    useChatStreamStore.getState().reset();
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
    expect(scrollArea).toHaveAttribute('tabIndex', '0');
    expect(composerOverlay).toHaveClass('absolute');
    expect(composerOverlay).toHaveClass('inset-x-0');
    expect(composerOverlay).toHaveClass('bottom-0');
    expect(within(scrollArea).getByText('Welcome to Megumi')).toBeInTheDocument();
    expect(within(composerOverlay).getByLabelText('Message Megumi')).toBeInTheDocument();
  });

  it('renders pending approvals in blocking controls without the separate tool-call card section', () => {
    installMegumiMock();
    useRunStore.getState().applyRuntimeEvent(runtimeEvent('run.started', 1, { runKind: 'agent' }));
    useToolCallStore.getState().upsertToolCall(createToolCall());
    useApprovalStore.getState().upsertApprovalRequest(createApprovalRequest());

    render(<ChatTimeline />);

    const timeline = screen.getByRole('log', { name: 'Chat timeline' });
    const approvalControls = screen.getByRole('region', { name: 'Blocking approval controls' });
    expect(approvalControls).toHaveTextContent('run_command');
    expect(approvalControls).toHaveTextContent('Run npm test');
    expect(screen.queryByRole('heading', { name: 'Tool calls' })).not.toBeInTheDocument();
    expect(screen.queryByText('Policy: ask - Command execution requires approval in default mode.')).not.toBeInTheDocument();
    expect(within(timeline).queryByRole('button', { name: 'Approve run_command' })).not.toBeInTheDocument();
    expect(within(approvalControls).getByRole('button', { name: 'Approve run_command' })).toBeInTheDocument();
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

  it('keeps approval controls outside the timeline log while retaining resolve actions', async () => {
    const megumi = installMegumiMock();
    useRunStore.getState().applyRuntimeEvent(runtimeEvent('run.started', 1, { runKind: 'agent' }));
    useApprovalStore.getState().upsertApprovalRequest(createApprovalRequest());

    render(<ChatTimeline />);

    const timeline = screen.getByRole('log', { name: 'Chat timeline' });
    expect(within(timeline).queryByRole('button', { name: 'Approve run_command' })).not.toBeInTheDocument();
    const approvalControls = screen.getByRole('region', { name: 'Blocking approval controls' });
    expect(approvalControls).toHaveAttribute('aria-live', 'polite');
    expect(approvalControls).toHaveAttribute('aria-atomic', 'true');

    await userEvent.selectOptions(screen.getByLabelText('Approval scope'), 'run');
    await userEvent.click(screen.getByRole('button', { name: 'Approve run_command' }));

    expect(megumi.approval.resolve).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        approvalRequestId: 'approval-1',
        decision: 'approved',
        scope: 'run',
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

  it('shows the pending canonical user message while waiting for stream events', async () => {
    installMegumiMock();
    selectMegumiProject();
    render(<ChatTimeline />);

    fireEvent.change(screen.getByLabelText('Message Megumi'), { target: { value: 'Start with the shell' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(screen.getByText('Start with the shell')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /processing disclosure/ })).not.toBeInTheDocument();
  });

  it('does not render legacy runtime final output without canonical stream messages', async () => {
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

    const timelineText = screen.getByRole('log', { name: 'Chat timeline' }).textContent ?? '';
    expect(timelineText).toContain('Explain Verilog');
    expect(timelineText).not.toContain('Verilog is an HDL.');
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
    expect(useChatUiStore.getState()).toMatchObject({
      activeSessionId: 'session-2',
      agentStatus: 'idle',
      lastError: null,
      sessionStates: {
        [originalSessionId]: expect.objectContaining({
          agentStatus: 'running',
          lastError: null,
        }),
      },
    });
  });

  it('does not render persisted legacy runtime error messages and does not retry from an empty draft', async () => {
    const session = installMegumiMock();
    selectMegumiProject();
    render(<ChatTimeline />);

    fireEvent.change(screen.getByLabelText('Message Megumi'), { target: { value: 'please fail this run' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(session.message.send).toHaveBeenCalledTimes(1);
    });

    act(() => {
      useChatUiStore.setState({
        agentStatus: 'error',
        lastError: 'Provider API key is missing.',
      });
    });

    expect(screen.queryByText('Provider API key is missing.')).not.toBeInTheDocument();
    expect(screen.queryByText('Needs attention')).not.toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(session.message.send).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'deepseek-v4-flash' } });
    expect(session.message.send).toHaveBeenCalledTimes(1);
  });

  it('does not render runtime-only processing disclosure without canonical blocks', () => {
    useRunStore.getState().applyRuntimeEvent(runtimeEvent('run.started', 1, { runKind: 'chat' }));
    useRunStore.getState().applyRuntimeEvent(runtimeEvent('context.effective.updated', 2, { sourceCount: 2 }));
    useRunStore.getState().applyRuntimeEvent(runtimeEvent('assistant.output.delta', 3, { delta: 'Working' }));
    useChatUiStore.setState({
      agentStatus: 'running',
      lastError: null,
    });

    render(<ChatTimeline />);

    expect(screen.queryByText('Check current UI')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /processing disclosure/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Working')).not.toBeInTheDocument();
  });

  it('does not render pending process fallback without canonical blocks', () => {
    useRunStore.getState().applyRuntimeEvent(runtimeEvent('run.started', 1, { runKind: 'chat' }));
    useChatUiStore.setState({
      agentStatus: 'running',
      lastError: null,
    });

    render(<ChatTimeline />);

    expect(screen.queryByText('正在处理')).not.toBeInTheDocument();
    expect(screen.queryByText('live')).not.toBeInTheDocument();
    expect(screen.queryByText('Explain Verilog')).not.toBeInTheDocument();
    expect(screen.queryByText('Verilog is an HDL.')).not.toBeInTheDocument();
  });

  it('does not collapse legacy process disclosure without canonical blocks', () => {
    useRunStore.getState().applyRuntimeEvent(runtimeEvent('run.started', 1, { runKind: 'agent' }));
    useRunStore.getState().applyRuntimeEvent(runtimeEvent('tool.call.completed', 2, {
      toolCallId: 'tool-call-1',
      toolName: 'read_file',
      completedAt: '2026-05-10T12:00:06.000Z',
    }));
    useChatUiStore.setState({
      agentStatus: 'running',
      lastError: null,
    });

    render(<ChatTimeline />);

    expect(screen.queryByRole('button', { name: /Expand processing disclosure/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Inspect project first')).not.toBeInTheDocument();
    expect(screen.queryByText('Here is the project summary.')).not.toBeInTheDocument();
  });

  it('renders canonical completed process disclosure collapsed before final assistant response', () => {
    activateCanonicalSession([
      committedUser('message-user-1', 'Summarize UI updates'),
      {
        ...committedAssistant('assistant:run-1', 'run-1', 'UI update summary is complete.'),
        blocks: [
          {
            blockId: 'process:run-1',
            kind: 'process_disclosure',
            runId: 'run-1',
            status: 'completed',
            startedAt: '2026-05-10T12:00:01.000Z',
            endedAt: '2026-05-10T12:01:42.000Z',
            items: [{
              itemId: 'step:model',
              kind: 'assistant_text',
              textId: 'prelude:model',
              phase: 'prelude',
              status: 'completed',
              text: 'Generate UI summary',
              format: 'plain',
            }],
          },
          {
            blockId: 'answer:run-1',
            kind: 'answer_text',
            runId: 'run-1',
            textId: 'text:run-1',
            status: 'completed',
            text: 'UI update summary is complete.',
            format: 'markdown',
          },
        ],
      },
    ]);

    render(<ChatTimeline />);

    const timelineText = screen.getByRole('log', { name: 'Chat timeline' }).textContent ?? '';
    expect(timelineText).toContain('Summarize UI updates');
    expect(timelineText).toContain('UI update summary is complete.');
    expect(screen.getByRole('button', { name: /Expand process disclosure/ })).toHaveAttribute('aria-expanded', 'false');
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

    useChatUiStore.setState({ agentStatus: 'running' });

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

  it('renders canonical chat stream messages as the live timeline source', () => {
    installMegumiMock();
    selectMegumiProject();
    useSessionStore.setState({
      sessions: [{
        id: 'session-1',
        projectId: 'project-1',
        title: 'Canonical session',
        agentType: 'free',
        createdAt: '2026-05-10T12:00:00.000Z',
        updatedAt: '2026-05-10T12:00:00.000Z',
      }],
      activeSessionId: 'session-1',
      activeAgentType: 'free',
    });
    useChatStreamStore.getState().setActiveSession('project-1', 'session-1');
    useChatStreamStore.setState({
      sessions: {
        [chatStreamSessionKey('project-1', 'session-1')]: {
          projectId: 'project-1',
          sessionId: 'session-1',
          streamsById: {},
          messages: [
            {
              messageId: 'message-user-1',
              role: 'user',
              projectId: 'project-1',
              sessionId: 'session-1',
              createdAt: '2026-05-10T12:00:00.000Z',
              blocks: [{
                blockId: 'user-text-1',
                kind: 'user_text',
                text: '读取 docs 目录',
                format: 'plain',
              }],
            },
            {
              messageId: 'assistant:run-1',
              role: 'assistant',
              projectId: 'project-1',
              sessionId: 'session-1',
              runId: 'run-1',
              createdAt: '2026-05-10T12:00:01.000Z',
              blocks: [
                {
                  blockId: 'process:run-1',
                  kind: 'process_disclosure',
                  runId: 'run-1',
                  status: 'completed',
                  startedAt: '2026-05-10T12:00:01.000Z',
                  endedAt: '2026-05-10T12:00:04.000Z',
                  items: [{
                    itemId: 'tool:tool-use-1',
                    kind: 'tool_activity',
                    toolUseId: 'tool-use-1',
                    toolName: 'list_directory',
                    inputSummary: 'docs',
                    status: 'succeeded',
                  }],
                },
                {
                  blockId: 'answer:run-1',
                  kind: 'answer_text',
                  runId: 'run-1',
                  textId: 'text-answer-1',
                  status: 'streaming',
                  text: 'docs 目录包含 README.md',
                  format: 'markdown',
                },
              ],
            },
          ],
        },
      },
    });

    render(<ChatTimeline />);

    const timeline = screen.getByRole('log', { name: 'Chat timeline' });
    expect(timeline).toHaveTextContent('读取 docs 目录');
    expect(timeline).toHaveTextContent('已处理');
    expect(timeline).toHaveTextContent('docs 目录包含 README.md');
    expect(timeline).not.toHaveTextContent('Streaming');
    expect(timeline).not.toHaveTextContent('Legacy active tool calls');
    expect(timeline).not.toHaveTextContent('TOOL CALLS');
  });

  it('renders canonical timeline messages without legacy flat message fallback', () => {
    installMegumiMock();
    selectMegumiProject();
    useSessionStore.setState({
      sessions: [{
        id: 'session-1',
        projectId: 'project-1',
        title: 'Canonical session',
        agentType: 'free',
        createdAt: '2026-05-10T12:00:00.000Z',
        updatedAt: '2026-05-10T12:00:00.000Z',
      }],
      activeSessionId: 'session-1',
      activeAgentType: 'free',
    });
    useChatStreamStore.getState().hydrateCommittedMessages('project-1', 'session-1', [
      committedUser('message-user-1', 'Canonical prompt'),
    ]);

    render(<ChatTimeline />);

    expect(screen.getByText('Canonical prompt')).toBeInTheDocument();
    expect(screen.queryByText('Legacy duplicate')).not.toBeInTheDocument();
  });

  it('renders canonical answer text from chat stream state', () => {
    installMegumiMock();
    selectMegumiProject();
    useSessionStore.setState({
      sessions: [{
        id: 'session-1',
        projectId: 'project-1',
        title: 'Canonical session',
        agentType: 'free',
        createdAt: '2026-05-10T12:00:00.000Z',
        updatedAt: '2026-05-10T12:00:00.000Z',
      }],
      activeSessionId: 'session-1',
      activeAgentType: 'free',
    });
    useChatUiStore.setState({ agentStatus: 'running' });
    useChatStreamStore.getState().setActiveSession('project-1', 'session-1');
    useChatStreamStore.setState({
      sessions: {
        [chatStreamSessionKey('project-1', 'session-1')]: {
          projectId: 'project-1',
          sessionId: 'session-1',
          streamsById: {},
          messages: [{
            messageId: 'assistant:run-1',
            role: 'assistant',
            projectId: 'project-1',
            sessionId: 'session-1',
            runId: 'run-1',
            createdAt: '2026-05-10T12:00:01.000Z',
            blocks: [{
              blockId: 'answer:run-1',
              kind: 'answer_text',
              runId: 'run-1',
              textId: 'text-answer-1',
              status: 'streaming',
              text: 'NEW CANONICAL ANSWER',
              format: 'markdown',
            }],
          }],
        },
      },
    });

    render(<ChatTimeline />);

    expect(screen.getByText('NEW CANONICAL ANSWER')).toBeInTheDocument();
  });

  it('renders canonical live assistant blocks without legacy history fallback', () => {
    installMegumiMock();
    selectMegumiProject();
    useSessionStore.setState({
      sessions: [{
        id: 'session-1',
        projectId: 'project-1',
        title: 'Mixed session',
        agentType: 'free',
        createdAt: '2026-05-10T12:00:00.000Z',
        updatedAt: '2026-05-10T12:00:00.000Z',
      }],
      activeSessionId: 'session-1',
      activeAgentType: 'free',
    });
    useChatUiStore.setState({ agentStatus: 'running' });
    useChatStreamStore.getState().setActiveSession('project-1', 'session-1');
    useChatStreamStore.setState({
      sessions: {
        [chatStreamSessionKey('project-1', 'session-1')]: {
          projectId: 'project-1',
          sessionId: 'session-1',
          streamsById: {},
          messages: [
            {
              messageId: 'message-user-1',
              role: 'user',
              projectId: 'project-1',
              sessionId: 'session-1',
              createdAt: '2026-05-10T12:00:00.000Z',
              blocks: [{
                blockId: 'user-text-1',
                kind: 'user_text',
                text: 'Read docs now',
                format: 'plain',
              }],
            },
            {
              messageId: 'assistant:run-1',
              role: 'assistant',
              projectId: 'project-1',
              sessionId: 'session-1',
              runId: 'run-1',
              createdAt: '2026-05-10T12:00:01.000Z',
              blocks: [{
                blockId: 'answer:run-1',
                kind: 'answer_text',
                runId: 'run-1',
                textId: 'text-answer-1',
                status: 'streaming',
                text: 'CANONICAL LIVE ANSWER',
                format: 'markdown',
              }],
            },
          ],
        },
      },
    });

    render(<ChatTimeline />);

    const timeline = screen.getByRole('log', { name: 'Chat timeline' });
    expect(timeline).not.toHaveTextContent('Earlier user question');
    expect(timeline).not.toHaveTextContent('Earlier assistant answer');
    expect(timeline).toHaveTextContent('CANONICAL LIVE ANSWER');
    expect(screen.getAllByText('Read docs now')).toHaveLength(1);
  });
});
