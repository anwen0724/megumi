// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApprovalCard } from '@megumi/desktop/renderer/entities/approval';
import type { ApprovalRequest } from '@megumi/shared/tool';

const request: ApprovalRequest = {
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
  createdAt: '2026-05-20T00:00:00.000Z',
};

describe('ApprovalCard', () => {
  it('renders the approval request details', () => {
    render(<ApprovalCard request={request} onResolve={() => undefined} />);

    expect(screen.getByText('Approval needed')).toBeInTheDocument();
    expect(screen.getByText('run_command')).toBeInTheDocument();
    expect(screen.getByText('Run npm test')).toBeInTheDocument();
    expect(screen.getByText('npm test')).toBeInTheDocument();
    expect(screen.getByLabelText('Approval scope')).toHaveValue('once');
  });

  it('resolves an approval with the selected scope', async () => {
    const onResolve = vi.fn();

    render(<ApprovalCard request={request} onResolve={onResolve} />);

    await userEvent.selectOptions(screen.getByLabelText('Approval scope'), 'run');
    await userEvent.click(screen.getByRole('button', { name: 'Approve run_command' }));

    expect(onResolve).toHaveBeenCalledWith({
      approvalRequestId: 'approval-1',
      decision: 'approved',
      scope: 'run',
    });
  });

  it('resolves a denial with the selected scope', async () => {
    const onResolve = vi.fn();

    render(<ApprovalCard request={{ ...request, requestedScope: 'project' }} onResolve={onResolve} />);

    await userEvent.click(screen.getByRole('button', { name: 'Deny run_command' }));

    expect(onResolve).toHaveBeenCalledWith({
      approvalRequestId: 'approval-1',
      decision: 'denied',
      scope: 'project',
    });
  });

  it('prefers modelVisibleName over legacy toolName for visible labels and actions', async () => {
    const onResolve = vi.fn();

    render(
      <ApprovalCard
        request={{
          ...request,
          toolName: 'echo',
          modelVisibleName: 'demo_echo',
          canonicalToolId: 'external_test:demo:echo',
          sourceId: 'external_test',
          namespace: 'demo',
          sourceToolName: 'echo',
          summary: 'Echo hello',
          preview: {
            action: 'hello',
            targets: [],
          },
        }}
        onResolve={onResolve}
      />,
    );

    expect(screen.getByText('demo_echo')).toBeInTheDocument();
    expect(screen.queryByText('external_test:demo:echo')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Approve demo_echo' }));

    expect(onResolve).toHaveBeenCalledWith({
      approvalRequestId: 'approval-1',
      decision: 'approved',
      scope: 'once',
    });
  });
});

