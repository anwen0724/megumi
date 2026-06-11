// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatUiStore } from '@megumi/desktop/renderer/entities/chat-ui/store';
import { useApprovalStore } from '@megumi/desktop/renderer/entities/approval';
import { useProjectStore } from '@megumi/desktop/renderer/entities/project/store';
import { useSessionStore } from '@megumi/desktop/renderer/entities/session/store';
import { IPC_CHANNELS } from '@megumi/shared/ipc';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import { useRunStore } from '@megumi/desktop/renderer/entities/run/store';
import { useToolCallStore } from '@megumi/desktop/renderer/entities/tool-call';
import { ChatPage } from '@megumi/desktop/renderer/features/chat';
import {
  chatStreamSessionKey,
  useChatStreamStore,
} from '@megumi/desktop/renderer/features/chat-stream';
import type { ApprovalRequest, ToolExecution } from '@megumi/shared/tool';
import type {
  TimelineAssistantMessage,
  TimelineMessage,
  TimelineUserMessage,
} from '@megumi/shared/timeline';

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

function committedUser(messageId: string, text: string, runId?: string): TimelineUserMessage {
  return {
    messageId,
    role: 'user',
    projectId: 'project-1',
    sessionId: 'session-1',
    runId,
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

function createToolCall(overrides: Partial<ToolExecution> = {}): ToolExecution {
  return {
    toolExecutionId: 'tool-execution-1',
    toolCallId: 'tool-call-1',
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
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
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
    status: 'pending_approval',
    requestedAt: '2026-05-20T00:00:00.000Z',
    ...overrides,
  };
}

function createApprovalRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    approvalRequestId: 'approval-1',
    toolCallId: 'tool-call-1',
    toolExecutionId: 'tool-execution-1',
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

function recoveryMeta(channel: string) {
  return {
    requestId: `request-${channel}`,
    channel,
    handledAt: '2026-06-01T10:00:00.000Z',
  };
}

function createRetryRequest(runId: string, reason: 'failed' | 'cancelled' | 'interrupted' = 'failed') {
  return {
    retryRequestId: `retry-${runId}`,
    runId,
    requestedBy: 'user' as const,
    retryKind: 'manual_retry' as const,
    reason,
    createdAt: '2026-06-01T10:00:00.000Z',
  };
}

function createCancelRequest(runId: string) {
  return {
    cancelRequestId: `cancel-${runId}`,
    runId,
    requestedBy: 'user' as const,
    reason: 'user_requested' as const,
    scope: 'run' as const,
    createdAt: '2026-06-01T10:00:00.000Z',
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function installMegumiMock() {
  const session = {
    message: {
      send: vi.fn().mockResolvedValue({ ok: true, requestId: 'request-1' }),
      cancel: vi.fn(),
    },
    branchDraft: {
      create: vi.fn(),
      cancel: vi.fn(),
    },
  };
  const approval = {
    resolve: vi.fn().mockResolvedValue({ ok: true, requestId: 'request-approval-1' }),
  };
  const recovery = {
    listRecoverableRuns: vi.fn().mockResolvedValue({
      ok: true,
      data: { runs: [] },
      meta: recoveryMeta(IPC_CHANNELS.recovery.recoverableRunsList),
    }),
    resume: vi.fn(),
    cancel: vi.fn(),
    retry: vi.fn(),
    restoreWorkspaceChangeSet: vi.fn().mockResolvedValue({
      ok: true,
      data: {},
      meta: recoveryMeta(IPC_CHANNELS.recovery.workspaceRestore),
    }),
  };
  const workspace = {
    files: {
      open: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          workspaceRoot: 'C:/all/work/study/megumi',
          filePath: 'src/app.ts',
          opened: true,
        },
        meta: recoveryMeta(IPC_CHANNELS.workspace.files.open),
      }),
    },
  };
  Object.defineProperty(window, 'megumi', {
    configurable: true,
    value: {
      project: {
        useExisting: vi.fn().mockResolvedValue({ ok: true, data: { cancelled: true } }),
      },
      workspace,
      session: {
        message: {
          send: session.message.send,
          cancel: session.message.cancel,
        },
        branchDraft: {
          create: session.branchDraft.create,
          cancel: session.branchDraft.cancel,
        },
      },
      approval,
      recovery,
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
  return { ...session, session, approval, recovery, workspace };
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

describe('ChatPage flow', () => {
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
    render(<ChatPage />);
    expect(screen.getByText('Welcome to Megumi')).toBeInTheDocument();
    expect(screen.getByText('Open a project to get started.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open project' })).toBeInTheDocument();
    expect(screen.getByLabelText('Message Megumi')).toBeInTheDocument();
    expect(screen.getByLabelText('Permission mode')).toHaveValue('default');
    expect(screen.getByLabelText('Model')).toHaveValue('deepseek-v4-flash');
  });

  it('keeps the scrollbar on the full-width message area while aligning message and composer columns', () => {
    activateCanonicalSession([committedUser('message-layout-user', 'Check layout')]);

    render(<ChatPage />);

    const root = screen.getByTestId('chat-page-root');
    const chatViewport = screen.getByTestId('chat-viewport');
    const messageScrollArea = screen.getByTestId('message-scroll-panel');
    const messageContentColumn = screen.getByTestId('message-column');
    const composerDock = screen.getByTestId('composer-dock');
    const composerContentColumn = screen.getByTestId('composer-dock-column');
    const contentColumn = screen.getByRole('log', { name: 'Chat timeline' });

    expect(root).toHaveClass('relative');
    expect(root).toHaveClass('overflow-hidden');
    expect(chatViewport).toHaveClass('h-full');
    expect(messageScrollArea).toHaveClass('absolute');
    expect(messageScrollArea).toHaveClass('bottom-4');
    expect(messageScrollArea).toHaveClass('min-h-0');
    expect(messageScrollArea).toHaveClass('overflow-y-auto');
    expect(messageScrollArea).not.toHaveClass('h-full');
    expect(messageScrollArea).not.toHaveClass('max-w-3xl');
    expect(messageScrollArea).toHaveAttribute('tabIndex', '0');
    expect(messageContentColumn).toHaveClass('mx-auto');
    expect(messageContentColumn).toHaveClass('w-[calc(100%-3rem)]');
    expect(messageContentColumn).toHaveClass('max-w-[var(--chat-column-width)]');
    expect(messageContentColumn).not.toHaveClass('px-6');
    expect(composerContentColumn).toHaveClass('mx-auto');
    expect(composerContentColumn).toHaveClass('w-[calc(100%-3rem)]');
    expect(composerContentColumn).toHaveClass('max-w-[var(--chat-composer-width)]');
    expect(composerContentColumn).not.toHaveClass('px-6');
    expect(contentColumn).toHaveClass('w-full');
    expect(contentColumn).not.toHaveClass('max-w-4xl');
    expect(composerDock).toHaveClass('absolute');
    expect(composerDock).toHaveClass('bottom-0');
    expect(composerDock).toHaveClass('bg-transparent');
    expect(composerDock).toHaveClass('pb-3');
    expect(composerDock).not.toHaveClass('px-6');
    expect(composerDock).not.toHaveClass('pb-6');
    expect(within(composerContentColumn).getByRole('form', { name: 'Message composer' })).not.toHaveClass('max-w-3xl');
    expect(within(messageScrollArea).getByText('Check layout')).toBeInTheDocument();
    expect(within(composerDock).getByLabelText('Message Megumi')).toBeInTheDocument();

    expect(screen.getByTestId('chat-page-root').getAttribute('style')).toContain('--composer-dock-height:');
    expect(screen.getByTestId('chat-page-root').getAttribute('style')).toContain('--composer-dock-bottom-inset:');
    expect(screen.getByTestId('chat-page-root').getAttribute('style')).not.toContain('--composer-dock-cut-inset:');
    expect(screen.getByTestId('chat-page-root').getAttribute('style')).toContain('--chat-column-width:');
    expect(screen.getByTestId('chat-page-root').getAttribute('style')).toContain('--chat-composer-width:');
    expect(screen.getByTestId('chat-page-root').getAttribute('style')).not.toContain('--chat-content-width:');
    expect(screen.getByTestId('message-bottom-spacer')).toBeInTheDocument();
    expect(screen.getByTestId('message-scroll-panel')).toHaveAttribute('tabIndex', '0');
    expect(screen.getByRole('log', { name: 'Chat timeline' })).not.toContainElement(
      screen.getByRole('form', { name: 'Message composer' }),
    );
  });

  it('keeps the empty-session composer on the centered chat content column', () => {
    selectMegumiProject();

    render(<ChatPage />);

    const welcomeLayout = screen.getByTestId('welcome-chat-layout');
    const welcomeCopy = screen.getByTestId('welcome-chat');
    const welcomeComposerLayout = screen.getByTestId('welcome-composer-layout');
    const composerForm = screen.getByRole('form', { name: 'Message composer' });

    expect(screen.getByText('Welcome to Megumi')).toBeInTheDocument();
    expect(welcomeLayout).toHaveClass('items-center');
    expect(welcomeLayout).toContainElement(welcomeCopy);
    expect(welcomeLayout).toContainElement(welcomeComposerLayout);
    expect(welcomeCopy).not.toHaveClass('h-full');
    expect(welcomeComposerLayout).toHaveClass('w-full');
    expect(welcomeComposerLayout).not.toHaveClass('pr-16');
    expect(welcomeComposerLayout).not.toHaveClass('xl:pr-32');
    expect(composerForm).not.toHaveClass('min-w-[38rem]');
  });

  it('keeps an existing empty history session in timeline mode instead of showing the new-session welcome', () => {
    selectMegumiProject();
    useSessionStore.setState({
      sessions: [{
        id: 'session-history-empty',
        projectId: 'project-1',
        title: 'hello',
        agentType: 'free',
        createdAt: '2026-05-10T12:00:00.000Z',
        updatedAt: '2026-05-10T12:00:00.000Z',
      }],
      activeSessionId: 'session-history-empty',
      activeAgentType: 'free',
    });
    useChatStreamStore.getState().hydrateCommittedMessages('project-1', 'session-history-empty', []);

    render(<ChatPage />);

    expect(screen.queryByText('Welcome to Megumi')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('New session project: Megumi')).not.toBeInTheDocument();
    expect(screen.getByRole('log', { name: 'Chat timeline' })).toBeInTheDocument();
    expect(screen.getByTestId('composer-dock')).toContainElement(
      screen.getByRole('form', { name: 'Message composer' }),
    );
  });

  it('renders pending approvals in blocking controls without the separate tool-call card section', () => {
    installMegumiMock();
    useRunStore.getState().applyRuntimeEvent(runtimeEvent('run.started', 1, { runKind: 'agent' }));
    useToolCallStore.getState().upsertToolCall(createToolCall());
    useApprovalStore.getState().upsertApprovalRequest(createApprovalRequest());

    render(<ChatPage />);

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

    render(<ChatPage />);

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

    render(<ChatPage />);

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
    render(<ChatPage />);

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
    render(<ChatPage />);

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
    render(<ChatPage />);

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
    render(<ChatPage />);

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
    render(<ChatPage />);

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

    render(<ChatPage />);

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

    render(<ChatPage />);

    expect(screen.queryByText('正在处理')).not.toBeInTheDocument();
    expect(screen.queryByText('live')).not.toBeInTheDocument();
    expect(screen.queryByText('Explain Verilog')).not.toBeInTheDocument();
    expect(screen.queryByText('Verilog is an HDL.')).not.toBeInTheDocument();
  });

  it('does not collapse legacy process disclosure without canonical blocks', () => {
    useRunStore.getState().applyRuntimeEvent(runtimeEvent('run.started', 1, { runKind: 'agent' }));
    useRunStore.getState().applyRuntimeEvent(runtimeEvent('tool.execution.completed', 2, {
      toolCallId: 'tool-call-1',
      toolName: 'read_file',
      completedAt: '2026-05-10T12:00:06.000Z',
    }));
    useChatUiStore.setState({
      agentStatus: 'running',
      lastError: null,
    });

    render(<ChatPage />);

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

    render(<ChatPage />);

    const timelineText = screen.getByRole('log', { name: 'Chat timeline' }).textContent ?? '';
    expect(timelineText).toContain('Summarize UI updates');
    expect(timelineText).toContain('UI update summary is complete.');
    expect(screen.getByRole('button', { name: /Expand process disclosure/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/Generate UI summary/)).not.toBeInTheDocument();
  });

  it('renders recoverable actions by status without a generic cancel action', async () => {
    const api = installMegumiMock();
    api.recovery.listRecoverableRuns.mockResolvedValue({
      ok: true,
      data: {
        runs: [
          { runId: 'run-failed', sessionId: 'session-1', status: 'failed', reason: 'failed', title: 'Failed run' },
          { runId: 'run-cancelled', sessionId: 'session-1', status: 'cancelled', reason: 'cancelled', title: 'Cancelled run' },
          { runId: 'run-interrupted', sessionId: 'session-1', status: 'running', reason: 'interrupted', title: 'Interrupted run' },
          { runId: 'run-other-session', sessionId: 'session-2', status: 'failed', reason: 'failed', title: 'Other session run' },
        ],
      },
      meta: recoveryMeta(IPC_CHANNELS.recovery.recoverableRunsList),
    });
    api.recovery.retry.mockResolvedValue({
      ok: true,
      data: { request: createRetryRequest('run-failed') },
      meta: recoveryMeta(IPC_CHANNELS.recovery.retry),
    });
    api.recovery.cancel.mockResolvedValue({
      ok: true,
      data: { request: createCancelRequest('run-interrupted') },
      meta: recoveryMeta(IPC_CHANNELS.recovery.cancel),
    });

    activateCanonicalSession([
      committedUser('message-1', 'hello'),
      committedAssistant('assistant:run-failed', 'run-failed', 'failed answer'),
      committedAssistant('assistant:run-cancelled', 'run-cancelled', 'cancelled answer'),
      committedAssistant('assistant:run-interrupted', 'run-interrupted', 'interrupted answer'),
    ]);

    render(<ChatPage />);

    expect(await screen.findAllByRole('button', { name: 'Retry' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Rerun' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark cancelled' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.queryByText('Other session run')).not.toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    expect(api.recovery.retry).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ runId: 'run-failed', retryKind: 'manual_retry', reason: 'failed' }),
    }));

    await userEvent.click(screen.getByRole('button', { name: 'Rerun' }));
    expect(api.recovery.retry).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ runId: 'run-cancelled', retryKind: 'manual_retry', reason: 'cancelled' }),
    }));

    await userEvent.click(screen.getByRole('button', { name: 'Mark cancelled' }));
    expect(api.recovery.cancel).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ runId: 'run-interrupted', reason: 'user_requested' }),
    }));
  });

  it('shows recoverable actions in ComposerDock instead of inside the timeline log', async () => {
    const api = installMegumiMock();
    api.recovery.listRecoverableRuns.mockResolvedValue({
      ok: true,
      data: {
        runs: [
          { runId: 'run-visible', sessionId: 'session-1', status: 'failed', reason: 'failed', title: 'Visible failed run' },
          { runId: 'run-unmatched', sessionId: 'session-1', status: 'failed', reason: 'failed', title: 'Unmatched failed run' },
        ],
      },
      meta: recoveryMeta(IPC_CHANNELS.recovery.recoverableRunsList),
    });
    activateCanonicalSession([
      committedUser('message-1', 'hello'),
      committedAssistant('assistant:run-visible', 'run-visible', 'visible answer'),
    ]);

    render(<ChatPage />);

    expect(await screen.findByLabelText('Recoverable actions for Unmatched failed run')).toBeInTheDocument();
    expect(screen.getByLabelText('Recoverable actions for Visible failed run')).toBeInTheDocument();
    const timeline = screen.getByRole('log', { name: 'Chat timeline' });
    expect(within(timeline).queryByLabelText('Recoverable actions for Visible failed run')).not.toBeInTheDocument();
    const composerDock = screen.getByTestId('composer-dock');
    expect(within(composerDock).getByLabelText('Recoverable actions for Visible failed run')).toBeInTheDocument();
  });

  it('prevents duplicate recoverable action requests while a request is pending', async () => {
    const api = installMegumiMock();
    const retryDeferred = createDeferred<Awaited<ReturnType<typeof api.recovery.retry>>>();
    const cancelDeferred = createDeferred<Awaited<ReturnType<typeof api.recovery.cancel>>>();
    api.recovery.listRecoverableRuns
      .mockResolvedValueOnce({
        ok: true,
        data: {
          runs: [
            { runId: 'run-failed', sessionId: 'session-1', status: 'failed', reason: 'failed', title: 'Failed run' },
            { runId: 'run-interrupted', sessionId: 'session-1', status: 'running', reason: 'interrupted', title: 'Interrupted run' },
          ],
        },
        meta: recoveryMeta(IPC_CHANNELS.recovery.recoverableRunsList),
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          runs: [
            { runId: 'run-interrupted', sessionId: 'session-1', status: 'running', reason: 'interrupted', title: 'Interrupted run' },
          ],
        },
        meta: recoveryMeta(IPC_CHANNELS.recovery.recoverableRunsList),
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { runs: [] },
        meta: recoveryMeta(IPC_CHANNELS.recovery.recoverableRunsList),
      });
    api.recovery.retry.mockReturnValueOnce(retryDeferred.promise);
    api.recovery.cancel.mockReturnValueOnce(cancelDeferred.promise);
    activateCanonicalSession([
      committedUser('message-1', 'hello'),
      committedAssistant('assistant:run-failed', 'run-failed', 'failed answer'),
      committedAssistant('assistant:run-interrupted', 'run-interrupted', 'interrupted answer'),
    ]);

    render(<ChatPage />);

    const retryActions = await screen.findByLabelText('Recoverable actions for Failed run');
    const retryButton = within(retryActions).getByRole('button', { name: 'Retry' });
    await userEvent.dblClick(retryButton);

    expect(api.recovery.retry).toHaveBeenCalledTimes(1);
    expect(retryButton).toBeDisabled();

    retryDeferred.resolve({
      ok: true,
      data: { request: createRetryRequest('run-failed') },
      meta: recoveryMeta(IPC_CHANNELS.recovery.retry),
    });
    await waitFor(() => {
      expect(screen.queryByLabelText('Recoverable actions for Failed run')).not.toBeInTheDocument();
    });

    const interruptedActions = screen.getByLabelText('Recoverable actions for Interrupted run');
    const markCancelledButton = within(interruptedActions).getByRole('button', { name: 'Mark cancelled' });
    await userEvent.dblClick(markCancelledButton);

    expect(api.recovery.cancel).toHaveBeenCalledTimes(1);
    expect(markCancelledButton).toBeDisabled();

    cancelDeferred.resolve({
      ok: true,
      data: { request: createCancelRequest('run-interrupted') },
      meta: recoveryMeta(IPC_CHANNELS.recovery.cancel),
    });
    await waitFor(() => {
      expect(screen.queryByLabelText('Recoverable actions for Interrupted run')).not.toBeInTheDocument();
    });
  });
  it('refreshes recoverable actions after retry rerun and mark-cancelled requests succeed', async () => {
    const api = installMegumiMock();
    api.recovery.listRecoverableRuns
      .mockResolvedValueOnce({
        ok: true,
        data: {
          runs: [
            { runId: 'run-failed', sessionId: 'session-1', status: 'failed', reason: 'failed', title: 'Failed run' },
            { runId: 'run-cancelled', sessionId: 'session-1', status: 'cancelled', reason: 'cancelled', title: 'Cancelled run' },
            { runId: 'run-interrupted', sessionId: 'session-1', status: 'running', reason: 'interrupted', title: 'Interrupted run' },
          ],
        },
        meta: recoveryMeta(IPC_CHANNELS.recovery.recoverableRunsList),
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          runs: [
            { runId: 'run-cancelled', sessionId: 'session-1', status: 'cancelled', reason: 'cancelled', title: 'Cancelled run' },
            { runId: 'run-interrupted', sessionId: 'session-1', status: 'running', reason: 'interrupted', title: 'Interrupted run' },
          ],
        },
        meta: recoveryMeta(IPC_CHANNELS.recovery.recoverableRunsList),
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          runs: [
            { runId: 'run-interrupted', sessionId: 'session-1', status: 'running', reason: 'interrupted', title: 'Interrupted run' },
          ],
        },
        meta: recoveryMeta(IPC_CHANNELS.recovery.recoverableRunsList),
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { runs: [] },
        meta: recoveryMeta(IPC_CHANNELS.recovery.recoverableRunsList),
      });
    api.recovery.retry.mockResolvedValue({
      ok: true,
      data: { request: createRetryRequest('run-failed') },
      meta: recoveryMeta(IPC_CHANNELS.recovery.retry),
    });
    api.recovery.cancel.mockResolvedValue({
      ok: true,
      data: { request: createCancelRequest('run-interrupted') },
      meta: recoveryMeta(IPC_CHANNELS.recovery.cancel),
    });
    activateCanonicalSession([
      committedUser('message-1', 'hello'),
      committedAssistant('assistant:run-failed', 'run-failed', 'failed answer'),
      committedAssistant('assistant:run-cancelled', 'run-cancelled', 'cancelled answer'),
      committedAssistant('assistant:run-interrupted', 'run-interrupted', 'interrupted answer'),
    ]);

    render(<ChatPage />);

    await userEvent.click(within(await screen.findByLabelText('Recoverable actions for Failed run')).getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(api.recovery.listRecoverableRuns).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByLabelText('Recoverable actions for Failed run')).not.toBeInTheDocument();

    await userEvent.click(within(screen.getByLabelText('Recoverable actions for Cancelled run')).getByRole('button', { name: 'Rerun' }));
    await waitFor(() => {
      expect(api.recovery.listRecoverableRuns).toHaveBeenCalledTimes(3);
    });
    expect(screen.queryByLabelText('Recoverable actions for Cancelled run')).not.toBeInTheDocument();

    await userEvent.click(within(screen.getByLabelText('Recoverable actions for Interrupted run')).getByRole('button', { name: 'Mark cancelled' }));
    await waitFor(() => {
      expect(api.recovery.listRecoverableRuns).toHaveBeenCalledTimes(4);
    });
    expect(screen.queryByLabelText('Recoverable actions for Interrupted run')).not.toBeInTheDocument();
  });

  it('refreshes recoverable actions when the current session run later becomes recoverable', async () => {
    const api = installMegumiMock();
    api.recovery.listRecoverableRuns
      .mockResolvedValueOnce({
        ok: true,
        data: { runs: [] },
        meta: recoveryMeta(IPC_CHANNELS.recovery.recoverableRunsList),
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          runs: [
            { runId: 'run-late-failed', sessionId: 'session-1', status: 'failed', reason: 'failed', title: 'Late failed run' },
          ],
        },
        meta: recoveryMeta(IPC_CHANNELS.recovery.recoverableRunsList),
      });
    activateCanonicalSession([
      committedUser('message-1', 'hello'),
      committedAssistant('assistant:run-late-failed', 'run-late-failed', 'late failed answer'),
    ]);

    render(<ChatPage />);

    await waitFor(() => {
      expect(api.recovery.listRecoverableRuns).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();

    act(() => {
      useRunStore.setState({
        activeRunId: 'run-late-failed',
        runs: {
          'run-late-failed': {
            runId: 'run-late-failed',
            sessionId: 'session-1',
            status: 'failed',
            updatedAt: '2026-06-01T10:00:01.000Z',
          },
        },
      });
    });

    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(api.recovery.listRecoverableRuns).toHaveBeenCalledTimes(2);
  });

  it('shows branch and rerun actions only for completed user messages and creates a branch draft', async () => {
    const api = installMegumiMock();
    api.session.branchDraft.create.mockResolvedValue({
      ok: true,
      data: {
        branchDraft: {
          branchMarkerId: 'branch-marker-1',
          sessionId: 'session-1',
          sourceMessageId: 'message-1',
          seedText: 'original prompt',
          label: 'Branch from 07:28',
          intent: 'branch',
          createdAt: '2026-06-01T10:00:00.000Z',
        },
      },
      meta: {
        requestId: 'request-branch-1',
        channel: IPC_CHANNELS.session.branchDraft.create,
        handledAt: '2026-06-01T10:00:00.000Z',
      },
    });
    activateCanonicalSession([
      committedUser('message-1', 'original prompt', 'run-1'),
      committedAssistant('assistant:run-1', 'run-1', 'answer'),
    ]);

    render(<ChatPage />);

    const userArticle = screen.getByRole('article', { name: 'User message' });
    await userEvent.hover(userArticle);
    await userEvent.click(screen.getByRole('button', { name: 'Branch from here' }));

    expect(api.session.branchDraft.create).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        sessionId: 'session-1',
        messageId: 'message-1',
        intent: 'branch',
      }),
    }));
    expect(screen.getByText('Branch from 07:28')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText('Message Megumi')).toHaveValue('original prompt');
    });
    expect(screen.queryByRole('button', { name: 'Branch from assistant message' })).not.toBeInTheDocument();
  });

  it('hides branch and rerun actions for in-flight user messages and sends rerun intent for historical messages', async () => {
    const api = installMegumiMock();
    api.session.branchDraft.create.mockResolvedValue({
      ok: true,
      data: {
        branchDraft: {
          branchMarkerId: 'branch-marker-rerun',
          sessionId: 'session-1',
          sourceMessageId: 'message-history',
          seedText: 'historical prompt',
          label: 'Branch from 07:28',
          intent: 'rerun',
          createdAt: '2026-06-01T10:00:00.000Z',
        },
      },
      meta: {
        requestId: 'request-rerun-1',
        channel: IPC_CHANNELS.session.branchDraft.create,
        handledAt: '2026-06-01T10:00:00.000Z',
      },
    });
    activateCanonicalSession([
      committedUser('message-history', 'historical prompt', 'run-history'),
      committedAssistant('assistant:run-history', 'run-history', 'historical answer'),
    ]);

    useChatStreamStore.getState().addPendingUserMessage('project-1', 'session-1', {
      clientMessageId: 'message-user-current-uuid',
      text: 'current prompt',
      createdAt: '2026-06-01T10:01:00.000Z',
    });

    render(<ChatPage />);

    const currentArticle = screen.getByText('current prompt').closest('article');
    expect(currentArticle).not.toBeNull();
    if (!currentArticle) {
      throw new Error('Expected current user article.');
    }
    await userEvent.hover(currentArticle);
    expect(within(currentArticle).queryByRole('button', { name: 'Branch from here' })).not.toBeInTheDocument();
    expect(within(currentArticle).queryByRole('button', { name: 'Rerun' })).not.toBeInTheDocument();

    const historicalArticle = screen.getByText('historical prompt').closest('article');
    expect(historicalArticle).not.toBeNull();
    if (!historicalArticle) {
      throw new Error('Expected historical user article.');
    }
    await userEvent.hover(historicalArticle);
    await userEvent.click(within(historicalArticle).getByRole('button', { name: 'Rerun' }));

    expect(api.session.branchDraft.create).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        sessionId: 'session-1',
        messageId: 'message-history',
        intent: 'rerun',
      }),
    }));
  });

  it('hides branch and rerun actions for historical messages while another run is active', async () => {
    installMegumiMock();
    activateCanonicalSession([
      committedUser('message-history', 'historical prompt', 'run-history'),
      committedAssistant('assistant:run-history', 'run-history', 'historical answer'),
    ]);
    useRunStore.setState({
      activeRunId: 'run-active',
      runs: {
        'run-active': {
          runId: 'run-active',
          sessionId: 'session-1',
          status: 'running',
          updatedAt: '2026-06-01T10:00:00.000Z',
        },
      },
    });

    render(<ChatPage />);

    const historicalArticle = screen.getByText('historical prompt').closest('article');
    expect(historicalArticle).not.toBeNull();
    if (!historicalArticle) {
      throw new Error('Expected historical user article.');
    }
    await userEvent.hover(historicalArticle);

    expect(within(historicalArticle).queryByRole('button', { name: 'Branch from here' })).not.toBeInTheDocument();
    expect(within(historicalArticle).queryByRole('button', { name: 'Rerun' })).not.toBeInTheDocument();
  });

  it('hides branch and rerun actions while waiting for approval', async () => {
    installMegumiMock();
    activateCanonicalSession([
      committedUser('message-history', 'historical prompt', 'run-history'),
      committedAssistant('assistant:run-history', 'run-history', 'historical answer'),
    ]);
    useChatUiStore.setState({
      activeSessionId: 'session-1',
      agentStatus: 'waiting-approval',
      sessionStates: {
        'session-1': {
          agentStatus: 'waiting-approval',
          lastError: null,
        },
      },
    });

    render(<ChatPage />);

    const historicalArticle = screen.getByText('historical prompt').closest('article');
    expect(historicalArticle).not.toBeNull();
    if (!historicalArticle) {
      throw new Error('Expected historical user article.');
    }
    await userEvent.hover(historicalArticle);

    expect(within(historicalArticle).queryByRole('button', { name: 'Branch from here' })).not.toBeInTheDocument();
    expect(within(historicalArticle).queryByRole('button', { name: 'Rerun' })).not.toBeInTheDocument();
  });

  it('hides branch and rerun actions while the active run is waiting for approval', async () => {
    installMegumiMock();
    activateCanonicalSession([
      committedUser('message-history', 'historical prompt', 'run-history'),
      committedAssistant('assistant:run-history', 'run-history', 'historical answer'),
    ]);
    useRunStore.setState({
      activeRunId: 'run-active',
      runs: {
        'run-active': {
          runId: 'run-active',
          sessionId: 'session-1',
          status: 'waiting_for_approval',
          updatedAt: '2026-06-01T10:00:00.000Z',
        },
      },
    });

    render(<ChatPage />);

    const historicalArticle = screen.getByText('historical prompt').closest('article');
    expect(historicalArticle).not.toBeNull();
    if (!historicalArticle) {
      throw new Error('Expected historical user article.');
    }
    await userEvent.hover(historicalArticle);

    expect(within(historicalArticle).queryByRole('button', { name: 'Branch from here' })).not.toBeInTheDocument();
    expect(within(historicalArticle).queryByRole('button', { name: 'Rerun' })).not.toBeInTheDocument();
  });

  it('wires the running composer Stop button to the active session message cancel request', async () => {
    const session = installMegumiMock();
    selectMegumiProject();
    render(<ChatPage />);

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

  it('calls useExistingProject when the Open project button is clicked', async () => {
    installMegumiMock();
    render(<ChatPage />);

    const openButton = screen.getByRole('button', { name: 'Open project' });
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

    render(<ChatPage />);

    expect(screen.getByText('Welcome to Megumi')).toBeInTheDocument();
    expect(screen.queryByText('Megumi is ready to help with this project.')).not.toBeInTheDocument();
    expect(screen.getByText('/home/user/test')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open project' })).not.toBeInTheDocument();
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
                    itemId: 'tool:tool-call-1',
                    kind: 'tool_activity',
                    toolCallId: 'tool-call-1',
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

    render(<ChatPage />);

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

    render(<ChatPage />);

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

    render(<ChatPage />);

    expect(screen.getByText('NEW CANONICAL ANSWER')).toBeInTheDocument();
  });

  it('renders workspace change footer actions under assistant messages', async () => {
    const api = installMegumiMock();
    api.recovery.restoreWorkspaceChangeSet.mockResolvedValueOnce({
      ok: true,
      data: {
        request: {
          restoreRequestId: 'workspace-restore-request-1',
          changeSetId: 'workspace-change-set-1',
          sessionId: 'session-1',
          runId: 'run-1',
          requestedBy: 'user',
          status: 'completed',
          requestedAt: '2026-06-06T10:00:01.000Z',
          completedAt: '2026-06-06T10:00:02.000Z',
        },
        result: {
          restoreResultId: 'workspace-restore-result-1',
          restoreRequestId: 'workspace-restore-request-1',
          changeSetId: 'workspace-change-set-1',
          sessionId: 'session-1',
          runId: 'run-1',
          status: 'restored',
          restoredAt: '2026-06-06T10:00:02.000Z',
          metadata: {
            changedFileCount: 1,
            restoredCount: 1,
            conflictCount: 0,
            failedCount: 0,
          },
        },
        fileResults: [{
          restoreFileResultId: 'workspace-restore-file-result-1',
          restoreResultId: 'workspace-restore-result-1',
          changedFileId: 'workspace-changed-file-1',
          projectPath: 'src/app.ts',
          status: 'restored',
          restoredAt: '2026-06-06T10:00:02.000Z',
        }],
        summary: {
          changeSetId: 'workspace-change-set-1',
          sessionId: 'session-1',
          runId: 'run-1',
          changedFileCount: 1,
          restorableCount: 0,
          restoredCount: 1,
          conflictCount: 0,
          failedCount: 0,
          hasRestorableChanges: false,
          updatedAt: '2026-06-06T10:00:02.000Z',
        },
      },
      meta: recoveryMeta(IPC_CHANNELS.recovery.workspaceRestore),
    });
    activateCanonicalSession([
      committedUser('message-user-1', 'Change a file', 'run-1'),
      {
        ...committedAssistant('assistant:run-1', 'run-1', 'Changed src/app.ts'),
        workspaceChangeFooter: {
          runId: 'run-1',
          sessionId: 'session-1',
          updatedAt: '2026-06-06T10:00:00.000Z',
          changeSets: [{
            changeSetId: 'workspace-change-set-1',
            changedFileCount: 1,
            restorableCount: 1,
            restoredCount: 0,
            conflictCount: 0,
            failedCount: 0,
            hasRestorableChanges: true,
            files: [{
              changedFileId: 'workspace-changed-file-1',
              projectPath: 'src/app.ts',
              changeKind: 'modified',
              restoreState: 'restorable',
            }],
          }],
        },
      },
    ]);

    render(<ChatPage />);

    const footer = screen.getByRole('region', { name: '本轮工作区变更' });
    expect(footer).toHaveTextContent('Megumi 修改了 1 个文件');
    await userEvent.click(within(footer).getByRole('button', { name: '打开' }));
    await userEvent.click(within(footer).getByRole('button', { name: '撤销' }));
    const restoreDialog = await screen.findByRole('status', { name: '撤销结果' });
    expect(restoreDialog).toHaveTextContent('已撤销 1 个文件');
    expect(restoreDialog).toHaveTextContent('src/app.ts 已恢复到修改前状态');

    expect(api.workspace.files.open).toHaveBeenCalledWith(expect.objectContaining({
      payload: {
        workspaceRoot: 'C:/all/work/study/megumi',
        filePath: 'src/app.ts',
      },
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.workspace.files.open,
        source: 'renderer',
      }),
    }));
    expect(api.recovery.restoreWorkspaceChangeSet).toHaveBeenCalledWith(expect.objectContaining({
      payload: {
        changeSetId: 'workspace-change-set-1',
        requestedBy: 'user',
        metadata: {
          source: 'workspace-change-footer',
        },
      },
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.recovery.workspaceRestore,
        source: 'renderer',
      }),
    }));
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

    render(<ChatPage />);

    const timeline = screen.getByRole('log', { name: 'Chat timeline' });
    expect(timeline).not.toHaveTextContent('Earlier user question');
    expect(timeline).not.toHaveTextContent('Earlier assistant answer');
    expect(timeline).toHaveTextContent('CANONICAL LIVE ANSWER');
    expect(screen.getAllByText('Read docs now')).toHaveLength(1);
  });
});

