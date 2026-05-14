// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TasksPanelTab } from '@megumi/desktop/renderer/features/workspace-panel';
import { useApprovalStore } from '@megumi/desktop/renderer/features/approvals/store';
import { useChatStore } from '@megumi/desktop/renderer/entities/chat/store';
import { useWorkspaceStateStore } from '@megumi/desktop/renderer/entities/workspace-state';

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
  useWorkspaceStateStore.setState({
    tasks: [],
    artifacts: [],
    memoryNotes: [],
    activeRunId: null,
  });
}

describe('TasksPanelTab', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders empty state with no active work', () => {
    render(<TasksPanelTab />);

    expect(screen.getByText('No active tasks')).toBeInTheDocument();
  });

  it('renders workspace run tasks', () => {
    useWorkspaceStateStore.getState().beginMockRun({
      message: 'Start with the shell',
      mode: 'agent',
      model: 'deepseek-v4-pro',
      now: '2026-05-10T00:00:00.000Z',
    });

    render(<TasksPanelTab />);

    expect(screen.getByText('Session tasks')).toBeInTheDocument();
    expect(screen.getByText('Mock agent run')).toBeInTheDocument();
    expect(screen.getByText('Preparing workspace context for "Start with the shell".')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
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
