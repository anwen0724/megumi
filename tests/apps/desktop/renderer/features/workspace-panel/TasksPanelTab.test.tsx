// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TasksPanelTab } from '@megumi/desktop/renderer/features/workspace-panel';
import { useApprovalStore } from '@megumi/desktop/renderer/features/approvals/store';
import { useChatStore } from '@megumi/desktop/renderer/entities/chat/store';
import { useApprovalStore as useRuntimeApprovalStore } from '@megumi/desktop/renderer/entities/approval/store';
import { useRunStore } from '@megumi/desktop/renderer/entities/run/store';
import { useToolCallStore } from '@megumi/desktop/renderer/entities/tool-call/store';

function resetStores() {
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
  useApprovalStore.setState({
    pending: null,
    resolve: null,
  });
  useRunStore.getState().resetRuns();
  useToolCallStore.getState().reset();
  useRuntimeApprovalStore.getState().reset();
}

describe('TasksPanelTab', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders empty state with no active work', () => {
    render(<TasksPanelTab />);

    expect(screen.getByText('No active tasks')).toBeInTheDocument();
  });

  it('renders active run state as session tasks', () => {
    useRunStore.setState({
      activeRunId: 'run-1',
      runs: {
        'run-1': {
          runId: 'run-1',
          sessionId: 'session-1',
          status: 'running',
          updatedAt: '2026-05-10T00:00:00.000Z',
        },
      },
      eventsByRun: {},
      lastError: null,
    });

    render(<TasksPanelTab />);

    expect(screen.getByText('Session tasks')).toBeInTheDocument();
    expect(screen.getByText('Running session message')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.queryByText('Mock agent run')).not.toBeInTheDocument();
    expect(screen.queryByText('Runtime chat request')).not.toBeInTheDocument();
  });

  it('renders pending tool calls', () => {
    useChatStore.setState({
      pendingToolCalls: [
        {
          id: 'tool-1',
          name: 'read_file',
          args: { path: 'apps/desktop/src/renderer/app/App.tsx' },
          status: 'executing',
        },
      ],
    });

    render(<TasksPanelTab />);

    expect(screen.getByText('Active tool calls')).toBeInTheDocument();
    expect(screen.getByText('read_file')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  it('renders pending approval card and resolves approval', async () => {
    const resolve = vi.fn();

    useApprovalStore.setState({
      pending: {
        toolCallId: 'approval-1',
        toolName: 'run_command',
        arguments: { command: 'npm test' },
        displayText: 'Run npm test',
      },
      resolve,
    });

    render(<TasksPanelTab />);

    expect(screen.getByText('Approval needed')).toBeInTheDocument();
    expect(screen.getByText('run_command')).toBeInTheDocument();
    expect(screen.getByText('Run npm test')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Approve run_command' }));

    expect(resolve).toHaveBeenCalledWith(true);
    expect(useApprovalStore.getState().pending).toBeNull();
  });

  it('renders runtime tool calls and runtime approvals', () => {
    useRunStore.setState({
      activeRunId: 'run-1',
      runs: {
        'run-1': {
          runId: 'run-1',
          sessionId: 'session-1',
          status: 'running',
          updatedAt: '2026-05-10T00:00:00.000Z',
        },
      },
      eventsByRun: {},
      lastError: null,
    });
    useToolCallStore.getState().upsertToolCall({
      toolCallId: 'tool-runtime-1',
      runId: 'run-1',
      stepId: 'step-1',
      actionId: 'action-1',
      toolName: 'read_file',
      input: { path: 'README.md' },
      inputPreview: {
        summary: 'Read README.md',
        targets: [{ kind: 'file', label: 'README.md' }],
        redactionState: 'none',
      },
      capabilities: ['workspace_read'],
      riskLevel: 'low',
      sideEffect: 'none',
      status: 'running',
      requestedAt: '2026-05-10T00:00:00.000Z',
    });
    useRuntimeApprovalStore.getState().upsertApprovalRequest({
      approvalRequestId: 'approval-runtime-1',
      toolCallId: 'tool-runtime-2',
      runId: 'run-1',
      stepId: 'step-1',
      actionKind: 'call_tool',
      toolName: 'write_file',
      capabilities: ['workspace_write'],
      riskLevel: 'medium',
      title: 'Write file',
      summary: 'Write README.md',
      preview: {
        action: 'write file',
        targets: [{ kind: 'file', label: 'README.md' }],
      },
      requestedScope: 'once',
      status: 'pending',
      createdAt: '2026-05-10T00:00:01.000Z',
    });
    useRuntimeApprovalStore.getState().upsertApprovalRequest({
      approvalRequestId: 'approval-runtime-other-run',
      toolCallId: 'tool-runtime-other-run',
      runId: 'run-2',
      stepId: 'step-2',
      actionKind: 'call_tool',
      toolName: 'delete_file',
      capabilities: ['workspace_write'],
      riskLevel: 'high',
      title: 'Delete file',
      summary: 'Delete README.md',
      preview: {
        action: 'delete file',
        targets: [{ kind: 'file', label: 'README.md' }],
      },
      requestedScope: 'once',
      status: 'pending',
      createdAt: '2026-05-10T00:00:02.000Z',
    });

    render(<TasksPanelTab />);

    expect(screen.getByText('Runtime tool calls')).toBeInTheDocument();
    expect(screen.getByText('read_file')).toBeInTheDocument();
    expect(screen.getByText('Runtime approvals')).toBeInTheDocument();
    expect(screen.getByText('write_file')).toBeInTheDocument();
    expect(screen.getByText('Write README.md')).toBeInTheDocument();
    expect(screen.queryByText('delete_file')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete README.md')).not.toBeInTheDocument();
  });

  it('does not render runtime approvals without an active run', () => {
    useRuntimeApprovalStore.getState().upsertApprovalRequest({
      approvalRequestId: 'approval-runtime-without-active-run',
      toolCallId: 'tool-runtime-without-active-run',
      runId: 'run-1',
      stepId: 'step-1',
      actionKind: 'call_tool',
      toolName: 'write_file',
      capabilities: ['workspace_write'],
      riskLevel: 'medium',
      title: 'Write file',
      summary: 'Write README.md',
      preview: {
        action: 'write file',
        targets: [{ kind: 'file', label: 'README.md' }],
      },
      requestedScope: 'once',
      status: 'pending',
      createdAt: '2026-05-10T00:00:01.000Z',
    });

    render(<TasksPanelTab />);

    expect(screen.getByText('No active tasks')).toBeInTheDocument();
    expect(screen.queryByText('Runtime approvals')).not.toBeInTheDocument();
    expect(screen.queryByText('write_file')).not.toBeInTheDocument();
  });

  it('denies pending approval', async () => {
    const resolve = vi.fn();

    useApprovalStore.setState({
      pending: {
        toolCallId: 'approval-2',
        toolName: 'write_file',
        arguments: { path: 'README.md' },
        displayText: 'Write README.md',
      },
      resolve,
    });

    render(<TasksPanelTab />);

    await userEvent.click(screen.getByRole('button', { name: 'Deny write_file' }));

    expect(resolve).toHaveBeenCalledWith(false);
    expect(useApprovalStore.getState().pending).toBeNull();
  });
});
